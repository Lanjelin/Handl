import Automerge, {automergeReady} from '/automerge.js';

const editor = document.getElementById('text-editor');
const checklist = document.getElementById('checklist');
const toggleModeButton = document.getElementById('toggle-mode');
const modeIcon = document.getElementById('mode-icon');
const checklistContainer = document.getElementById('checklist');
const itemTemplate = document.getElementById('item-template');
const statusIndicator = document.getElementById('status-icon');
const statusSymbol = document.getElementById('status-symbol');
const schemeSelect = document.getElementById('scheme-select');
const titleHeading = document.querySelector('.pane-title h2');
const settingsButton = document.getElementById('open-settings');
const settingsDialog = document.getElementById('settings-dialog');
const settingsSort = document.getElementById('sort-checked');
const removeCheckedButton = document.getElementById('remove-checked');
const closeSettingsButton = document.getElementById('close-settings');
const languageSelect = document.getElementById('language-select');
const shareCodeInput = document.getElementById('settings-share-code');
const restoreCodeInput = document.getElementById('restore-code-input');
const restoreCodeButton = document.getElementById('restore-code-button');
const themeColorMeta = document.getElementById('theme-color-meta');

const DEFAULT_SETTINGS = { sortChecked: false, colorScheme: 'default', language: 'en' };
const LOCAL_SETTINGS_KEY = 'handl-settings';
const LOCAL_TOKEN_KEY = 'handl-session-token';
const LOCAL_DOC_PREFIX = 'handl-doc';
const LOCAL_SYNC_PREFIX = 'handl-sync';

const FALLBACK_THEME_META_COLOR = '#0f172a';
const FALLBACK_THEME = {
  label: 'Default',
  metaColor: FALLBACK_THEME_META_COLOR,
  variables: {}
};

const FALLBACK_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' }
];

const FALLBACK_TRANSLATIONS = {
  en: {
    settingsTitle: 'Settings',
    sortChecked: 'Keep checked items at the bottom',
    colorScheme: 'Color scheme',
    removeChecked: 'Remove checked items',
    languageLabel: 'Language',
    languagePlaceholder: 'Search languages…',
    listIdLabel: 'List ID',
    joinListLabel: 'Join list',
    joinButton: 'Join',
    listIdPlaceholder: 'List ID',
    modeView: 'View',
    modeEdit: 'Edit',
    toggleToEdit: 'Switch to edit mode',
    toggleToView: 'Switch to view mode',
    statusConnected: 'Connected',
    statusDisconnected: 'Disconnected',
    statusConnecting: 'Connecting',
    loginHeading: 'Unlock',
    loginPasswordLabel: 'Password',
    loginSubmit: 'Enter',
    loginInvalid: 'Incorrect password.'
  }
};

let doc = null;
let items = [];
let settings = { ...DEFAULT_SETTINGS };
let ws;
let reconnectTimeout;
let syncTimeout;
let persistTimeout;
let pendingSync = false;
let viewMode = true;
let sessionToken = null;
let activeListId = '';
let shareCodeValue = '';
let syncState = null;
let themeCatalog = { default: FALLBACK_THEME };
let themeColorMap = { default: FALLBACK_THEME_META_COLOR };
let languages = FALLBACK_LANGUAGES;
let translations = FALLBACK_TRANSLATIONS;
let appReady = false;
let socketGeneration = 0;
let currentStatusVariant = 'idle';

document.addEventListener('DOMContentLoaded', async () => {
  editor.addEventListener('input', handleEditorInput);
  settingsButton.addEventListener('click', () => settingsDialog.showModal());
  closeSettingsButton.addEventListener('click', () => settingsDialog.close());
  settingsSort.addEventListener('change', handleSortToggle);
  removeCheckedButton.addEventListener('click', removeCheckedItems);
  toggleModeButton.addEventListener('click', toggleMode);
  languageSelect?.addEventListener('change', (event) => setLanguage(event.target.value));
  settingsDialog.addEventListener('click', (event) => {
    if (event.target === settingsDialog) {
      settingsDialog.close();
    }
  });

  if (schemeSelect) {
    schemeSelect.addEventListener('change', () => {
      mutateDoc((draft) => {
        draft.settings.colorScheme = schemeSelect.value;
      });
    });
  }

  const attemptRestore = () => {
    const code = (restoreCodeInput?.value ?? '').trim().toUpperCase();
    if (!code) return;
    restoreList(code);
  };

  restoreCodeButton?.addEventListener('click', attemptRestore);
  restoreCodeInput?.addEventListener('focus', () => {
    requestAnimationFrame(() => {
      ensureSettingsFieldVisible(restoreCodeInput);
    });
  });
  restoreCodeInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      attemptRestore();
    }
  });

  registerServiceWorker();
  bootstrapApp().catch((error) => {
    console.warn('Application bootstrap failed', error);
    setStatus('warn');
  });
});

