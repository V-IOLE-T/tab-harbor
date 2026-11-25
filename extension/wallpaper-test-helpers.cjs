'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function context(overrides = {}) {
  const scope = vm.createContext({ console, Blob, setTimeout, clearTimeout, ...overrides });
  return {
    scope,
    load(name) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), scope, { filename: name });
      return scope;
    },
  };
}

function element(tag = 'div') {
  const listeners = {};
  return {
    tagName: tag, style: {}, children: [], attributes: {}, isConnected: true,
    playCalls: 0, pauseCalls: 0, loadCalls: 0,
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; if (k === 'src') this.src = ''; },
    addEventListener(k, fn) { listeners[k] = fn; },
    dispatch(k) { listeners[k]?.(); },
    appendChild(child) { this.children.push(child); },
    insertBefore(child) { this.children.unshift(child); },
    remove() { this.removed = true; },
    load() { this.loadCalls++; },
    play() { this.playCalls++; return Promise.resolve(); },
    pause() { this.pauseCalls++; },
  };
}
module.exports = { context, element };
