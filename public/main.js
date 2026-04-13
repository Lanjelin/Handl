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
const modeLabel = document.getElementById('mode-label');
const languageSelect = document.getElementById('language-select');

let items = [];
let settings = { sortChecked: false, colorScheme: 'default', language: 'en' };
const LOCAL_SETTINGS_KEY = 'handl-settings';
let ws;
let reconnectTimeout;
let sendTimeout;
let pendingSend = false;
let viewMode = true;
let serverRevision = 0;
const themeColorMeta = document.getElementById('theme-color-meta');
const FALLBACK_THEME_META_COLOR = '#0f172a';
const FALLBACK_THEME = {
  label: 'Default',
  metaColor: FALLBACK_THEME_META_COLOR,
  variables: {}
};
let themeCatalog = { default: FALLBACK_THEME };
let themeColorMap = {
  default: FALLBACK_THEME_META_COLOR
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
    modeView: 'View',
    modeEdit: 'Edit',
    toggleToEdit: 'Switch to edit mode',
    toggleToView: 'Switch to view mode',
    statusConnected: 'Connected',
    statusDisconnected: 'Disconnected',
    statusConnecting: 'Connecting'
  }
};

let languages = FALLBACK_LANGUAGES;
let translations = FALLBACK_TRANSLATIONS;

document.addEventListener('DOMContentLoaded', async () => {
  const localSettings = loadLocalSettings();
  if (localSettings) {
    settings = { ...settings, ...localSettings };
  }
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
      settings.colorScheme = schemeSelect.value;
      applyColorScheme(schemeSelect.value);
      scheduleSend();
      persistLocalSettings();
    });
  }
  registerServiceWorker();
  await fetchThemeCatalog();
  await fetchTranslationCatalog();
  applyColorScheme(settings.colorScheme);
  updateModeUI();
  setStatus('idle');
  connectSocket();
  fetchConfig();
});

function handleEditorInput() {
  const parsed = parseEditor(editor.value);
  items = parsed;
  autoResizeEditor();
  scheduleSend();
  if (pendingSend) {
    pendingSend = false;
  }
}

function parseEditor(value) {
  const seen = new Map();
  items.forEach((item) => {
    seen.set(item.text, item);
  });

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => {
      const existing = seen.get(text);
      return {
        id: existing?.id ?? crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        text,
        checked: existing?.checked ?? false
      };
    });
}

function render() {
  const ordered = applySort([...items]);

  settingsSort.checked = Boolean(settings.sortChecked);
  applyColorScheme(settings.colorScheme);
  applyTranslations();
  updateModeUI();

  const textValue = ordered.map((item) => item.text).join('\n');

  checklist.innerHTML = '';
  ordered.forEach((item) => {
    const clone = itemTemplate.content.cloneNode(true);
    const label = clone.querySelector('.check-row');
    const checkbox = clone.querySelector('input[type=checkbox]');
    const text = clone.querySelector('.item-text');

    checkbox.checked = Boolean(item.checked);
    text.textContent = item.text;

    checkbox.addEventListener('change', () => {
      item.checked = checkbox.checked;
      updateFromCheckbox(item);
    });

    label.addEventListener('click', (event) => {
      if (event.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      item.checked = checkbox.checked;
      updateFromCheckbox(item);
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

function updateFromCheckbox(updatedItem) {
  const idx = items.findIndex((item) => item.id === updatedItem.id);
  if (idx !== -1) {
    items[idx] = { ...items[idx], checked: updatedItem.checked };
    render();
    scheduleSend(true);
  }
}

function applySort(source) {
  if (!settings.sortChecked) return source;
  return source.sort((a, b) => {
    if (a.checked === b.checked) return 0;
    return a.checked ? 1 : -1;
  });
}

function scheduleSend(skipDelay = false) {
  if (sendTimeout) clearTimeout(sendTimeout);
  if (skipDelay) {
    sendState();
    return;
  }
  sendTimeout = setTimeout(() => {
    sendState();
  }, 400);
}

function sendState() {
  pendingSend = false;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'state_update',
        payload: { items, settings, baseRevision: serverRevision }
      })
    );
  } else {
    pendingSend = true;
  }
}

function handleSortToggle() {
  settings.sortChecked = settingsSort.checked;
  render();
  scheduleSend();
  persistLocalSettings();
}

function removeCheckedItems() {
  const remaining = items.filter((item) => !item.checked);
  if (remaining.length === items.length) return;
  if (!confirm('Remove all checked items? This cannot be undone.')) return;
  items = remaining;
  render();
  scheduleSend();
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
  const locale = getLocale();
  const labels = {
    online: locale.statusConnected,
    warn: locale.statusDisconnected,
    idle: locale.statusConnecting
  };
  const target = icons[variant] ? variant : 'idle';
  if (statusSymbol) {
    statusSymbol.textContent = icons[target];
  }
  if (statusIndicator) {
    statusIndicator.dataset.status = target;
    statusIndicator.setAttribute('title', labels[target]);
  }
}

function connectSocket() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${scheme}://${location.host}`);

  ws.addEventListener('open', () => {
    setStatus('online');
    if (pendingSend) {
      sendState();
    }
  });

  ws.addEventListener('message', (event) => {
    handleMessage(event.data);
  });

  ws.addEventListener('close', () => {
    setStatus('warn');
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    setStatus('warn');
    ws.close();
  });
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connectSocket();
  }, 1500);
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (err) {
    console.warn('Invalid WS payload', err);
    return;
  }

  if (message.type === 'state' && message.payload) {
    items = message.payload.items ?? [];
    settings = message.payload.settings ?? settings;
    serverRevision = Number(message.payload.revision ?? serverRevision);
    persistLocalSettings();
    render();
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
  const normalized = translations[code] ? code : 'en';
  const previous = settings.language;
  settings.language = normalized;
  if (languageSelect) {
    languageSelect.value = normalized;
  }
  applyTranslations();
  if (normalized !== previous) {
    scheduleSend();
    persistLocalSettings();
  }
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

  if (header) header.textContent = locale.settingsTitle;
  if (sortLabel) sortLabel.textContent = locale.sortChecked;
  if (colorLabel) colorLabel.textContent = locale.colorScheme;
  if (removeButton) removeButton.textContent = locale.removeChecked;
  if (languageLabel) languageLabel.textContent = locale.languageLabel;
  if (languageSelect) {
    languageSelect.setAttribute('aria-label', locale.languageLabel);
  }
  if (modeLabel) {
    modeLabel.textContent = viewMode ? locale.modeView : locale.modeEdit;
  }
  if (toggleModeButton) {
    toggleModeButton.setAttribute('aria-label', viewMode ? locale.toggleToEdit : locale.toggleToView);
  }
  if (languageSelect) {
    languageSelect.value = translations[settings.language] ? settings.language : 'en';
  }
}

function toggleMode() {
  viewMode = !viewMode;
  if (viewMode) {
    handleEditorInput();
  }
  if (!viewMode) {
    editor.focus();
    editor.selectionStart = editor.selectionEnd = editor.value.length;
  }
  updateModeUI();
  if (!viewMode) {
    autoResizeEditor();
  }
  applyTranslations();
  render();
  if (!viewMode) {
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
