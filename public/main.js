import Automerge, {automergeReady} from '/automerge.js';

const editor = document.getElementById('text-editor');
const checklist = document.getElementById('checklist');
const toggleModeButton = document.getElementById('toggle-mode');
const modeIcon = document.getElementById('mode-icon');
const checklistContainer = document.getElementById('checklist');
const itemTemplate = document.getElementById('item-template');
const statusIndicator = document.getElementById('status-icon');
const statusSymbol = document.getElementById('status-symbol');
const presenceIndicator = document.getElementById('presence-indicator');
const schemeSelect = document.getElementById('scheme-select');
const titleHeading = document.querySelector('.pane-title h2');
const settingsButton = document.getElementById('open-settings');
const settingsDialog = document.getElementById('settings-dialog');
const confirmDialog = document.getElementById('confirm-dialog');
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginPasswordInput = document.getElementById('login-password');
const loginSubmitButton = document.getElementById('login-submit');
const loginError = document.getElementById('login-error');
const settingsDeleteButton = document.getElementById('show-delete-button');
const settingsEditButton = document.getElementById('show-edit-button');
const settingsSort = document.getElementById('sort-checked');
const removeCheckedButton = document.getElementById('remove-checked');
const closeSettingsButton = document.getElementById('close-settings');
const confirmRemoveButton = document.getElementById('confirm-remove');
const confirmCancelButton = document.getElementById('confirm-cancel');
const languageSelect = document.getElementById('language-select');
const shareCodeInput = document.getElementById('settings-share-code');
const copyShareCodeButton = document.getElementById('copy-share-code-button');
const shareListButton = document.getElementById('share-list-button');
const deleteCheckedButton = document.getElementById('delete-checked-button');
const restoreCodeInput = document.getElementById('restore-code-input');
const restoreCodeButton = document.getElementById('restore-code-button');
const copyFeedback = document.getElementById('copy-feedback');
const landingScreen = document.getElementById('landing-screen');
const landingCreateButton = document.getElementById('landing-create-button');
const landingJoinButton = document.getElementById('landing-join-button');
const landingActions = document.getElementById('landing-actions');
const landingInviteActions = document.getElementById('landing-invite-actions');
const landingInviteJoinButton = document.getElementById('landing-invite-join-button');
const landingInviteCancelButton = document.getElementById('landing-invite-cancel-button');
const landingJoinForm = document.getElementById('landing-join-form');
const landingShareCodeInput = document.getElementById('landing-share-code');
const landingJoinSubmit = document.getElementById('landing-join-submit');
const landingTitle = document.querySelector('[data-i18n="landingTitle"]');
const landingBody = document.querySelector('[data-i18n="landingBody"]');
const themeColorMeta = document.getElementById('theme-color-meta');

const DEFAULT_SETTINGS = { showDeleteButton: false, showEditButton: true, sortChecked: false, colorScheme: 'default', language: 'en' };
const LOCAL_SETTINGS_PREFIX = 'handl-settings';
const LOCAL_UI_PREFIX = 'handl-ui-cache';
const LOCAL_TOKEN_KEY = 'handl-session-token';
const LOCAL_DOC_PREFIX = 'handl-doc-v3';

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
    showDeleteButton: 'Show delete button',
    showEditButton: 'Show edit/view button',
    sortChecked: 'Keep checked items at the bottom',
    colorScheme: 'Color scheme',
    removeChecked: 'Remove checked items',
    deleteChecked: 'Delete checked items',
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
    presenceOthersViewing: 'Other people are viewing the list',
    copyListId: 'Copy list ID',
    shareList: 'Share list',
    shareJoinTitle: 'Join Handl list',
    loginHeading: 'Unlock',
    loginPasswordLabel: 'Password',
    loginSubmit: 'Enter',
    loginInvalid: 'Incorrect password.',
    landingTitle: 'Welcome to Handl',
    landingBody: 'Join an existing list or create a new one.',
    landingJoinExisting: 'Join existing list',
    landingCreateNew: 'Create new list',
    landingSharePlaceholder: 'Share code',
    landingInviteTitle: 'Join list {code}?',
    landingInviteBody: 'Joining will remove you from your current list.',
    landingInviteJoin: 'Join',
    landingInviteCancel: 'Cancel',
    copyFeedback: 'Copied',
    removeCheckedConfirmTitle: 'Remove checked items?',
    removeCheckedConfirmBody: 'This cannot be undone.',
    removeCheckedConfirmOk: 'Remove',
    removeCheckedConfirmCancel: 'Cancel'
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
let debugMetricsEnabled = false;
let bootstrapStartedAt = performance.now();
let sessionFetchStartedAt = 0;
let websocketConnectStartedAt = 0;
let heartbeatTimeout = null;
let lastHeartbeatAt = 0;
let socketGeneration = 0;
let currentStatusVariant = 'idle';
let connectedPeers = 0;
let landingMode = 'welcome';
let pendingJoinCode = '';
let copyFeedbackTimeout = null;
let editorLineMap = [];
let authRequired = false;
let bootstrapComplete = false;
let loginInProgress = false;

