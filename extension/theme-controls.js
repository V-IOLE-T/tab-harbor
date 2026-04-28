'use strict';

const {
  t: themeT,
} = globalThis.TabHarborI18n || {};

const {
  escapeHtmlAttribute: themeEscapeHtmlAttribute,
  getFallbackLabel: themeGetFallbackLabel,
  getIconSources: themeGetIconSources,
} = globalThis.TabOutIconUtils || {};

const {
  compressImageFileForStorage: themeCompressImageFileForStorage,
} = globalThis.TabOutBackgroundImage || {};

const {
  reorderSubsetByIds: themeReorderSubsetByIds,
} = globalThis.TabOutListOrder || {};

let themeMenuOpen = false;
let shortcutEditorState = {
  open: false,
  mode: 'create',
  shortcutId: '',
  url: '',
  label: '',
  icon: '',
  iconKind: '',
  presentation: 'default',
  returnToTabPicker: false,
  focusReturnEl: null,
};
let quickShortcutDragState = null;
let quickShortcutDraggedId = '';
let quickShortcutDraggedEl = null;
let quickShortcutGhostEl = null;
let quickShortcutSlotEl = null;
let quickShortcutSuppressClickUntil = 0;

// ---- Tab Picker state ----
let tabPickerOpen = false;
let tabPickerMode = 'tabs';
let tabPickerSearchQuery = '';
let tabPickerSelectedIds = new Set();
let tabPickerFocusReturnEl = null;
let tabPickerManualDraft = { url: '', label: '' };
const THEME_PREFERENCES_KEY = 'themePreferences';
const QUICK_SHORTCUTS_KEY = 'quickShortcuts';
const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([hidden])',
  '[href]:not([hidden])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const THEMES = {
  paper: {
    name: 'Paper',
    meta: 'Warm neutral',
    vars: {
      '--ink': '#1a1613',
      '--paper': '#f8f5f0',
      '--warm-gray': '#e8e2da',
      '--muted': '#9a918a',
      '--accent-amber': '#c8713a',
      '--accent-sage': '#5a7a62',
      '--accent-slate': '#5a6b7a',
      '--accent-rose': '#b35a5a',
      '--workspace-accent': '#8a653f',
      '--workspace-accent-soft': '#f2e7db',
      '--workspace-accent-border': '#d4b396',
      '--workspace-accent-contrast': '#fffaf5',
      '--status-active': '#3d7a4a',
      '--status-cooling': '#b8892e',
      '--status-abandoned': '#b35a5a',
      '--card-bg': '#fffdf9',
    },
  },
  sage: {
    name: 'Sage',
    meta: 'Soft green',
    vars: {
      '--ink': '#172018',
      '--paper': '#eef2eb',
      '--warm-gray': '#dbe3d7',
      '--muted': '#7f8c81',
      '--accent-amber': '#8b7146',
      '--accent-sage': '#4d6f57',
      '--accent-slate': '#5e7072',
      '--accent-rose': '#9a6860',
      '--workspace-accent': '#4f7657',
      '--workspace-accent-soft': '#deebe1',
      '--workspace-accent-border': '#9ebda6',
      '--workspace-accent-contrast': '#f6fbf7',
      '--status-active': '#446953',
      '--status-cooling': '#907548',
      '--status-abandoned': '#996760',
      '--card-bg': '#fafcf8',
    },
  },
  mist: {
    name: 'Mist',
    meta: 'Cool neutral',
    vars: {
      '--ink': '#161c21',
      '--paper': '#eef2f5',
      '--warm-gray': '#d8dee5',
      '--muted': '#7d8791',
      '--accent-amber': '#927255',
      '--accent-sage': '#5d7569',
      '--accent-slate': '#4f687a',
      '--accent-rose': '#9b6b71',
      '--workspace-accent': '#4f6d88',
      '--workspace-accent-soft': '#dde7f0',
      '--workspace-accent-border': '#9fb2c5',
      '--workspace-accent-contrast': '#f7fafc',
      '--status-active': '#4e6c61',
      '--status-cooling': '#94724a',
      '--status-abandoned': '#93636c',
      '--card-bg': '#fafcfd',
    },
  },
  blush: {
    name: 'Blush',
    meta: 'Soft clay',
    vars: {
      '--ink': '#201716',
      '--paper': '#f6efec',
      '--warm-gray': '#e5d8d2',
      '--muted': '#97827c',
      '--accent-amber': '#a06d4f',
      '--accent-sage': '#6a7866',
      '--accent-slate': '#64707a',
      '--accent-rose': '#ad6966',
      '--workspace-accent': '#a5656f',
      '--workspace-accent-soft': '#f2dfe1',
      '--workspace-accent-border': '#d2a1a7',
      '--workspace-accent-contrast': '#fff7f8',
      '--status-active': '#5a7162',
      '--status-cooling': '#9c7448',
      '--status-abandoned': '#a96262',
      '--card-bg': '#fffaf7',
    },
  },
  midnight: {
    name: 'Night',
    meta: 'Dark mode',
    vars: {
      '--ink': '#e8e2da',
      '--paper': '#0c1821',
      '--warm-gray': '#2a2420',
      '--muted': '#7a7169',
      '--accent-amber': '#82aae8',
      '--accent-sage': '#6b8f75',
      '--accent-slate': '#6b7f8f',
      '--accent-rose': '#c46b6b',
      '--workspace-accent': '#82aae8',
      '--workspace-accent-soft': '#152535',
      '--workspace-accent-border': '#3a3430',
      '--workspace-accent-contrast': '#1a1613',
      '--status-active': '#4d8f5a',
      '--status-cooling': '#c4993e',
      '--status-abandoned': '#c46b6b',
      '--card-bg': '#142031',
    },
  },
};

let themePreferences = {
  themeId: 'paper',
  customBackground: '',
  surfaceOpacity: 14,
};

function normalizeThemePreferences(input) {
  const next = input && typeof input === 'object' ? input : {};
  const themeId = String(next.themeId || 'paper');
  const rawOpacity = Number(next.surfaceOpacity);
  const surfaceOpacity = Number.isFinite(rawOpacity)
    ? Math.min(60, Math.max(2, Math.round(rawOpacity)))
    : 14;
  return {
    themeId: THEMES[themeId] ? themeId : 'paper',
    customBackground: typeof next.customBackground === 'string' ? next.customBackground : '',
    surfaceOpacity,
  };
}