async function bootstrapApp() {
  await automergeReady;

  const localSettings = loadLocalSettings();
  if (localSettings) {
    settings = { ...settings, ...localSettings };
  }

  applyColorScheme(settings.colorScheme);
  applyTranslations();
  updateModeUI();
  setStatus('idle');

  await fetchThemeCatalog();
  await fetchTranslationCatalog();

  doc = createInitialDoc();
  syncState = Automerge.initSyncState();
  appReady = true;

  await initializeSession();
  fetchConfig();
}

function createInitialDoc() {
  let initial = Automerge.init();
  initial = Automerge.change(initial, (draft) => {
    draft.items = [];
    draft.settings = { ...DEFAULT_SETTINGS };
  });
  return initial;
}

function docFromSnapshot(snapshot) {
  let loaded = Automerge.init();
  loaded = Automerge.change(loaded, (draft) => {
    draft.items = normalizeItems(snapshot?.items);
    draft.settings = normalizeSettings(snapshot?.settings);
  });
  return loaded;
}

function snapshotFromDoc(source = doc) {
  const raw = Automerge.toJS(source) || {};
  return {
    items: normalizeItems(raw.items),
    settings: normalizeSettings(raw.settings)
  };
}

function normalizeItems(source) {
  if (!Array.isArray(source)) return [];
  return source
    .map((entry) => {
      const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
      if (!text) return null;
      return {
        id: typeof entry?.id === 'string' && entry.id ? entry.id : crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        text,
        checked: Boolean(entry?.checked)
      };
    })
    .filter(Boolean);
}

function normalizeSettings(source) {
  if (!source || typeof source !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    sortChecked: typeof source.sortChecked === 'boolean' ? source.sortChecked : DEFAULT_SETTINGS.sortChecked,
    colorScheme: typeof source.colorScheme === 'string' ? source.colorScheme : DEFAULT_SETTINGS.colorScheme,
    language: typeof source.language === 'string' ? source.language : DEFAULT_SETTINGS.language
  };
}

function setDoc(nextDoc, { sync = false, persist = true, renderNow = true } = {}) {
  doc = nextDoc || createInitialDoc();
  const snapshot = snapshotFromDoc(doc);
  items = snapshot.items;
  settings = snapshot.settings;
  if (renderNow) {
    render();
  } else {
    applyColorScheme(settings.colorScheme);
    applyTranslations();
    if (settingsSort) {
      settingsSort.checked = Boolean(settings.sortChecked);
    }
    if (schemeSelect) {
      schemeSelect.value = settings.colorScheme;
    }
    if (languageSelect) {
      languageSelect.value = translations[settings.language] ? settings.language : 'en';
    }
  }
  if (persist) {
    schedulePersistDocument();
  }
  persistLocalSettings();
  if (sync) {
    scheduleSync();
  }
}

function mutateDoc(mutator, options = {}) {
  if (!appReady || !doc) return;
  const nextDoc = Automerge.change(doc, mutator);
  setDoc(nextDoc, { sync: true, ...options });
}

function handleEditorInput() {
  if (!appReady || !doc) return;
  const nextLines = parseEditorLines(editor.value);
  const currentVisible = applySort([...items]);
  const nextItems = reconcileLines(currentVisible, nextLines);

  mutateDoc((draft) => {
    draft.items = nextItems.map((item) => ({
      id: item.id,
      text: item.text,
      checked: Boolean(item.checked)
    }));
  });
}

function parseEditorLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function reconcileLines(currentItems, nextLines) {
  const used = new Set();
  const nextItems = [];

  for (let index = 0; index < nextLines.length; index += 1) {
    const text = nextLines[index];
    const existingAtIndex = currentItems[index];
    if (existingAtIndex && !used.has(existingAtIndex.id)) {
      used.add(existingAtIndex.id);
      nextItems.push({
        id: existingAtIndex.id,
        text,
        checked: Boolean(existingAtIndex.checked)
      });
      continue;
    }

    const reusable = currentItems.find((item) => !used.has(item.id) && item.text === text);
    if (reusable) {
      used.add(reusable.id);
      nextItems.push({
        id: reusable.id,
        text,
        checked: Boolean(reusable.checked)
      });
      continue;
    }

    nextItems.push({
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      text,
      checked: false
    });
  }

  return nextItems;
}

