// Atlas's native layer, shared by native.ios.ts and native.macos.ts: MapKit and NaturalLanguage have
// the same Objective-C API on both, so only what differs (haptics, the platform's map chrome) is theirs.
import { bundleStamp, defineModule, type Session } from 'nativescript-exact';

// Save this file while the app runs: the map takes the change in under a second, with no native build.
export const look = {
  style: 'satellite' as 'satellite' | 'hybrid' | 'standard',
  pitch: 62, // degrees from straight down
  distance: 1500, // metres from the landmark
  orbit: 5, // degrees of heading per second
};

export interface Platform {
  device: string;
  file: string;
  frameworks: string[];
  /** Plays the app's haptic signature; resolves with what played. */
  feel(session: Session): Promise<string>;
  /** The platform's own map chrome, hidden. */
  quiet(map: MKMapView): void;
}

interface Place { city: string; landmark: string; lat: number; lon: number; zone: string }

const places: Record<string, Place> = {
  tokyo: { city: 'Tokyo', landmark: 'Tokyo Tower', lat: 35.65858, lon: 139.74543, zone: 'Asia/Tokyo' },
  paris: { city: 'Paris', landmark: 'Eiffel Tower', lat: 48.85837, lon: 2.29448, zone: 'Europe/Paris' },
  london: { city: 'London', landmark: 'Tower Bridge', lat: 51.50546, lon: -0.07540, zone: 'Europe/London' },
  newyork: { city: 'New York', landmark: 'Empire State Building', lat: 40.74844, lon: -73.98566, zone: 'America/New_York' },
  sydney: { city: 'Sydney', landmark: 'Sydney Opera House', lat: -33.85678, lon: 151.21530, zone: 'Australia/Sydney' },
};
const placeOf = (id: string | undefined) => places[id ?? ''] ?? places.tokyo;

interface Globe { map: MKMapView; place: Place; heading: number; restUntil: number }

// The VM outlives a reload, so what must survive one (the live maps, the tickers, the edit count) is
// kept on globalThis, and each evaluation takes it over. One named property, never globalThis itself
// in a variable: an alias turns off the release build's metadata filter.
const kept: any = ((globalThis as any).__atlas ??= {});
const globes: Set<Globe> = (kept.__atlasGlobes ??= new Set());
// An edit is a bundle whose sources were saved after the last one's: a phone's first fetch of the
// served bundle carries the same sources as the one the build embedded.
const saved = bundleStamp().saved, arrived = Date.now();
if (kept.__atlasSaved !== undefined && saved > kept.__atlasSaved) kept.__atlasEdits = (kept.__atlasEdits ?? 0) + 1;
kept.__atlasSaved = Math.max(kept.__atlasSaved ?? 0, saved);
kept.__atlasEdits ??= 0;

function configure(map: MKMapView) {
  map.preferredConfiguration =
    look.style === 'standard' ? MKStandardMapConfiguration.alloc().initWithElevationStyleEmphasisStyle(MKMapElevationStyle.Realistic, MKStandardMapEmphasisStyle.Muted)
    : look.style === 'hybrid' ? MKHybridMapConfiguration.alloc().initWithElevationStyle(MKMapElevationStyle.Realistic)
    : MKImageryMapConfiguration.alloc().initWithElevationStyle(MKMapElevationStyle.Realistic);
}

const camera = (place: Place, heading: number) =>
  MKMapCamera.cameraLookingAtCenterCoordinateFromDistancePitchHeading(
    { latitude: place.lat, longitude: place.lon }, look.distance, look.pitch, heading);

function timeIn(place: Place) {
  const zone = NSTimeZone.timeZoneWithName(place.zone);
  const format = NSDateFormatter.new();
  format.timeZone = zone;
  format.setLocalizedDateFormatFromTemplate('EEEjmm');
  return { time: format.stringFromDate(NSDate.date()), zone: zone.localizedNameLocale(NSTimeZoneNameStyle.Generic, NSLocale.currentLocale) ?? place.zone };
}

const kinds: Record<string, string> = { [NLTagPersonalName]: 'Person', [NLTagPlaceName]: 'Place', [NLTagOrganizationName]: 'Organization' };

function mood(score: number) {
  if (score > 0.5) return 'Delighted';
  if (score > 0.1) return 'Warm';
  if (score < -0.5) return 'Upset';
  if (score < -0.1) return 'Cool';
  return 'Neutral';
}

