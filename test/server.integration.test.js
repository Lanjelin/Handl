import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable, Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT = resolve('.');
const SERVER_URL = pathToFileURL(resolve('server.js')).href;
const ENV_KEYS = ['PASSWORD', 'DATA_DIR', 'DB_FILE', 'PUBLIC_DIR', 'PORT'];

test('serves the normal shell when password auth is disabled', { concurrency: false }, async () => {
  const fixture = await loadHandl({ PASSWORD: '' });
  try {
    const root = await invokeApp(fixture.app, { method: 'GET', path: '/' });
    assert.equal(root.status, 200);
    assert.equal(root.body.includes('auth-locked'), false);

    const config = await invokeApp(fixture.app, { method: 'GET', path: '/config.json' });
    assert.equal(config.status, 200);
    assert.equal(JSON.parse(config.body).authRequired, false);

    const session = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/session?token=test-token'
    });
    assert.equal(session.status, 200);
  } finally {
    await fixture.close();
  }
});

test('round-trips Automerge docs through the snapshot helpers', { concurrency: false }, async () => {
  const fixture = await loadHandl({ PASSWORD: '' });
  try {
    const snapshot = {
      items: [
        { id: 'item-1', text: 'Milk', checked: false },
        { id: 'item-2', text: 'Eggs', checked: true }
      ]
    };

    const doc = fixture.docFromSnapshot(snapshot);
    const roundTrip = fixture.snapshotFromDoc(doc);
    assert.deepEqual(roundTrip, snapshot);

    const emptyRoundTrip = fixture.snapshotFromDoc(fixture.createInitialDoc());
    assert.deepEqual(emptyRoundTrip, { items: [] });
  } finally {
    await fixture.close();
  }
});

test('requires the configured password before exposing session endpoints', { concurrency: false }, async () => {
  const fixture = await loadHandl({ PASSWORD: 'secret' });
  try {
    const root = await invokeApp(fixture.app, { method: 'GET', path: '/' });
    assert.equal(root.status, 200);
    assert.equal(root.body.includes('auth-locked'), true);

    const authStatus = await invokeApp(fixture.app, { method: 'GET', path: '/auth/status' });
    const authStatusBody = JSON.parse(authStatus.body);
    assert.equal(authStatusBody.authRequired, true);
    assert.equal(authStatusBody.authenticated, false);

    const blockedSession = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/session?token=test-token'
    });
    assert.equal(blockedSession.status, 401);

    assert.equal(fixture.authenticatePassword('wrong'), null);
    const authToken = fixture.authenticatePassword('secret');
    assert.ok(authToken);
    const cookie = `handl-auth=${authToken}`;

    const unlockedStatus = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/auth/status',
      headers: { cookie }
    });
    const unlockedStatusBody = JSON.parse(unlockedStatus.body);
    assert.equal(unlockedStatusBody.authenticated, true);

    const unlockedRoot = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/',
      headers: { cookie }
    });
    assert.equal(unlockedRoot.body.includes('auth-locked'), false);
  } finally {
    await fixture.close();
  }
});

test('restores a shared list after login and rejects unauthenticated websocket upgrades', { concurrency: false }, async () => {
  const fixture = await loadHandl({ PASSWORD: 'secret' });
  try {
    const authToken = fixture.authenticatePassword('secret');
    assert.ok(authToken);
    const cookie = `handl-auth=${authToken}`;

    const created = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/session?token=alpha',
      headers: { cookie }
    });
    assert.equal(created.status, 200);
    const createdBody = JSON.parse(created.body);
    assert.equal(createdBody.token, 'alpha');
    assert.equal(createdBody.listId.length > 0, true);
    assert.equal(createdBody.shareCode.length > 0, true);

    const restoredBody = fixture.restoreWithCode(createdBody.shareCode, 'beta');
    assert.equal(restoredBody.listId, createdBody.listId);
    assert.equal(restoredBody.shareCode, createdBody.shareCode);
    assert.equal(restoredBody.token, 'beta');

    const upgradeSocket = makeUpgradeSocket();
    fixture.server.emit(
      'upgrade',
      {
        url: '/?token=beta',
        headers: { host: '127.0.0.1' }
      },
      upgradeSocket,
      Buffer.alloc(0)
    );
    assert.equal(upgradeSocket.destroyed, true);
  } finally {
    await fixture.close();
  }
});

test('reports metrics only to authenticated users and includes list counts', { concurrency: false }, async () => {
  const fixture = await loadHandl({ PASSWORD: 'secret' });
  try {
    const blockedMetrics = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/metrics'
    });
    assert.equal(blockedMetrics.status, 401);

    const authToken = fixture.authenticatePassword('secret');
    assert.ok(authToken);
    const cookie = `handl-auth=${authToken}`;

    const metrics = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/metrics',
      headers: { cookie }
    });
    assert.equal(metrics.status, 200);
    const body = JSON.parse(metrics.body);
    assert.equal(typeof body.totalLists, 'number');
    assert.equal(typeof body.cachedLists, 'number');
    assert.equal(typeof body.activeWebsocketClients, 'number');
    assert.equal(body.totalLists >= 0, true);
  } finally {
    await fixture.close();
  }
});

