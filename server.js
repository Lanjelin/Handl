import path from 'path';
import {fileURLToPath} from 'url';
import express from 'express';
import {createServer} from 'http';
import {WebSocketServer, WebSocket} from 'ws';
import {mkdirSync, readFileSync} from 'fs';
import Database from 'better-sqlite3';
import {randomBytes, randomUUID} from 'crypto';
import * as Automerge from '@automerge/automerge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'handl.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTOMERGE_MJS_DIR = path.join(__dirname, 'node_modules/@automerge/automerge/dist/mjs');
const PRUNE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
const SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_LENGTH = 8;

const THEMES = JSON.parse(readFileSync(path.join(__dirname, 'themes.json'), 'utf8'));
const TRANSLATIONS = JSON.parse(readFileSync(path.join(__dirname, 'translations.json'), 'utf8'));

const defaultSnapshot = {
  items: []
};

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

const stateCache = new Map();
const listClients = new Map();

ensureListSchema();

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
app.use('/vendor/automerge', express.static(AUTOMERGE_MJS_DIR, { maxAge: 0 }));
app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));

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
  const record = loadListRecord(listId);
  if (!record) {
    ws.close();
    return;
  }
  const client = { ws, syncState: Automerge.initSyncState() };
  attachClient(listId, client);
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
  const { listId, shareCode, state } = createList();
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
  stateCache.set(id, { doc, state });
  return { listId: id, shareCode, state };
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
  const record = { doc, state };
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
    persistListRecord(listId, record);
    drainSyncMessages(listId);
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
  }
}

function startPruneLoop() {
  setInterval(() => {
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    const rows = db.prepare('SELECT id FROM lists WHERE last_access < ?').all(cutoff);
    db.prepare('DELETE FROM lists WHERE last_access < ?').run(cutoff);
    for (const row of rows) {
      stateCache.delete(row.id);
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

function getString(value) {
  if (!value) return null;
  return value.toString();
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

console.log('Starting Handl with SQLite persistence...');
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
