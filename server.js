import path from 'path';
import {fileURLToPath} from 'url';
import express from 'express';
import {createServer} from 'http';
import {WebSocketServer} from 'ws';
import {mkdir, readFile, writeFile} from 'fs/promises';
import {randomUUID, createHash, timingSafeEqual} from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'list.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const HANDL_PASSWORD = process.env.HANDL_PASSWORD?.trim();
const AUTH_COOKIE_NAME = 'handl_auth';
const hashedPassword = HANDL_PASSWORD ? createHash('sha256').update(HANDL_PASSWORD).digest('hex') : null;
const rawCookieMaxAge = process.env.HANDL_COOKIE_MAXAGE?.trim();
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const HANDL_COOKIE_MAXAGE = (() => {
  if (!rawCookieMaxAge) return 30 * 24 * 60 * 60;
  const normalized = rawCookieMaxAge.toLowerCase();
  if (normalized === 'none') return null;
  if (normalized === 'inf' || normalized === 'infinite') return YEAR_SECONDS;
  const parsed = Number(rawCookieMaxAge);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30 * 24 * 60 * 60;
  return parsed;
})();
const HANDL_TITLE = process.env.HANDL_TITLE?.trim() || 'Handl';
const LOGIN_STRINGS = {
  en: {
    heading: 'Unlock',
    passwordLabel: 'Password',
    submit: 'Enter',
    invalid: 'Incorrect password.'
  },
  no: {
    heading: 'Lås opp',
    passwordLabel: 'Passord',
    submit: 'Skriv inn',
    invalid: 'Feil passord.'
  },
  es: {
    heading: 'Desbloquear',
    passwordLabel: 'Contraseña',
    submit: 'Entrar',
    invalid: 'Contraseña incorrecta.'
  },
  sv: {
    heading: 'Koppla upp',
    passwordLabel: 'Lösenord',
    submit: 'Logga in',
    invalid: 'Fel lösenord.'
  },
  da: {
    heading: 'Lås op',
    passwordLabel: 'Adgangskode',
    submit: 'Indtast',
    invalid: 'Forkert adgangskode.'
  },
  fi: {
    heading: 'Avaa',
    passwordLabel: 'Salasana',
    submit: 'Syötä',
    invalid: 'Väärä salasana.'
  },
  de: {
    heading: 'Entsperren',
    passwordLabel: 'Passwort',
    submit: 'Einloggen',
    invalid: 'Falsches Passwort.'
  },
  nl: {
    heading: 'Ontgrendel',
    passwordLabel: 'Wachtwoord',
    submit: 'Inloggen',
    invalid: 'Onjuist wachtwoord.'
  },
  fr: {
    heading: 'Déverrouiller',
    passwordLabel: 'Mot de passe',
    submit: 'Entrer',
    invalid: 'Mot de passe incorrect.'
  },
  pt: {
    heading: 'Desbloquear',
    passwordLabel: 'Senha',
    submit: 'Entrar',
    invalid: 'Senha incorreta.'
  },
  it: {
    heading: 'Sblocca',
    passwordLabel: 'Password',
    submit: 'Entra',
    invalid: 'Password errata.'
  }
};

const LOGIN_THEME = {
  default: {
    body: 'radial-gradient(circle at top, rgba(59, 130, 246, 0.25), transparent 45%), #050816',
    panel: '#0f172a',
    border: 'rgba(148, 163, 184, 0.3)',
    button: '#2563eb',
    buttonHover: '#1d4ed8'
  },
  dracula: {
    body: 'radial-gradient(circle at top, rgba(255, 121, 198, 0.25), transparent 45%), #0b0e17',
    panel: 'rgba(7, 8, 18, 0.95)',
    border: 'rgba(255, 121, 198, 0.45)',
    button: '#bd93f9',
    buttonHover: '#a074e4'
  },
  catppuccin: {
    body: 'radial-gradient(circle at top, rgba(245, 194, 231, 0.4), transparent 45%), #1b1727',
    panel: 'rgba(27, 24, 39, 0.95)',
    border: 'rgba(248, 250, 252, 0.3)',
    button: '#f38ba8',
    buttonHover: '#eb6f92'
  }
};

const getLoginLocale = () => LOGIN_STRINGS[state.settings.language] ?? LOGIN_STRINGS.en;
const getLoginTheme = () => LOGIN_THEME[state.settings.colorScheme] ?? LOGIN_THEME.default;

