// The module's side of the seam. scripts/nsx.mjs bundles this with the app's
// modules/apple/native.ts into one bytecode file.

export type Json = any;

export interface ExactEvents {
  press(): void;
  change(value: string): void;
  load(): void;
  message(text: string): void;
  intrinsicSize(width: number, height: number): void;
}

export interface ViewInstance {
  view: any;
  setProps?(props: Record<string, string>): void;
  destroy?(): void;
}

export interface ExactElementHandle {
  word: string;
  id: string;
  isNew: boolean;
  data: Record<string, string>;
  view: any;
  platform: any;
  click(): void;
  focus(): void;
  blur(): void;
  input(text: string): void;
}

export interface Reply {
  send(value: Json): void;
  fail(message: string): void;
}

export interface NativeModule {
  call?(request: Json): Json;
  later?(request: Json, reply: Reply): void | Promise<Json | void>;
  views?: Record<string, (props: Record<string, string>, events: ExactEvents) => ViewInstance>;
  hatches?: Record<string, { element?(el: ExactElementHandle): void; ended?(el: ExactElementHandle): void }>;
}

declare const __nsxHost: {
  log(line: string): void;
  changed(topic: string): void;
  now(): number;
  frames(token: number, start: boolean): void;
  after(token: number, ms: number): void;
  cancelAfter(token: number): void;
  reply(token: number, status: number, body: string): void;
  event(view: number, kind: number, text: string): void;
  act(element: number, action: string, text: string): void;
};

const host = __nsxHost;

const describe = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};
const logger = (...args: unknown[]) => host.log(args.map(describe).join(' '));
(globalThis as any).console = { log: logger, info: logger, warn: logger, error: logger, debug: logger };

let current: NativeModule = {};
const instances = new Map<number, ViewInstance>();
const handles = new Map<number, ExactElementHandle>();
const tickers = new Map<number, (frame: { now: number; seq: number }) => void>();
const waits = new Map<number, () => void>();
let nextToken = 1;

/** The session's clock: use it instead of CADisplayLink and NSTimer so the agent's `clock` moves your code. */
export const exact = {
  now: () => host.now(),
  changed: (topic: string) => host.changed(topic),
  frames(body: (frame: { now: number; seq: number }) => void) {
    const token = nextToken++;
    tickers.set(token, body);
    host.frames(token, true);
    return { stop() { if (tickers.delete(token)) host.frames(token, false); } };
  },
  after(ms: number, body: () => void) {
    const token = nextToken++;
    waits.set(token, body);
    host.after(token, ms);
    return { stop() { if (waits.delete(token)) host.cancelAfter(token); } };
  },
};

export function defineModule(module: NativeModule) {
  current = module;
}

const eventsFor = (view: number): ExactEvents => ({
  press: () => host.event(view, 0, ''),
  change: (value) => host.event(view, 1, value),
  load: () => host.event(view, 7, ''),
  message: (text) => host.event(view, 8, text),
  intrinsicSize: (width, height) => host.event(view, 9, `${width},${height}`),
});

(globalThis as any).__nsx = {
  call(request: string) {
    if (!current.call) throw new Error('this module answers no native.call');
    return JSON.stringify(current.call(JSON.parse(request)) ?? {});
  },
  later(request: string, token: number) {
    let settled = false;
    const reply: Reply = {
      send(value) { if (!settled) { settled = true; host.reply(token, 200, JSON.stringify(value ?? {})); } },
      fail(message) { if (!settled) { settled = true; host.reply(token, 500, message); } },
    };
    try {
      if (!current.later) throw new Error('this module answers no native.later');
      const result = current.later(JSON.parse(request), reply);
      if (result && typeof (result as Promise<Json>).then === 'function') {
        (result as Promise<Json>).then((value) => { if (value !== undefined) reply.send(value); }, (e) => reply.fail(describe(e)));
      }
    } catch (e) {
      reply.fail(describe(e));
    }
  },
  viewCreate(view: number, tag: string, props: string) {
    const factory = current.views?.[tag];
    if (!factory) throw new Error(`this module makes no <${tag}>`);
    const instance = factory(JSON.parse(props), eventsFor(view));
    instances.set(view, instance);
    return instance.view;
  },
  viewSetProps(view: number, props: string) {
    instances.get(view)?.setProps?.(JSON.parse(props));
  },
  viewDestroy(view: number) {
    instances.get(view)?.destroy?.();
    instances.delete(view);
  },
  element(phase: string, token: number, info: string, view: any, platform: any) {
    const parsed = JSON.parse(info);
    const handle: ExactElementHandle = {
      ...parsed,
      view,
      platform,
      click: () => host.act(token, 'click', ''),
      focus: () => host.act(token, 'focus', ''),
      blur: () => host.act(token, 'blur', ''),
      input: (text) => host.act(token, 'input', text),
    };
    const hatch = current.hatches?.[handle.word];
    if (phase === 'ended') {
      hatch?.ended?.(handle);
      handles.delete(token);
    } else {
      handles.set(token, handle);
      hatch?.element?.(handle);
    }
  },
  tick(token: number, now: number, seq: number) { tickers.get(token)?.({ now, seq }); },
  fireAfter(token: number) {
    const body = waits.get(token);
    waits.delete(token);
    body?.();
  },
};
