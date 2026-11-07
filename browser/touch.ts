// Touch controls for Need for Speed: Underground on phones and tablets:
//   - Driving controls (races, drift, drag):
//       steering: buttons (ArrowLeft / ArrowRight), thumb stick, or tilt (DeviceOrientation roll)
//       pedals:   Gas (ArrowUp), Brake (ArrowDown), Nitrous (ArrowUp + Space / PAD_LB, slide up from Gas),
//                 Handbrake (ShiftRight / PAD_RB)
//       gears:    Gear down (Delete / PAD_X) and Gear up (Insert / PAD_A) above the left thumb
//       top row:  Pause (Escape), Camera (KeyC), Look back (KeyB), Reset car (KeyR),
//                 Steering mode cycle button, and Tilt recenter button
//   - Menu controls:
//       D-pad (ArrowUp / ArrowLeft / ArrowRight / ArrowDown) bottom-left,
//       Type (on-screen keyboard input for profile/save names), Back (Escape), and OK (Enter) bottom-right,
//       plus direct touch-to-mouse tap on menu items and two-finger drag to rotate the car in the garage.
const PAD_A = 0, PAD_X = 2, PAD_LB = 4, PAD_RB = 5;

function cp1252(u: number): number {
  if (u < 0x80 || (u >= 0xA0 && u <= 0xFF)) return u;
  const hi = [0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039,
    0x0152, 0, 0x017D, 0, 0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC,
    0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178];
  const i = hi.indexOf(u);
  return i >= 0 && u !== 0 ? 0x80 + i : -1;
}

export interface TouchSession {
  input?: {
    key?(code: string, down: boolean): void;
    touchPad?(t: { buttons: number; lx: number } | null): void;
    viewRoll?(rad: number): void;
    padPressed?(): number;
    text?(chars: number[]): void;
  } | null;
  status?: {
    read(): Map<string, number> | null;
  } | null;
}

export function isPhone(): boolean {
  const uad = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  return uad?.mobile === true || /Android.+Mobile|iPhone|iPod/.test(navigator.userAgent) ||
    phoneScreen(navigator.maxTouchPoints ?? 0);
}

export function phoneScreen(touchPoints: number, w = typeof screen !== 'undefined' ? screen.width : 1024, h = typeof screen !== 'undefined' ? screen.height : 768): boolean {
  return touchPoints > 1 && Math.min(w, h) < 600;
}

