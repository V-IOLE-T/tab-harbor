'use strict';

(function attachTabHarborI18n(globalScope) {
  const LANGUAGE_PREFERENCE_KEY = 'languagePreference';
  const LANGUAGE_OPTIONS = new Set(['auto', 'en', 'zh-CN']);
  const i18nNavigator = globalScope.navigator || {};
  const i18nLanguage = String(i18nNavigator.language || i18nNavigator.userLanguage || 'en').toLowerCase();

  function resolveAutoLocale() {
    return i18nLanguage.startsWith('zh') ? 'zh-CN' : 'en';
  }

  function normalizeLanguagePreference(input) {
    const value = String(input || 'auto');
    return LANGUAGE_OPTIONS.has(value) ? value : 'auto';
  }

  function resolveLocaleByPreference(preference) {
    const normalizedPreference = normalizeLanguagePreference(preference);
    if (normalizedPreference === 'en') return 'en';
    if (normalizedPreference === 'zh-CN') return 'zh-CN';
    return resolveAutoLocale();
  }

  let i18nLanguagePreference = 'auto';
  let i18nLocale = resolveLocaleByPreference(i18nLanguagePreference);

  const i18nMessages = {
    en: {
      emptyTitle: 'Inbox zero, but for tabs.',
      emptySubtitle: "You're free.",
      greetingMorning: 'Good morning',
      greetingAfternoon: 'Good afternoon',
      greetingEvening: 'Good evening',
      timeJustNow: 'just now',
      timeMinAgo: '{count} min ago',
      timeHourAgo: '1 hr ago',
      timeHoursAgo: '{count} hrs ago',
      timeYesterday: 'yesterday',
      timeDaysAgo: '{count} days ago',
      tabsWordSingular: 'tab',
      tabsWordPlural: 'tabs',
      groupsWordSingular: 'group',
      groupsWordPlural: 'groups',
      openTabsSectionTitle: 'Open tabs',
      sectionSummary: '{tabs} {tabsWord} across {groups} {groupsWord}',
      closeAllTabsButton: 'Close all tabs',
      emptyTabsCount: '0 domains',
      promptNewGroupName: 'New group name',
      promptTodoTitle: 'Todo title',
      promptTodoDetails: 'Todo details (optional)',
      toastThemeUpdated: 'Theme updated',
      toastBackgroundCleared: 'Background cleared',
      toastClosedExtraTabHarborTabs: 'Closed extra Tab Harbor tabs',
      toastMovedTo: 'Moved to {name}',
      toastCreatedGroup: 'Created {name}',
      toastCouldNotCreateGroup: 'Could not create group',
      toastMovedBackToOriginalGroup: 'Moved back to original group',
      toastPinnedOrder: 'Pinned current order',
      toastPinOrderOff: 'Pin order turned off',
      toastTabClosed: 'Tab closed',
      toastFailedToSaveTab: 'Failed to save tab',
      toastSavedForLater: 'Saved for later',
      toastRestoredToOpenTabs: 'Restored to open tabs',
      toastRemovedFromArchive: 'Removed from archive',
      toastArchiveCleared: 'Archive cleared',
      toastClosedDuplicatesKeptOne: 'Closed duplicates, kept one copy each',
      toastAllTabsClosed: 'All tabs closed. Fresh start.',
      toastQuickTabRemoved: 'Quick tab removed',
      toastShortcutIconPasted: 'Shortcut icon pasted',
      toastSvgIconPasted: 'SVG icon pasted',
      toastClipboardNoImage: 'Clipboard does not contain an image or SVG',
      toastClipboardUsePasteShortcut: 'Use Cmd/Ctrl+V inside the editor if direct clipboard access is unavailable',
      toastClipboardTemporaryRef: 'This clipboard image is a temporary file reference. Use Cmd/Ctrl+V instead.',
      toastShortcutIconUpdated: 'Shortcut icon updated',
      toastCouldNotUseShortcutImage: 'Could not use shortcut image',
      toastCouldNotPasteShortcutImage: 'Could not paste shortcut image',
      toastQuickTabUpdated: 'Quick tab updated',
      toastQuickTabAdded: 'Quick tab added',
      toastCouldNotSaveShortcut: 'Could not save shortcut',
      errorImageCompressionUnavailable: 'Image compression is unavailable',
      errorPleaseEnterValidUrl: 'Please enter a valid URL',
      shortcutEditTitle: 'Edit shortcut',
      shortcutAddTitle: 'Add shortcut',
      shortcutPreviewFallbackLabel: 'Shortcut',
      shortcutPreviewCustomImageIcon: 'Custom image icon',
      shortcutPreviewSvgIcon: 'SVG icon',
      shortcutPreviewEmojiIcon: 'Emoji icon',
      shortcutPreviewWebsiteIcon: 'Website icon',
      shortcutPreviewHasCustomIcon: 'Custom icon will replace the site favicon.',
      shortcutPreviewNoCustomIcon: 'Upload or paste an image, or type an emoji.',
      closedTabsFromGroup: 'Closed {count} {tabsWord} from {groupLabel}',
      closedDuplicatesCount: 'Close {count} duplicate{suffix}',
      duplicatesCount: '{count} duplicate{suffix}',
      tabsOpenBadge: '{count} {tabsWord} open',
      tabsLabel: 'tabs',
      moreCount: '+{count} more',
      jumpToLabel: 'Jump to {label}',
      homepagesLabel: 'Homepages',
      moveToGroup: 'Move to group',
      noGroupsYet: 'No groups yet',
      newGroupButton: '+ New group',
      backToOriginalGroup: 'Back to original group',
      saveForLater: 'Save for later',
      closeThisTab: 'Close this tab',
      dragReorderTab: 'Drag to reorder tab',
      closeGroup: 'Close group',
      pinnedOrder: 'Pinned order',
      pinOrder: 'Pin order',
      deskSettings: 'Desk settings',
      deskSettingsPanel: 'Desk settings panel',
      deskPalette: 'Desk palette',
      deskBackdrop: 'Desk backdrop',
      uploadImage: 'Upload image',
      clearText: 'Clear',
      surfaceDepth: 'Surface depth',
      editQuickTab: 'Edit quick tab',
      removeQuickTab: 'Remove quick tab',
      addQuickTab: 'Add quick tab',
      addLink: 'Add link',
      languageLabel: 'Language',
      languageAuto: 'Auto',
      languageEnglish: 'English',
      languageChinese: '中文',
      chromeTabGroupsLabel: 'Chrome tab groups',
      toastChromeTabGroupsOn: 'Chrome tab groups on',
      toastChromeTabGroupsOff: 'Chrome tab groups off',
    },
    'zh-CN': {
      emptyTitle: '标签页清零了。',
      emptySubtitle: '你现在很轻松。',
      greetingMorning: '早上好',
      greetingAfternoon: '下午好',
      greetingEvening: '晚上好',
      timeJustNow: '刚刚',
      timeMinAgo: '{count} 分钟前',
      timeHourAgo: '1 小时前',
      timeHoursAgo: '{count} 小时前',
      timeYesterday: '昨天',
      timeDaysAgo: '{count} 天前',
      tabsWordSingular: '个标签页',
      tabsWordPlural: '个标签页',
      groupsWordSingular: '组',
      groupsWordPlural: '组',
      openTabsSectionTitle: '打开的标签页',
      sectionSummary: '{tabs} 个标签页，分布在 {groups} 个分组中',
      closeAllTabsButton: '关闭全部标签页',
      emptyTabsCount: '0 个域名分组',
      promptNewGroupName: '新分组名称',
      promptTodoTitle: '待办标题',
      promptTodoDetails: '待办详情（可选）',
      toastThemeUpdated: '主题已更新',
      toastBackgroundCleared: '背景已清除',
      toastClosedExtraTabHarborTabs: '已关闭多余的 Tab Harbor 标签页',
      toastMovedTo: '已移动到 {name}',
      toastCreatedGroup: '已创建 {name}',
      toastCouldNotCreateGroup: '无法创建分组',
      toastMovedBackToOriginalGroup: '已移回原始分组',
      toastPinnedOrder: '已固定当前顺序',
      toastPinOrderOff: '已取消固定顺序',
      toastTabClosed: '标签页已关闭',
      toastFailedToSaveTab: '保存失败',
      toastSavedForLater: '已保存到稍后阅读',
      toastRestoredToOpenTabs: '已恢复到打开标签页',
      toastRemovedFromArchive: '已从归档移除',
      toastArchiveCleared: '归档已清空',
      toastClosedDuplicatesKeptOne: '已关闭重复标签页，并为每个链接保留一个',
      toastAllTabsClosed: '已关闭全部标签页，重新开始吧。',
      toastQuickTabRemoved: '快捷链接已移除',
      toastShortcutIconPasted: '已粘贴快捷图标',
      toastSvgIconPasted: '已粘贴 SVG 图标',
      toastClipboardNoImage: '剪贴板中没有图片或 SVG',
      toastClipboardUsePasteShortcut: '若无法直接读取剪贴板，请在编辑器中使用 Cmd/Ctrl+V',
      toastClipboardTemporaryRef: '当前剪贴板图片是临时文件引用，请改用 Cmd/Ctrl+V。',
      toastShortcutIconUpdated: '快捷图标已更新',
      toastCouldNotUseShortcutImage: '无法使用该快捷图片',
      toastCouldNotPasteShortcutImage: '无法粘贴快捷图片',
      toastQuickTabUpdated: '快捷链接已更新',
      toastQuickTabAdded: '快捷链接已添加',
      toastCouldNotSaveShortcut: '无法保存快捷链接',
      errorImageCompressionUnavailable: '图片压缩不可用',
      errorPleaseEnterValidUrl: '请输入有效 URL',
      shortcutEditTitle: '编辑快捷链接',
      shortcutAddTitle: '添加快捷链接',
      shortcutPreviewFallbackLabel: '快捷链接',
      shortcutPreviewCustomImageIcon: '自定义图片图标',
      shortcutPreviewSvgIcon: 'SVG 图标',
      shortcutPreviewEmojiIcon: 'Emoji 图标',
      shortcutPreviewWebsiteIcon: '网站图标',
      shortcutPreviewHasCustomIcon: '自定义图标会替换站点 favicon。',
      shortcutPreviewNoCustomIcon: '上传或粘贴图片，或输入一个 emoji。',
      closedTabsFromGroup: '已关闭来自 {groupLabel} 的 {count} 个标签页',
      closedDuplicatesCount: '关闭 {count} 个重复标签页',
      duplicatesCount: '{count} 个重复标签页',
      tabsOpenBadge: '已打开 {count} 个标签页',
      tabsLabel: '标签页',
      moreCount: '+ 另外 {count} 个',
      jumpToLabel: '跳转到 {label}',
      homepagesLabel: '主页',
      moveToGroup: '移动到分组',
      noGroupsYet: '还没有分组',
      newGroupButton: '+ 新建分组',
      backToOriginalGroup: '移回原始分组',
      saveForLater: '保存到稍后阅读',
      closeThisTab: '关闭此标签页',
      dragReorderTab: '拖拽重排标签页',
      closeGroup: '关闭分组',
      pinnedOrder: '已固定顺序',
      pinOrder: '固定顺序',
      deskSettings: '桌面设置',
      deskSettingsPanel: '桌面设置面板',
      deskPalette: '桌面配色',
      deskBackdrop: '桌面背景',
      uploadImage: '上传图片',
      clearText: '清除',
      surfaceDepth: '透明度',
      editQuickTab: '编辑快捷链接',
      removeQuickTab: '删除快捷链接',
      addQuickTab: '添加快捷链接',
      addLink: '添加链接',
      languageLabel: '语言',
      languageAuto: '自动',
      languageEnglish: 'English',
      languageChinese: '中文',
      chromeTabGroupsLabel: 'Chrome 标签组',
      toastChromeTabGroupsOn: '已启用 同步Chrome标签组',
      toastChromeTabGroupsOff: '已禁用 同步Chrome标签组',
    },
  };

  const i18nTextMapZh = {
    'Right now': '此刻',
    'Search the web': '搜索网络',
    'Search with your default engine...': '用默认搜索引擎搜索...',
    'Open saved for later': '打开稍后阅读',
    'Open todos': '打开待办',
    'Saved items and todos': '收藏与待办',
    'Saved for later': '稍后阅读',
    'Todos': '待办',
    'Drawer views': '抽屉视图',
    'Search saved for later': '搜索稍后阅读',
    'Close right drawer': '关闭右侧抽屉',
    'Search saved pages...': '搜索已保存页面...',
    'Search saved pages': '搜索已保存页面',
    'Nothing saved yet. Park articles and tabs here when they matter, just not right now.': '还没有已保存内容。把重要但暂时不看的文章和标签页放在这里。',
    'Archive': '归档',
    'Clear archive': '清空归档',
    'Search todos': '搜索待办',
    'New todo': '新建待办',
    'Search todos...': '搜索待办...',
    'No tasks yet. Capture the next step when something needs a follow-up.': '还没有任务。需要后续跟进时，把下一步记在这里。',
    'Open tabs': '打开的标签页',
    'Edit shortcut': '编辑快捷链接',
    'Close shortcut editor': '关闭快捷链接编辑器',
    'Label': '标签',
    'Optional shortcut label': '可选的快捷链接标签',
    'Shortcut icon preview and paste target': '快捷图标预览与粘贴区域',
    'Shortcut icon source': '快捷图标来源',
    'Website': '网站',
    'Emoji': 'Emoji',
    'Image': '图片',
    'SVG code': 'SVG 代码',
    'Upload image': '上传图片',
    'Paste an image with Cmd/Ctrl+V while the editor is focused.': '编辑器聚焦时可用 Cmd/Ctrl+V 粘贴图片。',
    'Cancel': '取消',
    'Save': '保存',
    'Back to top': '返回顶部',
    'Desk settings': '桌面设置',
    'Desk settings panel': '桌面设置面板',
    'Desk palette': '桌面配色',
    'Desk backdrop': '桌面背景',
    'Clear': '清除',
    'Surface depth': '透明度',
    'Pinned order': '已固定顺序',
    'Pin order': '固定顺序',
    'Move to group': '移动到分组',
    'No groups yet': '还没有分组',
    '+ New group': '+ 新建分组',
    'Back to original group': '移回原始分组',
    'Save for later': '保存到稍后阅读',
    'Close this tab': '关闭此标签页',
    'Close group': '关闭分组',
    'Close extras': '关闭多余标签',
    'You have': '你当前有',
    'Tab Harbor tabs open. Keep just this one?': '个 Tab Harbor 标签页已打开。仅保留当前这个？',
    'Drag to reorder tab': '拖拽重排标签页',
    'Drag to reorder saved page': '拖拽重排已保存页面',
    'Drag to reorder todo': '拖拽重排待办',
    'Open again': '再次打开',
    'Delete archived todo': '删除已归档待办',
    'Archive': '归档',
    'Add link': '添加链接',
    'Add quick tab': '添加快捷链接',
    'Edit quick tab': '编辑快捷链接',
    'Remove quick tab': '删除快捷链接',
    'Sync Chrome tab groups': '同步Chrome标签组',
    'Homepages': '主页',
  };

  function i18nFormat(template, vars = {}) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
      return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`;
    });
  }

  function i18nT(key, vars = {}) {
    const bundle = i18nMessages[i18nLocale] || i18nMessages.en;
    const fallback = i18nMessages.en || {};
    const template = Object.prototype.hasOwnProperty.call(bundle, key)
      ? bundle[key]
      : fallback[key];
    if (template == null) return key;
    return i18nFormat(template, vars);
  }

  function i18nLocalizeText(input) {
    const text = String(input == null ? '' : input);
    if (i18nLocale !== 'zh-CN') return text;

    if (!text.trim()) return text;

    const leading = text.match(/^\s*/)?.[0] || '';
    const trailing = text.match(/\s*$/)?.[0] || '';
    const core = text.trim();

    if (Object.prototype.hasOwnProperty.call(i18nTextMapZh, core)) {
      return `${leading}${i18nTextMapZh[core]}${trailing}`;
    }

    let translated = core;

    translated = translated
      .replace(/^\+(\d+) more$/i, (_, count) => i18nT('moreCount', { count }))
      .replace(/^(\d+) tabs? open$/i, (_, count) => i18nT('tabsOpenBadge', { count }))
      .replace(/^(\d+) duplicate(?:s)?$/i, (_, count) => i18nT('duplicatesCount', { count }))
      .replace(/^Close (\d+) duplicate(?:s)?$/i, (_, count) => i18nT('closedDuplicatesCount', { count }))
      .replace(/^Created (.+)$/i, (_, rest) => `创建于 ${rest}`);

    if (translated !== core) {
      return `${leading}${translated}${trailing}`;
    }

    return text;
  }

  function i18nApplyToElement(el) {
    if (!(el instanceof HTMLElement)) return;

    if (el.dataset.i18n) {
      el.textContent = i18nT(el.dataset.i18n);
    }
    if (el.dataset.i18nPlaceholder) {
      el.setAttribute('placeholder', i18nT(el.dataset.i18nPlaceholder));
    }
    if (el.dataset.i18nAriaLabel) {
      el.setAttribute('aria-label', i18nT(el.dataset.i18nAriaLabel));
    }
    if (el.dataset.i18nTitle) {
      el.setAttribute('title', i18nT(el.dataset.i18nTitle));
    }
    if (el.dataset.i18nTooltip) {
      el.setAttribute('data-tooltip', i18nT(el.dataset.i18nTooltip));
    }

    const attrNames = ['aria-label', 'title', 'placeholder', 'data-tooltip'];
    attrNames.forEach(attr => {
      const current = el.getAttribute(attr);
      if (!current) return;
      const localized = i18nLocalizeText(current);
      if (localized !== current) {
        el.setAttribute(attr, localized);
      }
    });
  }

  function i18nLocalizeTextNodes(rootNode) {
    if (i18nLocale !== 'zh-CN') return;
    const root = rootNode || document.body;
    if (!root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }

    nodes.forEach(textNode => {
      const nextValue = i18nLocalizeText(textNode.nodeValue || '');
      if (nextValue !== textNode.nodeValue) {
        textNode.nodeValue = nextValue;
      }
    });
  }

  function i18nApplyDomTranslations(rootNode = document) {
    const root = rootNode && rootNode.querySelectorAll ? rootNode : document;
    const candidates = root.querySelectorAll
      ? root.querySelectorAll('[data-i18n],[data-i18n-placeholder],[data-i18n-aria-label],[data-i18n-title],[data-i18n-tooltip], [aria-label], [title], [placeholder], [data-tooltip]')
      : [];

    candidates.forEach(i18nApplyToElement);
    if (root instanceof HTMLElement || root === document || root === document.body) {
      i18nLocalizeTextNodes(root === document ? document.body : root);
    }

    if (document?.documentElement) {
      document.documentElement.lang = i18nLocale === 'zh-CN' ? 'zh-CN' : 'en';
    }
  }

  async function loadLanguagePreference() {
    if (!globalScope.chrome?.storage?.local?.get) {
      i18nLanguagePreference = 'auto';
      i18nLocale = resolveLocaleByPreference(i18nLanguagePreference);
      return i18nLanguagePreference;
    }

    try {
      const stored = await globalScope.chrome.storage.local.get(LANGUAGE_PREFERENCE_KEY);
      i18nLanguagePreference = normalizeLanguagePreference(stored[LANGUAGE_PREFERENCE_KEY]);
      i18nLocale = resolveLocaleByPreference(i18nLanguagePreference);
      return i18nLanguagePreference;
    } catch {
      i18nLanguagePreference = 'auto';
      i18nLocale = resolveLocaleByPreference(i18nLanguagePreference);
      return i18nLanguagePreference;
    }
  }

  async function setLanguagePreference(preference, { persist = true, reload = false } = {}) {
    i18nLanguagePreference = normalizeLanguagePreference(preference);
    i18nLocale = resolveLocaleByPreference(i18nLanguagePreference);

    if (persist && globalScope.chrome?.storage?.local?.set) {
      await globalScope.chrome.storage.local.set({
        [LANGUAGE_PREFERENCE_KEY]: i18nLanguagePreference,
      });
    }

    if (reload) {
      globalScope.location?.reload?.();
      return i18nLanguagePreference;
    }

    i18nApplyDomTranslations(document);
    return i18nLanguagePreference;
  }

  function getLanguagePreference() {
    return i18nLanguagePreference;
  }

  function i18nObserve() {
    if (!document?.body || i18nLocale !== 'zh-CN') return;

    let scheduled = false;
    const scheduleApply = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        i18nApplyDomTranslations(document.body);
      });
    };

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title', 'placeholder', 'data-tooltip'],
    });
  }

  const waitForDomReady = () => {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise(resolve => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  };

  const i18nReady = (async () => {
    await loadLanguagePreference();
    await waitForDomReady();
    i18nApplyDomTranslations(document);
    i18nObserve();
  })();

  globalScope.TabHarborI18n = {
    get locale() {
      return i18nLocale;
    },
    get isZh() {
      return i18nLocale === 'zh-CN';
    },
    t: i18nT,
    localizeText: i18nLocalizeText,
    applyDomTranslations: i18nApplyDomTranslations,
    getLanguagePreference,
    setLanguagePreference,
    ready: i18nReady,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