function read(text: string) {
  const words = text.trim();
  if (!words) return { language: '', mood: 'Waiting for words', score: 0, fraction: 0.5, names: [] };
  const code = NLLanguageRecognizer.dominantLanguageForString(words) ?? 'und';
  const tagger = NLTagger.alloc().initWithTagSchemes([NLTagSchemeSentimentScore, NLTagSchemeNameType]);
  tagger.string = words;
  // A language the sentiment model does not cover answers no score.
  const raw = Number(tagger.tagAtIndexUnitSchemeTokenRange(0, NLTokenUnit.Paragraph, NLTagSchemeSentimentScore, null));
  const score = Number.isFinite(raw) ? raw : 0;
  const names: { name: string; kind: string }[] = [];
  tagger.enumerateTagsInRangeUnitSchemeOptionsUsingBlock({ location: 0, length: words.length }, NLTokenUnit.Word, NLTagSchemeNameType,
    NLTaggerOptions.OmitWhitespace | NLTaggerOptions.OmitPunctuation | NLTaggerOptions.JoinNames,
    (tag, range) => {
      const name = words.substr(range.location, range.length);
      if (kinds[tag] && !names.some((n) => n.name === name && n.kind === kinds[tag])) names.push({ name, kind: kinds[tag] });
    });
  const language = NSLocale.currentLocale.localizedStringForLanguageCode(code) ?? code;
  return {
    language,
    mood: Number.isFinite(raw) ? mood(score) : `No mood model for ${language} here`,
    score: Math.round(score * 100) / 100,
    fraction: (score + 1) / 2,
    names,
  };
}

// The orbit and the clock's refresh never stop, so under the agent, whose clock must settle, they do not run.
function animate(session: Session) {
  kept.__atlasOrbit?.stop();
  kept.__atlasClock?.stop();
  kept.__atlasOrbit = kept.__atlasClock = null;
  if (session.agent) return;
  let last = session.now();
  kept.__atlasOrbit = session.frames(({ now }) => {
    const seconds = (now - last) / 1000;
    last = now;
    for (const globe of globes) {
      if (now < globe.restUntil) continue;
      globe.heading = (globe.heading + look.orbit * seconds) % 360;
      globe.map.camera = camera(globe.place, globe.heading);
    }
  });
  const tick = () => { session.changed('clock'); kept.__atlasClock = session.after(15000, tick); };
  kept.__atlasClock = session.after(15000, tick);
}

export function atlas(platform: Platform) {
  defineModule((session) => {
    kept.__atlasFly = (globe: Globe, id: string | undefined) => {
      const place = placeOf(id);
      if (place === globe.place) return;
      globe.place = place;
      globe.restUntil = session.now() + 3000;
      globe.map.setCameraAnimated(camera(place, globe.heading), true);
    };
    for (const globe of globes) { configure(globe.map); globe.map.camera = camera(globe.place, globe.heading); }
    animate(session);

    return {
      call(request) {
        switch (request.op) {
          case 'place': {
            const place = placeOf(request.id);
            return { city: place.city, landmark: place.landmark, ...timeIn(place) };
          }
          case 'read':
            return read(String(request.text ?? ''));
          case 'live': {
            const edits = kept.__atlasEdits as number;
            return {
              device: platform.device,
              file: platform.file,
              frameworks: ['MapKit', 'NaturalLanguage', ...platform.frameworks].join(' · '),
              edits,
              arrival: edits > 0 ? `${Math.max(0, arrived - saved)} ms` : '',
            };
          }
        }
        throw new Error(`Atlas has no call ${request.op}`);
      },

      later(request, reply) {
        if (request.op !== 'feel') return reply.fail(`Atlas has no later ${request.op}`);
        platform.feel(session).then((played) => reply.send({ played }), (e) => reply.fail(e.message));
      },

      views: {
        'atlas-globe': (props) => {
          const map = MKMapView.alloc().initWithFrame(CGRectMake(0, 0, 390, 360));
          map.zoomEnabled = false;
          map.scrollEnabled = false;
          map.rotateEnabled = false;
          map.pitchEnabled = false;
          platform.quiet(map);
          configure(map);
          const globe: Globe = { map, place: placeOf(props.place), heading: 25, restUntil: 0 };
          map.camera = camera(globe.place, globe.heading);
          globes.add(globe);
          return {
            view: map,
            setProps(next) { kept.__atlasFly(globe, next.place); },
            destroy() { globes.delete(globe); },
          };
        },
      },
    };
  });
}