export function touchFirst(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function markTouch(): void {
  const isTouch = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
    || ('ontouchstart' in window);
  const set = () => {
    const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : isTouch;
    document.documentElement.toggleAttribute('data-touch', coarse || isTouch);
  };
  set();
  if (typeof matchMedia === 'function') {
    const q = matchMedia('(pointer: coarse)');
    q.addEventListener?.('change', set);
  }
}

export function noPinchZoom(): void {
  for (const t of ['gesturestart', 'gesturechange']) {
    document.addEventListener(t, e => e.preventDefault(), { passive: false });
  }
  let lastTouchEnd = 0;
  document.addEventListener('touchend', e => {
    const now = performance.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

export function keepScreenOn(log: (s: string) => void): () => void {
  const wl = (navigator as { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinel> } }).wakeLock;
  if (!wl) return () => {};
  let lock: WakeLockSentinel | null = null, asking = false, stopped = false, said = false;
  const take = () => {
    if (stopped || asking || lock || document.hidden) return;
    asking = true;
    wl.request('screen').then(l => {
      if (stopped) { void l.release().catch(() => {}); return; }
      lock = l;
      l.addEventListener('release', () => { if (lock === l) lock = null; });
      if (!said) { said = true; log('[app] the screen stays on while the game runs (Wake Lock)'); }
    }, e => { if (!said) { said = true; log(`[app] Wake Lock refused: ${e}`); } })
      .finally(() => { asking = false; });
  };
  const onVisible = () => { if (!document.hidden) take(); };
  document.addEventListener('visibilitychange', onVisible);
  take();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    void lock?.release().catch(() => {});
    lock = null;
  };
}

export type Steering = 'buttons' | 'stick' | 'tilt';
export const STEERING: readonly Steering[] = ['buttons', 'stick', 'tilt'];
const NAMES: Record<Steering, string> = { buttons: 'buttons', stick: 'thumb stick', tilt: 'tilt' };
const LIST_NAMES: Record<Steering, string> = { buttons: 'Buttons', stick: 'Thumb stick', tilt: 'Tilt' };
const STORE = 'nfsu1-touch-steering';
const HOLD_MS = 150;
const STEER_EVENT = 'nfsu1-touch-steering';

let steeringNow: Steering = (() => {
  try {
    const s = (localStorage.getItem(STORE) ?? localStorage.getItem('nfsu2-touch-steering')) as Steering;
    return STEERING.includes(s) ? s : 'buttons';
  } catch { return 'buttons'; }
})();

export function steering(): Steering { return steeringNow; }
export function setSteering(to: Steering): void {
  if (to === steeringNow || !STEERING.includes(to)) return;
  steeringNow = to;
  try { localStorage.setItem(STORE, to); } catch { /* private window */ }
  dispatchEvent(new Event(STEER_EVENT));
}
export function onSteering(fn: () => void): void { addEventListener(STEER_EVENT, fn); }
export function steeringName(s: Steering): string { return LIST_NAMES[s]; }

export function askMotion(): Promise<boolean> {
  const D = typeof DeviceOrientationEvent === 'undefined' ? null
    : DeviceOrientationEvent as unknown as { requestPermission?(): Promise<string> };
  if (typeof D?.requestPermission !== 'function') return Promise.resolve(true);
  return D.requestPermission().then(r => r === 'granted', () => false);
}

const STICK_PX = 64, TILT_DEG = 30;
const LEVEL_MAX_DEG = 60, LEVEL_FADE_MS = 400;
const LEVEL_STORE = 'nfsu1-touch-level', LEVEL_EVENT = 'nfsu1-touch-level';
let levelOn = (() => { try { return localStorage.getItem(LEVEL_STORE) !== 'off'; } catch { return true; } })();
export function levelHorizon(): boolean { return levelOn; }
export function setLevelHorizon(on: boolean): void {
  levelOn = on;
  try { localStorage.setItem(LEVEL_STORE, on ? 'on' : 'off'); } catch { /* private window */ }
  dispatchEvent(new Event(LEVEL_EVENT));
}
export function onLevelHorizon(fn: () => void): void { addEventListener(LEVEL_EVENT, fn); }

const GEARS_STORE = 'nfsu1-touch-gears', GEARS_EVENT = 'nfsu1-touch-gears';
export type GearsOpt = 'auto' | 'show' | 'hide';
let gearsSetting: GearsOpt = (() => {
  try {
    const g = localStorage.getItem(GEARS_STORE);
    return g === 'show' || g === 'hide' ? g : 'auto';
  } catch {
    return 'auto';
  }
})();
export function gears(): GearsOpt { return gearsSetting; }
export function setGears(g: GearsOpt): void {
  if (g === gearsSetting) return;
  gearsSetting = g;
  try {
    if (g === 'auto') localStorage.removeItem(GEARS_STORE);
    else localStorage.setItem(GEARS_STORE, g);
  } catch {}
  dispatchEvent(new Event(GEARS_EVENT));
}
export function onGears(fn: () => void): void { addEventListener(GEARS_EVENT, fn); }

export type Size = 'auto' | number;
export interface SizeSetting {
  readonly sizes: readonly Size[];
  get(): Size;
  set(to: Size): void;
  scale(): number;
  name(s: Size): string;
  on(fn: () => void): void;
  check(): void;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function sizeSetting(store: string, sizes: readonly Size[], auto: () => number): SizeSetting {
  let now: Size = (() => {
    try { const n = Number(localStorage.getItem(store)); return sizes.includes(n) ? n : 'auto'; } catch { return 'auto'; }
  })();
  let autoNow = 0;
  const changed = () => dispatchEvent(new Event(store));
  const self: SizeSetting = {
    sizes,
    get: () => now,
    set(to) {
      if (to === now || !sizes.includes(to)) return;
      now = to;
      try { if (to === 'auto') localStorage.removeItem(store); else localStorage.setItem(store, String(to)); } catch { /* private window */ }
      changed();
    },
    scale: () => now === 'auto' ? auto() : now,
    name: s => s === 'auto' ? `Auto (${pct(auto())})` : pct(s),
    on: fn => addEventListener(store, fn),
    check() { const a = auto(); if (a !== autoNow) { autoNow = a; changed(); } },
  };
  const onScreenChange = () => {
    window.scrollTo(0, 0);
    self.check();
  };
  addEventListener('resize', onScreenChange);
  addEventListener('orientationchange', onScreenChange);
  if (typeof screen !== 'undefined' && screen.orientation) {
    screen.orientation.addEventListener('change', onScreenChange);
  }
  return self;
}

const ROOM = { across: 480, down: 260 }, ROOM_UPRIGHT = { across: 384, down: 356 };
let edges: HTMLElement | null = null;
const upright = () => document.documentElement.hasAttribute('data-touch') && innerHeight >= innerWidth;

function autoTouchSize(): number {
  const w = innerWidth || 800, h = innerHeight || 600;
  const want = Math.min(1.25, Math.max(1, Math.min(w, h) / 600));
  const m = edges && typeof getComputedStyle === 'function' ? getComputedStyle(edges) : null;
  const px = (v?: string) => parseFloat(v ?? '') || 12;
  const room = upright() ? ROOM_UPRIGHT : ROOM;
  const fit = Math.min(
    (w - px(m?.paddingLeft) - px(m?.paddingRight)) / room.across,
    (h - px(m?.paddingTop) - px(m?.paddingBottom)) / room.down,
  );
  return Math.max(0.8, Math.floor(Math.min(want, fit) * 20 + 1e-9) / 20);
}

export const touchSize = sizeSetting('nfsu1-touch-size', ['auto', 0.8, 0.9, 1, 1.1, 1.25, 1.5], autoTouchSize);

export function rollOf(beta: number, gamma: number, screenAngle: number): number | null {
  const rad = Math.PI / 180, b = beta * rad, g = gamma * rad, a = screenAngle * rad;
  const gx = Math.cos(b) * Math.sin(g), gy = -Math.sin(b);
  const sx = gx * Math.cos(a) - gy * Math.sin(a), sy = gx * Math.sin(a) + gy * Math.cos(a);
  if (Math.hypot(sx, sy) < 0.3) return null;
  return Math.atan2(sx, -sy);
}

/** Characters (cp1252) that turn `from` into `to`: backspaces (8), then added characters. */
export function edits(from: string, to: string): number[] {
  let p = 0;
  while (p < from.length && p < to.length && from[p] === to[p]) p++;
  const out: number[] = Array(from.length - p).fill(8);
  for (const ch of to.slice(p)) {
    const b = cp1252(ch.charCodeAt(0));
    if (b >= 0x20 && b !== 0x7F) out.push(b);
  }
  return out;
}

interface Ctl {
  id: string;
  el: HTMLElement;
  label: string;
  text?: string;
  keys?: string[];
  bit?: number;
  act?: () => void;
  group?: 'steer' | 'pedal';
  fingers: Set<number>;
  downAt: number;
  upTimer: number;
}

type Mode = 'drive' | 'menu' | '';
let forcedMode: Mode | null = null;

export function setForcedMode(m: Mode | null): void {
  forcedMode = m;
}

export function getForcedMode(): Mode | null {
  return forcedMode;
}
let toldCancel = false;

const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  left: '<path class="fill" d="M16 5L7 12l9 7z"/>',
  right: '<path class="fill" d="M8 5l9 7-9 7z"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  camera: '<path d="M4 8h3l2-2h6l2 2h3v10H4z"/><circle cx="12" cy="13" r="3"/>',
  look: '<path d="M19 12H6M11 7l-5 5 5 5"/>',
  reset: '<path d="M6 13a6 6 0 1 0 2-5.2"/><path d="M5 4v4h4"/>',
  center: '<circle cx="12" cy="12" r="6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  buttons: '<path d="M10 7l-5 5 5 5M14 7l5 5-5 5"/>',
  stick: '<circle cx="12" cy="12" r="8"/><circle class="fill" cx="12" cy="12" r="3"/>',
  tilt: '<rect x="4" y="8" width="16" height="9" rx="2" transform="rotate(-18 12 12)"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  menuUp: '<path class="fill" d="M5 16l7-9 7 9z"/>',
  menuDown: '<path class="fill" d="M5 8l7 9 7-9z"/>',
  nitro: '<path class="fill" d="M13.5 3C9.5 6.5 8 10 9 13c-2-1-2.5-3-2-4.5C4.5 11 4 15 6.5 18c1.5 1.8 3.6 3 5.8 3 3.4 0 6.2-2.6 6.2-6 0-3.2-2.2-5.6-3.5-7.5-.3 1.5-1 2.5-2 3 .8-2.2.8-4.8.5-7.5z"/>',
  kbd: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h10"/>',
  gamepad: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4M15 11h.01M17 13h.01"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M3 12h6.5M14.5 12H21M6.5 17.5l4-3.5M17.5 17.5l-4-3.5"/>',
};

export interface TouchDeps {
  toast(msg: string, ms: number): void;
  log(s: string): void;
}

export class TouchControls {
  private root: HTMLElement;
  private typeForm: HTMLFormElement;
  private typeInput: HTMLInputElement;
  private typeSent = '';
  private typeShown = false;
  private ctls = new Map<string, Ctl>();
  private byFinger = new Map<number, Ctl>();
  private keys = new Map<string, number>();
  private cancelled: { held: number; n: number } | null = null;
  private steering = steering();
  private session: TouchSession | null = null;
  private raf = 0;
  private ticks = true;
  private drive = 0;
  private frames = 0;
  private statusAt = 0;
  private seen = touchFirst();
  private away = false;
  private touchedAt = 0;
  private mode: Mode = '';
  private padButtons = 0;
  private lx = 0;
  private steerHeld: '' | 'ArrowLeft' | 'ArrowRight' = '';
  private steerAcc = 0;
  private stickEl: HTMLElement;
  private baseEl: HTMLElement;
  private knobEl: HTMLElement;
  private stickFinger = -1;
  private stickX0 = 0;
  private center: number | null = null;
  private lastRoll: number | null = null;
  private tiltHeard = false;
  private tiltCheck = 0;
  private tilt = 0;
  private levelK = 0;
  private levelAt = 0;
  private sentRoll = 0;
  private scale = 0;

  constructor(private stage: HTMLElement, private deps: TouchDeps) {
    const root = this.root = document.createElement('div');
    root.className = 'touch';
    root.hidden = true;
    root.dataset.nfsu2Ui = '';
    root.dataset.steering = this.steering;

    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick';
    this.baseEl = document.createElement('div');
    this.baseEl.className = 'stick-base';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'stick-knob';
    this.baseEl.append(this.knobEl);
    this.stickEl.append(this.baseEl);
    root.append(this.stickEl);

    const add = (id: string, label: string, inner: string | { text: string }, c: Partial<Ctl>, cls = '') => {
      const el = document.createElement('div');
      el.className = `tc ${cls}`.trim();
      el.dataset.ctl = id;
      el.setAttribute('role', 'button');
      if (typeof inner === 'string') el.innerHTML = inner;
      root.append(el);
      this.ctls.set(id, {
        id, el, label,
        text: typeof inner === 'string' ? undefined : inner.text,
        fingers: new Set(), downAt: 0, upTimer: 0,
        ...c,
      });
    };

    // Driving controls (mapped to NFSU1's native DirectInput race map at 0x00719798 + virtual pad)
    add('pause', 'Pause', svg(ICONS.pause), { keys: ['Escape'] }, 'small');
    add('camera', 'Camera', svg(ICONS.camera), { keys: ['KeyC'] }, 'small');
    add('look', 'Look back', svg(ICONS.look), { keys: ['KeyB'] }, 'small');
    add('reset', 'Reset car', svg(ICONS.reset), { keys: ['KeyR'] }, 'small');
    add('switch-mode', 'Switch Controls', svg(ICONS.gamepad), { act: () => this.toggleControlMode() }, 'small always');
    add('mode', 'Steering', svg(ICONS[this.steering]), { act: () => this.nextSteering() }, 'small');
    add('center', 'Straight ahead', svg(ICONS.center), { act: () => this.recenter() }, 'small');
    add('left', 'Steer left', svg(ICONS.left), { keys: ['ArrowLeft'], group: 'steer' }, 'big');
    add('right', 'Steer right', svg(ICONS.right), { keys: ['ArrowRight'], group: 'steer' }, 'big');
    add('brake', 'Brake', { text: 'Brake' }, { keys: ['ArrowDown'], group: 'pedal' }, 'big');
    add('gas', 'Gas', { text: 'Gas' }, { keys: ['ArrowUp'], group: 'pedal' }, 'big');
    add('nitro', 'Nitrous', svg(ICONS.nitro), { keys: ['ArrowUp', 'Space'], bit: 1 << PAD_LB, group: 'pedal' }, 'round');
    add('hb', 'Handbrake', { text: 'Hand\nbrake' }, { keys: ['ShiftRight'], bit: 1 << PAD_RB }, 'round');
    add('down', 'Gear down', svg(ICONS.down), { keys: ['Delete'], bit: 1 << PAD_X }, 'gear');
    add('up', 'Gear up', svg(ICONS.up), { keys: ['Insert'], bit: 1 << PAD_A }, 'gear');

    // Menu controls
    add('m-up', 'Up', svg(ICONS.menuUp), { keys: ['ArrowUp'] }, 'menu dpad');
    add('m-left', 'Left', svg(ICONS.left), { keys: ['ArrowLeft'] }, 'menu dpad');
    add('m-right', 'Right', svg(ICONS.right), { keys: ['ArrowRight'] }, 'menu dpad');
    add('m-down', 'Down', svg(ICONS.menuDown), { keys: ['ArrowDown'] }, 'menu dpad');
    add('m-type', 'Keyboard', svg(ICONS.kbd), { act: () => this.toggleType() }, 'menu wide');
    add('m-back', 'Back', { text: 'Back' }, { keys: ['Escape'] }, 'menu wide');
    add('m-ok', 'OK', { text: 'OK' }, { keys: ['Enter'] }, 'menu wide');

    this.relabel();
    this.updateSwitchButton();
    onSteering(() => this.applySteering(steering()));
    onGears(() => this.update());
    stage.append(root);

    // Mobile text entry bar for profile/save names
    const form = this.typeForm = document.createElement('form');
    form.className = 'type';
    form.hidden = true;
    form.dataset.nfsu2Ui = '';
    const input = this.typeInput = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.enterKeyHint = 'done';
    input.placeholder = 'Type text for game…';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('aria-label', 'Text for the game');
    form.append(input);
    stage.append(form);
    input.addEventListener('input', () => this.onTypeInput());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.acceptType(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeType(); }
    });
    form.addEventListener('submit', e => { e.preventDefault(); this.acceptType(); });

    touchSize.on(() => this.applySize());
    edges = root;
    this.applySize();
    touchSize.check();

    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('contextmenu', e => e.preventDefault());

    const onOrient = () => {
      window.scrollTo(0, 0);
      this.dropFingers();
      this.away = false;
      this.applySize();
      this.update();
    };
    addEventListener('orientationchange', onOrient);
    if (typeof screen !== 'undefined' && screen.orientation) {
      screen.orientation.addEventListener('change', onOrient);
    }

    stage.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      window.scrollTo(0, 0);
      this.seen = true;
      this.away = false;
      this.touchedAt = performance.now();
      this.update();
      if (this.mode === 'drive' && e.target instanceof HTMLCanvasElement) e.stopPropagation();
    }, { capture: true });

    addEventListener('keydown', e => {
      if (e.isTrusted && this.session && e.target !== this.typeInput) {
        this.away = true;
        this.update();
      }
    }, { capture: true });
  }

  relabel(): void {
    for (const c of this.ctls.values()) {
      c.el.setAttribute('aria-label', c.label);
      if (c.text === undefined) continue;
      const lines = c.text.split('\n');
      if (lines.length === 1) { c.el.textContent = lines[0]; continue; }
      const span = document.createElement('span');
      lines.forEach((l, i) => { if (i) span.append(document.createElement('br')); span.append(l); });
      c.el.replaceChildren(span);
    }
  }

  start(s: TouchSession, ticks = true): void {
    this.session = s;
    this.ticks = ticks;
    this.drive = 0;
    this.frames = 0;
    const tick = () => { this.frame(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  state() {
    return {
      shown: this.mode === 'drive',
      menu: this.mode === 'menu',
      drive: this.drive,
      steering: this.steering,
      lx: this.lx,
      buttons: this.padButtons,
      keys: [...this.keys.keys()],
      roll: this.sentRoll,
      typing: this.typeShown,
    };
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.closeType();
    this.setMode('');
    this.levelK = this.tilt = 0;
    this.center = this.lastRoll = null;
    if (this.sentRoll) { this.sentRoll = 0; this.session?.input?.viewRoll?.(0); }
    this.session = null;
    this.drive = this.frames = 0;
  }

  private frame(): void {
    const s = this.session;
    if (!s) return;
    const now = performance.now();
    if (now - this.statusAt > 100) {
      this.statusAt = now;
      const st = s.status?.read();
      if (st) {
        const prevDrive = this.drive;
        this.drive = st.get('drive') ?? 0;
        this.frames = st.get('frames') ?? 0;
        if ((prevDrive > 0 && this.drive === 0) || (prevDrive === 0 && this.drive > 0)) {
          setForcedMode(null);
        }
      }
    }
    if (!this.away && (s.input?.padPressed?.() ?? 0) > this.touchedAt) this.away = true;
    this.update();
    this.stepAnalogSteer();
    this.level(now);
  }

  /** Modulate ArrowLeft/ArrowRight from thumb-stick or tilt `lx` so NFSU1's DirectInput race map steers smoothly. */
  private stepAnalogSteer(): void {
    if (this.mode !== 'drive' || this.steering === 'buttons') {
      this.setSteerKey('');
      this.steerAcc = 0;
      return;
    }
    const mag = Math.abs(this.lx);
    if (mag < 0.06) {
      this.setSteerKey('');
      this.steerAcc = 0;
      return;
    }
    const want: 'ArrowLeft' | 'ArrowRight' = this.lx < 0 ? 'ArrowLeft' : 'ArrowRight';
    if (mag >= 0.85) {
      this.setSteerKey(want);
      return;
    }
    this.steerAcc += mag;
    if (this.steerAcc >= 1) {
      this.steerAcc -= 1;
      this.setSteerKey(want);
    } else {
      this.setSteerKey('');
    }
  }

  private setSteerKey(k: '' | 'ArrowLeft' | 'ArrowRight'): void {
    if (k === this.steerHeld) return;
    if (this.steerHeld) this.keyUp(this.steerHeld);
    this.steerHeld = k;
    if (k) this.keyDown(k);
  }

  private level(now: number): void {
    const on = this.mode === 'drive' && this.steering === 'tilt' && levelOn && (this.drive & 8) === 0;
    const dt = Math.min(100, now - this.levelAt);
    this.levelAt = now;
    this.levelK = Math.max(0, Math.min(1, this.levelK + (on ? dt : -dt) / LEVEL_FADE_MS));
    const k = this.levelK, roll = k * k * (3 - 2 * k) * this.tilt;
    if (roll === this.sentRoll) return;
    this.sentRoll = roll;
    this.session?.input?.viewRoll?.(roll);
  }

  private toggleControlMode(): void {
    const next: Mode = this.mode === 'drive' ? 'menu' : 'drive';
    setForcedMode(next);
    this.update();
    this.deps.toast(next === 'menu' ? 'Menu controls' : 'Race controls', 1000);
  }

  private updateSwitchButton(): void {
    const c = this.ctls.get('switch-mode');
    if (!c) return;
    const isDrive = this.mode === 'drive';
    c.label = isDrive ? 'Switch to menu controls' : 'Switch to race controls';
    c.el.setAttribute('aria-label', c.label);
    c.el.setAttribute('title', c.label);
    c.el.innerHTML = svg(isDrive ? ICONS.gamepad : ICONS.wheel);
  }

  private update(): void {
    const on = !!this.session && this.seen && !this.away;
    const autoMode: Mode = !on ? '' : (this.drive & 3) > 0 && (this.drive & 8) === 0 ? 'drive' : this.frames > 0 ? 'menu' : '';
    const mode: Mode = !on ? '' : (forcedMode ?? autoMode);
    this.root.toggleAttribute('data-roam', (this.drive & 3) === 2);
    const showGears = gearsSetting === 'show' ? true : gearsSetting === 'hide' ? false : (this.drive & 4) !== 0;
    this.root.toggleAttribute('data-gears', showGears);
    this.setMode(mode);
  }

  private setMode(mode: Mode): void {
    if (mode === this.mode) return;
    const drove = this.mode === 'drive';
    for (const c of this.ctls.values()) {
      if (c.id === 'switch-mode') continue;
      c.fingers.clear();
      this.up(c, true);
    }
    this.byFinger.clear();
    this.setSteerKey('');
    this.steerAcc = 0;
    this.stickUp();
    this.tiltOff();
    if (mode !== 'menu') this.closeType();
    this.lx = 0;
    this.padButtons = 0;
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.root.hidden = !mode;
    this.updateSwitchButton();
    if (mode === 'drive' && this.steering === 'tilt') this.tiltOn();
    if (drove || mode === 'drive') this.sendPad();
  }

  private sendPad(): void {
    this.session?.input?.touchPad?.({ buttons: this.padButtons, lx: this.steering === 'buttons' ? 0 : this.lx });
  }

  // ---- mobile text entry (.type) -------------------------------------------
  private toggleType(): void {
    if (this.typeShown) { this.closeType(); return; }
    this.typeShown = true;
    this.typeForm.hidden = false;
    this.typeSent = '';
    this.typeInput.value = '';
    this.ctls.get('m-type')?.el.classList.add('on');
    this.typeInput.focus({ preventScroll: true });
  }

  private closeType(): void {
    if (!this.typeShown) return;
    if (document.activeElement === this.typeInput) this.typeInput.blur();
    this.typeShown = false;
    this.typeForm.hidden = true;
    this.ctls.get('m-type')?.el.classList.remove('on');
  }

  private onTypeInput(): void {
    const v = this.typeInput.value.slice(0, 16);
    if (v !== this.typeInput.value) this.typeInput.value = v;
    const c = edits(this.typeSent, v);
    if (c.length) this.session?.input?.text?.(c);
    this.typeSent = v;
  }

  private acceptType(): void {
    this.onTypeInput();
    this.session?.input?.text?.([13]);
    this.closeType();
  }

  // ---- fingers on the controls ---------------------------------------------
  private ctlAt(x: number, y: number): Ctl | undefined {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-ctl]');
    return el ? this.ctls.get(el.dataset.ctl!) : undefined;
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === 'touch' && e.isPrimary) this.dropFingers();
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ctl]');
    const c = el ? this.ctls.get(el.dataset.ctl!) : undefined;
    if (c) { this.byFinger.set(e.pointerId, c); this.press(c, e.pointerId); return; }
    if ((e.target as HTMLElement).closest('.stick')) this.stickDown(e);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.stickFinger) { this.stickMove(e); return; }
    const c = this.byFinger.get(e.pointerId);
    if (!c?.group) return;
    const to = this.ctlAt(e.clientX, e.clientY);
    if (!to || to === c || to.group !== c.group) return;
    this.byFinger.set(e.pointerId, to);
    this.press(to, e.pointerId);
    this.release(c, e.pointerId);
  };

  private onUp = (e: PointerEvent) => {
    if (e.type === 'pointercancel') this.noteCancel(e.pointerId);
    if (e.pointerId === this.stickFinger) { this.stickUp(); this.sendPad(); return; }
    const c = this.byFinger.get(e.pointerId);
    if (!c) return;
    this.byFinger.delete(e.pointerId);
    this.release(c, e.pointerId);
    if (c.act && e.type === 'pointerup') c.act();
  };

  private noteCancel(finger: number): void {
    if (!this.byFinger.has(finger) && finger !== this.stickFinger) return;
    if (!this.cancelled) {
      this.cancelled = { held: this.byFinger.size + (this.stickFinger !== -1 ? 1 : 0), n: 0 };
      setTimeout(() => {
        const { held, n } = this.cancelled!;
        this.cancelled = null;
        this.deps.log(`[app] touch controls: ${n} of ${held} finger(s) cancelled by the phone`);
        if (n < 3 || this.mode !== 'drive' || toldCancel) return;
        toldCancel = true;
        this.deps.toast('The phone took your fingers off the controls: on many phones, three fingers take a screenshot. Nitro gives gas too, so slide your thumb up to it from Gas.', 10000);
      }, 50);
    }
    this.cancelled.n++;
  }

  private dropFingers(): void {
    const n = this.byFinger.size + (this.stickFinger !== -1 ? 1 : 0);
    if (!n) return;
    for (const [finger, c] of this.byFinger) this.release(c, finger);
    this.byFinger.clear();
    if (this.stickFinger !== -1) { this.stickUp(); this.sendPad(); }
    this.deps.log(`[app] touch controls: ${n} finger(s) let go that never lifted`);
  }

  private press(c: Ctl, finger: number): void {
    c.fingers.add(finger);
    if (c.fingers.size > 1) return;
    c.el.classList.add('on');
    if (c.act) return;
    if (this.ticks) navigator.vibrate?.(8);
    if (c.upTimer) { clearTimeout(c.upTimer); c.upTimer = 0; return; }
    c.downAt = performance.now();
    for (const k of c.keys ?? []) this.keyDown(k);
    if (c.bit) { this.padButtons |= c.bit; this.sendPad(); }
  }

  private release(c: Ctl, finger: number): void {
    c.fingers.delete(finger);
    if (c.fingers.size) return;
    c.el.classList.remove('on');
    if (c.act) return;
    const wait = c.downAt + HOLD_MS - performance.now();
    if (wait > 0) c.upTimer = setTimeout(() => { c.upTimer = 0; if (!c.fingers.size) this.up(c); }, wait) as unknown as number;
    else this.up(c);
  }

  private up(c: Ctl, now = false): void {
    if (now) { c.el.classList.remove('on'); if (!c.upTimer && !c.downAt) return; }
    clearTimeout(c.upTimer);
    c.upTimer = 0;
    if (!c.downAt) return;
    c.downAt = 0;
    for (const k of c.keys ?? []) this.keyUp(k);
    if (c.bit) { this.padButtons &= ~c.bit; this.sendPad(); }
  }

  private keyDown(code: string): void {
    const n = this.keys.get(code) ?? 0;
    this.keys.set(code, n + 1);
    if (!n) this.session?.input?.key?.(code, true);
  }

  private keyUp(code: string): void {
    const n = this.keys.get(code) ?? 0;
    if (n > 1) { this.keys.set(code, n - 1); return; }
    if (!n) return;
    this.keys.delete(code);
    this.session?.input?.key?.(code, false);
  }

  // ---- thumb stick ---------------------------------------------------------
  private stickDown(e: PointerEvent): void {
    if (this.stickFinger !== -1) return;
    this.stickFinger = e.pointerId;
    this.stickX0 = e.clientX;
    const rc = this.stickEl.getBoundingClientRect();
    this.baseEl.style.left = `${e.clientX - rc.left}px`;
    this.baseEl.style.top = `${e.clientY - rc.top}px`;
    this.baseEl.classList.add('on');
    if (this.ticks) navigator.vibrate?.(8);
  }

  private stickMove(e: PointerEvent): void {
    const lock = STICK_PX * (this.scale || 1);
    const dx = Math.max(-lock, Math.min(lock, e.clientX - this.stickX0));
    this.knobEl.style.setProperty('--dx', `${dx}px`);
    this.lx = dx / lock;
    this.sendPad();
  }

  private stickUp(): void {
    this.stickFinger = -1;
    this.baseEl.classList.remove('on');
    this.baseEl.style.left = this.baseEl.style.top = '';
    this.knobEl.style.removeProperty('--dx');
    if (this.steering === 'stick') {
      this.lx = 0;
      this.setSteerKey('');
      this.steerAcc = 0;
    }
  }

  // ---- tilt ----------------------------------------------------------------
  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    this.tiltHeard = true;
    const r = rollOf(e.beta, e.gamma, typeof screen !== 'undefined' ? (screen.orientation?.angle ?? 0) : 0);
    if (r === null) return;
    this.lastRoll = r;
    if (this.center === null) this.center = r;
    let d = r - this.center;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    const max = LEVEL_MAX_DEG * Math.PI / 180;
    this.tilt = Math.max(-max, Math.min(max, d));
    const v = Math.max(-1, Math.min(1, d / (TILT_DEG * Math.PI / 180)));
    this.lx = this.lx * 0.4 + v * 0.6;
    this.sendPad();
  };

  private tiltOn(): void {
    removeEventListener('deviceorientation', this.onOrient);
    addEventListener('deviceorientation', this.onOrient);
    this.tiltHeard = false;
    clearTimeout(this.tiltCheck);
    this.tiltCheck = setTimeout(() => {
      if (!this.tiltHeard && this.mode === 'drive' && this.steering === 'tilt') {
        this.deps.toast('Tilt has no motion sensor to read in this browser. The steering button (top right) switches to buttons.', 6000);
      }
    }, 2000) as unknown as number;
  }

  private tiltOff(): void {
    removeEventListener('deviceorientation', this.onOrient);
    clearTimeout(this.tiltCheck);
  }

  private recenter(): void {
    this.center = this.lastRoll;
    this.deps.toast('Straight ahead is where the phone is now.', 2000);
  }

  // ---- steering button -----------------------------------------------------
  private nextSteering(): void {
    const to = STEERING[(STEERING.indexOf(this.steering) + 1) % STEERING.length];
    if (to === 'tilt') {
      void askMotion().then(ok => {
        if (!ok) this.deps.toast('Tilt needs the motion sensor, which was not allowed.', 5000);
      });
    }
    setSteering(to);
    this.deps.toast(
      to === 'tilt'
        ? 'Steering: tilt. Hold the phone like a wheel; the button beside this one sets straight ahead.'
        : `Steering: ${NAMES[to]}`,
      to === 'tilt' ? 5000 : 2000,
    );
  }

  private applySteering(to: Steering): void {
    if (to === this.steering) return;
    for (const c of this.ctls.values()) if (c.group) { c.fingers.clear(); this.up(c, true); }
    this.setSteerKey('');
    this.steerAcc = 0;
    this.stickUp();
    this.tiltOff();
    this.steering = to;
    this.lx = 0;
    if (to === 'tilt') this.center = null;
    this.root.dataset.steering = to;
    this.ctls.get('mode')!.el.innerHTML = svg(ICONS[to]);
    if (this.mode === 'drive') {
      if (to === 'tilt') this.tiltOn();
      this.sendPad();
    }
    this.deps.log(`[app] touch controls: steering with ${NAMES[to]}`);
  }

  // ---- size ----------------------------------------------------------------
  private applySize(): void {
    const s = touchSize.scale();
    if (s === this.scale) return;
    const was = this.scale;
    this.scale = s;
    this.stage.style.setProperty('--ts', String(s));
    if (was) this.deps.log(`[app] touch controls: size ${Math.round(s * 100)} %${touchSize.get() === 'auto' ? ' (auto)' : ''}`);
  }
}

