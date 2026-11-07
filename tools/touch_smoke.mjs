#!/usr/bin/env node
// Exercise the touch controls and their mailbox protocol with Node host stubs.
// This does not operate a browser or establish game compatibility.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = path.resolve(process.argv[2] ?? path.join(root, 'work/upstream/nfsu2-web'));
const inputPath = path.join(upstream, 'web/src/input/index.ts');
const source = await readFile(inputPath, 'utf8');

const require = createRequire(path.join(upstream, 'web/build.mjs'));
const esbuild = require('esbuild');
const result = await esbuild.build({
  stdin: {
    contents: `${source}
export {
  TouchControls, setSteering, steering, setLevelHorizon, levelHorizon, rollOf, edits,
} from '../app/touch';
export {
  INPUT_MAGIC, INPUT_VERSION, IM_MAGIC, IM_VERSION, IM_EV_W, IM_EV_R, IM_OFF_EV,
  IM_PAD_CONNECTED, IM_PAD_BUTTONS, IM_PAD_AXIS, IM_VIEW_ROLL,
  IEV_KEY_DOWN, IEV_KEY_UP, IEV_MOUSE_MOVE, IEV_MOUSE_DOWN, IEV_MOUSE_UP, IEV_TEXT,
  IKF_TOUCH, PAD_A, PAD_X, PAD_LB, PAD_RB,
} from './proto';`,
    loader: 'ts',
    resolveDir: path.dirname(inputPath),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  plugins: [{
    name: 'tracked-browser',
    setup(build) {
      build.onResolve({ filter: /\/app\/keyboard$/ }, () => ({ path: path.join(root, 'browser/keyboard.ts') }));
      build.onResolve({ filter: /\/app\/touch$/ }, () => ({ path: path.join(root, 'browser/touch.ts') }));
    },
  }],
});

class Target {
  listeners = new Map();
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(e) { for (const fn of [...(this.listeners.get(e.type) ?? [])]) fn(e); return true; }
}

class ClassList {
  set = new Set();
  add(...names) { for (const n of names) this.set.add(n); }
  remove(...names) { for (const n of names) this.set.delete(n); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name); else this.set.delete(name);
    return on;
  }
  contains(name) { return this.set.has(name); }
}

class Element extends Target {
  style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
  dataset = {};
  classList = new ClassList();
  children = [];
  parentElement = null;
  hidden = false;
  tagName = 'DIV';
  isContentEditable = false;
  tabIndex = 0;
  clientWidth = 800;
  clientHeight = 600;
  value = '';
  rect = { left: 0, top: 0, right: 80, bottom: 80, width: 80, height: 80 };
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() { return [...this.classList.set].join(' '); }
  setAttribute(k, v) {
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(v);
    }
    this[k] = v;
  }
  removeAttribute(k) {
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[camel];
    }
    delete this[k];
  }
  hasAttribute(k) { return k in this; }
  toggleAttribute(k, force) {
    const on = force === undefined ? !this.hasAttribute(k) : !!force;
    if (on) this.setAttribute(k, ''); else this.removeAttribute(k);
    return on;
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n && typeof n === 'object') {
        n.parentElement = this;
        this.children.push(n);
      }
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (sel === '[data-ctl]' && cur.dataset?.ctl) return cur;
      if (sel.startsWith('.') && cur.classList?.contains(sel.slice(1))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const visit = node => {
      for (const ch of node.children ?? []) {
        const m = /^\[data-ctl="([^"]+)"\]$/.exec(sel);
        if (m && ch.dataset?.ctl === m[1]) out.push(ch);
        else if (sel.startsWith('.') && ch.classList?.contains(sel.slice(1))) out.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return out;
  }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture() {}
  focus() {}
  blur() {}
}

