// The modules' side of the seam. scripts/nsx.mjs bundles this with the app's
// modules/apple/native.ts and each NativeScript package's apple/native.ts into one bytecode file.

export type Json = any;

export interface ExactEvents {
  press(): void;
  change(value: string): void;
  load(): void;
  message(text: string): void;
  intrinsicSize(width: number, height: number): void;
}

/** What the agent's `type` sends a view: replace its value with `text`, or press `key` (a web key name). */
export type AgentInput = { text: string } | { key: string; phase?: 'down' | 'up' };

export interface ViewInstance {
  view: any;
  setProps?(props: Record<string, string>): void;
  /** Throw before changing anything for input the view does not take. Only an app module's views get it. */
  agentInput?(input: AgentInput): void;
  destroy?(): void;
}

export type ViewFactory = (props: Record<string, string>, events: ExactEvents) => ViewInstance;

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

/** The app's own native module: what `native.call` and `native.later` in app.ts reach. */
export interface NativeModule {
  call?(request: Json): Json;
  later?(request: Json, reply: Reply): void | Promise<Json | void>;
  views?: Record<string, ViewFactory>;
  hatches?: Record<string, { element?(el: ExactElementHandle): void; ended?(el: ExactElementHandle): void }>;
}

/**
 * A package's implementation: one handler per name its exact.json declares. A handler returns
 * the answer or a Promise of it; one that throws answers `{error}` with the error's `name`
 * (a DOMException name such as `NotSupportedError`), or `OperationError`.
 */
export interface NativePackage {
  names?: Record<string, (args: Record<string, Json>) => Json | Promise<Json>>;
  views?: Record<string, ViewFactory>;
}

declare const __nsxHost: {
  log(client: number, line: string): void;
  changed(client: number, topic: string): void;
  now(client: number): number;
  frames(client: number, token: number, start: boolean): void;
  after(client: number, token: number, ms: number): void;
  cancelAfter(client: number, token: number): void;
  reply(client: number, token: number, status: number, body: string): void;
  event(client: number, view: number, kind: number, text: string): void;
  act(client: number, element: number, action: string, text: string): void;
  diag(client: number, kind: number, name: string, value: number, text: string): number;
};

declare global {
  var console: Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...args: unknown[]) => void>;
}

const host = __nsxHost;

type Definition<T> = T | ((session: Session) => T);
type Client = {
  module: string;
  instances: Map<number, ViewInstance>;
  tickers: Map<number, (f: { now: number; seq: number }) => void>;
  waits: Map<number, () => void>;
  session: Session;
  made?: { from: Definition<NativeModule | NativePackage>; impl: NativeModule | NativePackage };
};

// Kept across a development reload, which evaluates the bundle again: attached clients and
// their live views stay, and only the definitions are replaced.
const state: { clients: Map<number, Client>; modules: Map<string, Definition<NativeModule | NativePackage>>; current: number; depth: number; nextToken: number } =
  (globalThis as any).__nsxState ??= { clients: new Map(), modules: new Map(), current: 0, depth: 0, nextToken: 1 };
state.depth ??= 0;

const describe = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};
const logger = (...args: unknown[]) => host.log(state.current || [...state.clients.keys()][0] || 0, args.map(describe).join(' '));
globalThis.console = { log: logger, info: logger, warn: logger, error: logger, debug: logger };

/** One session's side of Exact, as a Swift module's `context`. */
/**
 * When the newest source file of this bundle was saved and when nsx.mjs built it, in ms since the epoch
 * on the Mac that built it; a phone's clock may differ from it by its own clock's error.
 */
export function bundleStamp(): { saved: number; built: number } {
  return (globalThis as any).__nsxBundle ?? { saved: 0, built: 0 };
}

export interface Session {
  /** True under the agent: keep nothing ticking forever (an endless `frames`), or its clock never settles. */
  readonly agent: boolean;
  /** The session's clock: use it instead of CADisplayLink and NSTimer so the agent's `clock` moves your code. */
  now(): number;
  changed(topic: string): void;
  frames(body: (frame: { now: number; seq: number }) => void): { stop(): void };
  after(ms: number, body: () => void): { stop(): void };
  /**
   * What the module says of itself, as Swift's `context.diagnostics`: `agent state` shows counters
   * and snapshots under `hatches`, `perf hatches` the timings. Development builds only; a package's
   * calls keep nothing. Names are lowercase letters, digits, `-` and `.`.
   */
  diagnostics: {
    count(name: string, by?: number): void;
    measure(name: string, ms: number): void;
    /** A span on the session clock; `end()` once closes it. */
    begin(name: string): { end(): void };
    /** The latest snapshot is kept; one over 4 KB of JSON is refused. */
    publish(name: string, value: Json): void;
  };
}

