import { Body, Ecliptic, GeoVector } from "astronomy-engine";
import { startsNewTransitEpisode } from "@/lib/transit-episodes";

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PlanetPosition = {
  body: string;
  bodyZh: string;
  glyph: string;
  longitude: number;
  signZh: string;
  degree: number;
  retrograde: boolean;
};

export type TransitEvent = {
  id: string;
  date: string;
  transitBody: string;
  transitBodyZh: string;
  transitGlyph: string;
  natalBody: string;
  natalBodyZh: string;
  natalGlyph: string;
  aspect: "conjunction" | "square" | "trine" | "opposition";
  aspectZh: string;
  aspectGlyph: string;
  tone: "flow" | "focus" | "tension";
  orb: number;
  transitLongitude: number;
  natalLongitude: number;
  close: number;
  return5: number | null;
  return20: number | null;
};

export type UpcomingTransitEvent = Omit<
  TransitEvent,
  "close" | "return5" | "return20"
>;

export type TransitConfiguration = {
  id: string;
  signature: string;
  date: string;
  transitBody: string;
  transitBodyZh: string;
  transitGlyph: string;
  natalBody: string;
  natalBodyZh: string;
  natalGlyph: string;
  aspect: "conjunction" | "square" | "trine" | "opposition";
  aspectZh: string;
  aspectGlyph: string;
  tone: "flow" | "focus" | "tension";
  orb: number;
  transitLongitude: number;
  natalLongitude: number;
};

export type HistoricalTransitEpisode = TransitConfiguration & {
  barIndex: number;
  close: number;
};

const PLANETS = [
  { body: Body.Sun, key: "Sun", zh: "太陽", glyph: "☉" },
  { body: Body.Moon, key: "Moon", zh: "月亮", glyph: "☽" },
  { body: Body.Mercury, key: "Mercury", zh: "水星", glyph: "☿" },
  { body: Body.Venus, key: "Venus", zh: "金星", glyph: "♀" },
  { body: Body.Mars, key: "Mars", zh: "火星", glyph: "♂" },
  { body: Body.Jupiter, key: "Jupiter", zh: "木星", glyph: "♃" },
  { body: Body.Saturn, key: "Saturn", zh: "土星", glyph: "♄" },
] as const;

const TRANSIT_BODIES = PLANETS.filter((planet) =>
  ["Mars", "Jupiter", "Saturn"].includes(planet.key),
);

const NATAL_TARGETS = new Set(["Sun", "Venus", "Jupiter", "Saturn"]);
const SIGNS_ZH = [
  "牡羊",
  "金牛",
  "雙子",
  "巨蟹",
  "獅子",
  "處女",
  "天秤",
  "天蠍",
  "射手",
  "摩羯",
  "水瓶",
  "雙魚",
] as const;

const ASPECTS = [
  { key: "conjunction", angle: 0, zh: "合相", glyph: "☌", tone: "focus" },
  { key: "square", angle: 90, zh: "四分相", glyph: "□", tone: "tension" },
  { key: "trine", angle: 120, zh: "三分相", glyph: "△", tone: "flow" },
  { key: "opposition", angle: 180, zh: "對分相", glyph: "☍", tone: "tension" },
] as const;

type AspectDefinition = (typeof ASPECTS)[number];

const DAY_MS = 86_400_000;

function omitCandidateMetadata<T extends { key: string; timestamp: number }>(
  candidate: T,
): Omit<T, "key" | "timestamp"> {
  const event = { ...candidate };
  delete (event as Partial<T>).key;
  delete (event as Partial<T>).timestamp;
  return event;
}

function normalize(value: number) {
  return ((value % 360) + 360) % 360;
}

function separation(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function nearestAspect(gap: number): { aspect: AspectDefinition; orb: number } {
  let aspect: AspectDefinition = ASPECTS[0];
  let orb = Math.abs(gap - aspect.angle);
  for (const candidate of ASPECTS.slice(1)) {
    const candidateOrb = Math.abs(gap - candidate.angle);
    if (candidateOrb < orb) {
      aspect = candidate;
      orb = candidateOrb;
    }
  }
  return { aspect, orb };
}

function localTaipeiMoment(dateText: string, hour: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) throw new Error("日期格式不正確");

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 8, 0, 0));

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error("日期不存在");
  }
  return utc;
}