function render() {
  const ordered = applySort(items.map((item) => ({ ...item })));
  const textValue = ordered.map((item) => item.text).join('\n');

  settingsSort.checked = Boolean(settings.sortChecked);
  applyColorScheme(settings.colorScheme);
  applyTranslations();
  updateModeUI();

  checklist.innerHTML = '';
  ordered.forEach((item) => {
    const clone = itemTemplate.content.cloneNode(true);
    const label = clone.querySelector('.check-row');
    const checkbox = clone.querySelector('input[type=checkbox]');
    const text = clone.querySelector('.item-text');

    checkbox.checked = Boolean(item.checked);
    text.textContent = item.text;

    checkbox.addEventListener('change', () => {
      updateItemChecked(item.id, checkbox.checked);
    });

    label.addEventListener('click', (event) => {
      if (event.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      updateItemChecked(item.id, checkbox.checked);
    });

    checklist.appendChild(label);
  });

  const shouldUpdateEditor = !viewMode || document.activeElement !== editor;
  if (shouldUpdateEditor && editor.value.trim() !== textValue) {
    const previousStart = editor.selectionStart;
    const previousEnd = editor.selectionEnd;
    const previousScroll = editor.scrollTop;
    const wasFocused = document.activeElement === editor;
    editor.value = textValue;
    if (wasFocused) {
      editor.selectionStart = Math.min(previousStart, editor.value.length);
      editor.selectionEnd = Math.min(previousEnd, editor.value.length);
      editor.scrollTop = previousScroll;
    }
    autoResizeEditor();
  }
}

function updateItemChecked(id, checked) {
  if (!appReady || !doc) return;
  mutateDoc((draft) => {
    const item = draft.items.find((entry) => entry.id === id);
    if (item) {
      item.checked = checked;
    }
  });
}

function applyColorScheme(scheme) {
  const target = scheme || 'default';
  document.body.dataset.scheme = target;
  if (schemeSelect) {
    schemeSelect.value = target;
  }
  const color = themeColorMap[target] ?? FALLBACK_THEME_META_COLOR;
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', color);
  }
  document.documentElement.style.setProperty('--page-bg-solid', color);
  const theme = themeCatalog[target] ?? FALLBACK_THEME;
  applyThemeVariables(theme);
}

function applyThemeVariables(theme = FALLBACK_THEME) {
  const variables = theme.variables || {};
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'string') {
      document.documentElement.style.setProperty(key, value);
    }
  }
}

async function fetchConfig() {
  try {
    const res = await fetch('/config.json');
    if (!res.ok) throw new Error('config unavailable');
    const json = await res.json();
    if (json?.title) {
      document.title = json.title;
      if (titleHeading) titleHeading.textContent = json.title;
    }
  } catch (error) {
    console.warn('Failed to load config', error);
  }
}

function autoResizeEditor() {
  editor.style.height = 'auto';
  editor.style.height = `${editor.scrollHeight}px`;
  keepEditorVisible();
}

function keepEditorVisible() {
  if (viewMode) return;
  const rect = editor.getBoundingClientRect();
  const safeBottom = window.innerHeight - 80;
  if (rect.bottom > safeBottom) {
    window.scrollBy({
      top: rect.bottom - safeBottom,
      behavior: 'smooth'
    });
  }
}

function applySort(source) {
  if (!settings.sortChecked) return source;
  return source.sort((a, b) => {
    if (a.checked === b.checked) return 0;
    return a.checked ? 1 : -1;
  });
}

function handleSortToggle() {
  if (!appReady || !doc) return;
  mutateDoc((draft) => {
    draft.settings.sortChecked = settingsSort.checked;
  });
}

function removeCheckedItems() {
  if (!appReady || !doc) return;
  const remaining = items.filter((item) => !item.checked);
  if (remaining.length === items.length) return;
  if (!confirm('Remove all checked items? This cannot be undone.')) return;
  mutateDoc((draft) => {
    draft.items = remaining.map((item) => ({
      id: item.id,
      text: item.text,
      checked: Boolean(item.checked)
    }));
  });
  if (settingsDialog.open) {
    settingsDialog.close();
  }
}

