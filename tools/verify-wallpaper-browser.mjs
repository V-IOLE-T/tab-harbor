#!/usr/bin/env node
// Real Chrome extension smoke gate. Uses an isolated profile; no dependencies.
// Requires Chrome with Extensions.loadUnpacked support and ffmpeg on PATH.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
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
  let sequence = 0; const pending = new Map(); const exceptions = []; const consoleErrors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(a=>a.value ?? a.description).join(' '));
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
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {
      let api;
      Object.defineProperty(globalThis, 'TabHarborThemeStartup', {
        configurable:true, get:()=>api, set(value) {
          api=value;
          globalThis.startupPaint=Object.fromEntries(['--paper','--glass-blur','--glass-content-filter','--glass-frosted-fill','--glass-surface-scale','--glass-control-scale','--glass-panel-min','--custom-surface-opacity','--wallpaper-overlay-opacity','--wallpaper-overlay-paper-share'].map(name=>[name,document.documentElement.style.getPropertyValue(name)]));
        }
      });
    })()`}, sessionId);
    await send('Page.navigate', {url:`chrome-extension://${extensionId}/${file}`}, sessionId);
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
    'testsrc2=s=320x180:d=1', '-c:v', 'libvpx', '-y', fixture]);
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
  // Read final computed alpha on the production CSS, not only theme tokens.
  // Standalone probes avoid a changing tab count and nested surface composites.
  await dashboard.evaluate(`(() => {
    for (const cls of ['mission-card', 'saved-session-card']) {
      const node = document.createElement('div'); node.className = cls;
      node.dataset.opacityProbe = cls; node.textContent = 'Glass opacity probe';
      document.body.append(node);
    }
  })()`);
  const finalOpacity = () => dashboard.evaluate(`(() => {
    const alpha = color => {
      if (color === 'transparent') return 0;
      if (color.includes('/')) return parseFloat(color.split('/')[1]);
      if (color.startsWith('rgba')) return Number(color.match(/[\\d.]+/g)[3]);
      return 1;
    };
    return [...document.querySelectorAll('[data-opacity-probe]')].map(node =>
      alpha(getComputedStyle(node).backgroundColor));
  })()`);
  for (const mode of ['light', 'dark']) {
    const samples = []; const controlSamples = [];
    for (const materialIntensity of [0, 50, 100]) {
      await dashboard.evaluate(`saveThemePreferences({material:'clear',surfaceOpacity:14,materialIntensity:${materialIntensity},mode:'${mode}',wallpaperOverlay:37,wallpaperOverlayTint:0})`);
      await dashboard.evaluate('Promise.all(document.querySelector(".header-search-shell").getAnimations().map(a=>a.finished.catch(()=>{})))');
      const alphas = await finalOpacity(); samples.push(alphas);
      controlSamples.push(await dashboard.evaluate('getComputedStyle(document.querySelector(".header-search-shell")).backgroundColor'));
      assert.equal(await dashboard.evaluate('getComputedStyle(document.body,"::after").opacity'), '0.37');
      assert.equal(await dashboard.evaluate('document.documentElement.style.getPropertyValue("--glass-blur")'), '0px');

    }
    assert.notEqual(controlSamples[0],controlSamples[1], 'search fill follows glass strength');
    assert.notEqual(controlSamples[1],controlSamples[2]);
    for (let card = 0; card < 2; card++) {
      assert.ok(samples[0][card] > samples[1][card] && samples[1][card] > samples[2][card], 'final card opacity strictly decreases');
      assert.ok(samples[0][card] - samples[2][card] > .6, 'strength produces a visible range');
    }
    console.log('Computed clear alpha ' + mode + ' (mission/saved, 0/50/100): ' + JSON.stringify(samples));
  }
  const glassBeforeOverlay = await finalOpacity();
  for (const backgroundType of ['image', 'video']) {
    for (const wallpaperOverlay of [0, 50, 100]) {
      await dashboard.evaluate(`saveThemePreferences({backgroundType:'${backgroundType}',wallpaperOverlay:${wallpaperOverlay}})`);
      assert.equal(await dashboard.evaluate('Number(getComputedStyle(document.body,"::after").opacity)'), wallpaperOverlay / 100);
      assert.deepEqual(await finalOpacity(), glassBeforeOverlay, 'overlay cannot change content opacity');
      assert.equal(await dashboard.evaluate('getComputedStyle(document.body).backgroundImage.includes("linear-gradient")'), false);
      assert.equal(await dashboard.evaluate('getComputedStyle(document.body,"::before").backgroundColor'), 'rgba(0, 0, 0, 0)');
    }
  }
  // Real rapid input events must use the existing serial preference queue.
  await dashboard.evaluate(`(async () => {
    for (const [id, value] of [['themeWallpaperOverlayRange', 23], ['themeMaterialIntensityRange', 80], ['themeWallpaperOverlayRange', 41]]) {
      const input=document.getElementById(id); input.value=String(value);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
    await saveThemePreferences({});
  })()`);
  assert.deepEqual(await dashboard.evaluate('(({wallpaperOverlay,materialIntensity})=>[wallpaperOverlay,materialIntensity])(TabOutThemeControls.getThemePreferences())'), [41,80]);
  for (const mode of ['light','dark']) {
    await dashboard.evaluate(`saveThemePreferences({mode:'${mode}',material:'clear',materialIntensity:80,wallpaperOverlay:41})`);
    const fresh=await page('index.html');
    const paint=await fresh.evaluate('globalThis.startupPaint');
    const runtime=await fresh.evaluate('Object.fromEntries(Object.keys(globalThis.startupPaint).map(name=>[name,document.documentElement.style.getPropertyValue(name)]))');
    assert.deepEqual(paint,runtime,'cached first paint matches authoritative runtime in '+mode);
    await send('Target.closeTarget',{targetId:fresh.targetId});
  }
  await dashboard.evaluate(`document.querySelectorAll('[data-opacity-probe]').forEach(n=>n.remove())`);
  // Always verify the actual empty workspace and its controls at the reported
  // endpoints, with the same generated wallpaper, viewport and zero overlay.
  const visualDir = process.env.WALLPAPER_SCREENSHOT_DIR || path.join(temp, 'captures');
  mkdirSync(visualDir, {recursive:true});
  await send('Emulation.setDeviceMetricsOverride', {width:1280,height:900,deviceScaleFactor:1,mobile:false}, dashboard.sessionId);
  await dashboard.evaluate(`(() => {
    const c=document.createElement('canvas');c.width=1280;c.height=900;
    const x=c.getContext('2d');
    for(let j=0;j<900;j+=24) for(let i=0;i<1280;i+=24){
      x.fillStyle='hsl('+((i*13+j*7)%360)+' 55% '+(20+(i+j)%65)+'%)';x.fillRect(i,j,24,24);
    }
    globalThis.reviewImage=c.toDataURL();
  })()`);
  const visibleSelectors = ['.theme-menu', '.theme-option', '.theme-menu-action:not(.is-secondary)', '.header-search-shell',
    '.header-search-suggestions', '.deferred-shell', '.archive-search',
    '.shortcut-editor-form', '.shortcut-editor-input', '.tab-picker',
    '.todo-editor-form', '.todo-editor-input'];
  const surfacePeers = await Promise.all([page('index.html'),page('popup/popup.html')]);
  await send('Page.bringToFront',{},dashboard.sessionId);
  await dashboard.evaluate('openTodoEditor(); renderTodoPanel()');
  for (const mode of ['light','dark']) {
    const endpoints=[];
    for (const strength of [19,100]) {
      await dashboard.evaluate(`saveThemePreferences({customBackground:globalThis.reviewImage,backgroundType:'image',mode:'${mode}',material:'clear',surfaceOpacity:14,materialIntensity:${strength},wallpaperOverlay:0,wallpaperOverlayTint:0})`);
      await dashboard.evaluate(`setThemeMenuOpen(true)`);
      for (const target of surfacePeers) {
        await target.wait('document.documentElement.style.getPropertyValue("--glass-control-scale") === ' + JSON.stringify((1-strength*.009).toFixed(3)));
        assert.equal(await target.evaluate('document.documentElement.style.getPropertyValue("--glass-panel-min")'),await dashboard.evaluate('document.documentElement.style.getPropertyValue("--glass-panel-min")'));
      }
      await dashboard.evaluate(`Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))`);
      assert.equal(await dashboard.evaluate('document.querySelectorAll(".mission-card,.saved-session-card").length'),0,'visual workspace is empty');
      assert.equal(await dashboard.evaluate('getComputedStyle(document.body,"::after").opacity'),'0');
      const shot=await send('Page.captureScreenshot',{format:'png'},dashboard.sessionId);
      writeFileSync(path.join(visualDir,`clear-${mode}-${strength}.png`),Buffer.from(shot.data,'base64'));
      const metrics=await dashboard.evaluate(`(async () => {
        const alpha=c=>c==='transparent'?0:c.includes('/')?parseFloat(c.split('/')[1]):c.startsWith('rgba')?Number(c.match(/[0-9.]+/g)[3]):1;
        const measure=selector=>{
          const node=document.querySelector(selector); if(!node)return null;
          const style=getComputedStyle(node),r=node.getBoundingClientRect();
          let composite=alpha(style.backgroundColor);
          for(let p=node.parentElement;p&&p!==document.body;p=p.parentElement)composite=1-(1-composite)*(1-alpha(getComputedStyle(p).backgroundColor));
          return {alpha:alpha(style.backgroundColor),composite,visible:node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),opacity:style.opacity,textAlpha:alpha(style.color),blur:style.backdropFilter,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
        };
        const result={};
        const read=selectors=>selectors.forEach(s=>result[s]=measure(s));
        const settle=()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));
        read(['.theme-menu','.theme-menu-action:not(.is-secondary)','.header-search-shell']);
        await saveThemePreferences({colorSource:'preset'});setThemeMenuOpen(true);await settle();
        read(['.theme-option']);
        await saveThemePreferences({colorSource:'wallpaper'});setThemeMenuOpen(true);await settle();
        document.getElementById('headerSearchSuggestions').hidden=false;
        read(['.header-search-suggestions']);
        document.getElementById('headerSearchSuggestions').hidden=true;
        setThemeMenuOpen(false);
        setDeferredPanelOpen(true); await renderDeferredColumn();
        todoSearchOpen=true;await renderTodoPanel();await settle();
        read(['.deferred-shell','.archive-search','.todo-editor-form','.todo-editor-input']);
        setDeferredPanelOpen(false);await renderDeferredColumn();
        openShortcutEditor();await settle();
        read(['.shortcut-editor-form','.shortcut-editor-input']);
        closeShortcutEditor({restoreFocus:false});
        openTabPicker();await renderTabPickerPanel();await settle();
        read(['.tab-picker']);closeTabPicker({restoreFocus:false});
        setThemeMenuOpen(true);
        return result;
      })()`);
      endpoints.push(metrics);
    }
    for(const selector of visibleSelectors){
      const [low,high]=endpoints.map(e=>e[selector]);
      assert.ok(low&&high,'production component exists: '+selector);
      assert.ok(low.visible&&high.visible,'component measured while visible: '+selector);
      assert.ok(low.alpha-high.alpha>(selector.includes('theme-menu-action')?.15:.45),selector+' final fill must change materially');
      assert.ok(high.alpha<.16,selector+' high clear fill exposes wallpaper');
      assert.ok(high.composite<.3,selector+' ancestor fills must not hide wallpaper');
      assert.equal(high.opacity,'1',selector+' does not fade its text');
      assert.equal(high.textAlpha,1,selector+' text remains opaque');
      assert.ok(!high.blur.includes('blur(')||high.blur.includes('blur(0px)'),selector+' has no blur');
    }
    // Pixel comparison uses the same real panel/search bounds, including their
    // contents, rather than a detached swatch or synthetic content card.
    const frames=[19,100].map(n=>execFileSync('ffmpeg',['-v','error','-i',path.join(visualDir,`clear-${mode}-${n}.png`),'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:8*1024*1024}));
    const pixelDiff={};
    for(const selector of ['.theme-menu','.header-search-shell']){
      const r={...endpoints[0][selector].rect};let sum=0,count=0;
      assert.deepEqual(endpoints[0][selector].rect,endpoints[1][selector].rect,'same capture position: '+selector);
      // The menu overlaps the search's right side. Measure only the exposed
      // search pixels so a changed menu cannot make a static search pass.
      if(selector==='.header-search-shell') r.width=Math.min(r.width,endpoints[0]['.theme-menu'].rect.x-r.x-4);
      for(let y=Math.max(0,Math.ceil(r.y+2));y<Math.min(900,Math.floor(r.y+r.height-2));y++)for(let x=Math.max(0,Math.ceil(r.x+2));x<Math.min(1280,Math.floor(r.x+r.width-2));x++)for(let c=0;c<3;c++){
        const i=(y*1280+x)*3+c;sum+=Math.abs(frames[0][i]-frames[1][i]);count++;
      }
      assert.ok(count>0,'visible capture bounds: '+selector);
      pixelDiff[selector]=Number((sum/count).toFixed(2));
      assert.ok(pixelDiff[selector]>12,'visible wallpaper difference: '+selector);
    }
    console.log('Real component clear alpha '+mode+' (19/100): '+JSON.stringify(endpoints.map(e=>Object.fromEntries(Object.entries(e).map(([k,v])=>[k,{alpha:v?.alpha,composite:v?.composite}])))));
    console.log('Same-position mean RGB difference '+mode+': '+JSON.stringify(pixelDiff));
  }
  for (const target of surfacePeers) await send('Target.closeTarget',{targetId:target.targetId});
  await (await import('./verify-frosted-browser.mjs')).verifyFrosted({dashboard,page,send,visualDir});
  await dashboard.evaluate('delete globalThis.reviewImage');
  console.log('Visual captures: '+visualDir);
  await dashboard.evaluate(`document.querySelectorAll('[data-opacity-probe]').forEach(n=>n.remove())`);
  await dashboard.evaluate(`saveThemePreferences(${JSON.stringify(saved)})`);
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
  await second.wait('document.documentElement.style.getPropertyValue("--glass-blur") === "28px"');
  await popup.wait('document.documentElement.style.getPropertyValue("--paper") === ' + JSON.stringify(saved.wallpaperTheme.dark['--paper']));
  for (const target of [dashboard, second, popup]) {
    await target.wait('document.documentElement.style.getPropertyValue("--workspace-accent-contrast") === ' + JSON.stringify(saved.wallpaperTheme.dark['--paper']));
  }
  await dashboard.evaluate('saveThemePreferences({materialIntensity: 20, mode:"light", wallpaperOverlay:63})');
  await second.wait('document.documentElement.style.getPropertyValue("--glass-blur") === "7px"');
  await popup.wait('document.documentElement.style.getPropertyValue("--paper") === ' + JSON.stringify(saved.wallpaperTheme.light['--paper']));
  for (const target of [second,popup]) await target.wait('document.documentElement.style.getPropertyValue("--wallpaper-overlay-opacity") === "0.63"');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, dashboard.sessionId);
  await dashboard.wait('document.querySelector(".wallpaper-video-element").paused && getComputedStyle(document.querySelector(".wallpaper-video-element")).display === "none"');
  const backup = await dashboard.evaluate('TabHarborConfigSync.exportConfig()');
  assert.equal(JSON.parse(backup).themePreferences.wallpaperOverlay, 63);
  assert.equal(JSON.parse(backup).themePreferences.wallpaperOverlayTint, saved.wallpaperOverlayTint);
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
  // Old JSON without overlay fields migrates on import, then becomes stable
  // when the serial queue persists the normalized model.
  await dashboard.evaluate(`(async () => {
    const c=document.createElement('canvas'); c.width=c.height=2;
    await TabHarborConfigSync.importConfig(JSON.stringify({version:1,themePreferences:{mode:'light',material:'clear',materialIntensity:50,customBackground:c.toDataURL()}}));
  })()`);
  await dashboard.wait('TabOutThemeControls.getThemePreferences().wallpaperOverlay === 48');
  await dashboard.evaluate('saveThemePreferences({materialIntensity:100})');
  assert.equal(await dashboard.evaluate('(async () => (await chrome.storage.local.get("themePreferences")).themePreferences.wallpaperOverlay)()'),48);
  assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperOverlay'),48);
  assert.deepEqual(consoleErrors, [], 'extension pages must not log console errors');
  assert.deepEqual(exceptions, [], 'extension pages must initialize and operate without runtime exceptions');
  console.log('PASS: real extension upload and Clear controls, image/video palette switching, poster cleanup, IDB, serial sliders, computed opacity, independent overlay, cached first paint, MCU, light/dark, popup, multi-page sync, reduced-motion, backup migration/isolation; zero runtime exceptions');
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
  rmSync(temp, { recursive: true, force: true });
}
