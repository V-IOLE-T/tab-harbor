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
  const second = await page('index.html');
  const popup = await page('popup/popup.html');
  await second.wait('!!document.querySelector(".wallpaper-video-element")?.src');
  assert.equal(await second.evaluate('TabOutThemeControls.getThemePreferences().videoMeta.resourceId'), originalId);
  await second.wait('document.documentElement.style.getPropertyValue("--glass-blur") === "29px"');
  await popup.wait('document.documentElement.style.getPropertyValue("--paper") === ' + JSON.stringify(saved.wallpaperTheme.dark['--paper']));
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
  assert.deepEqual(exceptions, [], 'extension pages must initialize and operate without runtime exceptions');
  console.log('PASS: real extension upload, poster, IDB, sliders, MCU, light/dark, popup, multi-page sync, reduced-motion, backup isolation, image upload; zero runtime exceptions');
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
  rmSync(temp, { recursive: true, force: true });
}