async function fetchThemeCatalog() {
  try {
    const res = await fetch('/themes.json');
    if (!res.ok) throw new Error('themes unavailable');
    const catalog = await res.json();
    themeCatalog = { ...catalog };
    if (!themeCatalog.default) {
      themeCatalog.default = FALLBACK_THEME;
    }
    themeColorMap = Object.fromEntries(
      Object.entries(themeCatalog).map(([key, value]) => [key, value?.metaColor || FALLBACK_THEME_META_COLOR])
    );
    populateThemeOptions();
    applyColorScheme(settings.colorScheme);
  } catch (error) {
    console.warn('Failed to load themes', error);
  }
}

async function fetchTranslationCatalog() {
  try {
    const res = await fetch('/translations.json');
    if (!res.ok) throw new Error('translations unavailable');
    const catalog = await res.json();
    languages = Array.isArray(catalog.languages) && catalog.languages.length ? catalog.languages : FALLBACK_LANGUAGES;
    translations = catalog.strings && Object.keys(catalog.strings).length ? catalog.strings : FALLBACK_TRANSLATIONS;
  } catch (error) {
    console.warn('Failed to load translations', error);
    languages = FALLBACK_LANGUAGES;
    translations = FALLBACK_TRANSLATIONS;
  }
  populateLanguageOptions();
  applyTranslations();
}

function populateThemeOptions() {
  if (!schemeSelect) return;
  schemeSelect.innerHTML = '';
  for (const [key, value] of Object.entries(themeCatalog)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = value?.label || key;
    schemeSelect.appendChild(option);
  }
  schemeSelect.value = settings.colorScheme;
}

function setStatus(variant = 'idle') {
  const icons = {
    online: 'cloud_done',
    warn: 'cloud_off',
    idle: 'cloud_sync'
  };
  const target = icons[variant] ? variant : 'idle';
  currentStatusVariant = target;
  if (statusSymbol) {
    statusSymbol.textContent = icons[target];
  }
  updateStatusTooltip();
}

function connectSocket() {
  if (!sessionToken) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const generation = socketGeneration;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const query = `?token=${encodeURIComponent(sessionToken)}`;
  ws = new WebSocket(`${scheme}://${location.host}${query}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    setStatus('online');
    drainSync();
  });

  ws.addEventListener('message', (event) => {
    handleMessage(event.data);
  });

  ws.addEventListener('close', () => {
    if (generation !== socketGeneration) return;
    setStatus('warn');
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    if (generation !== socketGeneration) return;
    setStatus('warn');
    ws.close();
  });
}

async function initializeSession() {
  try {
    sessionToken = loadSessionToken() || crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    persistSessionToken(sessionToken);
    const url = `/session?token=${encodeURIComponent(sessionToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error('session unavailable');
    }
    const session = await res.json();
    await applySessionResponse(session);
    connectSocket();
  } catch (error) {
    console.warn('Failed to initialize session', error);
    setStatus('warn');
  }
}

async function restoreList(code) {
  try {
    const res = await fetch('/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, token: sessionToken })
    });
    if (!res.ok) throw new Error('restore failed');
    const session = await res.json();
    await applySessionResponse(session);
    if (settingsDialog.open) {
      settingsDialog.close();
    }
    if (restoreCodeInput) {
      restoreCodeInput.value = '';
    }
  } catch (error) {
    console.warn('Failed to restore list', error);
    alert('Unable to restore the list. Check the code and try again.');
  }
}

async function applySessionResponse(session) {
  if (!session) return;
  const nextListId = session.listId || activeListId;
  const listChanged = Boolean(activeListId && nextListId && nextListId !== activeListId);

  if (listChanged) {
    resetSocketState();
  }

  sessionToken = session.token || null;
  if (sessionToken) {
    persistSessionToken(sessionToken);
  } else {
    clearSessionToken();
  }

  activeListId = nextListId;
  shareCodeValue = session.shareCode ?? '';
  updateShareCodeDisplay();

  const cached = loadStoredDocument(activeListId);
  if (cached) {
    doc = cached.doc;
    syncState = cached.syncState;
  } else {
    doc = loadDocFromSession(session);
    syncState = Automerge.initSyncState();
  }

  setDoc(doc, { sync: false, persist: false });
  schedulePersistDocument();
  connectSocket();
}

function loadDocFromSession(session) {
  if (session?.doc) {
    try {
      return Automerge.load(base64ToBytes(session.doc));
    } catch (error) {
      console.warn('Failed to load session doc', error);
    }
  }
  if (session?.state) {
    return docFromSnapshot(session.state);
  }
  return createInitialDoc();
}

