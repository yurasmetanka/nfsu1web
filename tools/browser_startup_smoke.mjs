#!/usr/bin/env node
// Execute the overlaid startGame() with small host stubs. This is a source smoke,
// not a browser or game compatibility check.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = path.resolve(process.argv[2] ?? path.join(root, 'work/upstream/nfsu2-web'));
const source = await readFile(path.join(upstream, 'web/src/app/shell.ts'), 'utf8');

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const startup = between('async function startGame() {', '\n\nconst BROWSER_ENV =');
const envFilter = between('const BROWSER_ENV =', '\n\nfunction logLine');
const require = createRequire(path.join(upstream, 'web/build.mjs'));
const esbuild = require('esbuild');
const { code } = await esbuild.transform(`${startup}\n${envFilter}`, { loader: 'ts', target: 'es2022' });

const toastCalls = [];
const logLines = [];
let exitHandlerAttached = false;
let startOptions;
const canvas = { focus() {} };
const elements = new Map([
  ['#stage', { hidden: true }], ['#app', { inert: false }], ['#log-btn', { hidden: true }],
  ['#report', { hidden: true }],
]);
const session = {
  status: null,
  proc: { memory: {} },
  audio: { state: () => 'running' },
  exited: { then() { exitHandlerAttached = true; return Promise.resolve(); } },
};

class AudioContextStub {
  constructor() { this.state = 'running'; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

const context = {
  AudioContext: AudioContextStub,
  AwayCheck: class {},
  GameSession: { async start(options) { startOptions = options; return session; } },
  SAVE: 'save-nfsu1',
  away: null,
  awayLimits: () => ({}),
  awayLine() {},
  askRoam: async () => {},
  browserBrief: () => 'stub browser',
  canvas,
  isPhone: () => false,
  displayHz: 60,
  document: { body: { dataset: {} } },
  download: { async pause() {}, resume() {} },
  endStage() {},
  enterFullscreen: async () => ({ ok: true, locked: true }),
  exists: async () => false,
  fps: { set() {}, memory: null },
  loaded: { info: { rev: 'smoke-rev' }, module: {} },
  loadSettings: async () => null,
  log: { add(line) { logLines.push(line); }, keep(line) { logLines.push(line); } },
  logLine() {},
  moviesKept: async () => true,
  netBack() {},
  notice() {},
  offline: true,
  onExit() {},
  onSaved() {},
  performance: { now: () => 0 },
  phase: 'ready',
  q: { get: () => null },
  quitAt: null,
  refreshMeasured: Promise.resolve(),
  resolved: () => ({
    env: { NOSOUND: '1', NFSU2_BACKGROUND: 'pause', NFSFULL: '0', NFSU1_GRAPHICS: 'max', NFSU1_RESOLUTION: '800x600', NFSRES: '800x600', NFSU1_DYNAMIC_RESOLUTION: '0', NFSU2_AUDIO_LATENCY: 'interactive', NFSU2_REGFILE: '/save/registry.txt', NFSU2_SEED_REGISTRY: '0', NFSU2_FPS_COUNTER: 'off', NOMOVIES: '1', NFSU1_INTRO: 'off', NFSU2_INTRO: 'original' },
    notes: [],
  }),
  saves: { async settled() {} },
  saved: null,
  serverAnswers: async () => false,
  serverKind: () => 'local',
  serverRev: async () => null,
  setInterval: () => 1,
  setPhase(phase) { context.phase = phase; },
  setReach() {},
  setTimeout: () => 1,
  settledSize: async () => ({ w: 800, h: 600 }),
  stageCanvas: () => canvas,
  starting: true,
  testPage: () => false,
  toast(message, duration) { toastCalls.push({ message, duration }); },
  trackCanvasSize: () => () => {},
  toggleFullscreen() {},
  stopFatal() {},
  untrack: null,
  updatePlay() {},
  clearInterval() {},
  clearTimeout() {},
  console,
};
context.$ = selector => {
  if (selector === '#stage-canvas') return canvas;
  if (!elements.has(selector)) throw new Error(`unexpected selector ${selector}`);
  return elements.get(selector);
};

vm.runInNewContext(`${code}\nthis.runStartGame = startGame;`, context, { filename: 'overlaid-shell-startup.js' });
await context.runStartGame();

assert.equal(context.phase, 'playing', `startup reaches the running phase for a fresh profile: ${logLines.join(' | ')}`);
assert.equal(exitHandlerAttached, true, 'the session exit handler attaches after startup');
assert.equal(toastCalls.length, 1, 'startup shows its generic hint');
assert.equal(toastCalls[0].duration, 6000);
assert.match(toastCalls[0].message, /F9 opens the menu/);
assert.equal(startOptions.env.NOSOUND, '1', 'sound output reaches the shared audio host');
assert.equal(startOptions.env.NFSU2_BACKGROUND, 'pause', 'pause policy survives startup and reaches the shared lifecycle host');
assert.equal(startOptions.env.NFSU1_SAVEDIR, '/save/nfsu1');
assert.equal(startOptions.env.NFSU1_INTRO, 'off');
assert.equal(startOptions.env.NFSU2_INTRO, undefined);
assert.equal(startOptions.env.NFSU1_GRAPHICS, 'max');
assert.equal(startOptions.env.NFSRES, undefined, 'a restored fixed override cannot pin browser resolution');
assert.equal(startOptions.env.NFSU1_RESOLUTION, undefined, 'legacy resolution choice is ignored');
assert.equal(startOptions.env.NFSU1_DYNAMIC_RESOLUTION, '1', 'live resolution is always enabled');
assert.equal(logLines.some(line => line.includes('first-run check')), true);
const resolvePause = context.resolved;
context.resolved = () => {
  const r = resolvePause();
  r.env.NFSU2_BACKGROUND = 'run';
  return r;
};
context.phase = 'ready';
context.starting = true;
await context.runStartGame();
assert.equal(startOptions.env.NFSU2_BACKGROUND, 'run', 'keep running survives startup and reaches the shared lifecycle host');
console.log('Overlaid startGame startup smoke passed for a fresh profile. No browser was launched.');
