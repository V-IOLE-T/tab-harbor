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

    let protocol, hostname, pageUrl;
    try {
      const parsed = new URL(rawUrl);
      protocol = parsed.protocol;
      hostname = parsed.hostname;
      pageUrl = rawUrl;
    } catch {
      if (/^[a-zA-Z0-9.-]+$/.test(rawUrl) && rawUrl.includes('.')) {
        protocol = 'https:';
        hostname = rawUrl;
        pageUrl = `https://${rawUrl}`;
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

    const fallbackUrl = `https://${hostname}/favicon.ico`;

    return {
      url: chromeUrl,
      source: chromeUrl ? 'chrome' : '',
      fallback: fallbackUrl,
    };
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
    const originFaviconUrl = getPageOriginFaviconUrl(url);
    const sources = [
      isStableIconUrl(favIconUrl) ? favIconUrl : '',
      originFaviconUrl,
      primaryDomain ? getGoogleFaviconUrl(primaryDomain, size) : '',
      hostname && hostname !== primaryDomain ? getGoogleFaviconUrl(hostname, size) : '',
    ].filter(Boolean);

    return {
      hostname,
      primaryDomain,
      originFaviconUrl,
      sources,
    };
  }

  function getGroupIcon(group, label, size = 32) {
    const tabs = group?.tabs || [];
    const preferredTab = tabs.find(tab => tab?.favIconUrl) || tabs[0] || {};
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