function updateShareCodeDisplay() {
  const code = shareCodeValue || '';
  if (shareCodeInput) {
    shareCodeInput.value = code;
  }
}

function loadSessionToken() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LOCAL_TOKEN_KEY);
  } catch (error) {
    console.warn('Failed to load session token', error);
    return null;
  }
}

function persistSessionToken(token) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
  } catch (error) {
    console.warn('Failed to persist session token', error);
  }
}

function clearSessionToken() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LOCAL_TOKEN_KEY);
  } catch (error) {
    console.warn('Failed to clear session token', error);
  }
}

function scheduleSync() {
  pendingSync = true;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncTimeout = null;
    drainSync();
  }, 125);
}

function drainSync() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    pendingSync = true;
    return;
  }
  pendingSync = false;
  let nextSyncState = syncState;
  while (true) {
    const [updatedState, message] = Automerge.generateSyncMessage(doc, nextSyncState);
    nextSyncState = updatedState;
    if (!message) break;
    ws.send(message);
  }
  syncState = nextSyncState;
  schedulePersistDocument();
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connectSocket();
  }, 1500);
}

function resetSocketState() {
  socketGeneration += 1;
  pendingSync = false;
  syncState = Automerge.initSyncState();
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (ws) {
    const current = ws;
    ws = null;
    try {
      current.close();
    } catch (error) {
      console.warn('Failed to close websocket', error);
    }
  }
}

function handleMessage(raw) {
  const message = toUint8Array(raw);
  if (!message) return;
  try {
    const [nextDoc, nextSyncState] = Automerge.receiveSyncMessage(doc, syncState, message);
    doc = nextDoc;
    syncState = nextSyncState;
    const snapshot = snapshotFromDoc(doc);
    items = snapshot.items;
    settings = snapshot.settings;
    render();
    persistLocalSettings();
    schedulePersistDocument();
    drainSync();
  } catch (error) {
    console.warn('Invalid sync payload', error);
  }
}

function loadStoredDocument(listId) {
  if (typeof localStorage === 'undefined' || !listId) return null;
  try {
    const rawDoc = localStorage.getItem(docStorageKey(listId));
    if (!rawDoc) return null;
    const docBytes = base64ToBytes(rawDoc);
    const loadedDoc = Automerge.load(docBytes);
    const rawSync = localStorage.getItem(syncStorageKey(listId));
    const loadedSync = rawSync ? Automerge.decodeSyncState(base64ToBytes(rawSync)) : Automerge.initSyncState();
    return { doc: loadedDoc, syncState: loadedSync };
  } catch (error) {
    console.warn('Failed to load stored doc', error);
    return null;
  }
}

function schedulePersistDocument() {
  if (!activeListId || typeof localStorage === 'undefined') return;
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    persistTimeout = null;
    persistDocument();
  }, 125);
}

function persistDocument() {
  if (!activeListId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(docStorageKey(activeListId), bytesToBase64(Automerge.save(doc)));
    localStorage.setItem(syncStorageKey(activeListId), bytesToBase64(Automerge.encodeSyncState(syncState)));
  } catch (error) {
    console.warn('Failed to persist doc', error);
  }
}

function docStorageKey(listId) {
  return `${LOCAL_DOC_PREFIX}:${listId}`;
}

