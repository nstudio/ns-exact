import type { Answer, Result, Sources } from './app.contract.d.ts';

export const appId = 'com.example.ab-swift-1-cfa493';
export const grants = '';

const sources: Sources = {
  deviceInfo: (_args, _store, _storage, native) => {
    if (!native?.available) return { name: 'no native module', system: '', battery: 0 };
    return native.call({ op: 'device' }) as Result<'deviceInfo'>;
  },
  screenBrightness: (_args, _store, _storage, native) => {
    if (!native?.available) return { percent: 0 };
    native.watch('brightness');
    return native.call({ op: 'brightness' }) as Result<'screenBrightness'>;
  },
  playBuzz: async (_args, _store, _storage, native) =>
    (await native!.later({ op: 'buzz' })) as Result<'playBuzz'>,
  placeFor: async ([query], _store, _storage, native) => {
    if (!native?.available) return { city: '', country: '' };
    return (await native.later({ op: 'geocode', address: query })) as Result<'placeFor'>;
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
