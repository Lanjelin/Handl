import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import express from 'express';
import {createServer} from 'http';
import {WebSocketServer, WebSocket} from 'ws';
import {existsSync, mkdirSync, readFileSync} from 'fs';
import Database from 'better-sqlite3';
import {randomBytes, randomUUID, timingSafeEqual} from 'crypto';
import * as Automerge from '@automerge/automerge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const BOOT_DATA_DIR = process.env.DATA_DIR ? path.resolve(__dirname, process.env.DATA_DIR) : DEFAULT_DATA_DIR;

loadEnvFile(path.join(BOOT_DATA_DIR, '.env'));

// Runtime tuning knobs:
// - PORT / DATA_DIR / DB_FILE / PUBLIC_DIR control process binding and storage paths.
// - PRUNE_AFTER_MS evicts very old inactive lists.
// - PERSIST_DEBOUNCE_MS / PERSIST_MAX_DELAY_MS reduce SQLite write churn.
// - BROADCAST_DEBOUNCE_MS batches websocket fanout during bursts.
// - COMPACT_IDLE_DELAY_MS delays doc compaction until the list has been idle.
// - HEARTBEAT_MS sends a tiny websocket heartbeat to detect stale connections.
// - SHARE_CODE_LENGTH / SHARE_CODE_ALPHABET control restore code generation.
// - PASSWORD enables a simple login gate when set.
// - DEBUG_METRICS enables lightweight client-side connection timing logs.
// - METRICS_WINDOW_MS controls the rolling request window exposed by /metrics.
const PORT = readEnvInt('PORT', 3000);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(__dirname, process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const DB_FILE = process.env.DB_FILE ? path.resolve(__dirname, process.env.DB_FILE) : path.join(DATA_DIR, 'handl.db');
const PUBLIC_DIR = process.env.PUBLIC_DIR ? path.resolve(__dirname, process.env.PUBLIC_DIR) : path.join(__dirname, 'public');
const AUTOMERGE_MJS_DIR = path.join(__dirname, 'node_modules/@automerge/automerge/dist/mjs');
const PRUNE_AFTER_MS = readEnvInt('PRUNE_AFTER_MS', 180 * 24 * 60 * 60 * 1000);
const PERSIST_DEBOUNCE_MS = readEnvInt('PERSIST_DEBOUNCE_MS', 750);
const PERSIST_MAX_DELAY_MS = readEnvInt('PERSIST_MAX_DELAY_MS', 30 * 1000);
const BROADCAST_DEBOUNCE_MS = readEnvInt('BROADCAST_DEBOUNCE_MS', 50);
const COMPACT_IDLE_DELAY_MS = readEnvInt('COMPACT_IDLE_DELAY_MS', 2 * 60 * 1000);
const HEARTBEAT_MS = readEnvInt('HEARTBEAT_MS', 15000);
const METRICS_WINDOW_MS = readEnvInt('METRICS_WINDOW_MS', 15 * 60 * 1000);
const SHARE_CODE_ALPHABET = process.env.SHARE_CODE_ALPHABET || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_LENGTH = readEnvInt('SHARE_CODE_LENGTH', 8);
const DEBUG_METRICS = readEnvBool('DEBUG_METRICS', false);
const AUTH_PASSWORD = process.env.PASSWORD || '';
const AUTH_ENABLED = AUTH_PASSWORD.length > 0;
const AUTH_COOKIE = 'handl-auth';

const authTokens = new Set();

const THEMES = JSON.parse(readFileSync(path.join(__dirname, 'themes.json'), 'utf8'));
const TRANSLATIONS = JSON.parse(readFileSync(path.join(__dirname, 'translations.json'), 'utf8'));
const INDEX_HTML = readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    doc BLOB,
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
app.use(trackRequest);

const stateCache = new Map();
const listClients = new Map();
const persistTimers = new Map();
const forcePersistTimers = new Map();
const broadcastTimers = new Map();
const compactTimers = new Map();
const requestEvents = [];
let pruneLoopTimer = null;
let heartbeatLoopTimer = null;
let shutdownInProgress = false;
let shutdownPromise = null;
const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

ensureListSchema();
startHeartbeatLoop();

app.get('/session', (req, res) => {
  if (!assertAuthenticated(req, res)) return;
  const providedToken = getString(req.query.token);
  const session = getSession(providedToken);
  res.json(formatSessionResponse(session));
});

app.post('/restore', (req, res) => {
  if (!assertAuthenticated(req, res)) return;
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

app.post('/join', (req, res) => {
  if (!assertAuthenticated(req, res)) return;
  const code = (req.body?.code ?? req.body?.shareCode ?? req.body?.listId ?? '').toString().trim().toUpperCase();
  const providedToken = getString(req.body?.token ?? req.query.token);
  if (!code) {
    res.status(400).json({ error: 'share code is required' });
    return;
  }
  try {
    const session = restoreWithCode(code, providedToken);
    res.json(formatSessionResponse(session));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/auth/status', (req, res) => res.json({ authRequired: AUTH_ENABLED, authenticated: isAuthenticated(req) }));

app.post('/auth', (req, res) => {
  if (!AUTH_ENABLED) {
    res.json({ authRequired: false, authenticated: true });
    return;
  }
  const token = authenticatePassword((req.body?.password ?? '').toString());
  if (!token) {
    res.status(401).json({ error: 'invalid password' });
    return;
  }
  setAuthCookie(res, token);
  res.json({ authRequired: true, authenticated: true });
});

app.get('/themes.json', (req, res) => res.json(THEMES));
app.get('/translations.json', (req, res) => res.json(TRANSLATIONS));
app.get('/config.json', (req, res) => res.json({ title: 'Handl', debugMetrics: DEBUG_METRICS, authRequired: AUTH_ENABLED }));
app.get('/metrics', (req, res) => {
  if (!assertAuthenticated(req, res)) return;
  res.json(buildMetrics());
});
app.get(['/', '/index.html'], (req, res) => {
  res.type('html');
  res.send(renderIndexHtml(!isAuthenticated(req)));
});
app.use('/vendor/automerge', express.static(AUTOMERGE_MJS_DIR, { maxAge: 0 }));
app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
    if (!isAuthenticated(req)) {
      socket.destroy();
      return;
    }
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
  const record = loadListRecord(listId);
  if (!record) {
    ws.close();
    return;
  }
  const client = { ws, syncState: Automerge.initSyncState() };
  attachClient(listId, client);
  broadcastPresence(listId);
  drainSyncMessages(listId);
  ws.on('message', (raw) => handleMessage(raw, listId, client));
  ws.on('close', () => detachClient(listId, client));
});

startPruneLoop();

function getSession(token) {
  if (token) {
    const row = db
      .prepare('SELECT l.*, t.token FROM lists l JOIN tokens t ON t.list_id = l.id WHERE t.token = ?')
      .get(token);
    if (row) {
      touchList(row.id);
      return { listId: row.id, shareCode: row.share_code, record: loadListRecord(row.id), token };
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
  return { listId: row.id, shareCode: row.share_code, record: loadListRecord(row.id), token: normalizedToken };
}

function createSession(existingToken) {
  const token = ensureToken(existingToken);
  const { listId, shareCode } = createList();
  assignToken(token, listId);
  return { listId, shareCode, record: loadListRecord(listId), token };
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
  const doc = createInitialDoc();
  const state = snapshotFromDoc(doc);
  const now = Date.now();
  db.prepare('INSERT INTO lists (id, state, doc, share_code, last_access) VALUES (?, ?, ?, ?, ?)').run(
    id,
    JSON.stringify(state),
    Buffer.from(Automerge.save(doc)),
    shareCode,
    now
  );
  stateCache.set(id, { doc, state, dirty: false });
  return { listId: id, shareCode };
}

function generateShareCode() {
  let code;
  do {
    code = Array.from({ length: SHARE_CODE_LENGTH }, () => SHARE_CODE_ALPHABET[Math.floor(Math.random() * SHARE_CODE_ALPHABET.length)]).join('');
  } while (db.prepare('SELECT 1 FROM lists WHERE share_code = ?').get(code));
  return code;
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
          checked: Boolean(entry.checked)
        };
      })
      .filter(Boolean)
  );
}

function createInitialDoc() {
  let doc = Automerge.init();
  doc = Automerge.change(doc, (draft) => {
    draft.items = [];
  });
  return doc;
}

function snapshotFromDoc(doc) {
  const raw = Automerge.toJS(doc) || {};
  return {
    items: Array.isArray(raw.items) ? normalizeItems(raw.items) : []
  };
}

function docFromSnapshot(snapshot) {
  return Automerge.change(Automerge.init(), (draft) => {
    draft.items = Array.isArray(snapshot.items) ? normalizeItems(snapshot.items) : [];
  });
}

function loadListRecord(listId) {
  if (stateCache.has(listId)) {
    return stateCache.get(listId);
  }
  const row = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
  if (!row) return null;
  let doc = null;
  if (row.doc) {
    try {
      doc = Automerge.load(toUint8Array(row.doc));
    } catch (error) {
      doc = null;
    }
  }
  if (!doc) {
    try {
      const snapshot = JSON.parse(row.state);
      doc = docFromSnapshot(snapshot);
    } catch (error) {
      doc = createInitialDoc();
    }
  }
  const state = snapshotFromDoc(doc);
  const record = { doc, state, dirty: false };
  stateCache.set(listId, record);
  if (!row.doc) {
    persistListRecord(listId, record);
  }
  return record;
}

function persistListRecord(listId, record) {
  const now = Date.now();
  const state = snapshotFromDoc(record.doc);
  db
    .prepare('UPDATE lists SET state = ?, doc = ?, last_access = ? WHERE id = ?')
    .run(JSON.stringify(state), Buffer.from(Automerge.save(record.doc)), now, listId);
  record.state = state;
  record.dirty = false;
  stateCache.set(listId, record);
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

function handleMessage(raw, listId, client) {
  const record = loadListRecord(listId);
  if (!record) return;
  const message = toUint8Array(raw);
  if (!message) return;
  try {
    const [nextDoc, nextSyncState] = Automerge.receiveSyncMessage(record.doc, client.syncState, message);
    record.doc = nextDoc;
    client.syncState = nextSyncState;
    markListDirty(listId);
    scheduleBroadcast(listId);
  } catch (error) {
    console.warn('Failed to process sync message', error);
  }
}

function drainSyncMessages(listId) {
  const record = loadListRecord(listId);
  if (!record) return;
  const clients = listClients.get(listId);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    while (true) {
      const [nextSyncState, message] = Automerge.generateSyncMessage(record.doc, client.syncState);
      client.syncState = nextSyncState;
      if (!message) break;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

function attachClient(listId, client) {
  cancelCompact(listId);
  const clients = listClients.get(listId) ?? new Set();
  clients.add(client);
  listClients.set(listId, clients);
}

function detachClient(listId, client) {
  const clients = listClients.get(listId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) {
    listClients.delete(listId);
    cancelPersistTimers(listId);
    cancelBroadcast(listId);
    scheduleCompact(listId);
    return;
  }
  broadcastPresence(listId);
}

function markListDirty(listId) {
  const record = loadListRecord(listId);
  if (!record) return;
  record.dirty = true;

  const existingDebounce = persistTimers.get(listId);
  if (existingDebounce) {
    clearTimeout(existingDebounce);
  }
  persistTimers.set(
    listId,
    setTimeout(() => {
      persistTimers.delete(listId);
      flushListRecord(listId, { compact: false, evict: false });
    }, PERSIST_DEBOUNCE_MS)
  );

  if (!forcePersistTimers.has(listId)) {
    forcePersistTimers.set(
      listId,
      setTimeout(() => {
        forcePersistTimers.delete(listId);
        flushListRecord(listId, { compact: false, evict: false });
      }, PERSIST_MAX_DELAY_MS)
    );
  }
}

function cancelPersistTimers(listId) {
  const debounce = persistTimers.get(listId);
  if (debounce) {
    clearTimeout(debounce);
    persistTimers.delete(listId);
  }
  const force = forcePersistTimers.get(listId);
  if (force) {
    clearTimeout(force);
    forcePersistTimers.delete(listId);
  }
}

function scheduleBroadcast(listId) {
  if (broadcastTimers.has(listId)) return;
  broadcastTimers.set(
    listId,
    setTimeout(() => {
      broadcastTimers.delete(listId);
      drainSyncMessages(listId);
    }, BROADCAST_DEBOUNCE_MS)
  );
}

function cancelBroadcast(listId) {
  const timer = broadcastTimers.get(listId);
  if (!timer) return;
  clearTimeout(timer);
  broadcastTimers.delete(listId);
}

function broadcastPresence(listId) {
  const clients = listClients.get(listId);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(
        JSON.stringify({
          type: 'presence',
          connected: Math.max(clients.size - 1, 0)
        })
      );
    }
  }
}

function broadcastHeartbeat(listId) {
  const clients = listClients.get(listId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify({ type: 'heartbeat', ts: Date.now() });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function flushListRecord(listId, { compact = false, evict = false } = {}) {
  const record = loadListRecord(listId);
  if (!record) return false;
  const clients = listClients.get(listId);
  if (clients && clients.size > 0 && evict) {
    return false;
  }

  if (!record.dirty && !compact && !evict) {
    return true;
  }

  try {
    if (compact) {
      const snapshot = snapshotFromDoc(record.doc);
      record.doc = docFromSnapshot(snapshot);
    }
    persistListRecord(listId, record);
    return true;
  } catch (error) {
    console.warn(`Failed to persist list ${listId}`, error);
    return false;
  } finally {
    if (!record.dirty) {
      cancelPersistTimers(listId);
    }
    if (evict) {
      const latestClients = listClients.get(listId);
      if (!latestClients || latestClients.size === 0) {
        stateCache.delete(listId);
      }
    }
  }
}

function scheduleCompact(listId) {
  if (compactTimers.has(listId)) return;
  const timer = setTimeout(() => {
    compactTimers.delete(listId);
    compactList(listId);
  }, COMPACT_IDLE_DELAY_MS);
  compactTimers.set(listId, timer);
}

function cancelCompact(listId) {
  const timer = compactTimers.get(listId);
  if (!timer) return;
  clearTimeout(timer);
  compactTimers.delete(listId);
}

function compactList(listId) {
  const clients = listClients.get(listId);
  if (clients && clients.size > 0) {
    return;
  }
  const flushed = flushListRecord(listId, { compact: true, evict: true });
  if (flushed) {
    console.log(`Compacted Automerge doc for list ${listId}`);
  }
}

function startPruneLoop() {
  pruneLoopTimer = setInterval(() => {
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    const rows = db.prepare('SELECT id FROM lists WHERE last_access < ?').all(cutoff);
    db.prepare('DELETE FROM lists WHERE last_access < ?').run(cutoff);
    for (const row of rows) {
      stateCache.delete(row.id);
      cancelPersistTimers(row.id);
      cancelBroadcast(row.id);
      cancelCompact(row.id);
      const clients = listClients.get(row.id);
      if (clients) {
        for (const client of clients) {
          client.ws.close();
        }
        listClients.delete(row.id);
      }
    }
  }, 60 * 60 * 1000);
}

function startHeartbeatLoop() {
  heartbeatLoopTimer = setInterval(() => {
    for (const listId of listClients.keys()) {
      broadcastHeartbeat(listId);
    }
  }, HEARTBEAT_MS);
}

function trackRequest(req, res, next) {
  const pathKey = `${req.method} ${req.path}`;
  const now = Date.now();
  requestEvents.push({ pathKey, ts: now });
  pruneRequestEvents(now);
  next();
}

function pruneRequestEvents(now = Date.now()) {
  const cutoff = now - METRICS_WINDOW_MS;
  while (requestEvents.length > 0 && requestEvents[0].ts < cutoff) {
    requestEvents.shift();
  }
}

function buildMetrics() {
  const now = Date.now();
  pruneRequestEvents(now);
  const recentRequests = {};
  for (const entry of requestEvents) {
    recentRequests[entry.pathKey] = (recentRequests[entry.pathKey] || 0) + 1;
  }
  const activeWebsocketClients = Array.from(listClients.values()).reduce((sum, clients) => sum + clients.size, 0);
  const totalLists = db.prepare('SELECT COUNT(*) AS count FROM lists').get().count;
  const memory = process.memoryUsage();
  return {
    now,
    windowMs: METRICS_WINDOW_MS,
    totalLists,
    cachedLists: stateCache.size,
    trackedLists: listClients.size,
    activeWebsocketClients,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers
    },
    timers: {
      persist: persistTimers.size,
      forcePersist: forcePersistTimers.size,
      broadcast: broadcastTimers.size,
      compact: compactTimers.size
    },
    recentRequests
  };
}

function logStartupSummary() {
  console.log('');
  console.info('server');
  console.info(`  port=${PORT}`);
  console.info(`  dataDir=${DATA_DIR}`);
  console.info(`  dbFile=${DB_FILE}`);
  console.log('');
  console.info('config');
  console.info(`  auth=${AUTH_ENABLED ? 'on' : 'off'}`);
  console.info(`  prune=${PRUNE_AFTER_MS}`);
  console.info(`  persist=${PERSIST_DEBOUNCE_MS}/${PERSIST_MAX_DELAY_MS}`);
  console.info(`  broadcast=${BROADCAST_DEBOUNCE_MS}`);
  console.info(`  compact=${COMPACT_IDLE_DELAY_MS}`);
  console.info(`  heartbeat=${HEARTBEAT_MS}`);
  console.info(`  metricsWindow=${METRICS_WINDOW_MS}`);
  console.info(`  debugMetrics=${DEBUG_METRICS ? 'on' : 'off'}`);
  console.log('');
}

function getString(value) {
  if (!value) return null;
  return value.toString();
}

function isAuthenticated(req) {
  if (!AUTH_ENABLED) return true;
  const token = getCookieValue(req.headers.cookie || '', AUTH_COOKIE);
  return Boolean(token && authTokens.has(token));
}

function authenticatePassword(password) {
  if (!AUTH_ENABLED) return randomBytes(24).toString('hex');
  if (!timingSafeEquals(password, AUTH_PASSWORD)) {
    return null;
  }
  const token = randomBytes(24).toString('hex');
  authTokens.add(token);
  return token;
}

function assertAuthenticated(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: 'authentication required' });
  return false;
}

function setAuthCookie(res, token) {
  const parts = [
    `${AUTH_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=2592000'
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  const part = cookieHeader.split(';').map((chunk) => chunk.trim()).find((chunk) => chunk.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}

function timingSafeEquals(left, right) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

function renderIndexHtml(authLocked = false) {
  return authLocked ? INDEX_HTML.replace('<body>', '<body class="auth-locked">') : INDEX_HTML;
}

function readEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toString().trim().toLowerCase());
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex < 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      if (!key || process.env[key] != null) continue;
      let value = trimmed.slice(equalsIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn('Failed to load .env file', error);
  }
}

function formatShareCode(code) {
  return code?.trim().toUpperCase() || '';
}

function formatSessionResponse(session) {
  const record = session.record || { doc: createInitialDoc(), state: snapshotFromDoc(createInitialDoc()) };
  return {
    token: session.token,
    listId: session.listId,
    shareCode: formatShareCode(session.shareCode),
    state: snapshotFromDoc(record.doc),
    doc: bytesToBase64(Automerge.save(record.doc))
  };
}

function ensureListSchema() {
  const columns = db.prepare('PRAGMA table_info(lists)').all().map((row) => row.name);
  if (!columns.includes('doc')) {
    db.exec('ALTER TABLE lists ADD COLUMN doc BLOB');
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function bytesToBase64(bytes) {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < uint8.length; index += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(index, index + chunkSize));
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

if (isMainModule) {
  console.log('Starting Handl');
  logStartupSummary();
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });
  startServer().then((port) => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

export {
  app,
  server,
  startServer,
  closeServer,
  authenticatePassword,
  restoreWithCode,
  createInitialDoc,
  snapshotFromDoc,
  docFromSnapshot
};

function shutdown(signal) {
  closeServer({ signal, log: true }).finally(() => process.exit(0));
}

async function closeServer({ signal = 'manual', log = true } = {}) {
  if (shutdownPromise) return shutdownPromise;
  shutdownInProgress = true;
  shutdownPromise = new Promise((resolve) => {
    if (log) {
      console.log('');
      console.info('server');
      console.info(`  shutdown=${signal}`);
      console.log('');
    }

    if (pruneLoopTimer) {
      clearInterval(pruneLoopTimer);
      pruneLoopTimer = null;
    }
    if (heartbeatLoopTimer) {
      clearInterval(heartbeatLoopTimer);
      heartbeatLoopTimer = null;
    }
    for (const timer of persistTimers.values()) clearTimeout(timer);
    for (const timer of forcePersistTimers.values()) clearTimeout(timer);
    for (const timer of broadcastTimers.values()) clearTimeout(timer);
    for (const timer of compactTimers.values()) clearTimeout(timer);
    persistTimers.clear();
    forcePersistTimers.clear();
    broadcastTimers.clear();
    compactTimers.clear();

    for (const clients of listClients.values()) {
      for (const client of clients) {
        try {
          client.ws.close();
        } catch (error) {
          // ignore
        }
      }
    }

    if (!server.listening) {
      try {
        db.close();
      } catch (error) {
        // ignore
      }
      resolve();
      return;
    }

    const forceExit = setTimeout(() => {
      try {
        db.close();
      } catch (error) {
        // ignore
      }
      resolve();
    }, 5000);
    forceExit.unref?.();

    server.close(() => {
      try {
        db.close();
      } catch (error) {
        // ignore
      }
      clearTimeout(forceExit);
      resolve();
    });
  });
  return shutdownPromise;
}

function startServer(port = PORT, { host } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const onListen = () => {
        resolve(server.address().port);
      };
      if (host) {
        server.listen(port, host, onListen);
      } else {
        server.listen(port, onListen);
      }
    } catch (error) {
      reject(error);
    }
  });
}