function syncStorageKey(listId) {
  return `${LOCAL_SYNC_PREFIX}:${listId}`;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

function populateLanguageOptions() {
  if (!languageSelect) return;
  languageSelect.innerHTML = '';
  for (const option of languages) {
    const node = document.createElement('option');
    node.value = option.code;
    node.textContent = `${option.label} (${option.native})`;
    languageSelect.appendChild(node);
  }
  const availableCodes = new Set(languages.map((option) => option.code));
  if (!availableCodes.has(settings.language)) {
    settings.language = languages[0]?.code ?? 'en';
  }
  languageSelect.value = settings.language;
}

function setLanguage(code) {
  if (!appReady || !doc) return;
  const normalized = translations[code] ? code : 'en';
  mutateDoc((draft) => {
    draft.settings.language = normalized;
  });
  applyTranslations();
}

function getLocale() {
  return translations[settings.language] ?? translations.en;
}

function applyTranslations() {
  const locale = getLocale();
  const header = settingsDialog?.querySelector('[data-i18n="settingsTitle"]');
  const sortLabel = settingsDialog?.querySelector('[data-i18n="sortChecked"]');
  const colorLabel = settingsDialog?.querySelector('[data-i18n="colorScheme"]');
  const removeButton = document.querySelector('[data-i18n="removeChecked"]');
  const languageLabel = settingsDialog?.querySelector('[data-i18n="languageLabel"]');
  const listIdLabel = settingsDialog?.querySelector('[data-i18n="listIdLabel"]');
  const joinLabel = settingsDialog?.querySelector('[data-i18n="joinListLabel"]');
  const joinButton = document.querySelector('[data-i18n="joinButton"]');

  if (header) header.textContent = locale.settingsTitle;
  if (sortLabel) sortLabel.textContent = locale.sortChecked;
  if (colorLabel) colorLabel.textContent = locale.colorScheme;
  if (removeButton) removeButton.textContent = locale.removeChecked;
  if (languageLabel) languageLabel.textContent = locale.languageLabel;
  if (languageSelect) {
    languageSelect.setAttribute('aria-label', locale.languageLabel);
  }
  if (listIdLabel) listIdLabel.textContent = locale.listIdLabel;
  if (joinLabel) joinLabel.textContent = locale.joinListLabel;
  if (joinButton) joinButton.textContent = locale.joinButton;
  if (restoreCodeInput) {
    restoreCodeInput.placeholder = locale.listIdPlaceholder;
  }
  if (settingsButton) {
    settingsButton.setAttribute('title', locale.settingsTooltip);
    settingsButton.setAttribute('aria-label', locale.settingsTooltip);
  }
  if (toggleModeButton) {
    const modeTooltip = viewMode ? locale.toggleToEdit : locale.toggleToView;
    toggleModeButton.setAttribute('title', modeTooltip);
    toggleModeButton.setAttribute('aria-label', modeTooltip);
  }
  if (languageSelect) {
    languageSelect.value = translations[settings.language] ? settings.language : 'en';
  }
  updateStatusTooltip(locale);
}

function updateStatusTooltip(locale = getLocale()) {
  if (!statusIndicator) return;
  const labels = {
    online: locale.statusConnected,
    warn: locale.statusDisconnected,
    idle: locale.statusConnecting
  };
  statusIndicator.dataset.status = currentStatusVariant;
  statusIndicator.setAttribute('title', labels[currentStatusVariant] ?? locale.statusConnecting);
}

function ensureSettingsFieldVisible(field) {
  if (!settingsDialog || !field) return;
  const dialogRect = settingsDialog.getBoundingClientRect();
  const fieldRect = field.getBoundingClientRect();
  const padding = 20;
  if (fieldRect.top < dialogRect.top + padding) {
    settingsDialog.scrollBy({ top: fieldRect.top - dialogRect.top - padding, behavior: 'smooth' });
  } else if (fieldRect.bottom > dialogRect.bottom - padding) {
    settingsDialog.scrollBy({ top: fieldRect.bottom - dialogRect.bottom + padding, behavior: 'smooth' });
  }
}

function toggleMode() {
  if (!appReady || !doc) return;
  if (viewMode) {
    handleEditorInput();
  }
  viewMode = !viewMode;
  if (!viewMode) {
    editor.focus();
    editor.selectionStart = editor.selectionEnd = editor.value.length;
  }
  updateModeUI();
  applyTranslations();
  render();
  if (!viewMode) {
    autoResizeEditor();
    setTimeout(autoResizeEditor, 1);
  }
}

function updateModeUI() {
  checklistContainer.classList.toggle('hidden', !viewMode);
  editor.classList.toggle('hidden', viewMode);
  if (modeIcon) {
    modeIcon.textContent = viewMode ? 'edit_note' : 'visibility';
  }
}

function loadLocalSettings() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = {};
    if (typeof parsed.colorScheme === 'string') result.colorScheme = parsed.colorScheme;
    if (typeof parsed.language === 'string') result.language = parsed.language;
    if (typeof parsed.sortChecked === 'boolean') result.sortChecked = parsed.sortChecked;
    return Object.keys(result).length ? result : null;
  } catch (error) {
    console.warn('Failed to load local settings', error);
    return null;
  }
}

function persistLocalSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      LOCAL_SETTINGS_KEY,
      JSON.stringify({
        colorScheme: settings.colorScheme,
        language: settings.language,
        sortChecked: Boolean(settings.sortChecked)
      })
    );
  } catch (error) {
    console.warn('Failed to persist local settings', error);
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < source.length; index += chunkSize) {
    binary += String.fromCharCode(...source.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
