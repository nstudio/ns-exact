import { defineModule, exact } from 'nativescript-exact';


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

// The picker and this formatter must share a zone: a day is midnight of that zone, so a mismatch shifts it.
const utc = NSTimeZone.timeZoneForSecondsFromGMT(0);
const days = NSDateFormatter.new();
days.dateFormat = 'yyyy-MM-dd';
days.timeZone = utc;
// Without a POSIX locale, a device's own calendar and numerals change what yyyy-MM-dd reads and writes.
days.locale = NSLocale.localeWithLocaleIdentifier('en_US_POSIX');

let buzzes = 0;

NSNotificationCenter.defaultCenter.addObserverForNameObjectQueueUsingBlock(
  UIScreenBrightnessDidChangeNotification,
  null,
  NSOperationQueue.mainQueue,
  () => exact.changed('brightness'),
);

defineModule({
  call(request) {
    if (request.op === 'brightness') {
      const screen = UIApplication.sharedApplication.connectedScenes.anyObject().screen;
      return { percent: Math.round(screen.brightness * 100) };
    }
    if (request.op === 'device') {
      const device = UIDevice.currentDevice;
      device.batteryMonitoringEnabled = true;
      return { name: device.name, system: `${device.systemName} ${device.systemVersion}`, battery: device.batteryLevel };
    }
    throw new Error(`no call ${request.op}`);
  },

  later(request, reply) {
    if (request.op === 'buzz') {
      UIImpactFeedbackGenerator.alloc().initWithStyle(UIImpactFeedbackStyle.Medium).impactOccurred();
      return reply.send({ count: ++buzzes });
    }
    if (request.op !== 'geocode') return reply.fail(`no later ${request.op}`);
    const search = MKGeocodingRequest.alloc().initWithAddressString(request.address);
    search.getMapItemsWithCompletionHandler((items: any, error: any) => {
      if (error) return reply.fail(error.localizedDescription);
      const item = items?.objectAtIndex(0);
      reply.send({ city: item?.addressRepresentations?.cityName ?? '', country: item?.addressRepresentations?.regionName ?? '' });
    });
  },

  views: {
    'date-field': (props, events) => {
      const picker = UIDatePicker.new();
      picker.datePickerMode = UIDatePickerMode.Date;
      picker.preferredDatePickerStyle = UIDatePickerStyle.Compact;
      picker.timeZone = utc;
      let shown: string | undefined;
      const show = (day: string | undefined) => {
        if (day === shown) return;
        shown = day;
        const date = day ? days.dateFromString(day) : null;
        if (date) picker.date = date;
      };
      show(props.date);
      const action = target((p) => {
        shown = days.stringFromDate(p.date);
        events.message(shown);
      });
      picker.addTargetActionForControlEvents(action, 'fire', UIControlEvents.ValueChanged);
      picker.sizeToFit();
      events.intrinsicSize(picker.frame.size.width, picker.frame.size.height);
      events.message(days.stringFromDate(picker.date));
      return {
        view: picker,
        setProps(next) { show(next.date); },
        destroy() { picker.removeTargetActionForControlEvents(action, 'fire', UIControlEvents.ValueChanged); },
      };
    },
    'ns-slider': (props, events) => {
      const slider = UISlider.new();
      slider.minimumValue = 0;
      slider.maximumValue = 100;
      slider.minimumTrackTintColor = UIColor.systemPinkColor;
      slider.value = Number(props.level ?? 0);
      const action = target((s) => events.message(String(Math.round(s.value))));
      slider.addTargetActionForControlEvents(action, 'fire', UIControlEvents.ValueChanged);
      events.intrinsicSize(240, 44);
      return {
        view: slider,
        setProps(next) { if (!slider.tracking) slider.value = Number(next.level ?? 0); },
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
        console.log(`card hatch ready at ${exact.now()}`);
      },
    },
  },
});