document.addEventListener('DOMContentLoaded', async () => {
  editor.addEventListener('input', handleEditorInput);
  settingsButton.addEventListener('click', () => settingsDialog.showModal());
  closeSettingsButton.addEventListener('click', () => settingsDialog.close());
  settingsSort.addEventListener('change', handleSortToggle);
  removeCheckedButton.addEventListener('click', removeCheckedItems);
  deleteCheckedButton?.addEventListener('click', removeCheckedItems);
  confirmRemoveButton?.addEventListener('click', confirmRemoveCheckedItems);
  confirmCancelButton?.addEventListener('click', closeConfirmDialog);
  loginForm?.addEventListener('submit', handleLoginSubmit);
  toggleModeButton.addEventListener('click', toggleMode);
  copyShareCodeButton?.addEventListener('click', copyListIdToClipboard);
  shareListButton?.addEventListener('click', shareListLink);
  settingsDeleteButton?.addEventListener('change', handleDeleteButtonToggle);
  settingsEditButton?.addEventListener('change', handleEditButtonToggle);
  languageSelect?.addEventListener('change', (event) => setLanguage(event.target.value));
  settingsDialog.addEventListener('click', (event) => {
    if (event.target === settingsDialog) {
      settingsDialog.close();
    }
  });
  confirmDialog?.addEventListener('click', (event) => {
    if (event.target === confirmDialog) {
      closeConfirmDialog();
    }
  });

  if (schemeSelect) {
    schemeSelect.addEventListener('change', () => {
      settings.colorScheme = schemeSelect.value;
      persistLocalSettings();
      persistUiCache();
      applyColorScheme(settings.colorScheme);
    });
  }

  const attemptRestore = () => {
    const code = (restoreCodeInput?.value ?? '').trim().toUpperCase();
    if (!code) return;
    restoreList(code);
  };

  landingCreateButton?.addEventListener('click', createNewList);
  landingJoinButton?.addEventListener('click', () => {
    if (!landingJoinForm) return;
    landingJoinForm.classList.remove('hidden');
    landingShareCodeInput?.focus();
  });
  landingInviteJoinButton?.addEventListener('click', acceptInviteJoin);
  landingInviteCancelButton?.addEventListener('click', cancelInviteJoin);
  landingJoinSubmit?.addEventListener('click', attemptLandingJoin);
  landingShareCodeInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    attemptLandingJoin();
  });

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
  try {
    await automergeReady;

    debugMark('automerge-ready');
    hydrateBootState();

    await fetchConfig();
    await fetchThemeCatalog();
    await fetchTranslationCatalog();

    applyColorScheme(settings.colorScheme);
    applyTranslations();
    updateModeUI();
    setStatus('idle');
    updateNativeShareAvailability();

    if (authRequired) {
      const status = await fetchAuthStatus();
      if (!status?.authenticated) {
        showLoginScreen();
        return;
      }
    }

    await finishBootstrap();
  } finally {
    // no-op
  }
}

async function finishBootstrap() {
  if (bootstrapComplete) return;
  doc = createInitialDoc();
  syncState = Automerge.initSyncState();
  appReady = true;

  await initializeSession();
  bootstrapComplete = true;
}

function createInitialDoc() {
  let initial = Automerge.init();
  initial = Automerge.change(initial, (draft) => {
    draft.items = [];
  });
  return initial;
}

function docFromSnapshot(snapshot) {
  let loaded = Automerge.init();
  loaded = Automerge.change(loaded, (draft) => {
    draft.items = normalizeItems(snapshot?.items);
  });
  return loaded;
}