function normalizeQuickShortcuts(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(item => item && item.url)
    .map(item => {
      const normalizedIcon = normalizeShortcutIcon(item.icon || item.customIcon || '');
      return {
        id: String(item.id || `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        url: String(item.url).trim(),
        label: String(item.label || '').trim(),
        icon: normalizedIcon.value,
        iconKind: normalizedIcon.kind,
      };
    })
    .filter(item => item.url);
}

function isSvgMarkup(value) {
  const text = String(value || '').trim();
  return /^<svg[\s>]/i.test(text) || /^<\?xml[\s\S]*<svg[\s>]/i.test(text);
}

function svgToDataUrl(svgText) {
  const normalized = String(svgText || '').trim();
  if (!normalized) return '';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
}

function extractIconFromClipboardHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return { value: '', kind: '' };

  if (isSvgMarkup(raw)) {
    return { value: raw, kind: 'svg' };
  }

  const imageMatch = raw.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imageMatch?.[1]) {
    const src = imageMatch[1].trim();
    if (/^data:image\//i.test(src)) {
      return { value: src, kind: 'image' };
    }
  }

  const svgMatch = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (svgMatch?.[0]) {
    return { value: svgMatch[0], kind: 'svg' };
  }

  return { value: '', kind: '' };
}

function isTransientClipboardReference(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return (
    /^file:\/\//i.test(text) ||
    /^blob:/i.test(text) ||
    /^\/(private|var|tmp|Users)\//.test(text) ||
    /^[A-Za-z]:\\/.test(text)
  );
}

function getThemeDefinition(themeId) {
  return THEMES[themeId] || THEMES.paper;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function focusFirstElement(container) {
  if (!container) return null;
  const target = container.querySelector(FOCUSABLE_SELECTOR);
  target?.focus?.({ preventScroll: true });
  return target || null;
}

function setThemeMenuOpen(nextOpen, { restoreFocus = false } = {}) {
  themeMenuOpen = Boolean(nextOpen);
  renderThemeMenu();

  if (themeMenuOpen) {
    const panel = document.getElementById('themeMenuPanel');
    requestAnimationFrame(() => {
      focusFirstElement(panel);
    });
    return;
  }

  if (restoreFocus) {
    document.getElementById('themeMenuTrigger')?.focus?.({ preventScroll: true });
  }
}

function hexToRgbChannels(hex) {
  const value = String(hex || '').replace('#', '');
  if (value.length !== 6) return '248 245 240';

  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyThemePreferences() {
  const root = document.documentElement;
  const body = document.body;
  const theme = getThemeDefinition(themePreferences.themeId);
  const surfaceOpacity = themePreferences.surfaceOpacity;
  const borderOpacity = Math.max(8, surfaceOpacity);
  const badgeOpacity = Math.max(3, Math.round(surfaceOpacity * 0.28));
  const fallbackOpacity = Math.max(4, Math.round(surfaceOpacity * 0.36));

  Object.entries(theme.vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  root.style.setProperty('--custom-surface-opacity', `${surfaceOpacity}%`);
  root.style.setProperty('--custom-border-opacity', `${borderOpacity}%`);
  root.style.setProperty('--custom-badge-opacity', `${badgeOpacity}%`);
  root.style.setProperty('--custom-fallback-opacity', `${fallbackOpacity}%`);

  if (themePreferences.customBackground) {
    root.style.setProperty('--page-custom-background', `url("${themePreferences.customBackground}")`);
    if (body) {
      const paperRgb = hexToRgbChannels(theme.vars['--paper']);
      body.style.backgroundImage = `linear-gradient(rgba(${paperRgb} / 0.26), rgba(${paperRgb} / 0.26)), url("${themePreferences.customBackground}")`;
      body.classList.add('has-custom-background');
    }
  } else {
    root.style.setProperty('--page-custom-background', 'none');
    if (body) {
      body.style.removeProperty('background-image');
      body.classList.remove('has-custom-background');
    }
  }
}

function renderThemeMenu() {
  const trigger = document.getElementById('themeMenuTrigger');
  const pinToggle = document.getElementById('headerPinToggle');
  const panel = document.getElementById('themeMenuPanel');
  const options = document.getElementById('themeOptions');
  const transparencyRange = document.getElementById('themeTransparencyRange');
  const transparencyValue = document.getElementById('themeTransparencyValue');
  if (!trigger || !panel || !options || !transparencyRange || !transparencyValue) return;

  trigger.setAttribute('aria-expanded', String(themeMenuOpen));
  panel.hidden = !themeMenuOpen;
  transparencyRange.value = String(themePreferences.surfaceOpacity);
  transparencyValue.textContent = `${themePreferences.surfaceOpacity}%`;
  if (pinToggle && typeof groupOrderState !== 'undefined') {
    const pinTooltip = groupOrderState.pinEnabled
      ? (themeT ? themeT('pinnedOrder') : 'Pinned order')
      : (themeT ? themeT('pinOrder') : 'Pin order');
    pinToggle.classList.toggle('is-active', groupOrderState.pinEnabled);
    pinToggle.dataset.tooltip = pinTooltip;
    pinToggle.setAttribute('aria-label', pinTooltip);
    pinToggle.setAttribute('aria-pressed', String(groupOrderState.pinEnabled));
  }

  options.innerHTML = Object.entries(THEMES).map(([id, theme]) => `
    <button
      class="theme-option ${themePreferences.themeId === id ? 'is-active' : ''}"
      type="button"
      data-action="select-theme"
      data-theme-id="${id}"
      aria-pressed="${themePreferences.themeId === id}"
      style="--theme-paper:${theme.vars['--paper']};--theme-accent:${theme.vars['--accent-amber']};"
    >
      <span class="theme-option-main">
        <span class="theme-option-swatch" aria-hidden="true"></span>
        <span>
          <span class="theme-option-name">${theme.name}</span>
        </span>
      </span>
      <span class="theme-option-check" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" /></svg>
      </span>
    </button>
  `).join('');
}

async function getQuickShortcuts() {
  const stored = await chrome.storage.local.get(QUICK_SHORTCUTS_KEY);
  return normalizeQuickShortcuts(stored[QUICK_SHORTCUTS_KEY]);
}

async function saveQuickShortcuts(shortcuts) {
  const normalized = normalizeQuickShortcuts(shortcuts);
  await chrome.storage.local.set({ [QUICK_SHORTCUTS_KEY]: normalized });
  return normalized;
}

async function removeQuickShortcutById(shortcutId) {
  if (!shortcutId) return await getQuickShortcuts();
  const shortcuts = await getQuickShortcuts();
  return await saveQuickShortcuts(shortcuts.filter(item => item.id !== shortcutId));
}

async function saveQuickShortcutOrder(orderIds) {
  const shortcuts = await getQuickShortcuts();
  if (!Array.isArray(orderIds) || !orderIds.length || !themeReorderSubsetByIds) {
    return shortcuts;
  }
  return await saveQuickShortcuts(themeReorderSubsetByIds(shortcuts, orderIds));
}

function normalizeShortcutUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).toString();
  } catch {
    return '';
  }
}

function normalizeShortcutIcon(input) {
  const raw = String(input || '').trim();
  if (!raw) return { value: '', kind: '' };

  if (isSvgMarkup(raw)) {
    return { value: raw, kind: 'svg' };
  }

  if (/^data:image\//i.test(raw)) {
    return { value: raw, kind: 'image' };
  }

  if (/^[a-z]+:\/\//i.test(raw) || raw.includes('.') || raw.startsWith('/')) {
    const normalizedUrl = normalizeShortcutUrl(raw);
    if (normalizedUrl) {
      return { value: normalizedUrl, kind: 'image' };
    }
  }

  const glyph = [...raw].slice(0, 2).join('');
  return { value: glyph, kind: glyph ? 'glyph' : '' };
}

function createShortcutEditorState(input = {}) {
  return {
    open: Boolean(input.open),
    mode: input.mode === 'edit' ? 'edit' : 'create',
    shortcutId: String(input.shortcutId || ''),
    url: String(input.url || ''),
    label: String(input.label || ''),
    icon: String(input.icon || ''),
    iconKind: String(input.iconKind || 'site'),
    presentation: input.presentation === 'tab-picker' ? 'tab-picker' : 'default',
    returnToTabPicker: Boolean(input.returnToTabPicker),
    focusReturnEl: input.focusReturnEl instanceof HTMLElement ? input.focusReturnEl : null,
  };
}

function createTabPickerManualDraft(input = {}) {
  return {
    url: String(input.url || ''),
    label: String(input.label || ''),
  };
}

function getShortcutEditorElements() {
  return {
    modalBackdrop: document.getElementById('shortcutEditorBackdrop'),
    modalPanel: document.getElementById('shortcutEditor'),
    embeddedHost: document.getElementById('tabPickerEditorHost'),
    form: document.getElementById('shortcutEditorForm'),
    title: document.getElementById('shortcutEditorTitle'),
    back: document.getElementById('shortcutEditorBack'),
    url: document.getElementById('shortcutEditorUrl'),
    label: document.getElementById('shortcutEditorLabel'),
    source: document.getElementById('shortcutEditorSource'),
    sourceButtons: [...document.querySelectorAll('[data-action="select-shortcut-source"]')],
    emoji: document.getElementById('shortcutEditorEmoji'),
    svgCode: document.getElementById('shortcutEditorSvgCode'),
    siteGroup: document.getElementById('shortcutEditorSiteGroup'),
    emojiGroup: document.getElementById('shortcutEditorEmojiGroup'),
    imageGroup: document.getElementById('shortcutEditorImageGroup'),
    svgGroup: document.getElementById('shortcutEditorSvgGroup'),
    preview: document.getElementById('shortcutEditorPreview'),
    previewFallback: document.getElementById('shortcutEditorPreviewFallback'),
    previewTitle: document.getElementById('shortcutEditorPreviewTitle'),
    previewMeta: document.getElementById('shortcutEditorPreviewMeta'),
    fileInput: document.getElementById('shortcutIconFileInput'),
  };
}

function getTabPickerElements() {
  return {
    panel: document.getElementById('tabPicker'),
    tabsTab: document.getElementById('tabPickerTabsTab'),
    urlTab: document.getElementById('tabPickerUrlTab'),
    searchWrap: document.getElementById('tabPickerSearchWrap'),
    search: document.getElementById('tabPickerSearch'),
    list: document.getElementById('tabPickerList'),
    editorHost: document.getElementById('tabPickerEditorHost'),
    footer: document.getElementById('tabPickerFooter'),
  };
}

function syncFormControlValue(element, nextValue) {
  if (!element) return;
  const normalized = String(nextValue || '');
  const isActive = element === document.activeElement;
  if (element.dataset.composing === 'true') return;
  if (isActive && element.value === normalized) return;
  if (element.value !== normalized) {
    element.value = normalized;
  }
}

function resetShortcutEditorPosition(panel) {
  if (!panel) return;
  panel.style.removeProperty('left');
  panel.style.removeProperty('top');
  panel.style.removeProperty('right');
  panel.style.removeProperty('bottom');
  panel.style.removeProperty('inset');
}

function positionShortcutEditor(triggerEl = null) {
  if (shortcutEditorState.presentation === 'tab-picker') return;

  const panel = document.getElementById('shortcutEditor');
  if (!panel) return;

  if (!(triggerEl instanceof HTMLElement)) {
    resetShortcutEditorPosition(panel);
    return;
  }

  const viewportPadding = 16;
  const offset = 14;
  const triggerRect = triggerEl.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const panelWidth = panelRect.width || 360;
  const panelHeight = panelRect.height || 420;

  const fitsBelow = triggerRect.bottom + offset + panelHeight <= window.innerHeight - viewportPadding;
  const top = fitsBelow
    ? triggerRect.bottom + offset
    : Math.max(viewportPadding, triggerRect.top - panelHeight - offset);
  const left = Math.min(
    Math.max(triggerRect.left - 8, viewportPadding),
    window.innerWidth - panelWidth - viewportPadding
  );

  panel.style.inset = 'auto';
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function restoreShortcutEditorHome() {
  const elements = getShortcutEditorElements();
  if (!elements.form || !elements.modalPanel) return;
  if (elements.form.parentElement !== elements.modalPanel) {
    elements.modalPanel.appendChild(elements.form);
  }
}

function mountShortcutEditorInTabPicker() {
  const elements = getShortcutEditorElements();
  if (!elements.form || !elements.embeddedHost) return;
  if (elements.form.parentElement !== elements.embeddedHost) {
    elements.embeddedHost.appendChild(elements.form);
  }
}

function syncShortcutEditor() {
  const elements = getShortcutEditorElements();
  if (!elements.form) return;

  const isEmbedded = shortcutEditorState.presentation === 'tab-picker';
  if (isEmbedded) {
    mountShortcutEditorInTabPicker();
    if (elements.modalPanel) elements.modalPanel.hidden = true;
    if (elements.modalBackdrop) elements.modalBackdrop.hidden = true;
    if (elements.embeddedHost) elements.embeddedHost.hidden = !shortcutEditorState.open;
    elements.form.classList.add('is-tab-picker-pane');
  } else {
    restoreShortcutEditorHome();
    if (elements.modalPanel) elements.modalPanel.hidden = !shortcutEditorState.open;
    if (elements.modalBackdrop) elements.modalBackdrop.hidden = !shortcutEditorState.open;
    if (elements.embeddedHost) elements.embeddedHost.hidden = true;
    elements.form.classList.remove('is-tab-picker-pane');
  }

  if (elements.back) {
    elements.back.hidden = true;
  }
  if (shortcutEditorState.presentation === 'tab-picker' && shortcutEditorState.mode === 'create') {
    elements.title.textContent = themeT ? themeT('addByUrlTitle') : 'Add by URL';
  } else {
    elements.title.textContent = shortcutEditorState.mode === 'edit'
      ? (themeT ? themeT('shortcutEditTitle') : 'Edit shortcut')
      : (themeT ? themeT('shortcutAddTitle') : 'Add shortcut');
  }
  syncFormControlValue(elements.url, shortcutEditorState.url);
  syncFormControlValue(elements.label, shortcutEditorState.label);
  elements.sourceButtons.forEach(button => {
    const isSelected = button.dataset.source === shortcutEditorState.iconKind;
    button.setAttribute('aria-pressed', String(isSelected));
  });
  syncFormControlValue(elements.emoji, shortcutEditorState.iconKind === 'glyph' ? shortcutEditorState.icon : '');
  if (elements.svgCode) {
    syncFormControlValue(elements.svgCode, shortcutEditorState.iconKind === 'svg' ? shortcutEditorState.icon : '');
  }
  if (elements.siteGroup) elements.siteGroup.hidden = shortcutEditorState.iconKind !== 'site';
  if (elements.emojiGroup) elements.emojiGroup.hidden = shortcutEditorState.iconKind !== 'glyph';
  if (elements.imageGroup) elements.imageGroup.hidden = shortcutEditorState.iconKind !== 'image';
  if (elements.svgGroup) elements.svgGroup.hidden = shortcutEditorState.iconKind !== 'svg';

  const label = shortcutEditorState.label.trim() || shortcutEditorState.url.trim() || (themeT ? themeT('shortcutPreviewFallbackLabel') : 'Shortcut');
  const previewTitle = shortcutEditorState.iconKind === 'image'
    ? (themeT ? themeT('shortcutPreviewCustomImageIcon') : 'Custom image icon')
    : shortcutEditorState.iconKind === 'svg'
      ? (themeT ? themeT('shortcutPreviewSvgIcon') : 'SVG icon')
      : shortcutEditorState.iconKind === 'glyph'
        ? (themeT ? themeT('shortcutPreviewEmojiIcon') : 'Emoji icon')
        : (themeT ? themeT('shortcutPreviewWebsiteIcon') : 'Website icon');
  const previewMeta = shortcutEditorState.iconKind
    ? (themeT ? themeT('shortcutPreviewHasCustomIcon') : 'Custom icon will replace the site favicon.')
    : (themeT ? themeT('shortcutPreviewNoCustomIcon') : 'Upload or paste an image, or type an emoji.');

  if (elements.previewTitle) elements.previewTitle.textContent = previewTitle;
  if (elements.previewMeta) elements.previewMeta.textContent = previewMeta;
  if (elements.preview) {
    elements.preview.setAttribute('aria-label', `${previewTitle}. ${previewMeta}`);
  }

  if (elements.preview) {
    elements.preview.innerHTML = '';
    if ((shortcutEditorState.iconKind === 'image' || shortcutEditorState.iconKind === 'svg') && shortcutEditorState.icon) {
      const img = document.createElement('img');
      img.src = shortcutEditorState.iconKind === 'svg' ? svgToDataUrl(shortcutEditorState.icon) : shortcutEditorState.icon;
      img.alt = '';
      img.addEventListener('error', () => {
        img.remove();
        if (elements.previewFallback) {
          elements.previewFallback.textContent = themeGetFallbackLabel(label, '');
          elements.preview.appendChild(elements.previewFallback);
        }
      });
      elements.preview.appendChild(img);
    } else if (shortcutEditorState.iconKind === 'glyph' && shortcutEditorState.icon) {
      const glyph = document.createElement('span');
      glyph.className = 'shortcut-editor-preview-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = shortcutEditorState.icon;
      elements.preview.appendChild(glyph);
    } else if (elements.previewFallback) {
      elements.previewFallback.textContent = themeGetFallbackLabel(label, '');
      elements.preview.appendChild(elements.previewFallback);
    }
  }
}

function openShortcutEditor(shortcut = null, triggerEl = null, options = {}) {
  const normalized = shortcut ? normalizeQuickShortcuts([shortcut])[0] : null;
  if (options.presentation === 'tab-picker') {
    mountShortcutEditorInTabPicker();
  } else {
    restoreShortcutEditorHome();
  }
  shortcutEditorState = createShortcutEditorState({
    open: true,
    mode: normalized ? 'edit' : 'create',
    shortcutId: normalized?.id || '',
    url: normalized?.url || '',
    label: normalized?.label || '',
    icon: normalized?.icon || '',
    iconKind: normalized?.iconKind || 'site',
    presentation: options.presentation,
    returnToTabPicker: options.returnToTabPicker,
    focusReturnEl: triggerEl instanceof HTMLElement ? triggerEl : document.activeElement,
  });
  syncShortcutEditor();
  requestAnimationFrame(() => {
    if (shortcutEditorState.presentation !== 'tab-picker') {
      positionShortcutEditor(triggerEl);
    }
    getShortcutEditorElements().url?.focus?.({ preventScroll: true });
  });
}

function closeShortcutEditor({ restoreFocus = true } = {}) {
  const focusTarget = shortcutEditorState.focusReturnEl;
  const wasEmbedded = shortcutEditorState.presentation === 'tab-picker';
  resetShortcutEditorPosition(getShortcutEditorElements().modalPanel);
  shortcutEditorState = createShortcutEditorState();
  syncShortcutEditor();
  restoreShortcutEditorHome();
  if (wasEmbedded) {
    closeTabPicker({ restoreFocus });
    return;
  }
  if (restoreFocus) {
    focusTarget?.focus?.({ preventScroll: true });
  }
}

function setShortcutEditorField(field, value) {
  shortcutEditorState = createShortcutEditorState({
    ...shortcutEditorState,
    [field]: value,
  });
  syncShortcutEditor();
}

function syncTabPickerLayout() {
  const elements = getTabPickerElements();
  if (!elements.panel) return;

  const isUrlMode = tabPickerMode === 'url';
  if (elements.tabsTab) {
    elements.tabsTab.classList.toggle('is-active', !isUrlMode);
    elements.tabsTab.setAttribute('aria-selected', String(!isUrlMode));
  }
  if (elements.urlTab) {
    elements.urlTab.classList.toggle('is-active', isUrlMode);
    elements.urlTab.setAttribute('aria-selected', String(isUrlMode));
  }
  if (elements.searchWrap) {
    elements.searchWrap.hidden = isUrlMode;
  }
  if (elements.list) {
    elements.list.hidden = isUrlMode;
  }
  if (elements.editorHost) {
    elements.editorHost.hidden = !isUrlMode;
  }
  if (elements.footer && isUrlMode) {
    elements.footer.hidden = true;
  }
}

function setTabPickerMode(nextMode, { focus = true } = {}) {
  tabPickerMode = nextMode === 'url' ? 'url' : 'tabs';
  if (tabPickerMode === 'url') {
    openShortcutEditor(null, tabPickerFocusReturnEl || document.activeElement, {
      presentation: 'tab-picker',
    });
  } else if (shortcutEditorState.presentation === 'tab-picker') {
    shortcutEditorState = createShortcutEditorState();
    syncShortcutEditor();
    restoreShortcutEditorHome();
  }
  syncTabPickerLayout();

  requestAnimationFrame(() => {
    if (!focus) return;
    const elements = getTabPickerElements();
    if (tabPickerMode === 'url') {
      getShortcutEditorElements().url?.focus?.({ preventScroll: true });
      return;
    }
    elements.search?.focus?.({ preventScroll: true });
  });

  if (tabPickerMode === 'tabs') {
    renderTabPickerPanel();
  }
}

function setTabPickerManualField(field, value) {
  tabPickerManualDraft = createTabPickerManualDraft({
    ...tabPickerManualDraft,
    [field]: value,
  });
}

function setShortcutEditorIcon(input) {
  const normalized = normalizeShortcutIcon(input);
  shortcutEditorState = createShortcutEditorState({
    ...shortcutEditorState,
    icon: normalized.value,
    iconKind: normalized.kind || 'site',
  });
  syncShortcutEditor();
}

function setShortcutEditorSource(source) {
  const nextSource = ['site', 'glyph', 'image', 'svg'].includes(source) ? source : 'site';
  shortcutEditorState = createShortcutEditorState({
    ...shortcutEditorState,
    iconKind: nextSource,
    icon: nextSource === shortcutEditorState.iconKind ? shortcutEditorState.icon : '',
  });
  syncShortcutEditor();
}

async function applyShortcutEditorImageFile(file) {
  if (!themeCompressImageFileForStorage) {
    throw new Error(themeT ? themeT('errorImageCompressionUnavailable') : 'Image compression is unavailable');
  }
  const dataUrl = await themeCompressImageFileForStorage(file, {
    maxBytes: 96 * 1024,
    maxEdge: 160,
  });
  setShortcutEditorIcon(dataUrl);
}

async function saveShortcutEditorShortcut() {
  const url = normalizeShortcutUrl(shortcutEditorState.url);
  if (!url) {
    throw new Error(themeT ? themeT('errorPleaseEnterValidUrl') : 'Please enter a valid URL');
  }

  const shortcuts = await getQuickShortcuts();
  const nextShortcut = {
    id: shortcutEditorState.shortcutId || `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    label: shortcutEditorState.label.trim(),
    icon: shortcutEditorState.icon,
    iconKind: shortcutEditorState.iconKind,
  };

  const nextShortcuts = shortcutEditorState.mode === 'edit'
    ? shortcuts.map(item => item.id === nextShortcut.id ? nextShortcut : item)
    : [...shortcuts, nextShortcut];

  await saveQuickShortcuts(nextShortcuts);
  await renderQuickShortcuts();
  closeShortcutEditor();
}

async function saveTabPickerUrlShortcut() {
  const url = normalizeShortcutUrl(tabPickerManualDraft.url);
  if (!url) {
    throw new Error('Please enter a valid URL');
  }

  const shortcuts = await getQuickShortcuts();
  if (shortcuts.some(item => item.url === url)) {
    throw new Error('Already in shortcuts');
  }

  const nextShortcut = {
    id: `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    label: tabPickerManualDraft.label.trim(),
    icon: '',
    iconKind: 'site',
  };

  await saveQuickShortcuts([...shortcuts, nextShortcut]);
  await renderQuickShortcuts();
  closeTabPicker();
}

function getShortcutLabel(shortcut) {
  if (shortcut.label) return shortcut.label;

  try {
    return friendlyDomain(new URL(shortcut.url).hostname);
  } catch {
    return shortcut.url;
  }
}

function animateQuickShortcutNode(item, previousRect) {
  if (!item || !previousRect) return;

  const nextRect = item.getBoundingClientRect();
  const deltaX = previousRect.left - nextRect.left;
  const deltaY = previousRect.top - nextRect.top;
  if (!deltaX && !deltaY) return;

  const travel = Math.hypot(deltaX, deltaY);
  const duration = prefersReducedMotion()
    ? 0
    : Math.min(380, Math.max(240, Math.round(228 + travel * 0.4)));

  item.style.transition = 'none';
  item.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
  requestAnimationFrame(() => {
    item.style.transition = duration
      ? `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
      : 'none';
    item.style.transform = '';
  });
}

function animateQuickShortcutItems(listEl, previousRects, affectedIds = null) {
  const affected = affectedIds instanceof Set ? affectedIds : null;
  listEl?.querySelectorAll('[data-shortcut-id]:not(.is-drag-slot)').forEach(item => {
    const key = item.dataset.shortcutId || '';
    if (affected && !affected.has(key)) return;
    animateQuickShortcutNode(item, previousRects.get(key));
  });
}

function settleQuickShortcutItems(listEl, affectedIds = null) {
  const affected = affectedIds instanceof Set ? affectedIds : null;
  listEl?.querySelectorAll('[data-shortcut-id]:not(.is-drag-slot)').forEach(item => {
    const key = item.dataset.shortcutId || '';
    if (affected && !affected.has(key)) return;
    item.style.transition = 'none';
    item.style.transform = '';
  });
}

function ensureQuickShortcutSlot() {
  if (quickShortcutSlotEl || !quickShortcutDraggedEl) return quickShortcutSlotEl;

  quickShortcutSlotEl = document.createElement('div');
  quickShortcutSlotEl.className = 'quick-shortcut-slot is-drag-slot';
  quickShortcutSlotEl.dataset.shortcutId = quickShortcutDraggedId;
  quickShortcutSlotEl.style.width = `${quickShortcutDragState?.width || quickShortcutDraggedEl.getBoundingClientRect().width}px`;
  quickShortcutSlotEl.style.height = `${quickShortcutDragState?.height || quickShortcutDraggedEl.getBoundingClientRect().height}px`;
  quickShortcutDraggedEl.replaceWith(quickShortcutSlotEl);
  return quickShortcutSlotEl;
}

function ensureQuickShortcutGhost() {
  if (quickShortcutGhostEl || !quickShortcutDraggedEl) return quickShortcutGhostEl;

  quickShortcutGhostEl = quickShortcutDraggedEl.cloneNode(true);
  quickShortcutGhostEl.classList.remove('is-drag-origin');
  quickShortcutGhostEl.classList.add('is-drag-ghost');
  quickShortcutGhostEl.style.setProperty('--drag-width', `${quickShortcutDragState?.width || quickShortcutDraggedEl.getBoundingClientRect().width}px`);
  quickShortcutGhostEl.style.setProperty('--drag-height', `${quickShortcutDragState?.height || quickShortcutDraggedEl.getBoundingClientRect().height}px`);
  document.body.appendChild(quickShortcutGhostEl);
  return quickShortcutGhostEl;
}

function clearQuickShortcutDragState() {
  quickShortcutDragState = null;
  quickShortcutDraggedId = '';
  document.body.classList.remove('quick-shortcut-list-dragging');

  quickShortcutDraggedEl = null;
  quickShortcutGhostEl?.remove();
  quickShortcutGhostEl = null;
  quickShortcutSlotEl?.remove();
  quickShortcutSlotEl = null;
}

function clampQuickShortcutDragPoint(clientX, clientY) {
  const listEl = quickShortcutDragState?.listEl;
  if (!listEl || !quickShortcutDragState) {
    return { clientX, clientY };
  }

  const listRect = listEl.getBoundingClientRect();
  const width = Number(quickShortcutDragState.width) || 0;
  const height = Number(quickShortcutDragState.height) || 0;
  const minClientX = listRect.left + quickShortcutDragState.offsetX - width / 2;
  const maxClientX = listRect.right + quickShortcutDragState.offsetX - width / 2;
  const minClientY = listRect.top + quickShortcutDragState.offsetY - height / 2;
  const maxClientY = listRect.bottom + quickShortcutDragState.offsetY - height / 2;

  return {
    clientX: Math.min(Math.max(clientX, minClientX), maxClientX),
    clientY: Math.min(Math.max(clientY, minClientY), maxClientY),
  };
}

function updateDraggedQuickShortcutPosition(clientX, clientY) {
  if (!quickShortcutGhostEl || !quickShortcutDragState) return;

  quickShortcutGhostEl.style.setProperty('--drag-left', `${clientX - quickShortcutDragState.offsetX}px`);
  quickShortcutGhostEl.style.setProperty('--drag-top', `${clientY - quickShortcutDragState.offsetY}px`);
}

function buildQuickShortcutSlotTargets(listEl) {
  if (!(listEl instanceof HTMLElement)) return [];

  return [...listEl.querySelectorAll('[data-shortcut-id]')].map(item => {
    const rect = item.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  });
}

function findQuickShortcutSlotIndex(slotTargets, draggedCenterX, draggedCenterY) {
  if (!Array.isArray(slotTargets) || !slotTargets.length) return -1;

  let targetIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  slotTargets.forEach((slot, index) => {
    const dx = draggedCenterX - slot.centerX;
    const dy = draggedCenterY - slot.centerY;
    const distance = (dx * dx) + (dy * dy);
    if (distance < closestDistance) {
      closestDistance = distance;
      targetIndex = index;
    }
  });

  return targetIndex;
}

function previewQuickShortcutOrder(clientX, clientY) {
  const listEl = quickShortcutDragState?.listEl;
  if (!listEl || !quickShortcutDraggedId || !quickShortcutSlotEl) return;

  const clampedPoint = clampQuickShortcutDragPoint(clientX, clientY);
  const draggedCenterX = clampedPoint.clientX - quickShortcutDragState.offsetX + quickShortcutDragState.width / 2;
  const draggedCenterY = clampedPoint.clientY - quickShortcutDragState.offsetY + quickShortcutDragState.height / 2;

  const items = [...listEl.querySelectorAll('[data-shortcut-id]:not(.is-drag-slot)')];
  if (!items.length) return;

  const targetIndex = findQuickShortcutSlotIndex(
    quickShortcutDragState.slotTargets,
    draggedCenterX,
    draggedCenterY
  );
  if (targetIndex === -1) return;

  const insertBeforeItem = items[targetIndex] || null;
  const addCard = listEl.querySelector('.quick-shortcut-card.is-add');
  const targetBeforeNode = insertBeforeItem || addCard || null;
  const currentBeforeNode = quickShortcutSlotEl.nextElementSibling || null;
  if (targetBeforeNode === currentBeforeNode) return;

  const previousOrderIds = [...listEl.querySelectorAll('[data-shortcut-id]')]
    .map(item => item.dataset.shortcutId || '')
    .filter(Boolean);
  const previousSlotIndex = previousOrderIds.indexOf(quickShortcutDraggedId);
  const previousRects = new Map();
  listEl.querySelectorAll('[data-shortcut-id]:not(.is-drag-slot)').forEach(item => {
    previousRects.set(item.dataset.shortcutId || '', item.getBoundingClientRect());
  });
  const previousSlotRect = quickShortcutSlotEl.getBoundingClientRect();

  if (insertBeforeItem) {
    listEl.insertBefore(quickShortcutSlotEl, insertBeforeItem);
  } else {
    if (addCard) {
      listEl.insertBefore(quickShortcutSlotEl, addCard);
    } else {
      listEl.appendChild(quickShortcutSlotEl);
    }
  }

  const nextOrderIds = [...listEl.querySelectorAll('[data-shortcut-id]')]
    .map(item => item.dataset.shortcutId || '')
    .filter(Boolean);
  const nextSlotIndex = nextOrderIds.indexOf(quickShortcutDraggedId);
  const affectedIds = new Set(
    nextOrderIds.filter(id => previousOrderIds.indexOf(id) !== nextOrderIds.indexOf(id))
  );

  const rangeStart = Math.min(previousSlotIndex, nextSlotIndex);
  const rangeEnd = Math.max(previousSlotIndex, nextSlotIndex);
  nextOrderIds.forEach((id, index) => {
    if (index >= rangeStart && index <= rangeEnd) {
      affectedIds.add(id);
    }
  });

  settleQuickShortcutItems(listEl, affectedIds);
  animateQuickShortcutItems(listEl, previousRects, affectedIds);
  animateQuickShortcutNode(quickShortcutSlotEl, previousSlotRect);
}

function renderQuickShortcutCard(shortcut) {
  const label = getShortcutLabel(shortcut);
  const iconData = themeGetIconSources({ url: shortcut.url, title: label }, 32);
  const faviconUrl = iconData.sources[0] || '';
  const fallbackUrl = iconData.sources[1] || '';
  const fallbackLabel = themeGetFallbackLabel(label, iconData.hostname);
  const safeId = themeEscapeHtmlAttribute ? themeEscapeHtmlAttribute(shortcut.id) : shortcut.id.replace(/"/g, '&quot;');
  const safeUrl = themeEscapeHtmlAttribute ? themeEscapeHtmlAttribute(shortcut.url) : shortcut.url.replace(/"/g, '&quot;');
  const customIcon = normalizeShortcutIcon(shortcut.icon);
  const primaryIconUrl = customIcon.kind === 'image'
    ? customIcon.value
    : customIcon.kind === 'svg'
      ? svgToDataUrl(customIcon.value)
      : customIcon.kind === 'glyph'
        ? ''
        : faviconUrl;
  const iconErrorFallback = (customIcon.kind === 'image' || customIcon.kind === 'svg') ? (faviconUrl || fallbackUrl) : fallbackUrl;
  const glyphIcon = customIcon.kind === 'glyph' ? customIcon.value : '';

  return `
    <div class="quick-shortcut-card" data-shortcut-id="${safeId}">
      <button class="quick-shortcut-open" type="button" data-action="open-quick-shortcut" data-shortcut-url="${safeUrl}" aria-label="${label}" draggable="false">
        <span class="quick-shortcut-icon-wrap">
          ${primaryIconUrl ? `<img class="quick-shortcut-icon${customIcon.kind === 'image' ? ' quick-shortcut-icon-custom' : ''}" src="${primaryIconUrl}" alt="" draggable="false" onerror="handleIconError(this, '${iconErrorFallback}')">` : ''}
          ${glyphIcon ? `<span class="quick-shortcut-custom-glyph" aria-hidden="true">${glyphIcon}</span>` : ''}
          <span class="quick-shortcut-fallback"${primaryIconUrl || glyphIcon ? ' style="display:none"' : ''}>${fallbackLabel}</span>
        </span>
        <span class="quick-shortcut-label">${label}</span>
      </button>
      <button class="quick-shortcut-edit" type="button" data-action="edit-quick-shortcut" data-shortcut-id="${safeId}" aria-label="${themeT ? themeT('editQuickTab') : 'Edit quick tab'}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a2.25 2.25 0 1 1 3.182 3.182L10.582 17.13a4.5 4.5 0 0 1-1.897 1.13L6 19l.74-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487ZM19.5 7.125 16.875 4.5" /></svg>
      </button>
      <button class="quick-shortcut-remove" type="button" data-action="remove-quick-shortcut" data-shortcut-id="${safeId}" aria-label="${themeT ? themeT('removeQuickTab') : 'Remove quick tab'}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function renderQuickShortcutAddCard() {
  return `
    <div class="quick-shortcut-card is-add">
      <button class="quick-shortcut-open" type="button" data-action="add-quick-shortcut" aria-label="${themeT ? themeT('addQuickTab') : 'Add quick tab'}">
        <span class="quick-shortcut-icon-wrap">
          <svg class="quick-shortcut-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 5.25v13.5m6.75-6.75H5.25" />
          </svg>
        </span>
        <span class="quick-shortcut-label">${themeT ? themeT('addLink') : 'Add link'}</span>
      </button>
    </div>
  `;
}

async function renderQuickShortcuts() {
  const list = document.getElementById('quickTabsList');
  if (!list) return;

  const shortcuts = await getQuickShortcuts();
  list.innerHTML = `${shortcuts.map(renderQuickShortcutCard).join('')}${renderQuickShortcutAddCard()}`;
}

async function openShortcutEditorById(shortcutId, triggerEl = null) {
  const shortcuts = await getQuickShortcuts();
  const shortcut = shortcuts.find(item => item.id === shortcutId);
  if (!shortcut) return;
  openShortcutEditor(shortcut, triggerEl);
}

async function handleShortcutEditorPaste() {
  if (!shortcutEditorState.open) {
    return;
  }

  if (!navigator.clipboard?.read) {
    showToast(themeT ? themeT('toastClipboardUsePasteShortcut') : 'Press Cmd/Ctrl+V inside the editor to paste an image or SVG');
    return;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(type => type.startsWith('image/'));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const file = new File([blob], 'shortcut-icon.png', { type: imageType });
      await applyShortcutEditorImageFile(file);
      showToast(themeT ? themeT('toastShortcutIconPasted') : 'Shortcut icon pasted');
      return;
    }

    const textItem = items.find(item => item.types.includes('text/plain'));
    const htmlItem = items.find(item => item.types.includes('text/html'));
    if (htmlItem) {
      const htmlBlob = await htmlItem.getType('text/html');
      const html = await htmlBlob.text();
      const normalized = extractIconFromClipboardHtml(html);
      if (normalized.kind) {
        setShortcutEditorIcon(normalized.value);
        showToast(normalized.kind === 'svg'
          ? (themeT ? themeT('toastSvgIconPasted') : 'SVG icon pasted')
          : (themeT ? themeT('toastShortcutIconPasted') : 'Shortcut icon pasted'));
        return;
      }
      const htmlImageMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (htmlImageMatch?.[1] && isTransientClipboardReference(htmlImageMatch[1])) {
        showToast(themeT ? themeT('toastClipboardTemporaryRef') : 'This clipboard image is a temporary file reference. Use Cmd/Ctrl+V instead.');
        return;
      }
    }

    if (textItem) {
      const textBlob = await textItem.getType('text/plain');
      const text = await textBlob.text();
      const normalized = normalizeShortcutIcon(text);
      if (normalized.kind === 'svg' || /^data:image\//i.test(String(normalized.value || ''))) {
        setShortcutEditorIcon(normalized.value);
        showToast(normalized.kind === 'svg'
          ? (themeT ? themeT('toastSvgIconPasted') : 'SVG icon pasted')
          : (themeT ? themeT('toastShortcutIconPasted') : 'Shortcut icon pasted'));
        return;
      }
      if (isTransientClipboardReference(text)) {
        showToast(themeT ? themeT('toastClipboardTemporaryRef') : 'This clipboard image is a temporary file reference. Use Cmd/Ctrl+V instead.');
        return;
      }
    }

    showToast(themeT ? themeT('toastClipboardNoImage') : 'Clipboard does not contain an image or SVG');
  } catch (err) {
    showToast(themeT ? themeT('toastClipboardUsePasteShortcut') : 'Use Cmd/Ctrl+V inside the editor if direct clipboard access is unavailable');
  }
}

async function tryShortcutEditorPasteViaExecCommand() {
  return new Promise(resolve => {
    const target = document.createElement('textarea');
    target.setAttribute('aria-hidden', 'true');
    target.style.position = 'fixed';
    target.style.opacity = '0';
    target.style.pointerEvents = 'none';
    target.style.inset = '0 auto auto -9999px';
    document.body.appendChild(target);

    let finished = false;
    const cleanup = (result) => {
      if (finished) return;
      finished = true;
      target.removeEventListener('paste', onPaste);
      target.remove();
      resolve(result);
    };

    const onPaste = async (e) => {
      const imageItem = [...(e.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          e.preventDefault();
          try {
            await applyShortcutEditorImageFile(file);
            showToast(themeT ? themeT('toastShortcutIconPasted') : 'Shortcut icon pasted');
            cleanup(true);
            return;
          } catch {
            cleanup(false);
            return;
          }
        }
      }

      const pastedHtml = e.clipboardData?.getData('text/html') || '';
      const normalizedFromHtml = extractIconFromClipboardHtml(pastedHtml);
      if (normalizedFromHtml.kind) {
        e.preventDefault();
        setShortcutEditorIcon(normalizedFromHtml.value);
        showToast(normalizedFromHtml.kind === 'svg'
          ? (themeT ? themeT('toastSvgIconPasted') : 'SVG icon pasted')
          : (themeT ? themeT('toastShortcutIconPasted') : 'Shortcut icon pasted'));
        cleanup(true);
        return;
      }

      cleanup(false);
    };

    target.addEventListener('paste', onPaste, { once: true });
    target.focus({ preventScroll: true });

    let commandWorked = false;
    try {
      commandWorked = document.execCommand('paste');
    } catch { }

    setTimeout(() => cleanup(commandWorked), 120);
  });
}

// ---- Tab Picker ----

function filterRealTabs(tabs) {
  return tabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

function openTabPicker(triggerEl = null) {
  if (tabPickerOpen) return;
  tabPickerOpen = true;
  tabPickerMode = 'tabs';
  tabPickerSearchQuery = '';
  tabPickerSelectedIds = new Set();
  tabPickerFocusReturnEl = document.activeElement;
  tabPickerManualDraft = createTabPickerManualDraft();

  const backdrop = document.getElementById('tabPickerBackdrop');
  const panel = document.getElementById('tabPicker');
  if (backdrop) backdrop.removeAttribute('hidden');
  if (panel) panel.removeAttribute('hidden');

  shortcutEditorState = createShortcutEditorState();
  syncShortcutEditor();
  restoreShortcutEditorHome();
  syncTabPickerLayout();
  renderTabPickerPanel();
  getTabPickerElements().search?.focus?.({ preventScroll: true });
}

function closeTabPicker({ restoreFocus = true } = {}) {
  if (!tabPickerOpen) return;
  if (shortcutEditorState.presentation === 'tab-picker') {
    shortcutEditorState = createShortcutEditorState();
    syncShortcutEditor();
    restoreShortcutEditorHome();
  }
  tabPickerOpen = false;
  tabPickerMode = 'tabs';
  tabPickerSearchQuery = '';
  tabPickerSelectedIds = new Set();
  tabPickerManualDraft = createTabPickerManualDraft();

  const backdrop = document.getElementById('tabPickerBackdrop');
  const panel = document.getElementById('tabPicker');
  if (backdrop) backdrop.setAttribute('hidden', '');
  if (panel) panel.setAttribute('hidden', '');

  if (restoreFocus && tabPickerFocusReturnEl) {
    tabPickerFocusReturnEl.focus();
    tabPickerFocusReturnEl = null;
  }
}

async function renderTabPickerPanel() {
  if (!tabPickerOpen) return;
  if (tabPickerMode !== 'tabs') {
    syncTabPickerLayout();
    return;
  }

  const runtime = globalThis.TabHarborDashboardRuntime;
  if (!runtime) return;

  await runtime.fetchOpenTabs();
  const allTabs = runtime.getOpenTabs();
  const realTabs = filterRealTabs(allTabs);

  const shortcuts = await getQuickShortcuts();
  const existingUrls = new Set(shortcuts.map(s => s.url));

  const query = tabPickerSearchQuery.trim().toLowerCase();
  const filtered = query
    ? realTabs.filter(t => {
      const title = (t.title || '').toLowerCase();
      const url = (t.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    })
    : realTabs;

  const byDomain = new Map();
  for (const tab of filtered) {
    let hostname = '';
    try { hostname = new URL(tab.url).hostname; } catch { }
    const group = hostname.replace(/^www\./, '') || 'other';
    if (!byDomain.has(group)) byDomain.set(group, []);
    byDomain.get(group).push(tab);
  }

  const listEl = document.getElementById('tabPickerList');
  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="tab-picker-empty">${query ? 'No tabs match your search.' : 'No open tabs found.'}</div>`;
    syncTabPickerFooter();
    return;
  }

  let html = '';
  for (const [domain, tabs] of byDomain) {
    html += `<div class="tab-picker-group-label">${friendlyDomain(domain) || domain}</div>`;
    for (const tab of tabs) {
      const tabId = String(tab.id);
      const isSelected = tabPickerSelectedIds.has(tabId);
      const isAdded = existingUrls.has(tab.url);
      const title = stripTitleNoise(tab.title) || tab.url;
      const safeTitle = themeEscapeHtmlAttribute(title);
      let faviconHtml;
      if (tab.favIconUrl) {
        faviconHtml = `<img class="tab-picker-favicon" src="${themeEscapeHtmlAttribute(tab.favIconUrl)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className:'tab-picker-favicon-fallback', textContent:((${JSON.stringify(friendlyDomain(tab.url ? new URL(tab.url).hostname : '') || '?')})[0]||'?').toUpperCase()}))">`;
      } else {
        const initial = (friendlyDomain(tab.url ? new URL(tab.url).hostname : '') || '?')[0] || '?';
        faviconHtml = `<span class="tab-picker-favicon-fallback">${initial.toUpperCase()}</span>`;
      }

      const checkbox = `<input class="tab-picker-checkbox" type="checkbox" ${isSelected ? 'checked' : ''} data-action="toggle-tab-picker-selection" data-tab-id="${tabId}" aria-label="Select ${safeTitle}">`;

      let actionIcon;
      if (isAdded) {
        actionIcon = `<svg class="tab-picker-added-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`;
      } else {
        actionIcon = `<button class="tab-picker-add-btn" type="button" data-action="add-tab-to-shortcuts" data-tab-id="${tabId}" aria-label="Add ${safeTitle} to shortcuts">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>`;
      }

      html += `<div class="tab-picker-row ${isSelected ? 'is-selected' : ''}" role="option" aria-selected="${isSelected}">
        ${checkbox}
        ${faviconHtml}
        <span class="tab-picker-tab-title" title="${safeTitle}">${safeTitle}</span>
        ${actionIcon}
      </div>`;
    }
  }

  listEl.innerHTML = html;
  syncTabPickerFooter();
}

function syncTabPickerFooter() {
  const footer = document.getElementById('tabPickerFooter');
  const count = document.getElementById('tabPickerFooterCount');
  if (!footer || !count) return;

  const count_val = tabPickerSelectedIds.size;
  if (count_val === 0) {
    footer.setAttribute('hidden', '');
  } else {
    footer.removeAttribute('hidden');
    count.textContent = `${count_val} selected`;
  }
}

async function addSingleTabToQuickShortcuts(tab) {
  const shortcuts = await getQuickShortcuts();

  if (shortcuts.some(s => s.url === tab.url)) {
    showToast('Already in shortcuts');
    return;
  }

  const hostname = tab.url ? (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })() : '';
  const label = stripTitleNoise(tab.title) || friendlyDomain(hostname) || hostname || tab.url;

  const nextShortcut = {
    id: `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: tab.url,
    label,
    icon: tab.favIconUrl || '',
    iconKind: tab.favIconUrl ? 'image' : 'site',
  };

  const updated = [...shortcuts, nextShortcut];
  await saveQuickShortcuts(updated);
  await renderQuickShortcuts();
  showToast('Tab added — undo?', {
    action: {
      label: 'Undo',
      fn: async () => {
        await removeQuickShortcutById(nextShortcut.id);
        await renderQuickShortcuts();
      },
    },
  });
}

async function addSelectedTabsToQuickShortcuts() {
  const runtime = globalThis.TabHarborDashboardRuntime;
  if (!runtime) return;

  const allTabs = runtime.getOpenTabs();
  const selectedTabs = allTabs.filter(t => tabPickerSelectedIds.has(String(t.id)));
  if (selectedTabs.length === 0) return;

  const shortcuts = await getQuickShortcuts();
  const existingUrls = new Set(shortcuts.map(s => s.url));

  const newShortcuts = [];
  for (const tab of selectedTabs) {
    const shortcutUrl = tab.url || '';
    if (existingUrls.has(shortcutUrl)) continue;
    const hostname = shortcutUrl ? (() => { try { return new URL(shortcutUrl).hostname; } catch { return ''; } })() : '';
    const label = stripTitleNoise(tab.title) || friendlyDomain(hostname) || hostname || shortcutUrl;
    newShortcuts.push({
      id: `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: shortcutUrl,
      label,
      icon: tab.favIconUrl || '',
      iconKind: tab.favIconUrl ? 'image' : 'site',
    });
    existingUrls.add(shortcutUrl);
  }

  await saveQuickShortcuts([...shortcuts, ...newShortcuts]);
  await renderQuickShortcuts();
  closeTabPicker();
  showToast(`${newShortcuts.length} tab${newShortcuts.length !== 1 ? 's' : ''} added`);
}

