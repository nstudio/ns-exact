import { defineModule } from 'nativescript-exact';

function read(text: string) {
  const code = NLLanguageRecognizer.dominantLanguageForString(text);
  const language = code ? NSLocale.currentLocale.localizedStringForLanguageCode(code) ?? code : '';
  const tagger = NLTagger.alloc().initWithTagSchemes([NLTagSchemeSentimentScore]);
  tagger.string = text;
  // Empty text, or a language the sentiment model does not cover, answers no tag.
  const raw = Number(tagger.tagAtIndexUnitSchemeTokenRange(0, NLTokenUnit.Paragraph, NLTagSchemeSentimentScore, null));
  return { language, score: Number.isFinite(raw) ? Math.round(raw * 10) / 10 : 0 };
}

defineModule(() => ({
  call(request) {
    if (request.op === 'read') return read(String(request.text ?? ''));
    throw new Error(`no such op: ${request.op}`);
  },
}));
