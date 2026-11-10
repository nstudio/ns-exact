// Atlas on iPhone: a CoreHaptics signature, which no Exact package plays.
import { atlas } from './atlas';

function checked<T>(what: string, attempt: (error: interop.Reference<NSError>) => T): NonNullable<T> {
  const error = new interop.Reference<NSError>();
  const result = attempt(error);
  if (!result) throw new Error(`${what}: ${error.value?.localizedDescription ?? 'failed'}`);
  return result as NonNullable<T>;
}

const tap = (at: number, intensity: number, sharpness: number) =>
  CHHapticEvent.alloc().initWithEventTypeParametersRelativeTimeDuration(CHHapticEventTypeHapticTransient, [
    CHHapticEventParameter.alloc().initWithParameterIDValue(CHHapticEventParameterIDHapticIntensity, intensity),
    CHHapticEventParameter.alloc().initWithParameterIDValue(CHHapticEventParameterIDHapticSharpness, sharpness),
  ], at, 0);

const swell = (at: number, duration: number) =>
  CHHapticEvent.alloc().initWithEventTypeParametersRelativeTimeDuration(CHHapticEventTypeHapticContinuous, [
    CHHapticEventParameter.alloc().initWithParameterIDValue(CHHapticEventParameterIDHapticIntensity, 0.55),
    CHHapticEventParameter.alloc().initWithParameterIDValue(CHHapticEventParameterIDHapticSharpness, 0.2),
  ], at, duration);

atlas({
  device: 'iPhone',
  file: 'native.ios.ts',
  frameworks: ['CoreHaptics'],
  feel(session) {
    return new Promise((resolve, reject) => {
      if (!CHHapticEngine.capabilitiesForHardware().supportsHaptics) return reject(new Error('This device has no haptic engine'));
      const engine = checked('engine', (e) => CHHapticEngine.alloc().initAndReturnError(e));
      engine.playsHapticsOnly = true;
      const events = [tap(0, 0.5, 0.9), tap(0.09, 0.75, 0.7), tap(0.18, 1, 0.5), swell(0.3, 0.4)];
      const pattern = checked('pattern', (e) => CHHapticPattern.alloc().initWithEventsParametersError(events, [], e));
      checked('start', (e) => engine.startAndReturnError(e));
      const player = checked('player', (e) => engine.createPlayerWithPatternError(pattern, e));
      checked('play', (e) => player.startAtTimeError(0, e));
      session.after(800, () => { engine.stopWithCompletionHandler(null); resolve('Three taps and a swell, 0.7 s'); });
    });
  },
  quiet(map) {
    map.showsCompass = false;
  },
});