function snapshotFromDoc(source = doc) {
  const raw = Automerge.toJS(source) || {};
  return {
    items: normalizeItems(raw.items)
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

function setDoc(nextDoc, { sync = false, persist = true, renderNow = true } = {}) {
  doc = nextDoc || createInitialDoc();
  const snapshot = snapshotFromDoc(doc);
  items = snapshot.items;
  if (renderNow) {
    render();
  } else {
    applyColorScheme(settings.colorScheme);
    applyTranslations();
    if (settingsSort) {
      settingsSort.checked = Boolean(settings.sortChecked);
    }
    if (settingsDeleteButton) {
      settingsDeleteButton.checked = Boolean(settings.showDeleteButton);
    }
    if (settingsEditButton) {
      settingsEditButton.checked = settings.showEditButton !== false;
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
  const nextItems = reconcileLines(items, nextLines, editorLineMap);

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

function reconcileLines(currentItems, nextLines, previousLineMap = []) {
  const nextItems = [];
  let currentIndex = 0;
  let nextIndex = 0;

  while (currentIndex < currentItems.length && nextIndex < nextLines.length) {
    const currentItem = currentItems[currentIndex];
    const nextText = nextLines[nextIndex];
    const previousLine = previousLineMap[nextIndex];

    if (currentItem.text === nextText) {
      nextItems.push({
        id: currentItem.id,
        text: nextText,
        checked: Boolean(currentItem.checked)
      });
      currentIndex += 1;
      nextIndex += 1;
      continue;
    }

    const nextCurrent = currentItems[currentIndex + 1];
    if (previousLine && previousLine.id === nextCurrent?.id && nextCurrent.text === nextText) {
      nextItems.push({
        id: currentItem.id,
        text: nextText,
        checked: Boolean(currentItem.checked)
      });
      currentIndex += 1;
      nextIndex += 1;
      continue;
    }

    if (nextCurrent && nextCurrent.text === nextText) {
      currentIndex += 1;
      continue;
    }

    const nextTextLater = nextLines[nextIndex + 1];
    if (nextTextLater && nextTextLater === currentItem.text) {
      nextItems.push({
        id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        text: nextText,
        checked: false
      });
      nextIndex += 1;
      continue;
    }

    nextItems.push({
      id: currentItem.id,
      text: nextText,
      checked: Boolean(currentItem.checked)
    });
    currentIndex += 1;
    nextIndex += 1;
  }

  while (nextIndex < nextLines.length) {
    nextItems.push({
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      text: nextLines[nextIndex],
      checked: false
    });
    nextIndex += 1;
  }

  while (currentIndex < currentItems.length) {
    currentIndex += 1;
  }

  return nextItems;
}

function render() {
  const ordered = applySort(items.map((item) => ({ ...item })));
  const textItems = viewMode ? ordered : items;
  const textValue = textItems.map((item) => item.text).join('\n');
  editorLineMap = textItems.map((item) => ({ id: item.id, text: item.text }));

  settingsSort.checked = Boolean(settings.sortChecked);
  if (settingsDeleteButton) settingsDeleteButton.checked = Boolean(settings.showDeleteButton);
  if (settingsEditButton) settingsEditButton.checked = settings.showEditButton !== false;
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
  if (shouldUpdateEditor && normalizeEditorText(editor.value) !== textValue) {
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

function normalizeEditorText(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
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

function debugMetric(label, data = {}) {
  if (!debugMetricsEnabled) return;
  console.info(`[Handl metrics] ${label}`, {
    ...data,
    tsMs: Math.round(performance.now())
  });
}

function debugMark(label) {
  if (!debugMetricsEnabled) return;
  console.info(`[Handl metrics] ${label}`, {
    tsMs: Math.round(performance.now())
  });
}

function elapsedMs(startAt) {
  return startAt ? Math.round(performance.now() - startAt) : null;
}

async function fetchConfig() {
  try {
    const res = await fetch('/config.json');
    if (!res.ok) throw new Error('config unavailable');
    const json = await res.json();
    debugMetricsEnabled = Boolean(json?.debugMetrics);
    authRequired = Boolean(json?.authRequired);
    debugMetric('config-loaded', {
      totalBootstrapMs: elapsedMs(bootstrapStartedAt),
      debugMetrics: debugMetricsEnabled,
      authRequired
    });
    if (json?.title) {
      document.title = json.title;
      if (titleHeading) titleHeading.textContent = json.title;
    }
  } catch (error) {
    console.warn('Failed to load config', error);
  }
}

async function fetchAuthStatus() {
  try {
    const res = await fetch('/auth/status', { cache: 'no-store' });
    if (!res.ok) return { authRequired, authenticated: false };
    return await res.json();
  } catch (error) {
    console.warn('Failed to load auth status', error);
    return { authRequired, authenticated: false };
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (loginInProgress) return;
  loginInProgress = true;
  if (loginSubmitButton) {
    loginSubmitButton.disabled = true;
  }
  const password = (loginPasswordInput?.value ?? '').trim();
  try {
    await authenticatePassword(password);
    hideLoginError();
    hideLoginScreen();
    await finishBootstrap();
  } catch (error) {
    console.warn('Login failed', error);
    showLoginError();
    loginPasswordInput?.focus();
    loginPasswordInput?.select?.();
  } finally {
    loginInProgress = false;
    if (loginSubmitButton) {
      loginSubmitButton.disabled = false;
    }
  }
}

async function authenticatePassword(password) {
  const res = await fetch('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) {
    throw new Error('invalid password');
  }
  return res.json();
}

function showLoginScreen() {
  document.body.classList.add('auth-locked');
  if (loginScreen) {
    loginScreen.classList.remove('hidden');
    loginScreen.setAttribute('aria-hidden', 'false');
  }
  if (loginPasswordInput) {
    loginPasswordInput.value = '';
  }
  hideLoginError();
  if (loginPasswordInput) {
    requestAnimationFrame(() => loginPasswordInput.focus());
  }
}

function hideLoginScreen() {
  document.body.classList.remove('auth-locked');
  if (loginScreen) {
    loginScreen.classList.add('hidden');
    loginScreen.setAttribute('aria-hidden', 'true');
  }
}

function showLoginError() {
  if (!loginError) return;
  loginError.classList.remove('hidden');
}

function hideLoginError() {
  if (!loginError) return;
  loginError.classList.add('hidden');
}

function autoResizeEditor() {
  editor.style.height = 'auto';
  editor.style.height = `${editor.scrollHeight}px`;
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
  settings.sortChecked = settingsSort.checked;
  persistLocalSettings();
  persistUiCache();
  render();
}

function handleDeleteButtonToggle() {
  settings.showDeleteButton = Boolean(settingsDeleteButton?.checked);
  persistLocalSettings();
  persistUiCache();
  updateDeleteButtonVisibility();
}

function handleEditButtonToggle() {
  settings.showEditButton = Boolean(settingsEditButton?.checked);
  persistLocalSettings();
  persistUiCache();
  updateEditButtonVisibility();
}

function removeCheckedItems() {
  if (!appReady || !doc) return;
  const remaining = items.filter((item) => !item.checked);
  if (remaining.length === items.length) return;
  openConfirmDialog();
}

function confirmRemoveCheckedItems() {
  if (!appReady || !doc) return;
  const remaining = items.filter((item) => !item.checked);
  if (remaining.length === items.length) {
    closeConfirmDialog();
    return;
  }
  mutateDoc((draft) => {
    draft.items = remaining.map((item) => ({
      id: item.id,
      text: item.text,
      checked: Boolean(item.checked)
    }));
  });
  closeConfirmDialog();
  if (settingsDialog.open) {
    settingsDialog.close();
  }
}

function updateDeleteButtonVisibility() {
  if (!deleteCheckedButton) return;
  deleteCheckedButton.classList.toggle('hidden', !settings.showDeleteButton);
}

function updateEditButtonVisibility() {
  if (!toggleModeButton) return;
  toggleModeButton.classList.toggle('hidden', settings.showEditButton === false);
}

function openConfirmDialog() {
  if (!confirmDialog) return;
  confirmDialog.showModal();
}

function closeConfirmDialog() {
  if (!confirmDialog?.open) return;
  confirmDialog.close();
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
    persistUiCache();
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
  persistUiCache();
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
  websocketConnectStartedAt = performance.now();
  ws = new WebSocket(`${scheme}://${location.host}${query}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    debugMetric('ws-open', {
      connectMs: elapsedMs(websocketConnectStartedAt)
    });
    setStatus('online');
    markHeartbeatSeen();
    drainSync();
  });

  ws.addEventListener('message', (event) => {
    handleSocketMessage(event.data);
  });

  ws.addEventListener('close', () => {
    if (generation !== socketGeneration) return;
    debugMetric('ws-close', {
      connectMs: elapsedMs(websocketConnectStartedAt)
    });
    setStatus('warn');
    clearHeartbeatWatchdog();
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    if (generation !== socketGeneration) return;
    debugMetric('ws-error', {
      connectMs: elapsedMs(websocketConnectStartedAt)
    });
    setStatus('warn');
    clearHeartbeatWatchdog();
    ws.close();
  });
}

async function initializeSession() {
  try {
    const joinCode = getJoinCodeFromUrl();
    if (joinCode) {
      const storedToken = loadSessionToken();
      if (storedToken && activeListId) {
        sessionToken = storedToken;
        await loadSessionFromServer();
        if (shareCodeValue && shareCodeValue.toUpperCase() === joinCode.toUpperCase()) {
          clearJoinCodeFromUrl();
          return;
        }
        showInviteConfirmation(joinCode);
        return;
      }
      await joinList(joinCode);
      clearJoinCodeFromUrl();
      return;
    }
    const restoreCode = getRestoreCodeFromUrl();
    if (restoreCode) {
      await restoreList(restoreCode);
      clearJoinCodeFromUrl();
      return;
    }
    const storedToken = loadSessionToken();
    if (!storedToken) {
      showLandingScreen();
      return;
    }
    sessionToken = storedToken;
    await loadSessionFromServer();
  } catch (error) {
    console.warn('Failed to initialize session', error);
    setStatus('warn');
  }
}

async function loadSessionFromServer({ createToken = false } = {}) {
  if (createToken || !sessionToken) {
    sessionToken = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    persistSessionToken(sessionToken);
  }
  sessionFetchStartedAt = performance.now();
  const url = `/session?token=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('session unavailable');
  }
  const session = await res.json();
  debugMetric('session-loaded', {
    fetchMs: elapsedMs(sessionFetchStartedAt),
    listId: session.listId || '',
    created: Boolean(createToken)
  });
  await applySessionResponse(session);
  if (landingMode === 'welcome') {
    hideLandingScreen();
  }
}

async function restoreList(code) {
  try {
    sessionToken = ensureSessionToken();
    sessionFetchStartedAt = performance.now();
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
    clearJoinCodeFromUrl();
    hideLandingScreen();
    debugMetric('restore-loaded', {
      fetchMs: elapsedMs(sessionFetchStartedAt),
      shareCode: code
    });
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
  persistActiveListId();
  persistLocalSettings();

  const cached = loadStoredDocument(activeListId);
  if (cached) {
    doc = cached.doc;
  } else {
    doc = loadDocFromSession(session);
  }
  syncState = Automerge.initSyncState();

  setDoc(doc, { sync: false, persist: false });
  updatePresence(0);
  schedulePersistDocument();
  connectSocket();
}

function showLandingScreen() {
  landingMode = 'welcome';
  pendingJoinCode = '';
  if (landingScreen) {
    landingScreen.classList.remove('hidden');
    landingScreen.setAttribute('aria-hidden', 'false');
  }
  document.body.classList.add('landing-open');
  if (landingJoinForm) {
    landingJoinForm.classList.add('hidden');
  }
  if (landingActions) {
    landingActions.classList.remove('hidden');
  }
  if (landingInviteActions) {
    landingInviteActions.classList.add('hidden');
  }
  if (landingShareCodeInput) {
    landingShareCodeInput.value = '';
  }
  renderLandingCopy();
}

function hideLandingScreen() {
  if (landingScreen) {
    landingScreen.classList.add('hidden');
    landingScreen.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('landing-open');
  landingMode = 'welcome';
  pendingJoinCode = '';
}

function showInviteConfirmation(code) {
  landingMode = 'invite';
  pendingJoinCode = (code || '').trim().toUpperCase();
  if (landingScreen) {
    landingScreen.classList.remove('hidden');
    landingScreen.setAttribute('aria-hidden', 'false');
  }
  document.body.classList.add('landing-open');
  if (landingActions) {
    landingActions.classList.add('hidden');
  }
  if (landingInviteActions) {
    landingInviteActions.classList.remove('hidden');
  }
  if (landingJoinForm) {
    landingJoinForm.classList.add('hidden');
  }
  renderLandingCopy();
}

function renderLandingCopy() {
  const locale = getLocale();
  if (landingMode === 'invite') {
    if (landingTitle) {
      landingTitle.textContent = formatTemplate(locale.landingInviteTitle, { code: pendingJoinCode });
    }
    if (landingBody) {
      landingBody.textContent = locale.landingInviteBody;
    }
    if (landingInviteJoinButton) {
      landingInviteJoinButton.textContent = locale.landingInviteJoin;
    }
    if (landingInviteCancelButton) {
      landingInviteCancelButton.textContent = locale.landingInviteCancel;
    }
    return;
  }
  if (landingTitle) landingTitle.textContent = locale.landingTitle;
  if (landingBody) landingBody.textContent = locale.landingBody;
}

async function createNewList() {
  try {
    await loadSessionFromServer({ createToken: true });
    clearJoinCodeFromUrl();
  } catch (error) {
    console.warn('Failed to create new list', error);
    alert('Unable to create a new list right now. Please try again.');
  }
}

async function attemptLandingJoin() {
  const code = (landingShareCodeInput?.value ?? '').trim().toUpperCase();
  if (!code) return;
  await joinList(code);
}

async function acceptInviteJoin() {
  const code = (pendingJoinCode || '').trim();
  if (!code) return;
  await joinList(code);
  clearJoinCodeFromUrl();
}

function cancelInviteJoin() {
  clearJoinCodeFromUrl();
  hideLandingScreen();
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
  updateNativeShareAvailability();
}

async function copyListIdToClipboard() {
  const value = (shareCodeValue || shareCodeInput?.value || '').trim();
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      showCopyFeedback();
      return;
    }

    const fallback = document.createElement('textarea');
    fallback.value = value;
    fallback.setAttribute('readonly', 'true');
    fallback.style.position = 'fixed';
    fallback.style.left = '-9999px';
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand('copy');
    document.body.removeChild(fallback);
    showCopyFeedback();
  } catch (error) {
    console.warn('Failed to copy list ID', error);
  }
}

function showCopyFeedback() {
  if (!copyFeedback) return;
  const locale = getLocale();
  copyFeedback.textContent = locale.copyFeedback;
  copyFeedback.classList.remove('hidden');
  clearTimeout(copyFeedbackTimeout);
  copyFeedbackTimeout = setTimeout(() => {
    copyFeedback.classList.add('hidden');
  }, 1400);
}

async function shareListLink() {
  const code = (shareCodeValue || '').trim();
  if (!code) return;
  const locale = getLocale();
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', code);
  const joinUrl = url.toString();
  const shareData = {
    title: `${locale.shareJoinTitle || 'Join Handl list'} ${code}`,
    text: joinUrl,
    url: joinUrl
  };

  try {
    if (navigator.share && canUseNativeShare()) {
      await navigator.share(shareData);
    }
  } catch (error) {
    console.warn('Failed to open native share sheet', error);
  }
}

function canUseNativeShare() {
  if (!navigator.share) return false;
  if (navigator.userAgentData?.mobile) return true;
  return window.matchMedia?.('(pointer: coarse)')?.matches || false;
}

function updateNativeShareAvailability() {
  if (!shareListButton) return;
  shareListButton.classList.toggle('hidden', !canUseNativeShare());
}

async function joinList(listId) {
  const code = (listId || '').trim();
  if (!code) return;
  await restoreList(code.toUpperCase());
}

function getJoinCodeFromUrl() {
  const params = new URL(location.href).searchParams;
  return (params.get('join') || '').trim();
}

function getRestoreCodeFromUrl() {
  const params = new URL(location.href).searchParams;
  return (params.get('restore') || '').trim().toUpperCase();
}

function clearJoinCodeFromUrl() {
  const url = new URL(location.href);
  if (!url.searchParams.has('join') && !url.searchParams.has('restore')) return;
  url.searchParams.delete('join');
  url.searchParams.delete('restore');
  const query = url.searchParams.toString();
  const next = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
  history.replaceState({}, '', next);
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

function ensureSessionToken() {
  if (sessionToken) return sessionToken;
  sessionToken = loadSessionToken() || crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  persistSessionToken(sessionToken);
  return sessionToken;
}

function formatTemplate(template, replacements) {
  return String(template || '')
    .replace(/\{code\}/g, replacements?.code ?? '')
    .trim();
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
  updatePresence(0);
  clearHeartbeatWatchdog();
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
    render();
    schedulePersistDocument();
    drainSync();
  } catch (error) {
    console.warn('Invalid sync payload', error);
  }
}

function handleSocketMessage(data) {
  if (typeof data === 'string') {
    handleControlMessage(data);
    return;
  }
  handleMessage(data);
}

function handleControlMessage(raw) {
  try {
    const message = JSON.parse(raw);
    if (message?.type === 'presence') {
      updatePresence(message.connected);
      return;
    }
    if (message?.type === 'heartbeat') {
      markHeartbeatSeen(message.ts);
    }
  } catch (error) {
    // Ignore non-control text messages.
  }
}

function updatePresence(connected) {
  const total = Number.parseInt(String(connected), 10);
  connectedPeers = Number.isFinite(total) ? Math.max(total, 0) : 0;
  if (presenceIndicator) {
    presenceIndicator.classList.toggle('hidden', connectedPeers <= 0);
  }
  updatePresenceTooltip();
}

function markHeartbeatSeen(timestamp = Date.now()) {
  lastHeartbeatAt = timestamp;
  scheduleHeartbeatWatchdog();
}

function scheduleHeartbeatWatchdog() {
  clearHeartbeatWatchdog();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  heartbeatTimeout = setTimeout(() => {
    heartbeatTimeout = null;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const age = Date.now() - lastHeartbeatAt;
    if (age >= 25000) {
      debugMetric('ws-heartbeat-stale', { ageMs: age });
      setStatus('warn');
      try {
        ws.close();
      } catch (error) {
        console.warn('Failed to close stale websocket', error);
      }
      return;
    }
    scheduleHeartbeatWatchdog();
  }, 26000);
}

function clearHeartbeatWatchdog() {
  if (!heartbeatTimeout) return;
  clearTimeout(heartbeatTimeout);
  heartbeatTimeout = null;
}

function loadStoredDocument(listId) {
  if (typeof localStorage === 'undefined' || !listId) return null;
  try {
    const rawSnapshot = localStorage.getItem(docStorageKey(listId));
    if (!rawSnapshot) return null;
    const snapshot = JSON.parse(rawSnapshot);
    return { doc: docFromSnapshot(snapshot) };
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
    localStorage.setItem(docStorageKey(activeListId), JSON.stringify(snapshotFromDoc(doc)));
  } catch (error) {
    console.warn('Failed to persist doc', error);
  }
}

function docStorageKey(listId) {
  return `${LOCAL_DOC_PREFIX}:${listId}`;
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
    persistLocalSettings();
  }
  languageSelect.value = settings.language;
}

function setLanguage(code) {
  if (!appReady || !doc) return;
  const normalized = translations[code] ? code : 'en';
  settings.language = normalized;
  persistLocalSettings();
  persistUiCache();
  applyTranslations();
}

function getLocale() {
  return translations[settings.language] ?? translations.en;
}

function applyTranslations() {
  const locale = getLocale();
  const header = settingsDialog?.querySelector('[data-i18n="settingsTitle"]');
  const deleteButtonLabel = settingsDialog?.querySelector('[data-i18n="showDeleteButton"]');
  const editButtonLabel = settingsDialog?.querySelector('[data-i18n="showEditButton"]');
  const sortLabel = settingsDialog?.querySelector('[data-i18n="sortChecked"]');
  const colorLabel = settingsDialog?.querySelector('[data-i18n="colorScheme"]');
  const removeButton = document.querySelector('[data-i18n="removeChecked"]');
  const languageLabel = settingsDialog?.querySelector('[data-i18n="languageLabel"]');
  const listIdLabel = settingsDialog?.querySelector('[data-i18n="listIdLabel"]');
  const joinLabel = settingsDialog?.querySelector('[data-i18n="joinListLabel"]');
  const joinButtons = document.querySelectorAll('[data-i18n="joinButton"]');
  const landingTitle = document.querySelector('[data-i18n="landingTitle"]');
  const landingBody = document.querySelector('[data-i18n="landingBody"]');
  const landingCreateLabel = document.querySelector('[data-i18n="landingCreateNew"]');
  const landingJoinLabel = document.querySelector('[data-i18n="landingJoinExisting"]');
  const landingInviteJoinLabel = document.querySelector('[data-i18n="landingInviteJoin"]');
  const landingInviteCancelLabel = document.querySelector('[data-i18n="landingInviteCancel"]');
  const landingInviteBody = document.querySelector('[data-i18n="landingInviteBody"]');
  const loginHeadingLabel = document.querySelector('[data-i18n="loginHeading"]');
  const loginSubmitLabel = document.querySelector('[data-i18n="loginSubmit"]');
  const loginInvalidLabel = document.querySelector('[data-i18n="loginInvalid"]');
  const copyFeedbackLabel = document.querySelector('[data-i18n="copyFeedback"]');

  if (header) header.textContent = locale.settingsTitle;
  if (deleteButtonLabel) deleteButtonLabel.textContent = locale.showDeleteButton || 'Show delete button';
  if (editButtonLabel) editButtonLabel.textContent = locale.showEditButton || 'Show edit/view button';
  if (sortLabel) sortLabel.textContent = locale.sortChecked;
  if (colorLabel) colorLabel.textContent = locale.colorScheme;
  if (removeButton) removeButton.textContent = locale.removeChecked;
  if (languageLabel) languageLabel.textContent = locale.languageLabel;
  if (languageSelect) {
    languageSelect.setAttribute('aria-label', locale.languageLabel);
  }
  if (listIdLabel) listIdLabel.textContent = locale.listIdLabel;
  if (joinLabel) joinLabel.textContent = locale.joinListLabel;
  joinButtons.forEach((button) => {
    button.textContent = locale.joinButton;
  });
  if (landingTitle) landingTitle.textContent = locale.landingTitle;
  if (landingBody) landingBody.textContent = locale.landingBody;
  if (landingCreateLabel) landingCreateLabel.textContent = locale.landingCreateNew;
  if (landingJoinLabel) landingJoinLabel.textContent = locale.landingJoinExisting;
  if (landingInviteJoinLabel) landingInviteJoinLabel.textContent = locale.landingInviteJoin;
  if (landingInviteCancelLabel) landingInviteCancelLabel.textContent = locale.landingInviteCancel;
  if (landingInviteBody) landingInviteBody.textContent = locale.landingInviteBody;
  if (loginHeadingLabel) loginHeadingLabel.textContent = locale.loginHeading;
  if (loginPasswordInput) loginPasswordInput.placeholder = locale.loginPasswordLabel;
  if (loginPasswordInput) loginPasswordInput.setAttribute('aria-label', locale.loginPasswordLabel);
  if (loginSubmitLabel) loginSubmitLabel.textContent = locale.loginSubmit;
  if (loginInvalidLabel) loginInvalidLabel.textContent = locale.loginInvalid;
  if (copyFeedbackLabel) copyFeedbackLabel.textContent = locale.copyFeedback;
  if (deleteCheckedButton) {
    const deleteLabel = locale.deleteChecked || locale.removeChecked || 'Delete checked items';
    deleteCheckedButton.setAttribute('title', deleteLabel);
    deleteCheckedButton.setAttribute('aria-label', deleteLabel);
  }
  const confirmTitleLabel = document.querySelector('[data-i18n="removeCheckedConfirmTitle"]');
  const confirmBodyLabel = document.querySelector('[data-i18n="removeCheckedConfirmBody"]');
  const confirmOkLabel = document.querySelector('[data-i18n="removeCheckedConfirmOk"]');
  const confirmCancelLabel = document.querySelector('[data-i18n="removeCheckedConfirmCancel"]');
  if (confirmTitleLabel) confirmTitleLabel.textContent = locale.removeCheckedConfirmTitle;
  if (confirmBodyLabel) confirmBodyLabel.textContent = locale.removeCheckedConfirmBody;
  if (confirmOkLabel) confirmOkLabel.textContent = locale.removeCheckedConfirmOk;
  if (confirmCancelLabel) confirmCancelLabel.textContent = locale.removeCheckedConfirmCancel;
  if (landingShareCodeInput) {
    landingShareCodeInput.placeholder = locale.landingSharePlaceholder;
  }
  renderLandingCopy();
  if (restoreCodeInput) {
    restoreCodeInput.placeholder = locale.listIdPlaceholder;
  }
  if (copyShareCodeButton) {
    copyShareCodeButton.setAttribute('title', locale.copyListId);
    copyShareCodeButton.setAttribute('aria-label', locale.copyListId);
  }
  if (shareListButton) {
    shareListButton.setAttribute('title', locale.shareList);
    shareListButton.setAttribute('aria-label', locale.shareList);
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
  if (settingsDeleteButton) {
    settingsDeleteButton.checked = Boolean(settings.showDeleteButton);
  }
  if (settingsEditButton) {
    settingsEditButton.checked = settings.showEditButton !== false;
  }
  updateDeleteButtonVisibility();
  updateEditButtonVisibility();
  updateStatusTooltip(locale);
  updatePresenceTooltip();
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

function updatePresenceTooltip() {
  if (!presenceIndicator) return;
  const locale = getLocale();
  const label = locale.presenceOthersViewing || 'Other people are viewing the list';
  presenceIndicator.setAttribute('title', connectedPeers > 0 ? label : '');
  presenceIndicator.setAttribute('aria-label', connectedPeers > 0 ? label : '');
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
    const raw = localStorage.getItem(localSettingsKey());
    if (raw) return parseSettingsPayload(raw);
    const legacyKey = activeListId ? `${LOCAL_SETTINGS_PREFIX}:${activeListId}` : '';
    if (!legacyKey) return null;
    const legacyRaw = localStorage.getItem(legacyKey);
    return legacyRaw ? parseSettingsPayload(legacyRaw) : null;
  } catch (error) {
    console.warn('Failed to load local settings', error);
    return null;
  }
}

function parseSettingsPayload(raw) {
  try {
    const parsed = JSON.parse(raw);
    const result = {};
    if (typeof parsed.colorScheme === 'string') result.colorScheme = parsed.colorScheme;
    if (typeof parsed.language === 'string') result.language = parsed.language;
    if (typeof parsed.showDeleteButton === 'boolean') result.showDeleteButton = parsed.showDeleteButton;
    if (typeof parsed.showEditButton === 'boolean') result.showEditButton = parsed.showEditButton;
    if (typeof parsed.sortChecked === 'boolean') result.sortChecked = parsed.sortChecked;
    return Object.keys(result).length ? result : null;
  } catch (error) {
    console.warn('Failed to parse local settings', error);
    return null;
  }
}

function persistLocalSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      localSettingsKey(),
      JSON.stringify({
        colorScheme: settings.colorScheme,
        language: settings.language,
        showDeleteButton: Boolean(settings.showDeleteButton),
        showEditButton: settings.showEditButton !== false,
        sortChecked: Boolean(settings.sortChecked)
      })
    );
  } catch (error) {
    console.warn('Failed to persist local settings', error);
  }
}

function localSettingsKey() {
  return LOCAL_SETTINGS_PREFIX;
}

function persistActiveListId() {
  if (typeof localStorage === 'undefined' || !activeListId) return;
  try {
    localStorage.setItem('handl-active-list-id', activeListId);
  } catch (error) {
    console.warn('Failed to persist active list id', error);
  }
}

function persistUiCache() {
  if (typeof localStorage === 'undefined') return;
  try {
    const theme = themeCatalog[settings.colorScheme] ?? FALLBACK_THEME;
    const locale = translations[settings.language] ?? translations.en;
    localStorage.setItem(
      LOCAL_UI_PREFIX,
      JSON.stringify({
        colorScheme: settings.colorScheme,
        language: settings.language,
        theme: {
          metaColor: theme.metaColor || FALLBACK_THEME_META_COLOR,
          variables: theme.variables || {}
        },
        locale
      })
    );
  } catch (error) {
    console.warn('Failed to persist ui cache', error);
  }
}

function hydrateBootState() {
  const boot = globalThis.__handlBoot || {};
  if (boot.activeListId) {
    activeListId = boot.activeListId;
  }
  if (boot.settings && typeof boot.settings === 'object') {
    settings = { ...settings, ...boot.settings };
  }
  if (boot.ui && typeof boot.ui === 'object') {
    if (boot.ui.theme) {
      themeCatalog = {
        default: FALLBACK_THEME,
        [settings.colorScheme]: {
          label: settings.colorScheme,
          metaColor: boot.ui.theme.metaColor || FALLBACK_THEME_META_COLOR,
          variables: boot.ui.theme.variables || {}
        }
      };
      themeColorMap = {
        default: FALLBACK_THEME_META_COLOR,
        [settings.colorScheme]: boot.ui.theme.metaColor || FALLBACK_THEME_META_COLOR
      };
    }
    if (boot.ui.locale) {
      translations = {
        ...FALLBACK_TRANSLATIONS,
        [settings.language]: boot.ui.locale
      };
    }
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