const STARTUP_ASCII = String.raw`
  _   _                 _ _
 | | | | __ _ _ __   __| | |
 | |_| |/ _' | '_ \ / _' | |
 |  _  | (_| | | | | (_| | |
 |_| |_|\__,_|_| |_|\__,_|_|
`;

const defaultState = {
  items: [],
  settings: {
    sortChecked: false,
    colorScheme: 'default',
    language: 'en'
  },
  revision: 0
};

let state = { ...defaultState };

const app = express();
app.use(express.urlencoded({ extended: false }));

const getLoginPageContext = () => ({
  language: state.settings.language ?? 'en',
  scheme: state.settings.colorScheme ?? 'default'
});

const authCookieAttributes = () => {
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (HANDL_COOKIE_MAXAGE !== null) {
    parts.unshift(`Max-Age=${HANDL_COOKIE_MAXAGE}`);
  }
  return parts.join('; ');
};

const loginPage = ({ language = 'en', scheme = 'default', error = '' } = {}) => {
  const locale = LOGIN_STRINGS[language] || LOGIN_STRINGS.en;
  const theme = LOGIN_THEME[scheme] || LOGIN_THEME.default;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Handl login</title>
    <style>
      :root {
        font-family: system-ui, sans-serif;
        background: #050816;
        color: #e2e8f0;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${theme.body};
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        background: ${theme.panel};
        padding: 2rem;
        border-radius: 1.1rem;
        border: 1px solid ${theme.border};
        width: min(360px, 95vw);
        box-shadow: 0 15px 35px rgba(2, 6, 23, 0.65);
      }
      h2 {
        margin: 0;
        font-size: 1.6rem;
        color: #fff;
      }
      .field-label {
        font-size: 0.75rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(148, 163, 184, 0.9);
        margin-bottom: 0.25rem;
      }
      .field-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      input,
      select {
        padding: 0.85rem 0.9rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(148, 163, 184, 0.5);
        background: #020617;
        color: #e2e8f0;
        font-size: 1rem;
      }
      input:focus,
      select:focus {
        outline: 2px solid rgba(59, 130, 246, 0.7);
        outline-offset: 2px;
      }
      button {
        padding: 0.85rem;
        border: none;
        border-radius: 0.75rem;
        background: ${theme.button};
        color: #fff;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      button:hover {
        background: ${theme.buttonHover};
        transform: translateY(-1px);
      }
      .hint {
        color: rgba(148, 163, 184, 0.9);
        font-size: 0.85rem;
      }
      .error {
        color: #fecdd3;
        font-size: 0.9rem;
        margin: 0;
      }
    </style>
  </head>
  <body>
      <form method="POST">
      <h2>${locale.heading} ${HANDL_TITLE}</h2>
      ${error ? `<p class="error">${error}</p>` : ''}
      <div class="field-group">
        <span class="field-label">${locale.passwordLabel}</span>
        <input type="password" name="password" required autofocus />
      </div>
      <button type="submit">${locale.submit}</button>
    </form>
  </body>
</html>`;
};

const PUBLIC_ASSET_MAP = {
  '/manifest.json': 'manifest.json',
  '/icon.svg': 'icon.svg',
  '/icon-192.png': 'icon-192.png',
  '/icon-512.png': 'icon-512.png',
  '/sw.js': 'sw.js'
};

for (const [url, filename] of Object.entries(PUBLIC_ASSET_MAP)) {
  app.get(url, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, filename));
  });
}

app.get('/config.json', (req, res) => {
  res.json({ title: HANDL_TITLE });
});

app.use((req, res, next) => {
  if (!hashedPassword) return next();
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[AUTH_COOKIE_NAME] === hashedPassword) return next();
  if (req.path === '/login' || req.path === '/login/' || req.path.startsWith('/login?')) return next();
  if (req.method === 'POST' && req.path === '/login') return next();
  res.status(302).setHeader('Location', '/login').end();
});

app.post('/login', (req, res) => {
  if (!hashedPassword) {
    res.status(404).end();
    return;
  }
  const password = (req.body.password ?? '').toString();
  const context = getLoginPageContext();
  const locale = LOGIN_STRINGS[context.language] || LOGIN_STRINGS.en;
  const candidateHash = createHash('sha256').update(password).digest('hex');
  if (timingSafeEqual(Buffer.from(candidateHash), Buffer.from(hashedPassword))) {
    res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${hashedPassword}; ${authCookieAttributes()}`);
    res.redirect('/');
  } else {
    res.status(401).send(loginPage({ ...context, error: locale.invalid }));
  }
});

