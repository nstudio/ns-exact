import { defineModule } from 'nativescript-exact';

const ControlTarget = NSObject.extend(
  {
    bind(handler: (sender: any) => void) { this._handler = handler; return this; },
    fire(sender: any) { this._handler(sender); },
  },
  { name: 'NSXControlTarget', exposedMethods: { fire: { returns: interop.types.void, params: [interop.types.id] } } },
);

defineModule((session) => ({
  call(request) {
    if (request.op === 'host') {
      const info = NSProcessInfo.processInfo;
      return { name: info.processName, system: info.operatingSystemVersionString, memory: Math.round(info.physicalMemory / 2 ** 30) };
    }
    throw new Error(`no call ${request.op}`);
  },

  later(request, reply) {
    if (request.op !== 'wait') return reply.fail(`no later ${request.op}`);
    const started = session.now();
    session.after(request.ms, () => reply.send({ after: Math.round(session.now() - started) }));
  },

  views: {
    'ns-slider': (props, events) => {
      const slider = NSSlider.sliderWithValueMinValueMaxValueTargetAction(Number(props.level ?? 0), 0, 100, null, null);
      const moved = () => {
        const level = Math.round(slider.doubleValue);
        session.diagnostics.count('slider.change');
        session.diagnostics.publish('slider', { level });
        events.message(String(level));
      };
      const action = ControlTarget.alloc().init().bind(moved);
      slider.target = action;
      slider.action = 'fire';
      events.intrinsicSize(240, 28);
      return {
        view: slider,
        setProps(next) { slider.doubleValue = Number(next.level ?? 0); },
        agentInput(input) {
          const value = 'text' in input ? Number(input.text) : NaN;
          if (!Number.isFinite(value)) throw new Error('the slider takes a number from 0 to 100');
          slider.doubleValue = value;
          moved();
        },
        destroy() { slider.target = null; },
      };
    },
  },
}));
