import type { Answer, Result, Sources } from './app.contract.d.ts';

export const grants = '';

// Each answer watches `nsx:reload`, which the module raises when a saved edit of its code arrives,
// so the screen asks again and shows what the new code answers.
const sources: Sources = {
  placeInfo: ([id], _store, _storage, native) => {
    if (!native?.available) return { city: '', landmark: 'Tokyo Tower', time: '', zone: '' };
    native.watch('clock');
    native.watch('nsx:reload');
    return native.call({ op: 'place', id }) as Result<'placeInfo'>;
  },
  readNote: ([text], _store, _storage, native) => {
    if (!native?.available) return { language: '', mood: '', score: 0, fraction: 0.5, names: [] };
    native.watch('nsx:reload');
    return native.call({ op: 'read', text }) as Result<'readNote'>;
  },
  liveInfo: (_args, _store, _storage, native) => {
    if (!native?.available) return { device: '', file: '', frameworks: '', edits: 0, arrival: '' };
    native.watch('nsx:reload');
    return native.call({ op: 'live' }) as Result<'liveInfo'>;
  },
  feelIt: async (_args, _store, _storage, native) => (await native!.later({ op: 'feel' })) as Result<'feelIt'>,
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