// ---- Escape / backdrop click handlers for picker ----
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tabPickerOpen) {
    closeTabPicker();
  }
});

document.addEventListener('click', (e) => {
  if (!tabPickerOpen) return;
  if (e.target.id === 'tabPickerBackdrop') {
    closeTabPicker();
  }
});

// ---- Tab picker search ----
document.addEventListener('input', (e) => {
  if (e.target.id !== 'tabPickerSearch') return;
  tabPickerSearchQuery = e.target.value || '';
  renderTabPickerPanel();
});

// ---- Main action click handler ----
document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'add-quick-shortcut') {
    e.preventDefault();
    e.stopImmediatePropagation();
    openTabPicker(actionEl);
    return;
  }

  if (action === 'switch-tab-picker-view') {
    e.preventDefault();
    setTabPickerMode(actionEl.dataset.view || 'tabs');
    return;
  }

  if (action === 'show-tab-picker-tabs') {
    e.preventDefault();
    setTabPickerMode('tabs');
    return;
  }

  if (action === 'open-tab-picker') {
    e.preventDefault();
    e.stopImmediatePropagation();
    openTabPicker(actionEl);
    return;
  }

  if (action === 'close-tab-picker') {
    closeTabPicker();
    return;
  }

  if (action === 'add-tab-to-shortcuts') {
    const tabId = actionEl.dataset.tabId;
    if (!tabId) return;
    const runtime = globalThis.TabHarborDashboardRuntime;
    if (!runtime) return;
    const tab = runtime.getOpenTabs().find(t => String(t.id) === tabId);
    if (!tab) return;
    await addSingleTabToQuickShortcuts(tab);
    await renderTabPickerPanel();
    return;
  }

  if (action === 'toggle-tab-picker-selection') {
    const row = actionEl.closest('.tab-picker-row');
    const tabId = actionEl.dataset.tabId || '';
    if (tabPickerSelectedIds.has(tabId)) {
      tabPickerSelectedIds.delete(tabId);
      if (row) row.classList.remove('is-selected');
    } else {
      tabPickerSelectedIds.add(tabId);
      if (row) row.classList.add('is-selected');
    }
    syncTabPickerFooter();
    return;
  }

  if (action === 'add-selected-tabs') {
    e.preventDefault();
    await addSelectedTabsToQuickShortcuts();
    return;
  }

  if (action === 'clear-tab-picker-selection') {
    tabPickerSelectedIds = new Set();
    renderTabPickerPanel();
    return;
  }

  if (action === 'edit-quick-shortcut') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const shortcutId = actionEl.dataset.shortcutId || '';
    await openShortcutEditorById(shortcutId, actionEl);
    return;
  }

  if (action === 'remove-quick-shortcut') {
    e.stopImmediatePropagation();
    const shortcutId = actionEl.dataset.shortcutId;
    if (!shortcutId) return;
    await removeQuickShortcutById(shortcutId);
    await renderQuickShortcuts();
    showToast(themeT ? themeT('toastQuickTabRemoved') : 'Quick tab removed');
    return;
  }

  if (action === 'open-quick-shortcut') {
    e.stopImmediatePropagation();
    if (Date.now() < quickShortcutSuppressClickUntil) return;
    const url = actionEl.dataset.shortcutUrl;
    if (!url) return;
    await openOrFocusUrl(url);
    return;
  }

  if (action === 'close-shortcut-editor') {
    e.preventDefault();
    closeShortcutEditor({ restoreFocus: true });
    return;
  }

  if (action === 'select-shortcut-source') {
    e.preventDefault();
    setShortcutEditorSource(actionEl.dataset.source || 'site');
    if (actionEl.dataset.source === 'glyph') {
      getShortcutEditorElements().emoji?.focus?.({ preventScroll: true });
    }
    return;
  }

  if (action === 'upload-shortcut-icon') {
    e.preventDefault();
    getShortcutEditorElements().fileInput?.click();
    return;
  }

  if (action === 'paste-shortcut-icon') {
    e.preventDefault();
    const pasted = await tryShortcutEditorPasteViaExecCommand();
    if (!pasted) {
      await handleShortcutEditorPaste();
    }
    return;
  }

  if (action === 'clear-shortcut-icon') {
    e.preventDefault();
    setShortcutEditorIcon('');
    return;
  }
});

