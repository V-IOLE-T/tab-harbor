#!/usr/bin/env node
// Real Chrome extension smoke gate. Uses an isolated profile; no dependencies.
// Requires Chrome with Extensions.loadUnpacked support and ffmpeg on PATH.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(path.join(tmpdir(), 'tab-harbor-browser-'));
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
  `--user-data-dir=${temp}/profile`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome debugging endpoint timed out')), 15000);
    chrome.once('error', reject);
    chrome.stderr.on('data', chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const pending = new Map(); const exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (!message.id) return;
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  };
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const { id: extensionId } = await send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
  async function page(file) {
    const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extensionId}/${file}` });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    const evaluate = async expression => {
      const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error(`Timed out: ${expression}`);
    };
    await wait('!!globalThis.TabOutThemeControls');
    return { targetId, sessionId, evaluate, wait };
  }
  const dashboard = await page('index.html');
  await dashboard.wait('!!document.getElementById("themeVideoInput")');
  assert.equal(await dashboard.evaluate('!!chrome.storage.local'), true);
  assert.equal(await dashboard.evaluate('document.querySelector(\'[data-action="clear-custom-background"]\').disabled'), true);
  assert.equal(await dashboard.evaluate('document.querySelector(\'[data-action="clear-video-wallpaper"]\').disabled'), true);
  // Start without any wallpaper and exercise the real image upload handler.
  await dashboard.evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width=8; canvas.height=8;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#aa5533'; ctx.fillRect(0,0,8,8);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    const transfer=new DataTransfer(); transfer.items.add(new File([blob],'image.png',{type:'image/png'}));
    const input=document.getElementById('themeBackgroundInput');
    input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await dashboard.wait('TabOutThemeControls.getThemePreferences().backgroundType === "image"');
  assert.equal(await dashboard.evaluate('document.querySelector(\'[data-action="clear-custom-background"]\').disabled'), false);
  const imageHue = await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperSeedHue');
  const fixture = path.join(temp, 'wallpaper.webm');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=0x2288cc:s=320x180:d=1', '-c:v', 'libvpx', '-y', fixture]);
  await send('DOM.enable', {}, dashboard.sessionId);
  const { root: dom } = await send('DOM.getDocument', {}, dashboard.sessionId);
  const { nodeId } = await send('DOM.querySelector', { nodeId: dom.nodeId, selector: '#themeVideoInput' }, dashboard.sessionId);
  await send('DOM.setFileInputFiles', { nodeId, files: [fixture] }, dashboard.sessionId);
  await dashboard.wait('TabOutThemeControls.getThemePreferences().backgroundType === "video"');
  const originalId = await dashboard.evaluate('TabOutThemeControls.getThemePreferences().videoMeta.resourceId');
  assert.ok(originalId);
  assert.equal(await dashboard.evaluate('document.querySelector(\'[data-action="clear-video-wallpaper"]\').disabled'), false);
  const videoHue = await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperSeedHue');
  assert.notEqual(imageHue, videoHue);
  await dashboard.evaluate(`(async () => {
    await saveThemePreferences({colorSource:'wallpaper'});
    setThemeMenuOpen(true);
    document.querySelector('[data-action="select-background-type"][data-background-type="image"]').click();
  })()`);
  await dashboard.wait('TabOutThemeControls.getThemePreferences().backgroundType === "image"');
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperSeedHue'), imageHue);
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperTheme.source'), 'image');
  await dashboard.evaluate('document.querySelector(\'[data-action="select-background-type"][data-background-type="video"]\').click()');
  await dashboard.wait('TabOutThemeControls.getThemePreferences().backgroundType === "video"');
  const switchedVideo = await dashboard.evaluate('TabOutThemeControls.getThemePreferences()');
  assert.ok(Math.abs(switchedVideo.wallpaperSeedHue - videoHue) <= 2, 're-sampling the same poster preserves its hue');
  assert.equal(Math.round(switchedVideo.wallpaperTheme.seedHue), switchedVideo.wallpaperSeedHue);
  assert.equal(switchedVideo.wallpaperTheme.sourceHash, await dashboard.evaluate('TabHarborMonetTheme.hashSourceId(TabOutThemeControls.getThemePreferences().videoPoster)'));
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperTheme.source'), 'video');
  // Delay the real decoder and drag hue while the background save is pending.
  await dashboard.evaluate(`(async () => {
    const runtime = TabHarborWallpaperRuntime;
    const original = runtime.extractThemeFromImageDataUrl;
    let release, started;
    const decoding = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    runtime.extractThemeFromImageDataUrl = async (...args) => {
      started(); await gate; return original(...args);
    };
    try {
      document.querySelector('[data-action="select-background-type"][data-background-type="image"]').click();
      await decoding;
      const seed = document.getElementById('themeWallpaperSeedRange');
      seed.value = '180'; seed.dispatchEvent(new Event('input', {bubbles:true}));
      release();
      await saveThemePreferences({});
    } finally { release(); runtime.extractThemeFromImageDataUrl = original; }
  })()`);
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperTheme.source'), 'image');
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperTheme.seedHue'), 180);
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperSeedHue'), 180);
  await dashboard.evaluate('saveThemePreferences({backgroundType:"video"})');
  await dashboard.wait('!document.getElementById("themeVideoInput").disabled');
  // Exercise the actual change handler with a rejected preference write:
  // the staged blob must be removed while the old media stays playable.
  await dashboard.evaluate(`globalThis.originalStorageSet = chrome.storage.local.set;
    globalThis.failedSaveAttempts = 0;
    chrome.storage.local.set = () => { globalThis.failedSaveAttempts++; return Promise.reject(new Error('injected quota failure')); };`);
  await send('DOM.setFileInputFiles', { nodeId, files: [fixture] }, dashboard.sessionId);
  await dashboard.wait('globalThis.failedSaveAttempts === 1 && !document.getElementById("themeVideoInput").disabled');
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().videoMeta.resourceId'), originalId);
  assert.equal(await dashboard.evaluate(`TabHarborVideoWallpaperStore.hasVideoBlob(${JSON.stringify(originalId)})`), true);
  await dashboard.evaluate('chrome.storage.local.set = globalThis.originalStorageSet; delete globalThis.originalStorageSet');
  await dashboard.wait('!!document.querySelector(".wallpaper-video-element")?.src');
  assert.deepEqual(await dashboard.evaluate(`(() => { const v = document.querySelector('.wallpaper-video-element'); return [v.muted, v.loop, v.playsInline, v.poster.startsWith('data:image/')]; })()`), [true, true, true, true]);
  assert.equal(await dashboard.evaluate(`(async () => {
    const p = TabOutThemeControls.getThemePreferences();
    return (await TabHarborVideoWallpaperStore.getVideoRecord(p.videoMeta.resourceId)).blob.size === p.videoMeta.size;
  })()`), true);
  await dashboard.evaluate(`(async () => {
    const seed = document.getElementById('themeWallpaperSeedRange');
    seed.value = '180'; seed.dispatchEvent(new Event('input', {bubbles:true}));
    const intensity = document.getElementById('themeMaterialIntensityRange');
    intensity.value = '85'; intensity.dispatchEvent(new Event('input', {bubbles:true}));
    await saveThemePreferences({colorSource:'wallpaper', material:'frosted', mode:'dark'});
  })()`);
  const saved = await dashboard.evaluate('TabOutThemeControls.getThemePreferences()');
  assert.equal(saved.wallpaperSeedHue, 180); assert.equal(saved.materialIntensity, 85);
  assert.ok(saved.wallpaperTheme?.dark['--paper']);
  const actionContrast = await dashboard.evaluate(`(() => {
    const button = document.createElement('button');
    button.className = 'tab-cleanup-btn';
    button.textContent = 'Clean up';
    document.body.append(button);
    const style = getComputedStyle(button);
    const luminance = color => {
      const rgb = color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v => {
        v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const a = luminance(style.color), b = luminance(style.backgroundColor);
    button.remove();
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  })()`);
  assert.ok(actionContrast >= 4.5, 'computed dark Monet action contrast: ' + actionContrast);
  console.log('Dark Monet action contrast: ' + actionContrast.toFixed(2) + ':1');
  // Existing installations may still have the original low-contrast token.
  // Load new pages from that raw persisted cache, without regenerating it.
  await dashboard.evaluate(`(async () => {
    const prefs = TabOutThemeControls.getThemePreferences();
    prefs.wallpaperTheme.dark['--workspace-accent-contrast'] = '#f0f0f0';
    await chrome.storage.local.set({themePreferences:prefs});
  })()`);
  const second = await page('index.html');
  const popup = await page('popup/popup.html');
  await second.wait('!!document.querySelector(".wallpaper-video-element")?.src');
  assert.equal(await second.evaluate('TabOutThemeControls.getThemePreferences().videoMeta.resourceId'), originalId);
  await second.wait('document.documentElement.style.getPropertyValue("--glass-blur") === "29px"');
  await popup.wait('document.documentElement.style.getPropertyValue("--paper") === ' + JSON.stringify(saved.wallpaperTheme.dark['--paper']));
  for (const target of [dashboard, second, popup]) {
    await target.wait('document.documentElement.style.getPropertyValue("--workspace-accent-contrast") === ' + JSON.stringify(saved.wallpaperTheme.dark['--paper']));
  }
  await dashboard.evaluate('saveThemePreferences({materialIntensity: 20, mode:"light"})');
  await second.wait('document.documentElement.style.getPropertyValue("--glass-blur") === "14px"');
  await popup.wait('document.documentElement.style.getPropertyValue("--paper") === ' + JSON.stringify(saved.wallpaperTheme.light['--paper']));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, dashboard.sessionId);
  await dashboard.wait('document.querySelector(".wallpaper-video-element").paused && getComputedStyle(document.querySelector(".wallpaper-video-element")).display === "none"');
  const backup = await dashboard.evaluate('TabHarborConfigSync.exportConfig()');
  assert.equal(JSON.parse(backup).themePreferences.videoMeta.resourceId, undefined);
  await dashboard.evaluate(`TabHarborConfigSync.importConfig(${JSON.stringify(backup)})`);
  await dashboard.wait('!document.querySelector(".wallpaper-video-element")?.getAttribute("src")');
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().videoMeta.resourceId'), '');
  assert.match(await dashboard.evaluate('document.getElementById("wallpaperLayer").style.backgroundImage'), /data:image/);
  assert.equal(await dashboard.evaluate(`TabHarborVideoWallpaperStore.hasVideoBlob(${JSON.stringify(originalId)})`), true);
  await dashboard.evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width=8; canvas.height=8;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#aa5533'; ctx.fillRect(0,0,8,8);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    const input=document.getElementById('themeBackgroundInput');
    const transfer=new DataTransfer(); transfer.items.add(new File([blob],'image.png',{type:'image/png'}));
    input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await dashboard.wait('TabOutThemeControls.getThemePreferences().backgroundType === "image"');
  assert.equal(await dashboard.evaluate('document.body.classList.contains("has-custom-background")'), true);
  await dashboard.evaluate(`setThemeMenuOpen(true); document.querySelector('[data-action="clear-custom-background"]').click()`);
  await dashboard.wait('!TabOutThemeControls.getThemePreferences().customBackground');
  assert.equal(await dashboard.evaluate('document.querySelector(\'[data-action="clear-custom-background"]\').disabled'), true);
  await dashboard.evaluate(`setThemeMenuOpen(true); document.querySelector('[data-action="select-background-type"][data-background-type="video"]').click()`);
  await dashboard.wait('TabOutThemeControls.getThemePreferences().backgroundType === "video"');
  await dashboard.evaluate(`document.querySelector('[data-action="clear-video-wallpaper"]').click()`);
  await dashboard.wait('!TabOutThemeControls.getThemePreferences().videoMeta');
  assert.equal(await dashboard.evaluate('document.querySelector(\'[data-action="clear-video-wallpaper"]\').disabled'), true);
  assert.deepEqual(exceptions, [], 'extension pages must initialize and operate without runtime exceptions');
  console.log('PASS: real extension upload and Clear controls, image/video palette switching, poster, IDB, sliders, MCU, light/dark, popup, multi-page sync, reduced-motion, backup isolation; zero runtime exceptions');
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
  rmSync(temp, { recursive: true, force: true });
}
