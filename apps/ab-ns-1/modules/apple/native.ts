import { defineModule, exact } from 'nativescript-exact';

declare const UIDevice: any, UIColor: any, UISlider: any, UIControlEvents: any, NSObject: any, interop: any;
declare const MKGeocodingRequest: any, UIView: any, UIViewAutoresizing: any, CGRectMake: any;
declare const UIScreen: any, UIDatePicker: any, UIDatePickerMode: any, UIDatePickerStyle: any;
declare const UIImpactFeedbackGenerator: any, UIImpactFeedbackStyle: any;
declare const NSDateFormatter: any, NSLocale: any, NSTimeZone: any;

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

// The picker and the formatter must share a zone, or a day parsed here shows as a neighbouring day there.
const utc = NSTimeZone.timeZoneForSecondsFromGMT(0);
const dayFormat = NSDateFormatter.new();
dayFormat.locale = NSLocale.localeWithLocaleIdentifier('en_US_POSIX');
dayFormat.timeZone = utc;
dayFormat.dateFormat = 'yyyy-MM-dd';

let buzzes = 0;

defineModule({
  call(request) {
    if (request.op === 'device') {
      const device = UIDevice.currentDevice;
      device.batteryMonitoringEnabled = true;
      return { name: device.name, system: `${device.systemName} ${device.systemVersion}`, battery: device.batteryLevel };
    }
    if (request.op === 'brightness') return { percent: Math.round(UIScreen.mainScreen.brightness * 100) };
    throw new Error(`no call ${request.op}`);
  },

  later(request, reply) {
    if (request.op === 'buzz') {
      UIImpactFeedbackGenerator.alloc().initWithStyle(UIImpactFeedbackStyle.Medium).impactOccurred();
      buzzes += 1;
      return reply.send({ count: buzzes });
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
    'date-field': (props, events) => {
      const picker = UIDatePicker.new();
      picker.datePickerMode = UIDatePickerMode.Date;
      picker.preferredDatePickerStyle = UIDatePickerStyle.Compact;
      picker.timeZone = utc;
      const show = (day: string | undefined) => {
        const date = day ? dayFormat.dateFromString(day) : null;
        if (date && dayFormat.stringFromDate(picker.date) !== day) picker.date = date;
      };
      const report = () => {
        // intrinsicContentSize is -1 by -1 on a compact picker, and the width follows the date's text.
        const size = picker.sizeThatFits({ width: 0, height: 0 });
        events.intrinsicSize(size.width, size.height);
        events.message(dayFormat.stringFromDate(picker.date));
      };
      show(props.date);
      const action = target(report);
      picker.addTargetActionForControlEvents(action, 'fire', UIControlEvents.ValueChanged);
      report();
      return {
        view: picker,
        setProps(next) { show(next.date); },
        destroy() { picker.removeTargetActionForControlEvents(action, 'fire', UIControlEvents.ValueChanged); },
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
