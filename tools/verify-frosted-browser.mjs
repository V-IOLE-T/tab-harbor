// Frosted material gate: asserts observed browser behavior, not a copy of the
// production fill formula. Layout stability is checked through same-position
// captures, and every failure prints the measured table first.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const SURFACES = ['.theme-menu', '.header-search-shell', '.mission-card', '.deferred-shell'];
const STRENGTHS = [0, 50, 100];
const VIEWPORT = {width: 1280, height: 900};

// Reading is done in the page so the assertions below see real computed style,
// which is what a user actually gets after CSS cascade and color-mix resolve.
const READ = `(() => {
  const alpha = c => c === 'transparent' ? 0
    : c.includes('/') ? parseFloat(c.split('/')[1])
    : c.startsWith('rgba') ? Number(c.match(/[0-9.]+/g)[3]) : 1;
  const blurPx = v => { const m = /blur\\(([\\d.]+)px\\)/.exec(v || ''); return m ? Number(m[1]) : 0; };
  const measure = selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const style = getComputedStyle(node), r = node.getBoundingClientRect();
    const round = n => Math.round(n * 100) / 100;
    let composite = alpha(style.backgroundColor);
    for (let p = node.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      composite = 1 - (1 - composite) * (1 - alpha(getComputedStyle(p).backgroundColor));
    }
    return {
      fill: alpha(style.backgroundColor), composite, backdrop: style.backdropFilter,
      blurPx: blurPx(style.backdropFilter), opacity: style.opacity, textAlpha: alpha(style.color),
      visible: node.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}),
      rect: {x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height)},
    };
  };
  const result = Object.fromEntries(${JSON.stringify(SURFACES)}.map(s => [s, measure(s)]));
  // Nested drawer cards must reuse the drawer shell's single backdrop layer.
  result.nested = [...document.querySelectorAll('.deferred-shell .saved-session-card, .deferred-shell .mission-card')]
    .map(n => getComputedStyle(n).backdropFilter);
  return result;
})()`;

function table(rows) {
  return rows.map(r => `${r.mode} ${String(r.strength).padStart(3)} | ` + SURFACES
    .map(s => `${s.replace('.theme-menu','menu').replace('.header-search-shell','search').replace('.mission-card','card').replace('.deferred-shell','drawer')}=${r[s]?.fill?.toFixed(3)}/${r[s]?.blurPx}px`)
    .join(' ') + ` | pixel=${r.pixel ?? '-'}`).join('\n');
}

