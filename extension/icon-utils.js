'use strict';

(function attachIconUtils(globalScope) {
  const MULTI_PART_SUFFIXES = new Set([
    'ac.cn',
    'ac.jp',
    'ac.uk',
    'co.jp',
    'co.nz',
    'co.uk',
    'com.au',
    'com.br',
    'com.cn',
    'com.hk',
    'com.sg',
    'edu.cn',
    'gov.cn',
    'gov.uk',
    'net.au',
    'net.cn',
    'org.au',
    'org.cn',
    'org.uk',
  ]);
  const MULTI_TENANT_HOST_SUFFIXES = [
    'blogspot.com',
    'github.io',
    'notion.site',
    'substack.com',
    'vercel.app',
    'wordpress.com',
  ];
  const FRIENDLY_DOMAINS = Object.freeze({
    'github.com': 'GitHub',
    'www.github.com': 'GitHub',
    'gist.github.com': 'GitHub Gist',
    'youtube.com': 'YouTube',
    'www.youtube.com': 'YouTube',
    'music.youtube.com': 'YouTube Music',
    'x.com': 'X',
    'www.x.com': 'X',
    'twitter.com': 'X',
    'www.twitter.com': 'X',
    'reddit.com': 'Reddit',
    'www.reddit.com': 'Reddit',
    'old.reddit.com': 'Reddit',
    'substack.com': 'Substack',
    'www.substack.com': 'Substack',
    'medium.com': 'Medium',
    'www.medium.com': 'Medium',
    'linkedin.com': 'LinkedIn',
    'www.linkedin.com': 'LinkedIn',
    'stackoverflow.com': 'Stack Overflow',
    'www.stackoverflow.com': 'Stack Overflow',
    'news.ycombinator.com': 'Hacker News',
    'google.com': 'Google',
    'www.google.com': 'Google',
    'mail.google.com': 'Gmail',
    'docs.google.com': 'Google Docs',
    'drive.google.com': 'Google Drive',
    'calendar.google.com': 'Google Calendar',
    'meet.google.com': 'Google Meet',
    'gemini.google.com': 'Gemini',
    'chatgpt.com': 'ChatGPT',
    'www.chatgpt.com': 'ChatGPT',
    'chat.openai.com': 'ChatGPT',
    'claude.ai': 'Claude',
    'www.claude.ai': 'Claude',
    'code.claude.com': 'Claude Code',
    'notion.so': 'Notion',
    'www.notion.so': 'Notion',
    'figma.com': 'Figma',
    'www.figma.com': 'Figma',
    'slack.com': 'Slack',
    'app.slack.com': 'Slack',
    'discord.com': 'Discord',
    'www.discord.com': 'Discord',
    'wikipedia.org': 'Wikipedia',
    'en.wikipedia.org': 'Wikipedia',
    'amazon.com': 'Amazon',
    'www.amazon.com': 'Amazon',
    'netflix.com': 'Netflix',
    'www.netflix.com': 'Netflix',
    'spotify.com': 'Spotify',
    'open.spotify.com': 'Spotify',
    'vercel.com': 'Vercel',
    'www.vercel.com': 'Vercel',
    'npmjs.com': 'npm',
    'www.npmjs.com': 'npm',
    'developer.mozilla.org': 'MDN',
    'arxiv.org': 'arXiv',
    'www.arxiv.org': 'arXiv',
    'huggingface.co': 'Hugging Face',
    'www.huggingface.co': 'Hugging Face',
    'producthunt.com': 'Product Hunt',
    'www.producthunt.com': 'Product Hunt',
    'xiaohongshu.com': 'RedNote',
    'www.xiaohongshu.com': 'RedNote',
    'local-files': 'Local Files',
  });

  function capitalizeFriendlyPart(value = '') {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function friendlyDomain(hostname = '') {
    const value = String(hostname || '');
    if (!value) return '';
    if (FRIENDLY_DOMAINS[value]) return FRIENDLY_DOMAINS[value];

    if (value.endsWith('.substack.com') && value !== 'substack.com') {
      return `${capitalizeFriendlyPart(value.replace('.substack.com', ''))}'s Substack`;
    }
    if (value.endsWith('.github.io')) {
      return `${capitalizeFriendlyPart(value.replace('.github.io', ''))} (GitHub Pages)`;
    }

    const clean = value
      .replace(/^www\./, '')
      .replace(/\.(co\.uk|co\.jp|com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk)$/, '');
    return clean.split('.').map(capitalizeFriendlyPart).join(' ');
  }

  function getHostname(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function getPageOriginFaviconUrl(url = '') {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return `${parsed.origin}/favicon.ico`;
    } catch {
      return '';
    }
  }

  function isIpAddress(hostname = '') {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(hostname || ''));
  }

  function getPrimaryDomain(hostname = '') {
    const cleanHostname = String(hostname || '').trim().replace(/^www\./, '').toLowerCase();
    if (!cleanHostname || cleanHostname === 'localhost' || isIpAddress(cleanHostname)) return cleanHostname;

    if (MULTI_TENANT_HOST_SUFFIXES.some(suffix => cleanHostname.endsWith(`.${suffix}`))) {
      return cleanHostname;
    }

    const parts = cleanHostname.split('.').filter(Boolean);
    if (parts.length <= 2) return cleanHostname;

    const trailingPair = parts.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(trailingPair) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }

    return parts.slice(-2).join('.');
  }

  function getGoogleFaviconUrl(hostname, size = 16) {
    if (!hostname) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
  }

  function getFaviconUrl(input) {
    const rawUrl = typeof input === 'string' ? input : (input?.domain ?? '');
    if (!rawUrl) return { url: '', source: '', fallback: '' };

    const size = typeof input === 'string' ? 128 : (input?.size ?? 128);

    let protocol, hostname, pageUrl, fallbackOrigin;
    try {
      const parsed = new URL(rawUrl);
      protocol = parsed.protocol;
      hostname = parsed.hostname;
      pageUrl = rawUrl;
      fallbackOrigin = parsed.origin;
    } catch {
      if (/^[a-zA-Z0-9.-]+$/.test(rawUrl) && rawUrl.includes('.')) {
        protocol = 'https:';
        hostname = rawUrl;
        pageUrl = `https://${rawUrl}`;
        fallbackOrigin = pageUrl;
      } else {
        return { url: '', source: '', fallback: '' };
      }
    }

    if (protocol !== 'http:' && protocol !== 'https:') {
      return { url: '', source: '', fallback: '' };
    }

    const faviconBase = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL('_favicon/')
      : '';
    const chromeUrl = faviconBase
      ? `${faviconBase}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`
      : '';

    const fallbackUrl = fallbackOrigin ? `${fallbackOrigin}/favicon.ico` : '';

    return {
      url: chromeUrl,
      source: chromeUrl ? 'chrome' : '',
      fallback: fallbackUrl,
    };
  }

  function dedupeIconSources(sources = []) {
    const seen = new Set();
    return sources.filter(source => {
      const normalized = String(source || '').trim();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  function isStableIconUrl(url = '') {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:';
    } catch {
      return false;
    }
  }

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlAttribute(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getFallbackLabel(label, hostname = '') {
    const cleanLabel = (label || '').trim();
    if (cleanLabel) {
      const tokens = cleanLabel
        .split(/[\s./:_-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(token => token[0]?.toUpperCase() || '');
      const joined = tokens.join('');
      if (joined) return joined;
    }

    const cleanHost = hostname.replace(/^www\./, '');
    return (cleanHost.slice(0, 2) || '?').toUpperCase();
  }

  function getIconSources({ favIconUrl = '', url = '' } = {}, size = 16) {
    const hostname = getHostname(url);
    const primaryDomain = getPrimaryDomain(hostname);
    const faviconData = getFaviconUrl({ domain: url, size });
    const originFaviconUrl = faviconData.fallback || getPageOriginFaviconUrl(url);
    const sources = dedupeIconSources([
      isStableIconUrl(favIconUrl) ? favIconUrl : '',
      faviconData.url,
      originFaviconUrl,
      primaryDomain ? getGoogleFaviconUrl(primaryDomain, size) : '',
      hostname && hostname !== primaryDomain ? getGoogleFaviconUrl(hostname, size) : '',
    ]);

    return {
      hostname,
      primaryDomain,
      originFaviconUrl,
      sources,
    };
  }

  function getGroupIcon(group, label, size = 32) {
    const tabs = group?.tabs || [];
    const preferredTab = tabs.find(tab => isStableIconUrl(tab?.favIconUrl)) || tabs.find(tab => tab?.url) || tabs[0] || {};
    const { hostname, sources } = getIconSources(preferredTab, size);

    return {
      hostname,
      src: sources[0] || '',
      fallbackSrc: sources[1] || '',
      fallbackSources: sources.slice(1),
      fallbackLabel: getFallbackLabel(label, hostname),
    };
  }

  const api = {
    escapeHtml,
    escapeHtmlAttribute,
    friendlyDomain,
    getFallbackLabel,
    getPageOriginFaviconUrl,
    getGoogleFaviconUrl,
    getGroupIcon,
    getHostname,
    getPrimaryDomain,
    getFaviconUrl,
    getIconSources,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutIconUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