document.addEventListener('pointerdown', (e) => {
  const shortcutButton = e.target.closest('.quick-shortcut-open');
  if (!shortcutButton || e.button !== 0) return;
  if (shortcutButton.dataset.action !== 'open-quick-shortcut') return;

  const item = shortcutButton.closest('[data-shortcut-id]');
  const listEl = item?.parentElement;
  if (!item || !listEl) return;

  quickShortcutDraggedId = item.dataset.shortcutId || '';
  quickShortcutDraggedEl = item;

  const rect = item.getBoundingClientRect();
  quickShortcutDragState = {
    listEl,
    x: e.clientX,
    y: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    slotTargets: buildQuickShortcutSlotTargets(listEl),
    width: rect.width,
    height: rect.height,
    moved: false,
  };
});

document.addEventListener('pointermove', (e) => {
  if (!quickShortcutDraggedId || !quickShortcutDragState) return;

  const distance = Math.hypot(e.clientX - quickShortcutDragState.x, e.clientY - quickShortcutDragState.y);
  if (!quickShortcutDragState.moved && distance < 4) return;

  if (!quickShortcutDragState.moved) {
    quickShortcutDragState.moved = true;
    document.body.classList.add('quick-shortcut-list-dragging');
    ensureQuickShortcutSlot();
    ensureQuickShortcutGhost();
  }

  updateDraggedQuickShortcutPosition(e.clientX, e.clientY);
  previewQuickShortcutOrder(e.clientX, e.clientY);
});