let nowMs = 1000;
const rafCallbacks = new Map();
let nextRaf = 1;
const intervalCallbacks = new Map();
let nextInterval = 1;
const storage = new Map();
const window = new Target();
const document = new Target();
const docEl = new Element();
Object.assign(document, {
  hidden: false,
  fullscreenElement: null,
  documentElement: docEl,
  hasFocus: () => true,
  querySelector: () => null,
  elementFromPoint: (x, y) => {
    const hit = node => {
      for (const ch of node.children ?? []) {
        const found = hit(ch);
        if (found) return found;
        const r = ch.rect;
        if (ch.dataset?.ctl && r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return ch;
      }
      return null;
    };
    return hit(stage);
  },
  createElement(tag) { const el = new Element(); el.tagName = tag.toUpperCase(); return el; },
});
Object.assign(window, {
  innerWidth: 800,
  innerHeight: 600,
  screen: { width: 800, height: 600, orientation: { angle: 0 } },
  matchMedia: q => ({ matches: q === '(pointer: coarse)' }),
});

const context = vm.createContext({
  module: { exports: {} },
  console,
  document,
  window,
  innerWidth: 800,
  innerHeight: 600,
  matchMedia: window.matchMedia,
  HTMLElement: Element,
  Event,
  navigator: { platform: 'Linux', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Linux; Android 14)' },
  performance: { now: () => nowMs },
  localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  addEventListener: window.addEventListener.bind(window),
  removeEventListener: window.removeEventListener.bind(window),
  dispatchEvent: window.dispatchEvent.bind(window),
  requestAnimationFrame: fn => { const id = nextRaf++; rafCallbacks.set(id, fn); return id; },
  cancelAnimationFrame: id => { rafCallbacks.delete(id); },
  setInterval: fn => { const id = nextInterval++; intervalCallbacks.set(id, fn); return id; },
  clearInterval: id => { intervalCallbacks.delete(id); },
  setTimeout: fn => { fn(); return 1; },
  clearTimeout() {},
});
vm.runInContext(result.outputFiles[0].text, context);
const p = context.module.exports;

const buffer = new SharedArrayBuffer(32768), ptr = 64;
const header = new Int32Array(buffer, ptr, 64), bytes = new Uint8Array(buffer);
header[p.IM_MAGIC] = p.INPUT_MAGIC;
header[p.IM_VERSION] = p.INPUT_VERSION;
const stage = new Element();
const canvas = new Element();
canvas.tagName = 'CANVAS';
canvas.rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
stage.append(canvas);

const input = p.attachInput(
  { memory: { buffer }, registered: async () => ({ ptr }) },
  canvas,
  { gamepads: true, mac: false, log() {} },
);
await Promise.resolve();
await Promise.resolve();
assert.equal(input.status().attached, true);

function events() {
  const rows = [];
  for (let i = header[p.IM_EV_R]; i < header[p.IM_EV_W]; i++) {
    const at = ptr + p.IM_OFF_EV + (i & 1023) * 16;
    const view = new DataView(buffer, at, 16);
    rows.push({
      type: bytes[at],
      dik: bytes[at + 1],
      vk: bytes[at + 2],
      flags: bytes[at + 3],
      chars: [...bytes.slice(at + 5, at + 5 + bytes[at + 4])],
      a: view.getInt32(8, true),
      b: view.getInt32(12, true),
    });
  }
  header[p.IM_EV_R] = header[p.IM_EV_W];
  return rows;
}

function stepFrame(dt = 120) {
  nowMs += dt;
  for (const fn of [...intervalCallbacks.values()]) fn();
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const fn of cbs) fn(nowMs);
}

// 1. 1-finger touch-to-mouse on the canvas emits IEV_MOUSE_MOVE (IKF_TOUCH) + IEV_MOUSE_DOWN + IEV_MOUSE_UP.
canvas.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 400, clientY: 300, preventDefault() {} });
canvas.dispatchEvent({ type: 'pointerup', pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 400, clientY: 300, preventDefault() {} });
const touchMouseEvs = events();
assert.equal(touchMouseEvs.length, 3);
assert.equal(touchMouseEvs[0].type, p.IEV_MOUSE_MOVE);
assert.equal((touchMouseEvs[0].flags & p.IKF_TOUCH) !== 0, true);
assert.equal(touchMouseEvs[1].type, p.IEV_MOUSE_DOWN);
assert.equal(touchMouseEvs[2].type, p.IEV_MOUSE_UP);

// 2. Mobile text entry helper and IEV_TEXT mailbox event.
assert.deepEqual([...p.edits('NFS', 'NF')], [8]);
assert.deepEqual([...p.edits('NF', 'NFS')], ['S'.charCodeAt(0)]);
input.text([65, 8, 13]);
assert.deepEqual(events().map(e => [e.type, e.chars]), [[p.IEV_TEXT, [65, 8, 13]]]);

// 3. View roll writes float bits into IM_VIEW_ROLL.
input.viewRoll(0.25);
assert.equal(Math.fround(new Float32Array(buffer, ptr + p.IM_VIEW_ROLL * 4, 1)[0]), 0.25);
input.viewRoll(0);

// 4. TouchControls in menu mode and drive mode.
let driveValue = 0;
const touch = new p.TouchControls(stage, { toast() {}, log() {} });
const rootEl = stage.children.find(c => c.classList.contains('touch'));
assert.ok(rootEl, 'TouchControls root element mounted on stage');

const gasBtn = rootEl.querySelector('[data-ctl="gas"]');
const nitroBtn = rootEl.querySelector('[data-ctl="nitro"]');
gasBtn.rect = { left: 700, top: 440, right: 784, bottom: 588, width: 84, height: 148 };
nitroBtn.rect = { left: 712, top: 368, right: 772, bottom: 428, width: 60, height: 60 };

touch.start({
  input,
  status: { read: () => new Map([['drive', driveValue], ['frames', 10]]) },
});
stepFrame();
assert.equal(touch.state().menu, true);
assert.equal(touch.state().shown, false);

