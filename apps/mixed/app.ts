import type { Answer, Result, Sources } from './app.contract.d.ts';

export const appId = 'com.example.mixed-507363';
export const grants = '';

const sources: Sources = {
  helloFromSwift: (_args, _store, _storage, native) => {
    if (!native?.available) return { text: '' };
    return native.call({ op: 'hello' }) as Result<'helloFromSwift'>;
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