app.get('/login', (req, res) => {
  if (!hashedPassword) {
    res.redirect('/');
    return;
  }
  res.send(loginPage(getLoginPageContext()));
});

app.use(express.static(PUBLIC_DIR, { maxAge: '1d' }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const cookies = parseCookies(req.headers.cookie);
  if (hashedPassword && cookies[AUTH_COOKIE_NAME] !== hashedPassword) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

function parseCookies(header) {
  if (!header) return {};
  return header
    .split(';')
    .map((chunk) => chunk.split('='))
    .reduce((acc, pair) => {
      if (pair.length === 2) {
        acc[pair[0].trim()] = pair[1];
      }
      return acc;
    }, {});
}

async function ensureDataDir() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to ensure data directory', err);
    throw err;
  }
}

async function loadState() {
  try {
    const json = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(json);
    if (parsed && Array.isArray(parsed.items) && typeof parsed.settings === 'object') {
      state = {
        items: normalizeItems(parsed.items),
        settings: { ...defaultState.settings, ...parsed.settings },
        revision: typeof parsed.revision === 'number' ? parsed.revision : defaultState.revision
      };
      applySort();
      return;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to load state', err);
    }
  }
  state = { ...defaultState, items: normalizeItems(defaultState.items) };
  await persistState();
}

async function persistState() {
  try {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist state', err);
  }
}

function normalizeItems(items) {
  const normalized = [];
  for (const entry of items) {
    if (!entry) continue;
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!text) continue;
    normalized.push({
      id: typeof entry.id === 'string' && entry.id ? entry.id : randomUUID(),
      text,
      checked: Boolean(entry.checked),
      rev: typeof entry.rev === 'number' ? entry.rev : 0
    });
  }
  return normalized;
}

function applySort() {
  if (!state.settings.sortChecked) {
    return;
  }
  state.items.sort((a, b) => {
    if (a.checked === b.checked) {
      return 0;
    }
    return a.checked ? 1 : -1;
  });
}

function mergeIncomingItems(incomingItems, baseRevision) {
  const newRevision = state.revision + 1;
  const serverMap = new Map(state.items.map((item) => [item.id, item]));
  const incomingOrder = new Set();
  const merged = [];

  for (const incoming of incomingItems) {
    incomingOrder.add(incoming.id);
    const serverItem = serverMap.get(incoming.id);
    if (serverItem) {
      merged.push({
        ...serverItem,
        text: incoming.text,
        checked: incoming.checked,
        rev: newRevision
      });
    } else {
      merged.push({
        ...incoming,
        rev: newRevision
      });
    }
  }

  for (const serverItem of state.items) {
    if (!incomingOrder.has(serverItem.id) && serverItem.rev > baseRevision) {
      merged.push(serverItem);
    }
  }

  state.items = merged;
  state.revision = newRevision;
}

function broadcastState() {
  const payload = JSON.stringify({ type: 'state', payload: state });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

function handleMessage(raw, ws) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch (err) {
    console.warn('Malformed ws message', err);
    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Malformed message' } }));
    return;
  }

  if (message?.type === 'state_update' && message.payload) {
    const items = normalizeItems(message.payload.items ?? []);
    const incomingSettings = message.payload.settings;
    const settings = { ...state.settings };
    if (incomingSettings && typeof incomingSettings.sortChecked === 'boolean') {
      settings.sortChecked = incomingSettings.sortChecked;
    }
    if (incomingSettings && typeof incomingSettings.colorScheme === 'string') {
      settings.colorScheme = incomingSettings.colorScheme;
    }
    if (incomingSettings && typeof incomingSettings.language === 'string') {
      settings.language = incomingSettings.language;
    }

    const baseRevision = Number(message.payload.baseRevision ?? state.revision);
    mergeIncomingItems(items, baseRevision);
    state.settings = settings;
    applySort();
    persistState();
    broadcastState();
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', payload: state }));
  ws.on('message', (raw) => handleMessage(raw, ws));
  ws.on('error', (err) => console.warn('ws error', err));
});

(async () => {
  await ensureDataDir();
  await loadState();
  console.log(STARTUP_ASCII);
  console.log(
    `Settings: colorScheme=${state.settings.colorScheme}, language=${state.settings.language}, sortChecked=${state.settings.sortChecked}`
  );
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
})();
