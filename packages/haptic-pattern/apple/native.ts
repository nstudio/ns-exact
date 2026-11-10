import { definePackage } from 'nativescript-exact';

const refused = (name: string, message: string) => Object.assign(new Error(message), { name });

// Each CoreHaptics call that can fail takes an NSError** and answers nil or false.
function checked<T>(what: string, attempt: (error: interop.Reference<NSError>) => T): NonNullable<T> {
  const error = new interop.Reference<NSError>();
  const result = attempt(error);
  if (!result) throw refused('OperationError', `${what}: ${error.value?.localizedDescription ?? 'failed'}`);
  return result as NonNullable<T>;
}

const between = (name: string, value: unknown, low: number, high: number) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < low || n > high) throw refused('TypeError', `${name} must be a number from ${low} to ${high}`);
  return n;
};

export default definePackage(() => {
  let engine: CHHapticEngine | null = null;
  const supported = () => CHHapticEngine.capabilitiesForHardware().supportsHaptics;

  // The engine stops when the app goes to the background or the haptic server resets; started again before
  // each pattern, it resumes from either. Dropped on a reset, as its players are then invalid.
  const started = () => {
    if (!engine) {
      engine = checked('CHHapticEngine', (e) => CHHapticEngine.alloc().initAndReturnError(e));
      engine.playsHapticsOnly = true;
      engine.autoShutdownEnabled = true;
      engine.resetHandler = () => { engine = null; };
    }
    const running = engine;
    checked('start', (e) => running.startAndReturnError(e));
    return running;
  };

  return {
    names: {
      hapticsStatus: () => ({ supported: supported() }),

      playPattern: (options) => {
        if (!supported()) throw refused('NotSupportedError', 'this device has no haptic engine');
        const intensity = between('intensity', options.intensity, 0, 1);
        const sharpness = between('sharpness', options.sharpness, 0, 1);
        const count = Math.round(between('count', options.count, 1, 32));
        const gap = between('gap', options.gap, 10, 2000) / 1000;
        const parameters = [
          CHHapticEventParameter.alloc().initWithParameterIDValue(CHHapticEventParameterIDHapticIntensity, intensity),
          CHHapticEventParameter.alloc().initWithParameterIDValue(CHHapticEventParameterIDHapticSharpness, sharpness),
        ];
        const events = Array.from({ length: count }, (_, i) =>
          CHHapticEvent.alloc().initWithEventTypeParametersRelativeTimeDuration(CHHapticEventTypeHapticTransient, parameters, i * gap, 0));
        const pattern = checked('pattern', (e) => CHHapticPattern.alloc().initWithEventsParametersError(events, [], e));
        const running = started();
        const player = checked('player', (e) => running.createPlayerWithPatternError(pattern, e));
        checked('play', (e) => player.startAtTimeError(0, e));
        return { events: count, duration: Math.round((count - 1) * gap * 1000) };
      },
    },
  };
});
