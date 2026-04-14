import path from 'path';
import {fileURLToPath} from 'url';
import express from 'express';
import {createServer} from 'http';
import {WebSocketServer, WebSocket} from 'ws';
import {mkdirSync, readFileSync} from 'fs';
import Database from 'better-sqlite3';
import {randomBytes, randomUUID} from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'handl.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRUNE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
const SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_LENGTH = 8;

const THEMES = JSON.parse(readFileSync(path.join(__dirname, 'themes.json'), 'utf8'));
const TRANSLATIONS = JSON.parse(readFileSync(path.join(__dirname, 'translations.json'), 'utf8'));

const defaultState = {
  items: [],
  settings: {
    sortChecked: false,
    colorScheme: 'default',
    language: 'en'
  },
  revision: 0
};

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL,
    share_code TEXT NOT NULL UNIQUE,
    last_access INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    created INTEGER NOT NULL,
    FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE
  );
`);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const stateCache = new Map();
const listClients = new Map();

app.get('/session', (req, res) => {
  const providedToken = getString(req.query.token);
  const session = getSession(providedToken);
  res.json(formatSessionResponse(session));
});

app.post('/restore', (req, res) => {
  const code = (req.body?.code ?? '').toString().trim().toUpperCase();
  const providedToken = getString(req.body?.token ?? req.query.token);
  if (!code) {
    res.status(400).json({ error: 'restore code is required' });
    return;
  }
  try {
    const session = restoreWithCode(code, providedToken);
    res.json(formatSessionResponse(session));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/themes.json', (req, res) => res.json(THEMES));
app.get('/translations.json', (req, res) => res.json(TRANSLATIONS));
app.get('/config.json', (req, res) => res.json({ title: 'Handl' }));
app.use(express.static(PUBLIC_DIR, { maxAge: '1d' }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = getString(url.searchParams.get('token'));
    const mapping = getTokenMapping(token);
    if (!mapping) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, mapping.listId);
    });
  } catch (err) {
    socket.destroy();
  }
});

wss.on('connection', (ws, listId) => {
  const state = loadListState(listId);
  if (!state) {
    ws.close();
    return;
  }
  attachClient(listId, ws);
  ws.send(JSON.stringify({ type: 'state', payload: cloneState(state) }));
  ws.on('message', (raw) => handleMessage(raw, listId));
  ws.on('close', () => detachClient(listId, ws));
});

startPruneLoop();

function getSession(token) {
  if (token) {
    const row = db
      .prepare('SELECT l.*, t.token FROM lists l JOIN tokens t ON t.list_id = l.id WHERE t.token = ?')
      .get(token);
    if (row) {
      touchList(row.id);
      return { listId: row.id, shareCode: row.share_code, state: parseState(row), token };
    }
  }
  return createSession(token);
}

function restoreWithCode(code, token) {
  const row = db.prepare('SELECT * FROM lists WHERE share_code = ?').get(code);
  if (!row) {
    throw new Error('share code not found');
  }
  const normalizedToken = ensureToken(token);
  assignToken(normalizedToken, row.id);
  touchList(row.id);
  return { listId: row.id, shareCode: row.share_code, state: parseState(row), token: normalizedToken };
}

function createSession(existingToken) {
  const token = ensureToken(existingToken);
  const { listId, shareCode, state } = createList();
  assignToken(token, listId);
  return { listId, shareCode, state, token };
}

function ensureToken(value) {
  return value?.trim() || randomToken();
}

function randomToken() {
  return randomBytes(16).toString('hex');
}

function assignToken(token, listId) {
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO tokens (token, list_id, created) VALUES (?, ?, ?)').run(token, listId, now);
}

function createList() {
  const id = randomUUID();
  const shareCode = generateShareCode();
  const state = cloneState(defaultState);
  const now = Date.now();
  db.prepare('INSERT INTO lists (id, state, revision, share_code, last_access) VALUES (?, ?, ?, ?, ?)').run(
    id,
    JSON.stringify(state),
    state.revision,
    shareCode,
    now
  );
  stateCache.set(id, state);
  return { listId: id, shareCode, state };
}

function generateShareCode() {
  let code;
  do {
    code = Array.from({ length: SHARE_CODE_LENGTH }, () => SHARE_CODE_ALPHABET[Math.floor(Math.random() * SHARE_CODE_ALPHABET.length)]).join('');
  } while (db.prepare('SELECT 1 FROM lists WHERE share_code = ?').get(code));
  return code;
}

function parseState(row) {
  try {
    const parsed = JSON.parse(row.state);
    return {
      items: Array.isArray(parsed.items) ? normalizeItems(parsed.items) : [],
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
      revision: Number(row.revision ?? defaultState.revision)
    };
  } catch (err) {
    return cloneState(defaultState);
  }
}

function normalizeItems(items) {
  return (
    items
      .map((entry) => {
        const text = typeof entry.text === 'string' ? entry.text.trim() : '';
        if (!text) return null;
        return {
          id: typeof entry.id === 'string' && entry.id ? entry.id : randomUUID(),
          text,
          checked: Boolean(entry.checked),
          rev: typeof entry.rev === 'number' ? entry.rev : 0
        };
      })
      .filter(Boolean)
  );
}

function cloneState(state) {
  return {
    items: state.items.map((item) => ({ ...item })),
    settings: { ...state.settings },
    revision: state.revision
  };
}

function loadListState(listId) {
  if (stateCache.has(listId)) {
    return stateCache.get(listId);
  }
  const row = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
  if (!row) return null;
  const state = parseState(row);
  stateCache.set(listId, state);
  return state;
}

function persistListState(listId, state) {
  const now = Date.now();
  db
    .prepare('UPDATE lists SET state = ?, revision = ?, last_access = ? WHERE id = ?')
    .run(JSON.stringify(state), state.revision, now, listId);
  stateCache.set(listId, state);
}

function touchList(listId) {
  const now = Date.now();
  db.prepare('UPDATE lists SET last_access = ? WHERE id = ?').run(now, listId);
}

function getTokenMapping(token) {
  if (!token) return null;
  const row = db.prepare('SELECT l.id AS listId FROM lists l JOIN tokens t ON t.list_id = l.id WHERE t.token = ?').get(token);
  if (!row) return null;
  touchList(row.listId);
  return row;
}

function handleMessage(raw, listId) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (_) {
    return;
  }
  if (message?.type !== 'state_update' || !message.payload) {
    return;
  }
  const state = loadListState(listId);
  if (!state) return;
  const items = normalizeItems(message.payload.items ?? []);
  const incomingSettings = message.payload.settings;
  if (incomingSettings && typeof incomingSettings.sortChecked === 'boolean') {
    state.settings.sortChecked = incomingSettings.sortChecked;
  }
  if (incomingSettings && typeof incomingSettings.colorScheme === 'string') {
    state.settings.colorScheme = incomingSettings.colorScheme;
  }
  if (incomingSettings && typeof incomingSettings.language === 'string') {
    state.settings.language = incomingSettings.language;
  }
  const baseRevision = Number(message.payload.baseRevision ?? state.revision);
  mergeIncomingItems(state, items, baseRevision);
  applySort(state);
  persistListState(listId, state);
  broadcastState(listId, state);
}

function mergeIncomingItems(state, incomingItems, baseRevision) {
  const newRevision = state.revision + 1;
  const serverMap = new Map(state.items.map((item) => [item.id, item]));
  const incomingOrder = new Set();
  const merged = [];
  for (const incoming of incomingItems) {
    incomingOrder.add(incoming.id);
    const serverItem = serverMap.get(incoming.id);
    if (serverItem) {
      const serverChanged = serverItem.rev > baseRevision;
      const textChanged = serverItem.text !== incoming.text;
      const checkedChanged = serverItem.checked !== incoming.checked;
      if (serverChanged && (textChanged || checkedChanged)) {
        merged.push(serverItem);
        merged.push({
          ...incoming,
          id: randomUUID(),
          rev: newRevision
        });
      } else if (serverChanged) {
        merged.push(serverItem);
      } else {
        merged.push({
          ...serverItem,
          text: incoming.text,
          checked: incoming.checked,
          rev: newRevision
        });
      }
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

function applySort(state) {
  if (!state.settings.sortChecked) return;
  state.items.sort((a, b) => {
    if (a.checked === b.checked) return 0;
    return a.checked ? 1 : -1;
  });
}

function broadcastState(listId, state) {
  const clients = listClients.get(listId);
  if (!clients) return;
  const payload = JSON.stringify({ type: 'state', payload: cloneState(state) });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function attachClient(listId, ws) {
  const clients = listClients.get(listId) ?? new Set();
  clients.add(ws);
  listClients.set(listId, clients);
}

function detachClient(listId, ws) {
  const clients = listClients.get(listId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) {
    listClients.delete(listId);
  }
}

function startPruneLoop() {
  setInterval(() => {
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    db.prepare('DELETE FROM lists WHERE last_access < ?').run(cutoff);
  }, 60 * 60 * 1000);
}

function getString(value) {
  if (!value) return null;
  return value.toString();
}

function formatShareCode(code) {
  return code?.trim().toUpperCase() || '';
}

function formatSessionResponse(session) {
  const state = session.state || cloneState(defaultState);
  return {
    token: session.token,
    listId: session.listId,
    shareCode: formatShareCode(session.shareCode),
    state: cloneState(state)
  };
}

console.log('Starting Handl with SQLite persistence...');
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