test('reuses the same list when the same session token is requested again', { concurrency: false }, async () => {
  const fixture = await loadHandl({ PASSWORD: '' });
  try {
    const first = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/session?token=repeat-token'
    });
    assert.equal(first.status, 200);
    const firstBody = JSON.parse(first.body);

    const second = await invokeApp(fixture.app, {
      method: 'GET',
      path: '/session?token=repeat-token'
    });
    assert.equal(second.status, 200);
    const secondBody = JSON.parse(second.body);

    assert.equal(secondBody.listId, firstBody.listId);
    assert.equal(secondBody.shareCode, firstBody.shareCode);
    assert.equal(secondBody.token, firstBody.token);
  } finally {
    await fixture.close();
  }
});

test('rejects invalid restore codes', { concurrency: false }, async () => {
  const fixture = await loadHandl({ PASSWORD: 'secret' });
  try {
    assert.throws(() => {
      fixture.restoreWithCode('not-a-real-code', 'beta');
    }, /share code not found/);
  } finally {
    await fixture.close();
  }
});

async function loadHandl(extraEnv = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'handl-test-'));
  const envBackup = new Map();
  for (const key of ENV_KEYS) {
    envBackup.set(key, process.env[key]);
  }
  for (const [key, value] of Object.entries({
    DATA_DIR: dataDir,
    DB_FILE: join(dataDir, 'handl.db'),
    PUBLIC_DIR: join(ROOT, 'public'),
    PORT: '3000',
    ...extraEnv
  })) {
    if (value == null || value === '') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const mod = await import(`${SERVER_URL}?case=${Date.now()}-${Math.random()}`);
  return {
    app: mod.app,
    server: mod.server,
    authenticatePassword: mod.authenticatePassword,
    restoreWithCode: mod.restoreWithCode,
    createInitialDoc: mod.createInitialDoc,
    snapshotFromDoc: mod.snapshotFromDoc,
    docFromSnapshot: mod.docFromSnapshot,
    async close() {
      await mod.closeServer({ log: false });
      for (const [key, value] of envBackup) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function invokeApp(app, { method = 'GET', path = '/', headers = {}, body = '' } = {}) {
  const payload = body ? String(body) : '';
  const req = new BodyRequest(payload);
  req.method = method;
  req.url = path;
  req.originalUrl = path;
  req.headers = normalizeHeaders({
    ...headers,
    ...(payload ? { 'content-length': String(Buffer.byteLength(payload)) } : {})
  });
  req.socket = new EventEmitter();
  req.connection = req.socket;
  req.get = (name) => req.headers[String(name).toLowerCase()];
  req.header = req.get;

  const res = createMockResponse();

  await new Promise((resolve, reject) => {
    res.once('finish', resolve);
    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });

  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body
  };
}

function createMockResponse() {
  const response = new MockResponse();

  response.setHeader = (name, value) => {
    response.headers[String(name).toLowerCase()] = value;
  };
  response.getHeader = (name) => response.headers[String(name).toLowerCase()];
  response.writeHead = (statusCode, headers = {}) => {
    response.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value);
    }
    return response;
  };
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.type = (value) => {
    const map = {
      html: 'text/html; charset=utf-8',
      json: 'application/json; charset=utf-8'
    };
    response.setHeader('content-type', map[value] || value);
    return response;
  };
  response.json = (value) => {
    response.type('json');
    return response.end(JSON.stringify(value));
  };
  response.send = (value) => {
    if (Buffer.isBuffer(value)) {
      return response.end(value);
    }
    if (typeof value === 'object' && value !== null) {
      return response.json(value);
    }
    return response.end(String(value));
  };
  response.write = (chunk) => {
    if (chunk != null) {
      response.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return true;
  };
  response.end = (chunk) => {
    if (chunk != null) {
      response.write(chunk);
    }
    response.body = Buffer.concat(response.chunks).toString('utf8');
    response.emit('finish');
    return response;
  };
  response.removeHeader = (name) => {
    delete response.headers[String(name).toLowerCase()];
  };
  response.getHeaders = () => ({ ...response.headers });
  return response;
}

class BodyRequest extends Readable {
  constructor(payload) {
    super();
    this.payload = payload;
    this.sent = false;
  }

  _read() {
    if (this.sent) return;
    this.sent = true;
    if (this.payload) {
      this.push(Buffer.from(this.payload));
    }
    this.push(null);
  }
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  }

  getHeader(name) {
    return this.headers[String(name).toLowerCase()];
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) {
      this.setHeader(name, value);
    }
    return this;
  }

  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  }

  type(value) {
    const map = {
      html: 'text/html; charset=utf-8',
      json: 'application/json; charset=utf-8'
    };
    this.setHeader('content-type', map[value] || value);
    return this;
  }

  json(value) {
    this.type('json');
    return this.end(JSON.stringify(value));
  }

  send(value) {
    if (Buffer.isBuffer(value)) {
      return this.end(value);
    }
    if (typeof value === 'object' && value !== null) {
      return this.json(value);
    }
    return this.end(String(value));
  }

  end(chunk, encoding, callback) {
    if (chunk != null && chunk !== '') {
      this.write(chunk, encoding);
    }
    return super.end(callback);
  }

  removeHeader(name) {
    delete this.headers[String(name).toLowerCase()];
  }

  getHeaders() {
    return { ...this.headers };
  }
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function makeUpgradeSocket() {
  return {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
    on() {},
    once() {},
    write() {},
    end() {}
  };
}