const sessionOf = (who: () => number, agent = false): Session => ({
  agent,
  now: () => host.now(who()),
  changed: (topic) => host.changed(who(), topic),
  frames(body) {
    const client = who(), token = state.nextToken++;
    state.clients.get(client)?.tickers.set(token, body);
    host.frames(client, token, true);
    return { stop() { if (state.clients.get(client)?.tickers.delete(token)) host.frames(client, token, false); } };
  },
  after(ms, body) {
    const client = who(), token = state.nextToken++;
    state.clients.get(client)?.waits.set(token, body);
    host.after(client, token, ms);
    return { stop() { if (state.clients.get(client)?.waits.delete(token)) host.cancelAfter(client, token); } };
  },
  diagnostics: {
    count: (name, by = 1) => { host.diag(who(), 1, name, by, ''); },
    measure: (name, ms) => { host.diag(who(), 2, name, ms, ''); },
    begin(name) {
      const client = who(), token = host.diag(client, 3, name, 0, '');
      return { end() { if (token) host.diag(client, 4, '', token, ''); } };
    },
    publish: (name, value) => { host.diag(who(), 5, name, 0, JSON.stringify(value) ?? 'null'); },
  },
});

// A native callback (a target-action, a completion handler, a promise continuation) runs outside
// any call from Swift, so only one attached session can be meant.
const running = () => {
  if (state.depth > 0) return state.current;
  if (state.clients.size === 1) return state.clients.keys().next().value!;
  throw new Error(`exact ran outside a call from Exact with ${state.clients.size} sessions attached, so it cannot tell whose; ` +
    'define the module as a function of its session, defineModule((session) => ({ ... })), and use session there');
}

/** The session whose call is running. In native callbacks, use the session a module definition takes. */
export const exact: Session = sessionOf(running);

/** The app's module: an object, or a function of each session's `Session` that makes its own. */
export function defineModule(module: Definition<NativeModule>) {
  state.modules.set('app', module);
}

/** A package's apple/native.ts: `export default definePackage({...})`; nsx.mjs registers it under the package's name. */
export function definePackage(pkg: Definition<NativePackage>): Definition<NativePackage> {
  return pkg;
}

export function __register(name: string, pkg: Definition<NativePackage>) {
  state.modules.set(name, pkg);
}

const eventsFor = (client: number, view: number): ExactEvents => ({
  press: () => host.event(client, view, 0, ''),
  change: (value) => host.event(client, view, 1, value),
  load: () => host.event(client, view, 7, ''),
  message: (text) => host.event(client, view, 8, text),
  intrinsicSize: (width, height) => host.event(client, view, 9, `${width},${height}`),
});

const clientOf = (client: number) => {
  const found = state.clients.get(client);
  if (!found) throw new Error(`no NativeScript client ${client}`);
  return found;
};
// A function definition is made once per session, and again after a reload replaces it.
const definition = (c: Client): NativeModule | NativePackage => {
  const from = state.modules.get(c.module) ?? {};
  if (c.made?.from !== from) c.made = { from, impl: typeof from === 'function' ? from(c.session) : from };
  return c.made.impl;
};
const isPackage = (c: Client) => c.module !== 'app';

// A package's answer, as ExactPackage replies take it: an object as is, anything else under `exact:answer`.
const packageReply = (value: Json) =>
  value === undefined ? {} : value !== null && typeof value === 'object' && !Array.isArray(value) ? value : { 'exact:answer': value };
const packageError = (e: unknown) => ({ error: e instanceof Error && e.name !== 'Error' ? e.name : 'OperationError', message: describe(e) });

const handlerFor = (c: Client, name: string) => {
  const handler = (definition(c) as NativePackage).names?.[name];
  if (!handler) throw Object.assign(new Error(`${c.module} answers no ${name}`), { name: 'NotSupportedError' });
  return handler;
};