function longitude(body: Body, date: Date) {
  return normalize(Ecliptic(GeoVector(body, date, true)).elon);
}

function isRetrograde(body: Body, date: Date) {
  if (body === Body.Sun || body === Body.Moon) return false;
  const tomorrow = new Date(date.getTime() + DAY_MS);
  const delta = ((longitude(body, tomorrow) - longitude(body, date) + 540) % 360) - 180;
  return delta < 0;
}

export function buildNatalChart(dateText: string, hour: number): PlanetPosition[] {
  const date = localTaipeiMoment(dateText, hour);
  return PLANETS.map((planet) => {
    const lon = longitude(planet.body, date);
    return {
      body: planet.key,
      bodyZh: planet.zh,
      glyph: planet.glyph,
      longitude: Number(lon.toFixed(2)),
      signZh: SIGNS_ZH[Math.floor(lon / 30) % 12],
      degree: Number((lon % 30).toFixed(1)),
      retrograde: isRetrograde(planet.body, date),
    };
  });
}

function forwardReturn(bars: PriceBar[], index: number, sessions: number) {
  if (!bars[index + sessions]) return null;
  return Number((((bars[index + sessions].close / bars[index].close) - 1) * 100).toFixed(1));
}

export function buildTransitEvents(
  natal: PlanetPosition[],
  bars: PriceBar[],
): TransitEvent[] {
  const candidates: Array<TransitEvent & { key: string; timestamp: number }> = [];
  const targets = natal.filter((planet) => NATAL_TARGETS.has(planet.body));

  bars.forEach((bar, index) => {
    const session = localTaipeiMoment(bar.date, 9);
    for (const transit of TRANSIT_BODIES) {
      const transitLongitude = longitude(transit.body, session);
      for (const target of targets) {
        const gap = separation(transitLongitude, target.longitude);
        const nearest = nearestAspect(gap);

        if (nearest.orb > 1.25) continue;
        const key = `${transit.key}-${nearest.aspect.key}-${target.body}`;
        candidates.push({
          id: `${bar.date}-${key}`,
          key,
          timestamp: session.getTime(),
          date: bar.date,
          transitBody: transit.key,
          transitBodyZh: transit.zh,
          transitGlyph: transit.glyph,
          natalBody: target.body,
          natalBodyZh: target.bodyZh,
          natalGlyph: target.glyph,
          aspect: nearest.aspect.key,
          aspectZh: nearest.aspect.zh,
          aspectGlyph: nearest.aspect.glyph,
          tone: nearest.aspect.tone,
          orb: Number(nearest.orb.toFixed(2)),
          transitLongitude: Number(transitLongitude.toFixed(2)),
          natalLongitude: target.longitude,
          close: bar.close,
          return5: forwardReturn(bars, index, 5),
          return20: forwardReturn(bars, index, 20),
        });
      }
    }
  });

  const selected: typeof candidates = [];
  for (const candidate of [...candidates].sort((a, b) => a.orb - b.orb)) {
    const overlaps = selected.some(
      (event) =>
        event.key === candidate.key &&
        Math.abs(event.timestamp - candidate.timestamp) < 12 * DAY_MS,
    );
    if (!overlaps) selected.push(candidate);
  }

  return selected
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-24)
    .map(omitCandidateMetadata);
}

