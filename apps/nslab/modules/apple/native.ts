import { defineModule } from 'nativescript-exact';

function target(handler: (sender: any) => void) {
  return ControlTarget.alloc().init().bind(handler);
}

const ControlTarget = NSObject.extend(
  {
    bind(handler: (sender: any) => void) { this._handler = handler; return this; },
    fire(sender: any) { this._handler(sender); },
  },
  { name: 'NSXControlTarget', exposedMethods: { fire: { returns: interop.types.void, params: [interop.types.id] } } },
);

// A function of the session, so each embedded session gets its own module, as a Swift module's
// `context` is its own; native callbacks then reach the right one.
defineModule((session) => ({
  call(request) {
    if (request.op === 'device') {
      const device = UIDevice.currentDevice;
      device.batteryMonitoringEnabled = true;
      return { name: device.name, system: `${device.systemName} ${device.systemVersion}`, battery: device.batteryLevel };
    }
    throw new Error(`no call ${request.op}`);
  },

  later(request, reply) {
    if (request.op !== 'geocode') return reply.fail(`no later ${request.op}`);
    const search = MKGeocodingRequest.alloc().initWithAddressString(request.address);
    const span = session.diagnostics.begin('geocode'), started = Date.now();
    search.getMapItemsWithCompletionHandler((items: any, error: any) => {
      span.end();
      session.diagnostics.measure('geocode.wall', Date.now() - started);
      if (error) return reply.fail(error.localizedDescription);
      const item = items?.objectAtIndex(0) as MKMapItem;
      reply.send({ city: item?.addressRepresentations?.cityName ?? '', country: item?.addressRepresentations?.regionName ?? '' });
    });
  },

  views: {
    'ns-slider': (props, events) => {
      const slider = UISlider.new();
      slider.minimumValue = 0;
      slider.maximumValue = 100;
      slider.minimumTrackTintColor = UIColor.systemPinkColor;
      slider.value = Number(props.level ?? 0);
      const moved = () => {
        const level = Math.round(slider.value);
        session.diagnostics.count('slider.change');
        session.diagnostics.publish('slider', { level });
        events.message(String(level));
      };
      const action = target(moved);
      slider.addTargetActionForControlEvents(action, 'fire', UIControlEvents.ValueChanged);
      events.intrinsicSize(240, 44);
      return {
        view: slider,
        setProps(next) { if (!slider.tracking) slider.value = Number(next.level ?? 0); },
        agentInput(input) {
          const value = 'text' in input ? Number(input.text) : NaN;
          if (!Number.isFinite(value)) throw new Error('the slider takes a number from 0 to 100');
          slider.value = value;
          moved();
        },
        destroy() { slider.removeTargetActionForControlEvents(action, 'fire', UIControlEvents.ValueChanged); },
      };
    },
  },

  hatches: {
    card: {
      element(el) {
        if (!el.isNew) return;
        const bar = UIView.alloc().initWithFrame(CGRectMake(0, 0, 6, el.view.bounds.size.height));
        bar.backgroundColor = UIColor.systemPinkColor;
        bar.autoresizingMask = UIViewAutoresizing.FlexibleHeight;
        el.view.addSubview(bar);
        console.log(`card hatch ready at ${session.now()}`);
      },
    },
  },
}));