// Menu button press (OK -> Enter 0x1c).
const okBtn = rootEl.querySelector('[data-ctl="m-ok"]');
rootEl.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 2, target: okBtn, clientX: 720, clientY: 560, preventDefault() {} });
assert.deepEqual(events().map(e => [e.type, e.dik]), [[p.IEV_KEY_DOWN, 0x1c]]);
rootEl.dispatchEvent({ type: 'pointerup', pointerType: 'touch', pointerId: 2, target: okBtn, clientX: 720, clientY: 560, preventDefault() {} });
assert.deepEqual(events().map(e => [e.type, e.dik]), [[p.IEV_KEY_UP, 0x1c]]);

// Switch to drive mode (drive = 5: race + gears).
driveValue = 5;
stepFrame();
assert.equal(touch.state().shown, true);
assert.equal(touch.state().menu, false);
assert.equal(rootEl.hasAttribute('data-gears'), true);

// Gas pedal press, then slide into Nitro, then release.
rootEl.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 3, target: gasBtn, clientX: 740, clientY: 500, preventDefault() {} });
assert.deepEqual(events().map(e => [e.type, e.dik]), [[p.IEV_KEY_DOWN, 0xc8]]);
rootEl.dispatchEvent({ type: 'pointermove', pointerType: 'touch', pointerId: 3, target: gasBtn, clientX: 740, clientY: 400, preventDefault() {} });
assert.deepEqual(events().map(e => [e.type, e.dik]), [[p.IEV_KEY_DOWN, 0x39]]);
stepFrame();
assert.equal((header[p.IM_PAD_BUTTONS] & (1 << p.PAD_LB)) !== 0, true);
rootEl.dispatchEvent({ type: 'pointerup', pointerType: 'touch', pointerId: 3, target: gasBtn, clientX: 740, clientY: 400, preventDefault() {} });
assert.deepEqual(events().map(e => [e.type, e.dik]), [[p.IEV_KEY_UP, 0xc8], [p.IEV_KEY_UP, 0x39]]);

// Handbrake and gear buttons emit NFSU1 native keys + pad buttons.
const hbBtn = rootEl.querySelector('[data-ctl="hb"]');
const upBtn = rootEl.querySelector('[data-ctl="up"]');
const downBtn = rootEl.querySelector('[data-ctl="down"]');
rootEl.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 4, target: hbBtn, clientX: 650, clientY: 450, preventDefault() {} });
rootEl.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 5, target: upBtn, clientX: 120, clientY: 450, preventDefault() {} });
rootEl.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 6, target: downBtn, clientX: 40, clientY: 450, preventDefault() {} });
assert.deepEqual(events().map(e => [e.type, e.dik]), [
  [p.IEV_KEY_DOWN, 0x36],
  [p.IEV_KEY_DOWN, 0xd2],
  [p.IEV_KEY_DOWN, 0xd3],
]);
stepFrame();
assert.equal((header[p.IM_PAD_BUTTONS] & ((1 << p.PAD_RB) | (1 << p.PAD_A) | (1 << p.PAD_X))),
  (1 << p.PAD_RB) | (1 << p.PAD_A) | (1 << p.PAD_X));
rootEl.dispatchEvent({ type: 'pointerup', pointerType: 'touch', pointerId: 4, target: hbBtn, preventDefault() {} });
rootEl.dispatchEvent({ type: 'pointerup', pointerType: 'touch', pointerId: 5, target: upBtn, preventDefault() {} });
rootEl.dispatchEvent({ type: 'pointerup', pointerType: 'touch', pointerId: 6, target: downBtn, preventDefault() {} });
events();

// Thumb-stick steering sets virtual pad LX and modulates ArrowLeft/ArrowRight for NFSU1 keyboard steering.
p.setSteering('stick');
const stickEl = rootEl.querySelector('.stick');
stickEl.rect = { left: 0, top: 200, right: 320, bottom: 600, width: 320, height: 400 };
rootEl.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 7, target: stickEl, clientX: 160, clientY: 480, preventDefault() {} });
rootEl.dispatchEvent({ type: 'pointermove', pointerType: 'touch', pointerId: 7, target: stickEl, clientX: 100, clientY: 480, preventDefault() {} });
stepFrame();
assert.equal(touch.state().lx < -0.9, true);
assert.equal(header[p.IM_PAD_CONNECTED], 1);
assert.equal(new Float32Array(buffer, ptr + p.IM_PAD_AXIS * 4, 1)[0] < -0.9, true);
assert.deepEqual(events().map(e => [e.type, e.dik]), [[p.IEV_KEY_DOWN, 0xcb]]);
rootEl.dispatchEvent({ type: 'pointerup', pointerType: 'touch', pointerId: 7, target: stickEl, clientX: 100, clientY: 480, preventDefault() {} });
stepFrame();
assert.deepEqual(events().map(e => [e.type, e.dik]), [[p.IEV_KEY_UP, 0xcb]]);

touch.stop();
input.detach();
console.log('Touch controls smoke passed: touch-to-mouse, mobile text entry, view roll, menu D-pad/OK, drive Gas-to-Nitro slide, handbrake/gears and thumb-stick steering.');
