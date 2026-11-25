'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const math = require('./theme-math.js');

const fillOf = (strength, depth = 14) => parseFloat(
  math.computeEffectiveOpacityVars(depth, math.computeMaterialVars({ material: 'frosted', materialIntensity: strength }))['--glass-frosted-fill']);
const blurOf = strength => parseFloat(math.computeMaterialVars({ material: 'frosted', materialIntensity: strength })['--glass-blur']);

// @lat: [[wallpaper-validation#Frosted material verification]]
test('frosted blur steps from a hairline to a strong diffusion endpoint', () => {
  // 1/17/33px at 0/50/100 is the decided shape: ~1 + 0.32i, rounded.
  assert.deepEqual([0, 50, 100].map(blurOf), [1, 17, 33]);
  let previous = 0;
  for (let strength = 0; strength <= 100; strength++) {
    const blur = blurOf(strength);
    assert.ok(blur >= previous, `blur must not regress at ${strength}`);
    assert.ok(blur > 0, `frosted always blurs, even at ${strength}`);
    previous = blur;
  }
});

// @lat: [[wallpaper-validation#Frosted material verification]]
test('frosted fill keeps body text legible at 0 and never turns opaque at 100', () => {
  // The floor exists for readability over a busy wallpaper; the ceiling keeps
  // the wallpaper (and the blur) visible instead of a solid panel.
  assert.ok(fillOf(0) >= 43 && fillOf(0) <= 47, `0-strength floor is about 45%, got ${fillOf(0)}`);
  assert.ok(fillOf(100) >= 72 && fillOf(100) <= 78, `100-strength ceiling is 72-78%, got ${fillOf(100)}`);
  assert.ok(fillOf(100) < 85, 'frosted 100 must not approach an opaque panel');
  let previous = 0;
  for (let strength = 0; strength <= 100; strength++) {
    const fill = fillOf(strength);
    assert.ok(fill > previous, `fill must increase monotonically at ${strength}`);
    assert.ok(fill < 85, `fill stays translucent at ${strength}`);
    previous = fill;
  }
});

// @lat: [[wallpaper-validation#Frosted material verification]]
test('surface depth cannot push a frosted fill to opaque or below the legibility floor', () => {
  for (const depth of [2, 14, 60]) {
    let previous = 0;
    for (let strength = 0; strength <= 100; strength++) {
      const fill = fillOf(strength, depth);
      assert.ok(fill >= 43, `depth ${depth} strength ${strength} stays readable, got ${fill}`);
      assert.ok(fill < 85, `depth ${depth} strength ${strength} stays translucent, got ${fill}`);
      assert.ok(fill > previous, `depth ${depth} fill monotonic at ${strength}`);
      previous = fill;
    }
  }
});

// @lat: [[wallpaper-validation#Frosted material verification]]
test('frosting is visible in both tones because dark panels stop short of opaque', () => {
  // Dark tone previously painted menu/drawer at a full 100% fill, which hid the
  // blur completely. The frosted token must stay below opaque in both tones.
  for (const strength of [0, 50, 100]) {
    const fill = fillOf(strength);
    assert.ok(fill <= 78, `dark surfaces stay translucent at ${strength}: ${fill}%`);
  }
});

// @lat: [[wallpaper-validation#Frosted material verification]]
test('leaving frosted resets the override and preserves the clear endpoints', () => {
  assert.equal(math.computeMaterialVars({ material: 'frosted' })['--glass-frosted-fill'], '60%');
  for (const material of ['default', 'clear']) {
    const vars = math.computeMaterialVars({ material, materialIntensity: 100 });
    // CSS-wide `initial` drops the frosted override so each surface falls back
    // to its own material-aware fill.
    assert.equal(vars['--glass-frosted-fill'], 'initial');
    assert.equal(vars['--glass-content-filter'], 'none');
    assert.equal(math.computeEffectiveOpacityVars(14, vars)['--glass-frosted-fill'], undefined);
  }
  const clear = math.computeMaterialVars({ material: 'clear', materialIntensity: 100 });
  assert.equal(clear['--glass-blur'], '0px');
  assert.equal(clear['--glass-control-scale'], '0.100');
  assert.equal(math.computeEffectiveOpacityVars(14, clear)['--custom-surface-opacity'], '1.4%');
});

// @lat: [[wallpaper-validation#Frosted material verification]]
test('search and cards take the content filter while nested drawer cards reset it', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.header-search-shell,\s*\.mission-card,\s*\.saved-session-card\s*\{[^}]*backdrop-filter:\s*var\(--glass-content-filter\)/);
  assert.match(css, /\.deferred-shell \.saved-session-card,\s*\.deferred-shell \.mission-card\s*\{[^}]*backdrop-filter:\s*none/);
  // Every frosted-aware surface must read the token with a fallback, and none
  // of them may fade its own text or create a filter/will-change layer.
  for (const selector of ['.header-search-shell', '.header-search-shell:focus-within', '.mission-card', '.saved-session-card', 'body.theme-tone-dark .theme-menu', 'body.theme-tone-dark .deferred-shell']) {
    const block = css.slice(css.indexOf(selector + ' {')).split('}')[0];
    assert.ok(block.includes('var(--glass-frosted-fill,'), selector + ' uses the frosted fill');
    assert.doesNotMatch(block, /(?:^|;)\s*(?:opacity|filter|will-change):/);
  }
  // Dark menu/drawer used to hardcode a 100% fill, which hid the blur entirely
  // and made "frosted" indistinguishable from an opaque panel.
  for (const selector of ['body.theme-tone-dark .theme-menu', 'body.theme-tone-dark .deferred-shell']) {
    const block = css.slice(css.indexOf(selector + ' {')).split('}')[0];
    assert.match(block, /var\(--glass-frosted-fill,/, selector + ' defers to the bounded frosted fill');
  }
  assert.match(css, /\.mission-card\s*\{[^}]*border-radius:\s*16px;[^}]*overflow:\s*visible;/);
  assert.match(css, /@supports not[\s\S]*--glass-frosted-fill:\s*initial !important;/);
});
