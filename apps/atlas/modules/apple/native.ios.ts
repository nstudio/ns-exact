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

const heartbeat = (at: number) => [tap(at, 1, 0.3), tap(at + 0.15, 0.6, 0.3)];

atlas({
  device: 'iPhone',
  file: 'native.ios.ts',
  frameworks: ['CoreHaptics'],
  feel(session) {
    return new Promise((resolve, reject) => {
      if (!CHHapticEngine.capabilitiesForHardware().supportsHaptics) return reject(new Error('This device has no haptic engine'));
      const engine = checked('engine', (e) => CHHapticEngine.alloc().initAndReturnError(e));
      engine.playsHapticsOnly = true;
      const events = [...heartbeat(0), ...heartbeat(0.8)];
      const pattern = checked('pattern', (e) => CHHapticPattern.alloc().initWithEventsParametersError(events, [], e));
      checked('start', (e) => engine.startAndReturnError(e));
      const player = checked('player', (e) => engine.createPlayerWithPatternError(pattern, e));
      checked('play', (e) => player.startAtTimeError(0, e));
      session.after(1100, () => { engine.stopWithCompletionHandler(null); resolve('A heartbeat twice, strong then soft, 0.95 s'); });
    });
  },
  quiet(map) {
    map.showsCompass = false;
  },
});
