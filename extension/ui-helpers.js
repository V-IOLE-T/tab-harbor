'use strict';

const {
  locale: uiLocale = 'en',
  t: uiT,
} = globalThis.TabHarborI18n || {};

/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

function shootConfetti(x, y) {
  const colors = [
    '#c8713a',
    '#e8a070',
    '#5a7a62',
    '#8aaa92',
    '#5a6b7a',
    '#8a9baa',
    '#d4b896',
    '#b35a5a',
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6;
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 80;
    const gravity = 200;

    const startTime = performance.now();
    const duration = 700 + Math.random() * 200;

    function frame(now) {
      const elapsed = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) {
        el.remove();
        return;
      }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

function showToast(message, { action } = {}) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  if (!toast || !toastText) return;
  const toastAction = document.getElementById('toastAction');
  if (!toast || !toastText) return;

  toastText.textContent = message;

  if (action && toastAction) {
    toastAction.textContent = action.label;
    toastAction.hidden = false;
    toastAction.onclick = async () => {
      try {
        await Promise.resolve(action.fn());
      } catch (error) {
        console.error('Toast action failed:', error);
      } finally {
        toast.classList.remove('visible');
      }
    };
  } else if (toastAction) {
    toastAction.hidden = true;
    toastAction.onclick = null;
  }

  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function setImageFallbackAttributes(imgEl, fallbackUrl = '') {
  if (!imgEl) return;
  const fallbackSources = Array.isArray(fallbackUrl)
    ? fallbackUrl.map(url => String(url || '').trim()).filter(Boolean)
    : String(fallbackUrl || '').trim()
      ? [String(fallbackUrl || '').trim()]
      : [];

  if (fallbackSources.length) {
    imgEl.dataset.fallbackSrc = fallbackSources[0];
    if (fallbackSources.length > 1) {
      imgEl.dataset.fallbackSrcset = JSON.stringify(fallbackSources.slice(1));
    } else {
      delete imgEl.dataset.fallbackSrcset;
    }
  } else {
    delete imgEl.dataset.fallbackSrc;
    delete imgEl.dataset.fallbackSrcset;
  }
  delete imgEl.dataset.fallbackApplied;
}

function revealImageFallback(imgEl) {
  if (!imgEl) return;
  imgEl.style.display = 'none';
  const sibling = imgEl.nextElementSibling;
  if (!sibling) return;
  if (
    sibling.classList.contains('group-nav-fallback') ||
    sibling.classList.contains('chip-favicon-fallback') ||
    sibling.classList.contains('inline-favicon-fallback') ||
    sibling.classList.contains('popup-tab-favicon-fallback') ||
    sibling.classList.contains('quick-shortcut-fallback') ||
    sibling.classList.contains('tab-picker-favicon-fallback')
  ) {
    sibling.style.display = (
      sibling.classList.contains('inline-favicon-fallback') ||
      sibling.classList.contains('tab-picker-favicon-fallback')
    ) ? 'inline-flex' : 'flex';
  }
}

function handleImageFallbackError(imgEl) {
  if (!imgEl) return;

  const fallbackQueue = [];
  const primaryFallback = String(imgEl.dataset.fallbackSrc || '').trim();
  if (primaryFallback) fallbackQueue.push(primaryFallback);

  const serializedQueue = String(imgEl.dataset.fallbackSrcset || '').trim();
  if (serializedQueue) {
    try {
      const parsed = JSON.parse(serializedQueue);
      if (Array.isArray(parsed)) {
        fallbackQueue.push(...parsed.map(url => String(url || '').trim()).filter(Boolean));
      }
    } catch {
      // Ignore malformed fallback queues and continue to inline fallback.
    }
  }

  const currentSrc = String(imgEl.currentSrc || imgEl.src || '').trim();
  const nextFallback = fallbackQueue.find(url => url && url !== currentSrc && url !== String(imgEl.dataset.fallbackApplied || '').trim());
  if (nextFallback) {
    const remaining = fallbackQueue.filter(url => url && url !== nextFallback);
    imgEl.dataset.fallbackApplied = nextFallback;
    imgEl.dataset.fallbackSrc = nextFallback;
    if (remaining.length) {
      imgEl.dataset.fallbackSrcset = JSON.stringify(remaining);
    } else {
      delete imgEl.dataset.fallbackSrcset;
    }
    imgEl.src = nextFallback;
    return;
  }

  revealImageFallback(imgEl);
}

if (!globalThis.__tabHarborImageFallbackBound) {
  document.addEventListener('error', event => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!('fallbackSrc' in target.dataset) && !('fallbackSrcset' in target.dataset)) return;
    handleImageFallbackError(target);
  }, true);
  globalThis.__tabHarborImageFallbackBound = true;
}