let touchSettingsId = 0;

/** Mount Touch Controls settings (Steering mode & Touch controls size) inside the Controls panel or dialog. */
export function mountTouchSettings(root: HTMLElement | null): void {
  if (!root) return;
  const uid = `nfsu1-touch-ui-${++touchSettingsId}`;
  root.replaceChildren();
  const group = document.createElement('div');
  group.className = 'group';

  const heading = document.createElement('h3');
  heading.textContent = 'Touch controls';
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'Shown automatically when you touch the screen on a phone or tablet. In menus, tap items directly, drag with two fingers to turn the car, or use the D-pad, Back, OK and Keyboard buttons.';

  // Active controls mode row (Auto / Driving / Menu)
  const modeRow = document.createElement('div');
  modeRow.className = 'set';
  const modeLabel = document.createElement('span');
  modeLabel.className = 'set-label';
  modeLabel.textContent = 'Controls';
  const modeHelp = document.createElement('span');
  modeHelp.className = 'set-help';
  const modeCtl = document.createElement('div');
  modeCtl.className = 'set-control';
  const modeSeg = document.createElement('div');
  modeSeg.className = 'seg';
  modeSeg.setAttribute('role', 'radiogroup');
  modeSeg.setAttribute('aria-label', 'Controls mode');
  for (const [val, text, help] of [
    ['auto', 'Auto', 'Switch automatically (driving controls in race, menu in menus).'],
    ['drive', 'Driving', 'Force driving pedals and steering on screen.'],
    ['menu', 'Menu', 'Force menu D-pad, Back and OK buttons on screen.'],
  ] as const) {
    const opt = document.createElement('label');
    opt.className = 'opt';
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = `${uid}-mode`;
    inp.value = val;
    inp.checked = val === 'auto' ? forcedMode === null : forcedMode === val;
    inp.addEventListener('change', () => {
      setForcedMode(val === 'auto' ? null : (val as Mode));
      modeHelp.textContent = help;
    });
    if (inp.checked) modeHelp.textContent = help;
    const txt = document.createElement('span');
    txt.textContent = text;
    opt.append(inp, txt);
    modeSeg.append(opt);
  }
  modeCtl.append(modeSeg);
  modeRow.append(modeLabel, modeCtl, modeHelp);

  // Gears setting row (Auto-detect / Manual (Show) / Automatic (Hide))
  const gearsRow = document.createElement('div');
  gearsRow.className = 'set';
  const gearsLabel = document.createElement('span');
  gearsLabel.className = 'set-label';
  gearsLabel.textContent = 'Gears';
  const gearsHelp = document.createElement('span');
  gearsHelp.className = 'set-help';
  const gearsCtl = document.createElement('div');
  gearsCtl.className = 'set-control';
  const gearsSeg = document.createElement('div');
  gearsSeg.className = 'seg';
  gearsSeg.setAttribute('role', 'radiogroup');
  gearsSeg.setAttribute('aria-label', 'Gears mode');
  for (const [val, text, help] of [
    ['auto', 'Auto', 'Detect transmission automatically (hide for automatic, show for manual/drag).'],
    ['show', 'Show', 'Always show Shift Up / Down buttons while driving.'],
    ['hide', 'Hide', 'Always hide Shift Up / Down buttons.'],
  ] as const) {
    const opt = document.createElement('label');
    opt.className = 'opt';
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = `${uid}-gears`;
    inp.value = val;
    inp.checked = gearsSetting === val;
    inp.addEventListener('change', () => {
      setGears(val as GearsOpt);
      gearsHelp.textContent = help;
    });
    if (inp.checked) gearsHelp.textContent = help;
    const txt = document.createElement('span');
    txt.textContent = text;
    opt.append(inp, txt);
    gearsSeg.append(opt);
  }
  gearsCtl.append(gearsSeg);
  gearsRow.append(gearsLabel, gearsCtl, gearsHelp);

  group.append(heading, note, modeRow, gearsRow);

  // Steering mode row
  const steerRow = document.createElement('div');
  steerRow.className = 'set';
  const steerLabel = document.createElement('span');
  steerLabel.className = 'set-label';
  steerLabel.textContent = 'Steering';
  const steerHelp = document.createElement('span');
  steerHelp.className = 'set-help';
  steerHelp.textContent = 'Buttons, virtual thumb stick, or tilt the device like a wheel (can also be switched top-right while driving).';
  const steerCtl = document.createElement('div');
  steerCtl.className = 'set-control';
  const steerSeg = document.createElement('div');
  steerSeg.className = 'seg';
  steerSeg.setAttribute('role', 'radiogroup');
  steerSeg.setAttribute('aria-label', 'Touch steering');
  const steerInputs = new Map<Steering, HTMLInputElement>();
  for (const mode of STEERING) {
    const opt = document.createElement('label');
    opt.className = 'opt';
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = `${uid}-steer`;
    inp.value = mode;
    inp.checked = steering() === mode;
    inp.onchange = () => {
      if (!inp.checked) return;
      if (mode === 'tilt') void askMotion();
      setSteering(mode);
    };
    steerInputs.set(mode, inp);
    opt.append(inp, steeringName(mode));
    steerSeg.append(opt);
  }
  onSteering(() => {
    const cur = steering();
    for (const [m, inp] of steerInputs) inp.checked = m === cur;
  });
  steerCtl.append(steerSeg);
  steerRow.append(steerLabel, steerHelp, steerCtl);

  // Touch controls size row
  const sizeRow = document.createElement('div');
  sizeRow.className = 'set';
  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'set-label';
  sizeLabel.textContent = 'Touch controls size';
  const sizeHelp = document.createElement('span');
  sizeHelp.className = 'set-help';
  sizeHelp.textContent = 'Size of the on-screen driving, menu and top-left Menu buttons.';
  const sizeCtl = document.createElement('div');
  sizeCtl.className = 'set-control';
  const sizeSeg = document.createElement('div');
  sizeSeg.className = 'seg';
  sizeSeg.setAttribute('role', 'radiogroup');
  sizeSeg.setAttribute('aria-label', 'Touch controls size');

  const renderSizes = () => {
    sizeSeg.replaceChildren();
    const cur = touchSize.get();
    for (const s of touchSize.sizes) {
      const opt = document.createElement('label');
      opt.className = 'opt';
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = `${uid}-size`;
      inp.value = String(s);
      inp.checked = s === cur;
      inp.onchange = () => {
        if (inp.checked) touchSize.set(s);
      };
      opt.append(inp, touchSize.name(s));
      sizeSeg.append(opt);
    }
  };
  touchSize.on(renderSizes);
  renderSizes();
  sizeCtl.append(sizeSeg);
  sizeRow.append(sizeLabel, sizeHelp, sizeCtl);

  group.append(steerRow, sizeRow);
  root.append(group);
}

