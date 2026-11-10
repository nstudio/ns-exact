import type { Answer, Result, Sources } from './app.contract.d.ts';

export const grants = '';

const sources: Sources = {
  hostInfo: (_args, _store, _storage, native) => {
    if (!native?.available) return { name: 'no native module', system: '', memory: 0 };
    return native.call({ op: 'host' }) as Result<'hostInfo'>;
  },
  laterInfo: async (_args, _store, _storage, native) => {
    if (!native?.available) return { after: -1 };
    return (await native.later({ op: 'wait', ms: 20 })) as Result<'laterInfo'>;
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