function renderMissionsEmptyState() {
  return `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${uiT ? uiT('emptyTitle') : 'Inbox zero, but for tabs.'}</div>
      <div class="empty-subtitle">${uiT ? uiT('emptySubtitle') : "You're free."}</div>
    </div>
  `;
}

function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = renderMissionsEmptyState();

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = uiT ? uiT('emptyTabsCount') : '0 domains';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays = Math.floor((now - then) / 86400000);

  if (diffMins < 1) return uiT ? uiT('timeJustNow') : 'just now';
  if (diffMins < 60) return uiT ? uiT('timeMinAgo', { count: diffMins }) : `${diffMins} min ago`;
  if (diffHours < 24) {
    if (!uiT) return `${diffHours} hr${diffHours !== 1 ? 's' : ''} ago`;
    return diffHours === 1
      ? uiT('timeHourAgo')
      : uiT('timeHoursAgo', { count: diffHours });
  }
  if (diffDays === 1) return uiT ? uiT('timeYesterday') : 'yesterday';
  return uiT ? uiT('timeDaysAgo', { count: diffDays }) : `${diffDays} days ago`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return uiT ? uiT('greetingMorning') : 'Good morning';
  if (hour < 17) return uiT ? uiT('greetingAfternoon') : 'Good afternoon';
  return uiT ? uiT('greetingEvening') : 'Good evening';
}

function getDateDisplay() {
  const locale = uiLocale === 'zh-CN' ? 'zh-CN' : 'en-US';
  return new Date().toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const FRIENDLY_DOMAINS = {
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
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  const clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(co\.uk|co\.jp|com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain = hostname.replace(/^www\./, '');
  const seps = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix = title.slice(idx + sep.length).trim();
    const suffixLow = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '';
  let hostname = '';
  try {
    const u = new URL(url);
    pathname = u.pathname;
    hostname = u.hostname;
  } catch {
    return title || '';
  }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull' && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1] && titleIsUrl) {
      return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}

// Test exposure
globalThis.friendlyDomain = friendlyDomain;
globalThis.stripTitleNoise = stripTitleNoise;
globalThis.cleanTitle = cleanTitle;
globalThis.smartTitle = smartTitle;
globalThis.capitalize = capitalize;

const ICONS = {
  tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true"><path d="M845.312 0.512H32.512v1022.976h958.976v-876.8L845.312 0.512z m-172.864 62.976v256H351.488v-256h320.96zM287.488 960.512V605.76l29.184-29.248h390.656l29.184 29.248v354.752H287.488z m640 0h-126.976V585.152L727.424 512H296.576L223.488 585.152v375.36H96.512V63.488h190.976v320.448h449.024V63.488h79.68l111.296 112.32v784.704z m-384-832h65.984v128H543.488v-128z" /></svg>`,
  focus: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
  move: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 6.75h12m-12 5.25h12m-12 5.25h12M4.5 6.75h.008v.008H4.5V6.75Zm0 5.25h.008v.008H4.5V12Zm0 5.25h.008v.008H4.5v-.008Z" /></svg>`,
  pin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none" aria-hidden="true"><path d="M648.728381 130.779429a73.142857 73.142857 0 0 1 22.674286 15.433142l191.561143 191.756191a73.142857 73.142857 0 0 1-22.137905 118.564571l-67.876572 30.061715-127.341714 127.488-10.093714 140.239238a73.142857 73.142857 0 0 1-124.684191 46.445714l-123.66019-123.782095-210.724572 211.699809-51.833904-51.614476 210.846476-211.821714-127.926857-128.024381a73.142857 73.142857 0 0 1 46.299428-124.635429l144.237715-10.776381 125.074285-125.220571 29.379048-67.779048a73.142857 73.142857 0 0 1 96.207238-38.034285z m-29.086476 67.120761l-34.913524 80.530286-154.087619 154.331429-171.398095 12.751238 303.323428 303.542857 12.044191-167.399619 156.233143-156.428191 80.384-35.59619-191.585524-191.73181z" fill="currentColor" /></svg>`,
  moon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646z" /></svg>`,
};