export async function verifyFrosted({dashboard, page, send, visualDir}) {
  // Freeze geometry and motion so both tones and every strength are captured
  // at identical positions and nothing animates between captures.
  await send('Emulation.setDeviceMetricsOverride', {...VIEWPORT, deviceScaleFactor: 1, mobile: false}, dashboard.sessionId);
  await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]}, dashboard.sessionId);

  // A high-frequency wallpaper is the hard case for legibility: a blurred but
  // evenly filled surface still has to keep body text readable on it.
  await dashboard.evaluate(`(() => {
    const c = document.createElement('canvas'); c.width = ${VIEWPORT.width}; c.height = ${VIEWPORT.height};
    const x = c.getContext('2d');
    for (let j = 0; j < c.height; j += 18) for (let i = 0; i < c.width; i += 18) {
      x.fillStyle = 'hsl(' + ((i * 17 + j * 11) % 360) + ' 68% ' + (14 + (i + j) % 68) + '%)';
      x.fillRect(i, j, 18, 18);
    }
    x.font = 'bold 40px sans-serif'; x.fillStyle = '#000'; x.fillText('FROSTED WALLPAPER', 60, 140);
    globalThis.reviewImage = c.toDataURL();
  })()`);

  // Fonts and data must both be settled before geometry is trusted.
  const settle = async () => {
    await dashboard.evaluate('document.fonts.ready');
    await dashboard.evaluate('Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))');
    let previous = '', stable = 0;
    for (let i = 0; i < 100; i++) {
      const signature = await dashboard.evaluate(
        `JSON.stringify(${JSON.stringify(SURFACES)}.map(s => {
          const n = document.querySelector(s); if (!n) return [s, null];
          const r = n.getBoundingClientRect(); return [s, r.x, r.y, r.width, r.height, n.textContent.length];
        }))`);
      stable = signature === previous ? stable + 1 : 0; previous = signature;
      if (stable >= 6) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Frosted production layout/data did not stabilize: ' + previous);
  };

  console.log('FROSTED starting behavior gate (complex wallpaper, both tones, 0/50/100)');
  const peers = await Promise.all([page('index.html'), page('popup/popup.html')]);
  await send('Page.bringToFront', {}, dashboard.sessionId);

  // A real tab gives the workspace a real mission card to measure.
  const fixtureTab = await dashboard.evaluate('(async () => (await chrome.tabs.create({url:"https://example.com/frosted-review", active:false})).id)()');
  await dashboard.wait(`(async () => (await chrome.tabs.get(${fixtureTab})).status === 'complete')()`);
  await dashboard.wait('!!document.querySelector(".mission-card")');
  const pinLayout = 'document.body.classList.remove("entry-animations-enabled");window.scrollTo(0,0)';

  const rows = [];
  const diffRows = [];
  const frames = {};
  try {
    for (const mode of ['light', 'dark']) {
      for (const strength of STRENGTHS) {
        // Drive the real controls so the CSS cascade, not a test formula, decides.
        await dashboard.evaluate(`saveThemePreferences({customBackground:globalThis.reviewImage,backgroundType:'image',colorSource:'preset',mode:'${mode}',material:'frosted',surfaceOpacity:14,materialIntensity:${strength},wallpaperOverlay:0,wallpaperOverlayTint:0})`);
        await dashboard.evaluate(`(async () => {
          setThemeMenuOpen(true);
          document.querySelector('[data-action="select-material"][data-material="frosted"]')?.click();
          const n = document.getElementById('themeMaterialIntensityRange');
          n.value = '${strength}'; n.dispatchEvent(new Event('input', {bubbles: true}));
          await saveThemePreferences({});
        })()`);
        assert.equal(
          await dashboard.evaluate('(async () => (await chrome.storage.local.get("themePreferences")).themePreferences.materialIntensity)()'),
          strength, `${mode} ${strength}: real control persisted the strength`);

        // Peers must paint the same tokens; compare observed tokens, not a formula.
        const tokens = await dashboard.evaluate('Object.fromEntries(["--glass-blur","--glass-content-filter","--glass-frosted-fill"].map(n => [n, document.documentElement.style.getPropertyValue(n)]))');
        for (const peer of peers) {
          await peer.wait(`document.documentElement.style.getPropertyValue("--glass-frosted-fill") === ${JSON.stringify(tokens['--glass-frosted-fill'])}`);
          assert.deepEqual(
            await peer.evaluate(`Object.fromEntries(${JSON.stringify(Object.keys(tokens))}.map(n => [n, document.documentElement.style.getPropertyValue(n)]))`),
            tokens, `${mode} ${strength}: dashboard and popup share frosted tokens`);
        }

        await dashboard.evaluate('Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))');
        await dashboard.evaluate(pinLayout);
        await settle();
        const measured = await dashboard.evaluate(READ);
        for (const selector of SURFACES.filter(s => s !== '.deferred-shell')) {
          assert.ok(measured[selector], `${mode} ${strength}: production surface ${selector} exists`);
        }
        // Workspace surfaces are captured with the drawer closed, so the drawer's
        // own geometry cannot shift the pixels under the menu, search and card.
        const workspaceShot = await send('Page.captureScreenshot', {format: 'png'}, dashboard.sessionId);
        const workspaceFile = path.join(visualDir, `frosted-${mode}-${strength}-workspace.png`);
        writeFileSync(workspaceFile, Buffer.from(workspaceShot.data, 'base64'));
        frames[`${mode}-${strength}-workspace`] = execFileSync('ffmpeg',
          ['-v', 'error', '-i', workspaceFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
          {maxBuffer: 16 * 1024 * 1024});

        // The drawer only renders its cards while open; measure it in its real state.
        await dashboard.evaluate('setThemeMenuOpen(false);setDeferredPanelOpen(true);renderDeferredColumn()');
        await dashboard.evaluate(pinLayout);
        await settle();
        const drawerState = await dashboard.evaluate(READ);
        measured['.deferred-shell'] = drawerState['.deferred-shell'];
        assert.ok(measured['.deferred-shell'], `${mode} ${strength}: drawer shell exists`);
        if (drawerState.nested.length) {
          assert.ok(drawerState.nested.every(v => v === 'none'),
            `${mode} ${strength}: nested drawer cards reset the content filter, got ${JSON.stringify(drawerState.nested)}`);
        }
        const drawerShot = await send('Page.captureScreenshot', {format: 'png'}, dashboard.sessionId);
        const drawerFile = path.join(visualDir, `frosted-${mode}-${strength}-drawer.png`);
        writeFileSync(drawerFile, Buffer.from(drawerShot.data, 'base64'));
        frames[`${mode}-${strength}-drawer`] = execFileSync('ffmpeg',
          ['-v', 'error', '-i', drawerFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
          {maxBuffer: 16 * 1024 * 1024});
        await dashboard.evaluate('setDeferredPanelOpen(false);renderDeferredColumn();setThemeMenuOpen(true)');
        rows.push({mode, strength, ...measured});
      }
    }

    // Behavior assertions. No production constant or formula is restated here:
    // every check is an ordering or a readability bound on observed values.
    for (const mode of ['light', 'dark']) {
      const at = strength => rows.find(r => r.mode === mode && r.strength === strength);
      for (const selector of SURFACES) {
        const [low, mid, high] = STRENGTHS.map(s => at(s)[selector]);
        const label = `${mode} ${selector}`;

        // 1. backdrop-filter is really applied, never "none".
        for (const [strength, m] of STRENGTHS.map((s, i) => [s, [low, mid, high][i]])) {
          assert.equal(m.visible, true, `${label} ${strength}: surface is visible`);
          assert.equal(m.opacity, '1', `${label} ${strength}: surface does not fade itself`);
          assert.equal(m.textAlpha, 1, `${label} ${strength}: text stays opaque`);
          assert.notEqual(m.backdrop, 'none', `${label} ${strength}: computed backdrop-filter must not be none`);
          assert.ok(!m.backdrop.includes('blur(0px)'), `${label} ${strength}: frosted must actually blur, got ${m.backdrop}`);
          assert.ok(m.blurPx > 0, `${label} ${strength}: blur radius is positive, got ${m.blurPx}`);
        }

        // 2. blur strictly increases 0 < 50 < 100.
        assert.ok(low.blurPx < mid.blurPx,
          `${label}: blur must increase 0→50, got ${low.blurPx}px → ${mid.blurPx}px`);
        assert.ok(mid.blurPx < high.blurPx,
          `${label}: blur must increase 50→100, got ${mid.blurPx}px → ${high.blurPx}px`);

        // 3. fill strictly increases and stays readable-but-translucent.
        assert.ok(low.fill < mid.fill, `${label}: fill must increase 0→50, got ${low.fill} → ${mid.fill}`);
        assert.ok(mid.fill < high.fill, `${label}: fill must increase 50→100, got ${mid.fill} → ${high.fill}`);
        assert.ok(low.fill >= 0.40, `${label}: 0-strength fill keeps body text readable, got ${low.fill}`);
        assert.ok(high.fill <= 0.80, `${label}: 100-strength fill stays translucent, got ${high.fill}`);
        assert.ok(high.fill < 0.9, `${label}: frosted never becomes an opaque panel, got ${high.fill}`);
        // Dark panels must not be painted shut: the blur has to remain visible.
        assert.ok(high.composite < 0.9, `${label}: ancestors do not seal the wallpaper, composite ${high.composite}`);

        // 4. Layout stability across strengths, verified by identical geometry.
        assert.deepEqual(mid.rect, low.rect, `${label}: same position at 0 and 50`);
        assert.deepEqual(high.rect, low.rect, `${label}: same position at 0 and 100`);
      }

      // 5. Pixel differences are monotonic and the endpoint is clearly visible.
      // The drawer is captured in its own scene; workspace surfaces use theirs.
      const sceneOf = selector => selector === '.deferred-shell' ? 'drawer' : 'workspace';
      const clip = selector => {
        const r = {...at(0)[selector].rect};
        // The menu overlaps the search's right edge; keep only exposed pixels so
        // a moving menu cannot make a static search look changed.
        if (selector === '.header-search-shell') r.width = Math.min(r.width, at(0)['.theme-menu'].rect.x - r.x - 4);
        return r;
      };
      const meanDiff = (selector, a, b) => {
        const scene = sceneOf(selector);
        const f = frames[`${mode}-${a}-${scene}`], g = frames[`${mode}-${b}-${scene}`];
        assert.ok(f && g, `${mode} ${selector}: captures exist for scene ${scene}`);
        const r = clip(selector); let sum = 0, count = 0;
        for (let y = Math.max(0, Math.ceil(r.y + 3)); y < Math.min(VIEWPORT.height, Math.floor(r.y + r.height - 3)); y++) {
          for (let x = Math.max(0, Math.ceil(r.x + 3)); x < Math.min(VIEWPORT.width, Math.floor(r.x + r.width - 3)); x++) {
            for (let c = 0; c < 3; c++) { sum += Math.abs(f[(y * VIEWPORT.width + x) * 3 + c] - g[(y * VIEWPORT.width + x) * 3 + c]); count++; }
          }
        }
        assert.ok(count > 0, `${mode} ${selector}: capture bounds expose pixels`);
        return Number((sum / count).toFixed(2));
      };
      for (const selector of SURFACES) {
        const d0 = meanDiff(selector, 0, 50), d1 = meanDiff(selector, 50, 100), dEnd = meanDiff(selector, 0, 100);
        assert.ok(d0 > 1, `${mode} ${selector}: 0→50 visibly changes, got ${d0}`);
        assert.ok(d1 > 1, `${mode} ${selector}: 50→100 visibly changes, got ${d1}`);
        assert.ok(dEnd > d0 && dEnd > d1, `${mode} ${selector}: cumulative change dominates each step (${dEnd} vs ${d0}/${d1})`);
        // 12/255 is the same "visible wallpaper difference" bar the clear gate
        // uses for a real surface, so the endpoints must clear an established
        // threshold rather than one tuned to a particular surface.
        assert.ok(dEnd > 12, `${mode} ${selector}: endpoints differ clearly, got ${dEnd}`);
        diffRows.push({mode, strength: '0→50', surface: selector, diff: d0});
        diffRows.push({mode, strength: '50→100', surface: selector, diff: d1});
        diffRows.push({mode, strength: '0→100', surface: selector, diff: dEnd});
        for (const row of rows.filter(r => r.mode === mode)) {
          if (row[selector]) row[`pixel-${selector}`] = row.strength === 100 ? dEnd : (row.strength === 50 ? d0 : '-');
        }
      }
      console.log('FROSTED ' + mode + ' observed\n' + table(rows.filter(r => r.mode === mode)));
      console.log('FROSTED ' + mode + ' pixel diffs ' + JSON.stringify(diffRows.filter(r => r.mode === mode)));
    }

    // A flat background has no detail to blur, so blur is naturally invisible
    // there; the fill and the independent overlay must still behave.
    for (const strength of STRENGTHS) {
      await dashboard.evaluate(`saveThemePreferences({backgroundType:"none",material:"frosted",materialIntensity:${strength},wallpaperOverlay:37})`);
      await settle();
      const flat = await dashboard.evaluate(READ);
      assert.ok(flat['.mission-card'], `flat ${strength}: mission card exists`);
      assert.ok(flat['.mission-card'].backdrop !== 'none', `flat ${strength}: frosted still declares a backdrop filter`);
      assert.equal(await dashboard.evaluate('TabOutThemeControls.getThemePreferences().wallpaperOverlay'), 37,
        `flat ${strength}: overlay preference is independent of glass`);
    }
    assert.equal(await dashboard.evaluate('getComputedStyle(document.body).backgroundImage'), 'none', 'flat background has no image wash');
    assert.equal(await dashboard.evaluate('getComputedStyle(document.body,"::after").opacity'), '0', 'flat background paints no overlay');
    console.log('FROSTED flat-background note: an even tone has no high-frequency detail, so blur is naturally not visible; fill and overlay still tracked.');

    // Leaving frosted must hand surfaces back to the clear/default materials.
    await dashboard.evaluate('saveThemePreferences({backgroundType:"image",customBackground:globalThis.reviewImage,material:"clear",materialIntensity:100})');
    await settle();
    assert.equal(await dashboard.evaluate('document.documentElement.style.getPropertyValue("--glass-frosted-fill")'), 'initial',
      'clear resets the frosted fill override');
    assert.ok(Math.abs((await dashboard.evaluate(READ))['.mission-card'].fill - .082) < .01, 'clear still reaches its own endpoint after a frosted round trip');
  } catch (error) {
    // A failure must be actionable: print every measurement taken so far.
    console.error('FROSTED measured table before failure:\n' + table(rows));
    if (diffRows.length) console.error('FROSTED measured pixel diffs before failure:\n' + JSON.stringify(diffRows, null, 1));
    console.error('FROSTED failure: ' + error.message);
    throw error;
  }

  for (const peer of peers) await send('Target.closeTarget', {targetId: peer.targetId});
  await dashboard.evaluate(`chrome.tabs.remove(${fixtureTab})`);
}