const seam: Record<string, (client: number, ...rest: any[]) => unknown> = {
  attach(client: number, module: string, agent = false) {
    if (!state.modules.has(module)) throw new Error(`no NativeScript module ${module} is defined; is it in the bundle nsx.mjs built?`);
    const c: Client = { module, instances: new Map(), tickers: new Map(), waits: new Map(), session: sessionOf(() => client, agent) };
    state.clients.set(client, c);
    try {
      definition(c);
    } catch (e) {
      state.clients.delete(client);
      throw e;
    }
  },
  detach(client: number) {
    const c = state.clients.get(client);
    c?.instances.forEach((i) => i.destroy?.());
    state.clients.delete(client);
  },
  call(client: number, request: string) {
    const c = clientOf(client), parsed = JSON.parse(request);
    if (isPackage(c)) {
      try {
        const value = handlerFor(c, parsed.name)(parsed.args ?? {});
        if (value && typeof value.then === 'function') throw new Error(`${parsed.name} answered a Promise; a synchronous call must answer now`);
        return JSON.stringify(packageReply(value));
      } catch (e) {
        return JSON.stringify(packageError(e));
      }
    }
    const module = definition(c) as NativeModule;
    if (!module.call) throw new Error('this module answers no native.call');
    return JSON.stringify(module.call(parsed) ?? {});
  },
  later(client: number, request: string, token: number) {
    const c = clientOf(client), parsed = JSON.parse(request);
    let settled = false;
    const reply: Reply = {
      send(value) { if (!settled) { settled = true; host.reply(client, token, 200, JSON.stringify(isPackage(c) ? packageReply(value) : value ?? {})); } },
      fail(message) {
        if (settled) return;
        settled = true;
        if (isPackage(c)) host.reply(client, token, 200, JSON.stringify(packageError(message)));
        else host.reply(client, token, 500, message);
      },
    };
    const failed = (e: unknown) => (isPackage(c) ? (settled = true, host.reply(client, token, 200, JSON.stringify(packageError(e)))) : reply.fail(describe(e)));
    try {
      const result = isPackage(c) ? handlerFor(c, parsed.name)(parsed.args ?? {}) : (() => {
        const module = definition(c) as NativeModule;
        if (!module.later) throw new Error('this module answers no native.later');
        return module.later(parsed, reply);
      })();
      if (result && typeof (result as Promise<Json>).then === 'function') {
        (result as Promise<Json>).then((value) => { if (value !== undefined || isPackage(c)) reply.send(value); }, failed);
      } else if (isPackage(c)) {
        reply.send(result);
      }
    } catch (e) {
      failed(e);
    }
  },
  viewCreate(client: number, view: number, tag: string, props: string) {
    const c = clientOf(client), factory = definition(c).views?.[tag];
    if (!factory) throw new Error(`${c.module} makes no <${tag}>`);
    const instance = factory(JSON.parse(props), eventsFor(client, view));
    c.instances.set(view, instance);
    return instance.view;
  },
  viewSetProps(client: number, view: number, props: string) {
    clientOf(client).instances.get(view)?.setProps?.(JSON.parse(props));
  },
  viewInput(client: number, view: number, kind: string, text: string, phase: string) {
    const c = clientOf(client), instance = c.instances.get(view);
    if (!instance?.agentInput) throw new Error(`this ${c.module} view takes no agent input`);
    instance.agentInput(kind === 'text' ? { text } : { key: text, ...(phase ? { phase: phase as 'down' | 'up' } : {}) });
  },
  viewDestroy(client: number, view: number) {
    const c = clientOf(client);
    c.instances.get(view)?.destroy?.();
    c.instances.delete(view);
  },
  element(client: number, phase: string, token: number, info: string, view: any, platform: any) {
    const c = clientOf(client), parsed = JSON.parse(info);
    const handle: ExactElementHandle = {
      ...parsed,
      view,
      platform,
      click: () => host.act(client, token, 'click', ''),
      focus: () => host.act(client, token, 'focus', ''),
      blur: () => host.act(client, token, 'blur', ''),
      input: (text) => host.act(client, token, 'input', text),
    };
    const hatch = (definition(c) as NativeModule).hatches?.[handle.word];
    if (phase === 'ended') hatch?.ended?.(handle);
    else hatch?.element?.(handle);
  },
  tick(client: number, token: number, now: number, seq: number) { clientOf(client).tickers.get(token)?.({ now, seq }); },
  fireAfter(client: number, token: number) {
    const c = clientOf(client), body = c.waits.get(token);
    c.waits.delete(token);
    body?.();
  },
};

(globalThis as any).__nsx = Object.fromEntries(Object.entries(seam).map(([name, fn]) => [name, (client: number, ...rest: any[]) => {
  const previous = state.current;
  state.current = client;
  state.depth++;
  try {
    return fn(client, ...rest);
  } finally {
    state.depth--;
    state.current = previous;
  }
}]));
// A deadline that passes inside a native call leaves Hermes' timeout pending until bytecode next
// checks for it, at any function's entry: the seam enters this one to raise it on the entry that overran.
(globalThis as any).__nsx.breakCheck = () => {};
