'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// @lat: [[startup#Optional fonts never block the workspace]]
test('workspace mounts before optional network fonts become screen stylesheets', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const fontLinks = [...html.matchAll(/<link\b[^>]*href="https:\/\/fonts.googleapis.com\/css[^>]*>/g)];
  assert.equal(fontLinks.length, 1);
  assert.match(fontLinks[0][0], /media="print"/);
  assert.match(fontLinks[0][0], /id="optionalFonts"/);

  const fonts = { media: 'print' };
  let finishMount;
  let mountStarted = false;
  const context = vm.createContext({
    document: { getElementById: () => fonts },
    TabHarborDashboardRuntime: {
      mountDashboardRuntime: () => {
        mountStarted = true;
        return new Promise(resolve => { finishMount = resolve; });
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context);
  assert.equal(mountStarted, true);
  assert.equal(fonts.media, 'print');
  finishMount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fonts.media, 'all');
});
