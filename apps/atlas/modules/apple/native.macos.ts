// Atlas on the Mac: the trackpad's haptics, through AppKit.
import { atlas } from './atlas';

atlas({
  device: 'Mac',
  file: 'native.macos.ts',
  frameworks: ['AppKit haptics'],
  feel(session) {
    const performer = NSHapticFeedbackManager.defaultPerformer;
    const beat = (n: number) => performer.performFeedbackPatternPerformanceTime(NSHapticFeedbackPattern.Generic, NSHapticFeedbackPerformanceTime.Now);
    return new Promise((resolve) => {
      beat(0);
      session.after(120, () => beat(1));
      session.after(240, () => { beat(2); resolve('Three beats on the trackpad'); });
    });
  },
  quiet(map) {
    map.showsCompass = false;
    map.showsZoomControls = false;
    map.showsPitchControl = false;
  },
});