document.addEventListener('pointerup', async () => {
  if (!quickShortcutDraggedId || !quickShortcutDragState) return;

  const moved = quickShortcutDragState.moved;
  const nextOrderIds = moved
    ? [...quickShortcutDragState.listEl.children]
      .map(node => {
        if (node === quickShortcutSlotEl) return quickShortcutDraggedId;
        return node.dataset?.shortcutId || '';
      })
      .filter(Boolean)
    : [];
  clearQuickShortcutDragState();

  if (!moved) return;

  quickShortcutSuppressClickUntil = Date.now() + 250;
  await saveQuickShortcutOrder(nextOrderIds);
  await renderQuickShortcuts();
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'shortcutEditorUrl') {
    setShortcutEditorField('url', e.target.value);
    return;
  }

  if (e.target.id === 'shortcutEditorLabel') {
    setShortcutEditorField('label', e.target.value);
    return;
  }

  if (e.target.id === 'shortcutEditorEmoji') {
    const normalized = normalizeShortcutIcon(e.target.value);
    shortcutEditorState = createShortcutEditorState({
      ...shortcutEditorState,
      icon: normalized.value,
      iconKind: normalized.kind || 'glyph',
    });
    syncShortcutEditor();
    return;
  }

  if (e.target.id === 'shortcutEditorSvgCode') {
    const normalized = normalizeShortcutIcon(e.target.value);
    shortcutEditorState = createShortcutEditorState({
      ...shortcutEditorState,
      icon: normalized.value,
      iconKind: normalized.kind || 'svg',
    });
    syncShortcutEditor();
  }
});