export function buildUpcomingTransitEvents(
  natal: PlanetPosition[],
  fromDateText: string,
  totalDays = 120,
): UpcomingTransitEvent[] {
  const from = localTaipeiMoment(fromDateText, 9);
  const targets = natal.filter((planet) => NATAL_TARGETS.has(planet.body));
  const candidates: Array<UpcomingTransitEvent & { key: string; timestamp: number }> = [];

  for (let day = 1; day <= totalDays; day += 1) {
    const moment = new Date(from.getTime() + day * DAY_MS);
    const date = new Date(moment.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const transit of TRANSIT_BODIES) {
      const transitLongitude = longitude(transit.body, moment);
      for (const target of targets) {
        const gap = separation(transitLongitude, target.longitude);
        const nearest = nearestAspect(gap);

        if (nearest.orb > 0.55) continue;
        const key = `${transit.key}-${nearest.aspect.key}-${target.body}`;
        candidates.push({
          id: `${date}-${key}`,
          key,
          timestamp: moment.getTime(),
          date,
          transitBody: transit.key,
          transitBodyZh: transit.zh,
          transitGlyph: transit.glyph,
          natalBody: target.body,
          natalBodyZh: target.bodyZh,
          natalGlyph: target.glyph,
          aspect: nearest.aspect.key,
          aspectZh: nearest.aspect.zh,
          aspectGlyph: nearest.aspect.glyph,
          tone: nearest.aspect.tone,
          orb: Number(nearest.orb.toFixed(2)),
          transitLongitude: Number(transitLongitude.toFixed(2)),
          natalLongitude: target.longitude,
        });
      }
    }
  }

  const selected: typeof candidates = [];
  for (const candidate of [...candidates].sort((a, b) => a.orb - b.orb)) {
    if (
      selected.some(
        (event) =>
          event.key === candidate.key &&
          Math.abs(event.timestamp - candidate.timestamp) < 12 * DAY_MS,
      )
    ) continue;
    selected.push(candidate);
  }

  return selected
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 5)
    .map(omitCandidateMetadata);
}

function transitConfigurationsForDate(
  natal: PlanetPosition[],
  dateText: string,
): TransitConfiguration[] {
  const session = localTaipeiMoment(dateText, 9);
  const targets = natal.filter((planet) => NATAL_TARGETS.has(planet.body));
  const configurations: TransitConfiguration[] = [];

  for (const transit of TRANSIT_BODIES) {
    const transitLongitude = longitude(transit.body, session);
    for (const target of targets) {
      const gap = separation(transitLongitude, target.longitude);
      const nearest = nearestAspect(gap);
      const signature = `${transit.key}-${nearest.aspect.key}-${target.body}`;
      configurations.push({
        id: `${dateText}-${signature}`,
        signature,
        date: dateText,
        transitBody: transit.key,
        transitBodyZh: transit.zh,
        transitGlyph: transit.glyph,
        natalBody: target.body,
        natalBodyZh: target.bodyZh,
        natalGlyph: target.glyph,
        aspect: nearest.aspect.key,
        aspectZh: nearest.aspect.zh,
        aspectGlyph: nearest.aspect.glyph,
        tone: nearest.aspect.tone,
        orb: Number(nearest.orb.toFixed(2)),
        transitLongitude: Number(transitLongitude.toFixed(2)),
        natalLongitude: target.longitude,
      });
    }
  }

  return configurations.sort((a, b) => a.orb - b.orb);
}

export function buildTransitSnapshot(
  natal: PlanetPosition[],
  dateText: string,
  activeOrb = 3,
): TransitConfiguration[] {
  return transitConfigurationsForDate(natal, dateText)
    .filter((configuration) => configuration.orb <= activeOrb);
}

export function buildHistoricalTransitEpisodes(
  natal: PlanetPosition[],
  bars: PriceBar[],
  peakOrb = 1.25,
): HistoricalTransitEpisode[] {
  const bySignature = new Map<string, HistoricalTransitEpisode[]>();

  bars.forEach((bar, barIndex) => {
    for (const configuration of transitConfigurationsForDate(natal, bar.date)) {
      if (configuration.orb > peakOrb) continue;
      const episode = { ...configuration, barIndex, close: bar.close };
      bySignature.set(configuration.signature, [
        ...(bySignature.get(configuration.signature) || []),
        episode,
      ]);
    }
  });

  const selected: HistoricalTransitEpisode[] = [];
  for (const episodes of bySignature.values()) {
    let run: HistoricalTransitEpisode[] = [];
    const flush = () => {
      if (!run.length) return;
      selected.push([...run].sort((a, b) => a.orb - b.orb)[0]);
      run = [];
    };

    for (const episode of episodes.sort((a, b) => a.barIndex - b.barIndex)) {
      const previous = run.at(-1);
      if (previous && startsNewTransitEpisode(previous, episode)) flush();
      run.push(episode);
    }
    flush();
  }

  return selected.sort((a, b) => a.date.localeCompare(b.date));
}