document.addEventListener('compositionstart', (e) => {
  if (!(e.target instanceof HTMLElement)) return;
  if (!['shortcutEditorUrl', 'shortcutEditorLabel', 'shortcutEditorEmoji', 'shortcutEditorSvgCode'].includes(e.target.id)) {
    return;
  }
  e.target.dataset.composing = 'true';
});

document.addEventListener('compositionend', (e) => {
  if (!(e.target instanceof HTMLElement)) return;
  if (e.target.dataset.composing !== 'true') return;
  delete e.target.dataset.composing;

  if (e.target.id === 'shortcutEditorUrl') {
    setShortcutEditorField('url', e.target.value);
    return;
  }

  if (e.target.id === 'shortcutEditorLabel') {
    setShortcutEditorField('label', e.target.value);
    return;
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'shortcutIconFileInput') return;

  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  try {
    await applyShortcutEditorImageFile(file);
    showToast(themeT ? themeT('toastShortcutIconUpdated') : 'Shortcut icon updated');
  } catch (err) {
    showToast(err?.message || (themeT ? themeT('toastCouldNotUseShortcutImage') : 'Could not use shortcut image'));
  }
});

document.addEventListener('paste', async (e) => {
  if (!shortcutEditorState.open) return;
  const imageItem = [...(e.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
  if (imageItem) {
    const file = imageItem.getAsFile();
    if (!file) return;

    e.preventDefault();
    try {
      await applyShortcutEditorImageFile(file);
      showToast(themeT ? themeT('toastShortcutIconPasted') : 'Shortcut icon pasted');
    } catch (err) {
      showToast(err?.message || (themeT ? themeT('toastCouldNotPasteShortcutImage') : 'Could not paste shortcut image'));
    }
    return;
  }

  const pastedHtml = e.clipboardData?.getData('text/html') || '';
  const normalizedFromHtml = extractIconFromClipboardHtml(pastedHtml);
  if (normalizedFromHtml.kind) {
    e.preventDefault();
    setShortcutEditorIcon(normalizedFromHtml.value);
    showToast(normalizedFromHtml.kind === 'svg'
      ? (themeT ? themeT('toastSvgIconPasted') : 'SVG icon pasted')
      : (themeT ? themeT('toastShortcutIconPasted') : 'Shortcut icon pasted'));
    return;
  }

  const pastedText = e.clipboardData?.getData('text/plain') || '';
  const normalized = normalizeShortcutIcon(pastedText);
  if (normalized.kind === 'svg') {
    e.preventDefault();
    setShortcutEditorIcon(normalized.value);
    showToast(themeT ? themeT('toastSvgIconPasted') : 'SVG icon pasted');
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'shortcutEditorForm') return;

  e.preventDefault();
  try {
    const mode = shortcutEditorState.mode;
    await saveShortcutEditorShortcut();
    showToast(mode === 'edit'
      ? (themeT ? themeT('toastQuickTabUpdated') : 'Quick tab updated')
      : (themeT ? themeT('toastQuickTabAdded') : 'Quick tab added'));
  } catch (err) {
    showToast(err?.message || (themeT ? themeT('toastCouldNotSaveShortcut') : 'Could not save shortcut'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && shortcutEditorState.open) {
    closeShortcutEditor({ restoreFocus: true });
  }
});

document.addEventListener('click', (e) => {
  if (!shortcutEditorState.open) return;
  if (e.target.id === 'shortcutEditorBackdrop') {
    closeShortcutEditor({ restoreFocus: true });
  }
});

async function loadThemePreferences() {
  const stored = await chrome.storage.local.get(THEME_PREFERENCES_KEY);
  themePreferences = normalizeThemePreferences(stored[THEME_PREFERENCES_KEY]);
  applyThemePreferences();
  renderThemeMenu();
  return themePreferences;
}

async function saveThemePreferences(nextPreferences) {
  themePreferences = normalizeThemePreferences({
    ...themePreferences,
    ...nextPreferences,
  });
  await chrome.storage.local.set({ [THEME_PREFERENCES_KEY]: themePreferences });
  applyThemePreferences();
  renderThemeMenu();
  return themePreferences;
}

globalThis.TabOutThemeControls = {
  filterRealTabs,
  normalizeShortcutUrl,
  normalizeQuickShortcuts,
};
