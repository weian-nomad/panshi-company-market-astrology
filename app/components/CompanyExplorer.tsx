"use client";

import type {
  PlanetPosition,
  PriceBar,
  TransitEvent,
  UpcomingTransitEvent,
} from "@/lib/astrology";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HeroInstrument } from "./HeroInstrument";

type AnchorKey = "listing" | "established";
type RangeKey = "3M" | "6M" | "1Y";
type LensKey = "symbolic" | "evidence";

type AnchorData = {
  date: string;
  label: string;
  precision: "date" | "derived";
  precisionLabel: string;
  timeLabel: string;
  confidence: string;
  natal: PlanetPosition[];
  events: TransitEvent[];
  upcoming: UpcomingTransitEvent[];
};

type CompanyPayload = {
  company: {
    symbol: string;
    shortName: string;
    fullName: string;
    englishName: string;
    establishedDate: string;
    listingDate: string;
    industry: string;
    website: string;
    registryUpdatedAt: string;
  };
  market: {
    exchange: string;
    currency: string;
    timeZone: string;
    latestDate: string;
    latestClose: number;
    change: number;
    changePercent: number;
    basis: string;
  };
  bars: PriceBar[];
  anchors: Record<AnchorKey, AnchorData>;
  sources: {
    company: string;
    price: string;
    fetchedAt: string;
  };
};

const RANGE_SESSIONS: Record<RangeKey, number> = {
  "3M": 66,
  "6M": 132,
  "1Y": 260,
};

const QUICK_SYMBOLS = [
  { symbol: "2330", name: "台積電" },
  { symbol: "2317", name: "鴻海" },
  { symbol: "2454", name: "聯發科" },
  { symbol: "2881", name: "富邦金" },
];

const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("zh-TW", {
  month: "short",
  day: "numeric",
});

function parseDate(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function formatDate(date: string) {
  return dateFormatter.format(parseDate(date));
}

function formatShortDate(date: string) {
  return shortDateFormatter.format(parseDate(date));
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "待觀察";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function readStoredList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStoredList(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Saving is a convenience; the research view remains usable without storage.
  }
}

function periodReturn(bars: PriceBar[], sessions: number) {
  if (bars.length < 2) return null;
  const current = bars.at(-1)!.close;
  const start = bars[Math.max(0, bars.length - 1 - sessions)].close;
  return Number((((current / start) - 1) * 100).toFixed(1));
}

function median(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function chartSignature(planets: PlanetPosition[]) {
  const counts = { fire: 0, earth: 0, air: 0, water: 0 };
  const elements = ["fire", "earth", "air", "water"] as const;
  for (const planet of planets) {
    const signIndex = Math.floor(planet.longitude / 30) % 12;
    counts[elements[signIndex % 4]] += 1;
  }
  const dominant = (Object.entries(counts) as Array<[keyof typeof counts, number]>)
    .sort((a, b) => b[1] - a[1])[0][0];
  const sun = planets.find((planet) => planet.body === "Sun");
  const copy = {
    fire: { label: "火象偏強", title: "開創型時間質地", body: "象徵語言偏向速度、能見度與向外擴張。" },
    earth: { label: "土象偏強", title: "結構型時間質地", body: "象徵語言偏向穩定、建置與長期累積。" },
    air: { label: "風象偏強", title: "網路型時間質地", body: "象徵語言偏向資訊、連結與快速重組。" },
    water: { label: "水象偏強", title: "流動型時間質地", body: "象徵語言偏向周期、滲透與集體情緒。" },
  }[dominant];
  return {
    ...copy,
    sun: sun ? `本命太陽・${sun.signZh} ${sun.degree.toFixed(1)}°` : "本命太陽",
    dominant,
    counts,
  };
}

function polar(longitude: number, radius: number) {
  const angle = ((180 - longitude) * Math.PI) / 180;
  return {
    x: 180 + radius * Math.cos(angle),
    y: 180 - radius * Math.sin(angle),
  };
}

function placePlanets(planets: PlanetPosition[]) {
  const sorted = [...planets].sort((a, b) => a.longitude - b.longitude);
  return sorted.map((planet, index) => {
    const previous = sorted[(index - 1 + sorted.length) % sorted.length];
    const rawGap = Math.abs(planet.longitude - previous.longitude);
    const gap = Math.min(rawGap, 360 - rawGap);
    const radius = gap < 10 ? (index % 2 ? 91 : 108) : 102;
    return { ...planet, ...polar(planet.longitude, radius) };
  });
}

function PlanetWheel({
  natal,
  selectedEvent,
}: {
  natal: PlanetPosition[];
  selectedEvent: TransitEvent | null;
}) {
  const planets = useMemo(() => placePlanets(natal), [natal]);
  const eventTransit = selectedEvent
    ? polar(selectedEvent.transitLongitude, 138)
    : null;
  const eventNatal = selectedEvent
    ? polar(selectedEvent.natalLongitude, 78)
    : null;

  return (
    <div className="wheel-wrap">
      <svg
        className="planet-wheel"
        viewBox="0 0 360 360"
        role="img"
        aria-label="公司本命行星位置與所選行運相位"
      >
        <circle className="wheel-orbit wheel-orbit--outer" cx="180" cy="180" r="168" />
        <circle className="wheel-orbit" cx="180" cy="180" r="145" />
        <circle className="wheel-orbit wheel-orbit--natal" cx="180" cy="180" r="118" />
        <circle className="wheel-core" cx="180" cy="180" r="72" />

        {ZODIAC.map((glyph, index) => {
          const boundaryA = polar(index * 30, 145);
          const boundaryB = polar(index * 30, 168);
          const glyphPosition = polar(index * 30 + 15, 157);
          return (
            <g key={glyph}>
              <line
                className="wheel-division"
                x1={boundaryA.x}
                y1={boundaryA.y}
                x2={boundaryB.x}
                y2={boundaryB.y}
              />
              <text
                className="wheel-zodiac"
                x={glyphPosition.x}
                y={glyphPosition.y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {glyph}
              </text>
            </g>
          );
        })}

        {eventTransit && eventNatal && selectedEvent ? (
          <g>
            <line
              className={`wheel-aspect wheel-aspect--${selectedEvent.tone}`}
              x1={eventNatal.x}
              y1={eventNatal.y}
              x2={eventTransit.x}
              y2={eventTransit.y}
            />
            <circle
              className={`wheel-event-halo wheel-event-halo--${selectedEvent.tone}`}
              cx={eventTransit.x}
              cy={eventTransit.y}
              r="14"
            />
            <text
              className="wheel-transit"
              x={eventTransit.x}
              y={eventTransit.y}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {selectedEvent.transitGlyph}
            </text>
          </g>
        ) : null}

        {planets.map((planet) => {
          const tickStart = polar(planet.longitude, 118);
          return (
            <g key={planet.body}>
              <line
                className="wheel-planet-tick"
                x1={tickStart.x}
                y1={tickStart.y}
                x2={planet.x}
                y2={planet.y}
              />
              <text
                className={`wheel-planet${planet.retrograde ? " wheel-planet--retrograde" : ""}`}
                x={planet.x}
                y={planet.y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {planet.glyph}
              </text>
            </g>
          );
        })}

        <text className="wheel-center-label" x="180" y="170" textAnchor="middle">
          NATAL
        </text>
        <text className="wheel-center-value" x="180" y="194" textAnchor="middle">
          本命基準
        </text>
      </svg>

      <div className="planet-legend" aria-label="本命行星位置">
        {natal.map((planet) => (
          <span key={planet.body}>
            <b>{planet.glyph}</b>
            {planet.signZh} {planet.degree.toFixed(1)}°
            {planet.retrograde ? " ℞" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function PriceChart({
  bars,
  events,
  selectedEvent,
  onSelectEvent,
}: {
  bars: PriceBar[];
  events: TransitEvent[];
  selectedEvent: TransitEvent | null;
  onSelectEvent: (event: TransitEvent) => void;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 900;
  const height = 420;
  const padding = { top: 28, right: 72, bottom: 44, left: 20 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = bars.map((bar) => bar.close);
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const spread = Math.max(1, maxRaw - minRaw);
  const min = minRaw - spread * 0.1;
  const max = maxRaw + spread * 0.1;
  const xFor = (index: number) => padding.left + (index / Math.max(1, bars.length - 1)) * plotWidth;
  const yFor = (value: number) => padding.top + ((max - value) / (max - min)) * plotHeight;
  const path = bars.map((bar, index) => `${index ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(bar.close).toFixed(1)}`).join(" ");
  const area = `${path} L${xFor(bars.length - 1).toFixed(1)},${padding.top + plotHeight} L${padding.left},${padding.top + plotHeight} Z`;
  const barIndex = new Map(bars.map((bar, index) => [bar.date, index]));
  const markers = events.filter((event) => barIndex.has(event.date)).slice(-9);
  const hoveredBar = hoverIndex === null ? null : bars[hoverIndex];
  const highlighted = hoveredBar || (selectedEvent ? bars[barIndex.get(selectedEvent.date) ?? -1] : null);
  const highlightedIndex = highlighted ? barIndex.get(highlighted.date) ?? null : null;

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (bars.length - 1)));
  };

  const gridValues = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4).reverse();
  const xTicks = [0, Math.floor((bars.length - 1) / 3), Math.floor(((bars.length - 1) * 2) / 3), bars.length - 1];

  return (
    <div className="price-chart-shell">
      <a className="skip-link" href="#event-table">
        跳到相位事件清單
      </a>
      <div className="price-chart-canvas">
        <svg
          className="price-chart"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`股價日線，${bars[0]?.date} 至 ${bars.at(-1)?.date}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#355b8c" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#355b8c" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {gridValues.map((value) => (
            <g key={value}>
              <line
                className="chart-grid"
                x1={padding.left}
                x2={padding.left + plotWidth}
                y1={yFor(value)}
                y2={yFor(value)}
              />
              <text
                className="chart-axis-label"
                x={padding.left + plotWidth + 12}
                y={yFor(value)}
                dominantBaseline="middle"
              >
                {formatPrice(value)}
              </text>
            </g>
          ))}

          {markers.map((event) => {
            const index = barIndex.get(event.date)!;
            const selected = selectedEvent?.id === event.id;
            return (
              <g key={event.id}>
                <line
                  className={`event-line event-line--${event.tone}${selected ? " is-selected" : ""}`}
                  x1={xFor(index)}
                  x2={xFor(index)}
                  y1={padding.top}
                  y2={padding.top + plotHeight}
                />
                <circle
                  className={`event-point event-point--${event.tone}${selected ? " is-selected" : ""}`}
                  cx={xFor(index)}
                  cy={yFor(event.close)}
                  r={selected ? 7 : 5}
                />
              </g>
            );
          })}

          <path className="chart-area" d={area} />
          <path className="chart-price-line" d={path} />

          {highlighted && highlightedIndex !== null ? (
            <g className="chart-crosshair">
              <line
                x1={xFor(highlightedIndex)}
                x2={xFor(highlightedIndex)}
                y1={padding.top}
                y2={padding.top + plotHeight}
              />
              <circle cx={xFor(highlightedIndex)} cy={yFor(highlighted.close)} r="6" />
            </g>
          ) : null}

          {xTicks.map((index) => (
            <text
              className="chart-axis-label chart-axis-label--x"
              key={index}
              x={xFor(index)}
              y={height - 14}
              textAnchor={index === 0 ? "start" : index === bars.length - 1 ? "end" : "middle"}
            >
              {formatShortDate(bars[index].date)}
            </text>
          ))}
        </svg>

        {markers.map((event) => {
          const index = barIndex.get(event.date)!;
          const left = (xFor(index) / width) * 100;
          const top = (yFor(event.close) / height) * 100;
          return (
            <button
              className="event-hit-area"
              key={event.id}
              style={{ left: `${left}%`, top: `${top}%` }}
              type="button"
              onClick={() => onSelectEvent(event)}
              aria-label={`${formatDate(event.date)}：${event.transitBodyZh}${event.aspectZh}本命${event.natalBodyZh}`}
              aria-pressed={selectedEvent?.id === event.id}
            />
          );
        })}

        {highlighted && highlightedIndex !== null ? (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.max(12, Math.min(88, (xFor(highlightedIndex) / width) * 100))}%`,
            }}
          >
            <span>{formatDate(highlighted.date)}</span>
            <strong>NT$ {formatPrice(highlighted.close)}</strong>
            <small>
              開 {formatPrice(highlighted.open)}　高 {formatPrice(highlighted.high)}　低 {formatPrice(highlighted.low)}
            </small>
          </div>
        ) : null}
      </div>
      <div className="chart-legend" aria-label="圖表圖例">
        <span><i className="legend-line" />原始收盤價</span>
        <span><i className="legend-dot legend-dot--flow" />和諧相位</span>
        <span><i className="legend-dot legend-dot--focus" />聚焦相位</span>
        <span><i className="legend-dot legend-dot--tension" />張力相位</span>
      </div>
    </div>
  );
}

function ReturnValue({ value }: { value: number | null }) {
  const className = value === null ? "muted" : value >= 0 ? "positive" : "negative";
  return <span className={className}>{formatPercent(value)}</span>;
}

function LoadingDashboard() {
  return (
    <section className="dashboard-loading" aria-label="正在整理公司與市場資料" aria-busy="true">
      <div className="casting-ritual">
        <div className="casting-orbit" aria-hidden="true"><i /><i /><span /></div>
        <div>
          <span className="section-index">CASTING / 起盤</span>
          <h2>正在為這家公司定下時間基準</h2>
          <p>校準交易所時區 → 把誕生日放回天空 → 對齊實際交易日</p>
        </div>
      </div>
      <div className="loading-head shimmer" />
      <div className="loading-grid">
        <div className="loading-chart shimmer" />
        <div className="loading-wheel shimmer" />
      </div>
      <p>命盤已起，正在拉回價格時間線…</p>
    </section>
  );
}

function eventReading(event: TransitEvent | null) {
  if (!event) {
    return {
      title: "先從時間線選一個相位窗口",
      body: "點選圖上標記或下方事件，命盤會同步標出當天的行運位置。",
      question: "把它當成對照線索，不是結論。",
    };
  }

  const subject = {
    Jupiter: "擴張、資源與市場想像",
    Saturn: "結構、限制與長期責任",
    Mars: "動能、競爭與短期波動",
  }[event.transitBody] || "外在節奏";

  const tone = {
    flow: "符號上呈現較順的連結",
    focus: "符號上把同一主題集中放大",
    tension: "符號上呈現需要調整的張力",
  }[event.tone];

  return {
    title: `${event.transitBodyZh}${event.aspectZh}本命${event.natalBodyZh}`,
    body: `${subject}與公司本命的${event.natalBodyZh}主題重合，${tone}。此處只描述命盤結構，不把相位當成價格原因。`,
    question: event.return20 === null
      ? "D+20 尚未走完，先觀察波動是否放大，不預設方向。"
      : `後 20 個交易日的實際收盤報酬為 ${formatPercent(event.return20)}；這是歷史結果，不代表同類相位會重複。`,
  };
}

export function CompanyExplorer() {
  const [query, setQuery] = useState("2330");
  const [payload, setPayload] = useState<CompanyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [anchorKey, setAnchorKey] = useState<AnchorKey>("listing");
  const [range, setRange] = useState<RangeKey>("1Y");
  const [lens, setLens] = useState<LensKey>(() => {
    if (typeof window === "undefined") return "symbolic";
    return new URLSearchParams(window.location.search).get("lens") === "evidence"
      ? "evidence"
      : "symbolic";
  });
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [savedSymbols, setSavedSymbols] = useState<string[]>(() => readStoredList("panshi:symbols"));
  const [savedWindows, setSavedWindows] = useState<string[]>(() => readStoredList("panshi:windows"));
  const [shareFeedback, setShareFeedback] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const loadCompany = useCallback(async (
    symbol: string,
    options?: { anchor?: AnchorKey; range?: RangeKey },
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    setPayload(null);
    setSelectedEventId(null);

    try {
      const response = await fetch(`/api/company?symbol=${encodeURIComponent(symbol)}&months=13`, {
        signal: controller.signal,
      });
      const data = await response.json() as CompanyPayload | { error?: string };
      if (!response.ok || !("company" in data)) {
        throw new Error(("error" in data && data.error) || "資料暫時無法取得");
      }
      setPayload(data);
      setQuery(data.company.symbol);
      const nextAnchor = options?.anchor || "listing";
      setAnchorKey(nextAnchor);
      setRange(options?.range || "1Y");
      setSelectedEventId(data.anchors[nextAnchor].events.at(-1)?.id || null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "資料暫時無法取得");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSymbol = /^\d{4,6}$/.test(params.get("symbol") || "")
      ? params.get("symbol")!
      : "2330";
    const initialAnchor = params.get("anchor") === "established" ? "established" : "listing";
    const initialRange = (["3M", "6M", "1Y"] as string[]).includes(params.get("range") || "")
      ? params.get("range") as RangeKey
      : "1Y";
    const bootstrap = window.setTimeout(() => {
      void loadCompany(initialSymbol, { anchor: initialAnchor, range: initialRange });
    }, 0);
    return () => {
      window.clearTimeout(bootstrap);
      abortRef.current?.abort();
    };
  }, [loadCompany]);

  useEffect(() => {
    if (!payload) return;
    const params = new URLSearchParams(window.location.search);
    params.set("symbol", payload.company.symbol);
    params.set("anchor", anchorKey);
    params.set("range", range);
    params.set("lens", lens);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}#workspace`);
  }, [payload, anchorKey, range, lens]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const symbol = query.replace(/\D/g, "").slice(0, 6);
    if (symbol.length < 4) {
      setError("請輸入 4–6 碼上市股票代號。");
      return;
    }
    void loadCompany(symbol);
  };

  const anchor = payload?.anchors[anchorKey] || null;
  const visibleBars = useMemo(() => {
    if (!payload) return [];
    return payload.bars.slice(-RANGE_SESSIONS[range]);
  }, [payload, range]);
  const visibleEvents = useMemo(() => {
    if (!anchor || !visibleBars.length) return [];
    const firstDate = visibleBars[0].date;
    return anchor.events.filter((event) => event.date >= firstDate);
  }, [anchor, visibleBars]);
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId)
    || visibleEvents.at(-1)
    || null;

  const setAnchor = (key: AnchorKey) => {
    setAnchorKey(key);
    const nextEvents = payload?.anchors[key].events || [];
    setSelectedEventId(nextEvents.at(-1)?.id || null);
  };

  const setChartRange = (nextRange: RangeKey) => {
    setRange(nextRange);
    if (!anchor || !payload) return;
    const nextBars = payload.bars.slice(-RANGE_SESSIONS[nextRange]);
    const firstDate = nextBars[0]?.date;
    const nextEvent = anchor.events.filter((event) => event.date >= firstDate).at(-1);
    setSelectedEventId(nextEvent?.id || null);
  };

  const stats = useMemo(() => {
    const d5 = visibleEvents.map((event) => event.return5);
    const d20 = visibleEvents.map((event) => event.return20);
    const completed20 = d20.filter((value): value is number => value !== null);
    return {
      median5: median(d5),
      median20: median(d20),
      completed20: completed20.length,
      winRate20: completed20.length
        ? (completed20.filter((value) => value > 0).length / completed20.length) * 100
        : null,
    };
  }, [visibleEvents]);

  const reading = eventReading(selectedEvent);
  const signature = anchor ? chartSignature(anchor.natal) : null;

  const persistSymbols = (symbols: string[]) => {
    setSavedSymbols(symbols);
    writeStoredList("panshi:symbols", symbols);
  };

  const toggleCompanySave = () => {
    if (!payload) return;
    const symbol = payload.company.symbol;
    persistSymbols(savedSymbols.includes(symbol)
      ? savedSymbols.filter((item) => item !== symbol)
      : [...savedSymbols, symbol]);
  };

  const toggleWindowSave = (event: UpcomingTransitEvent) => {
    if (!payload) return;
    const key = `${payload.company.symbol}:${anchorKey}:${event.id}`;
    const next = savedWindows.includes(key)
      ? savedWindows.filter((item) => item !== key)
      : [...savedWindows, key];
    setSavedWindows(next);
    writeStoredList("panshi:windows", next);
  };

  const shareCurrentView = async () => {
    if (!payload || !anchor) return;
    const shareData = {
      title: `盤勢 · ${payload.company.shortName} 公司命盤`,
      text: `看 ${payload.company.shortName} 的${anchor.label}與歷史股價如何對齊。`,
      url: window.location.href,
    };
    let sharedNatively = false;
    try {
      if (typeof navigator.share === "function") {
        sharedNatively = true;
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
      }
      setShareFeedback(sharedNatively ? "已開啟分享" : "連結已複製");
    } catch {
      setShareFeedback("");
    }
    window.setTimeout(() => setShareFeedback(""), 1800);
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="盤勢首頁">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span>
            <b>盤勢</b>
            <small>PANSHI</small>
          </span>
        </a>
        <nav aria-label="主要導覽">
          <a href="#workspace">開始對照</a>
          <a href="#methodology">方法與界線</a>
        </nav>
        <span className="header-note">臺股研究版 <i /> BETA
        </span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 企業命盤 × 價格時間線</p>
          <h1>
            <span className="hero-title-line">把公司的時間，</span>
            <span className="hero-title-line hero-title-line--shift">放回股價裡看。</span>
          </h1>
          <p className="hero-lead">
            輸入股票代號，把成立日或首日交易建成命盤基準，
            再把主要行運標回歷史價格。看的是過去如何重合，不把巧合說成保證。
          </p>

          <form className="company-search" onSubmit={handleSearch}>
            <label htmlFor="company-symbol">上市股票代號</label>
            <div className="search-control">
              <span className="search-icon" aria-hidden="true" />
              <input
                id="company-symbol"
                value={query}
                onChange={(event) => setQuery(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="輸入代號，例如 2330"
                aria-describedby="market-scope"
              />
              <span className="market-tag">TWSE</span>
              <button type="submit" disabled={loading}>
                {loading ? "整理中" : "開始對照"}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            <div className="search-meta" id="market-scope">
              <span>快速範例</span>
              {QUICK_SYMBOLS.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() => {
                    setQuery(item.symbol);
                    void loadCompany(item.symbol);
                  }}
                >
                  {item.name} {item.symbol}
                </button>
              ))}
            </div>
          </form>

          <div className="hero-proof">
            <span><b>01</b>官方公司日期</span>
            <span><b>02</b>交易日對齊</span>
            <span><b>03</b>可回看的歷史結果</span>
          </div>
        </div>

        <HeroInstrument />
      </section>

      <div className="status-region" aria-live="polite">
        {error ? (
          <div className="error-banner" role="alert">
            <span aria-hidden="true">!</span>
            <div><b>這次沒有載入成功</b><p>{error}</p></div>
            <button type="button" onClick={() => void loadCompany(query || "2330")}>重試</button>
          </div>
        ) : null}
      </div>

      <section className="workspace" id="workspace">
        {loading && !payload ? <LoadingDashboard /> : null}

        {payload && anchor ? (
          <>
            <div className="company-bar">
              <div className="company-identity">
                <span className="ticker-badge">{payload.company.symbol}</span>
                <div>
                  <p>{payload.market.exchange} · {payload.company.industry}</p>
                  <h2>{payload.company.shortName}</h2>
                  <span>{payload.company.englishName}</span>
                </div>
              </div>
              <div className="latest-price">
                <span>最新收盤・{formatDate(payload.market.latestDate)}</span>
                <strong>NT$ {formatPrice(payload.market.latestClose)}</strong>
                <em className={payload.market.change >= 0 ? "positive" : "negative"}>
                  {payload.market.change >= 0 ? "↑" : "↓"} {payload.market.change > 0 ? "+" : ""}{formatPrice(payload.market.change)}
                  　({formatPercent(payload.market.changePercent, 2)})
                </em>
              </div>
              <div className="market-facts">
                <div><span>1 個月</span><ReturnValue value={periodReturn(payload.bars, 22)} /></div>
                <div><span>3 個月</span><ReturnValue value={periodReturn(payload.bars, 66)} /></div>
                <div><span>1 年</span><ReturnValue value={periodReturn(payload.bars, 252)} /></div>
                <small>{payload.market.basis}</small>
              </div>
              <div className="company-actions">
                <button type="button" onClick={toggleCompanySave} aria-pressed={savedSymbols.includes(payload.company.symbol)}>
                  <span aria-hidden="true">{savedSymbols.includes(payload.company.symbol) ? "★" : "☆"}</span>
                  {savedSymbols.includes(payload.company.symbol) ? "已收進觀察簿" : "加入觀察簿"}
                </button>
                <button type="button" onClick={() => void shareCurrentView()}>
                  <span aria-hidden="true">↗</span>{shareFeedback || "分享這張盤"}
                </button>
              </div>
            </div>

            <div className={`lens-switcher lens-switcher--${lens}`}>
              <div>
                <span className="section-index">READING LENS</span>
                <h3>同一張盤，用兩種方式看</h3>
                <p>{lens === "symbolic"
                  ? "先用命盤符號掌握公司的時間質地，再逐層打開資料。"
                  : "先看樣本、報酬與反例，再決定這個符號值不值得繼續研究。"}</p>
              </div>
              <div role="group" aria-label="閱讀鏡模式">
                <button type="button" className={lens === "symbolic" ? "is-active" : ""} aria-pressed={lens === "symbolic"} onClick={() => setLens("symbolic")}>
                  <span aria-hidden="true">✦</span><b>玄覽</b><small>命格・象徵・儀式</small>
                </button>
                <button type="button" className={lens === "evidence" ? "is-active" : ""} aria-pressed={lens === "evidence"} onClick={() => setLens("evidence")}>
                  <span aria-hidden="true">◎</span><b>驗證</b><small>歷史・樣本・反例</small>
                </button>
              </div>
            </div>

            <div className="anchor-strip">
              <div className="anchor-heading">
                <span className="section-index">01 / ANCHOR</span>
                <div><h3>先確定這間公司的「生日」</h3><p>不同基準會得到不同命盤，所以永遠連同來源與精度顯示。</p></div>
              </div>
              <div className="anchor-options" role="group" aria-label="命盤日期基準">
                {(["listing", "established"] as AnchorKey[]).map((key) => {
                  const option = payload.anchors[key];
                  const active = key === anchorKey;
                  return (
                    <button
                      key={key}
                      className={active ? "is-active" : ""}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setAnchor(key)}
                    >
                      <span className="radio-mark"><i /></span>
                      <span><small>{key === "listing" ? "資本市場命盤" : "公司成立命盤"}</small><b>{option.label}</b><em>{formatDate(option.date)}</em></span>
                      <span className={`precision-badge precision-badge--${option.precision}`}>{option.precisionLabel}</span>
                    </button>
                  );
                })}
              </div>
              <div className="anchor-source">
                <span><b>目前基準</b>{formatDate(anchor.date)} · {anchor.label}</span>
                <span><b>時間與時區</b>{anchor.timeLabel} · Asia/Taipei</span>
                <span><b>資料信心</b>{anchor.confidence} · 公司基本資料表</span>
              </div>
            </div>

            <div className={`dashboard-grid dashboard-grid--${lens}`}>
              <section className="chart-panel" aria-labelledby="price-title">
                <div className="panel-heading">
                  <div><span className="section-index">02 / TIMELINE</span><h3 id="price-title">把相位事件標在價格上</h3></div>
                  <div className="range-switch" role="group" aria-label="圖表時間範圍">
                    {(["3M", "6M", "1Y"] as RangeKey[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={range === item ? "is-active" : ""}
                        aria-pressed={range === item}
                        onClick={() => setChartRange(item)}
                      >{item}</button>
                    ))}
                  </div>
                </div>
                <div className="chart-context">
                  <span>日線 · TWD</span>
                  <span>{visibleBars.length} 個交易日</span>
                  <span>{visibleEvents.length} 個主要相位窗口</span>
                </div>
                <PriceChart
                  bars={visibleBars}
                  events={visibleEvents}
                  selectedEvent={selectedEvent}
                  onSelectEvent={(event) => setSelectedEventId(event.id)}
                />
              </section>

              <aside className="natal-panel" aria-labelledby="natal-title">
                <div className="panel-heading">
                  <div><span className="section-index">NATAL CHART</span><h3 id="natal-title">公司本命基準</h3></div>
                  <span className={`confidence-pill confidence-pill--${anchor.precision}`}><i /> {anchor.precisionLabel}</span>
                </div>
                {signature ? (
                  <div className={`signature-card signature-card--${signature.dominant}`}>
                    <div className="signature-seal" aria-hidden="true"><i /><span>{anchorKey === "listing" ? "市" : "立"}</span></div>
                    <div><span>{signature.sun} · {signature.label}</span><h4>{signature.title}</h4><p>{signature.body}</p></div>
                  </div>
                ) : null}
                <PlanetWheel natal={anchor.natal} selectedEvent={selectedEvent} />
                <div className="precision-note">
                  <span aria-hidden="true">i</span>
                  <p><b>{anchor.timeLabel}</b><br />因此本版只比較行星黃經與相位，不顯示上升、宮位或紫微時盤。</p>
                </div>
              </aside>
            </div>

            <section className="upcoming-section" aria-labelledby="upcoming-title">
              <div className="upcoming-intro">
                <span className="section-index">03 / NEXT WINDOW</span>
                <h3 id="upcoming-title">下一個觀察窗口</h3>
                <p>這些是未來 120 天內較接近精確的主要相位。只先標記「何時看」，不預設價格會往哪裡走。</p>
              </div>
              <div className="upcoming-rail">
                {anchor.upcoming.slice(0, 4).map((event, index) => {
                  const key = `${payload.company.symbol}:${anchorKey}:${event.id}`;
                  const saved = savedWindows.includes(key);
                  return (
                    <article key={event.id} className={`upcoming-card upcoming-card--${event.tone}`}>
                      <div><span>{String(index + 1).padStart(2, "0")}</span><em>{event.orb.toFixed(2)}°</em></div>
                      <time dateTime={event.date}>{formatDate(event.date)}</time>
                      <strong>{event.transitGlyph}{event.aspectGlyph}{event.natalGlyph}</strong>
                      <h4>{event.transitBodyZh}{event.aspectZh}{event.natalBodyZh}</h4>
                      <p>{event.tone === "flow" ? "關係較順的象徵窗口" : event.tone === "tension" ? "張力與調整主題較強" : "同一主題集中放大"}</p>
                      <button type="button" aria-pressed={saved} onClick={() => toggleWindowSave(event)}>
                        {saved ? "★ 已收進觀察" : "☆ 記住這一天"}
                      </button>
                    </article>
                  );
                })}
              </div>
              <small className="upcoming-boundary">天象精確日可落在休市日；市場對照會以最近的實際交易日為準。</small>
            </section>

            <section className={`study-section study-section--${lens}`} aria-labelledby="study-title">
              <div className="study-heading">
                <div><span className="section-index">04 / EVIDENCE LEDGER</span><h3 id="study-title">回到過去，看實際發生什麼</h3><p>每個相位以最接近精確的交易日為代表，報酬從當日收盤往後對照。</p></div>
                <div className="study-summary">
                  <div><span>主要窗口</span><strong>{visibleEvents.length}</strong><small>次</small></div>
                  <div><span>D+5 中位數</span><strong className={(stats.median5 || 0) >= 0 ? "positive" : "negative"}>{formatPercent(stats.median5)}</strong></div>
                  <div><span>D+20 中位數</span><strong className={(stats.median20 || 0) >= 0 ? "positive" : "negative"}>{formatPercent(stats.median20)}</strong></div>
                  <div><span>D+20 正報酬比例</span><strong>{stats.winRate20 === null ? "—" : `${stats.winRate20.toFixed(0)}%`}</strong><small>{stats.completed20} 筆完成</small></div>
                </div>
              </div>

              <div className="study-layout">
                <div className="event-table-wrap" id="event-table" tabIndex={-1}>
                  <table className="event-table">
                    <thead><tr><th>交易日</th><th>主要相位窗口</th><th>當日收盤</th><th>D+5</th><th>D+20</th><th><span className="sr-only">選擇</span></th></tr></thead>
                    <tbody>
                      {[...visibleEvents].reverse().slice(0, 8).map((event) => {
                        const active = selectedEvent?.id === event.id;
                        return (
                          <tr key={event.id} className={active ? "is-active" : ""}>
                            <td><time dateTime={event.date}>{formatDate(event.date)}</time></td>
                            <td><span className={`aspect-token aspect-token--${event.tone}`}>{event.transitGlyph}{event.aspectGlyph}{event.natalGlyph}</span><span><b>{event.transitBodyZh}{event.aspectZh}{event.natalBodyZh}</b><small>容許度 {event.orb.toFixed(2)}°</small></span></td>
                            <td>NT$ {formatPrice(event.close)}</td>
                            <td><ReturnValue value={event.return5} /></td>
                            <td><ReturnValue value={event.return20} /></td>
                            <td><button type="button" onClick={() => setSelectedEventId(event.id)} aria-label={`查看 ${formatDate(event.date)} 相位`} aria-pressed={active}>{active ? "正在看" : "展開"}<span aria-hidden="true">↗</span></button></td>
                          </tr>
                        );
                      })}
                      {!visibleEvents.length ? (
                        <tr><td colSpan={6} className="empty-row">這個時間範圍沒有符合條件的主要相位，可切換到 1Y 查看。</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <article className={`reading-card reading-card--${selectedEvent?.tone || "focus"}`}>
                  <div className="reading-card-head"><span>05 / INTERPRETATION</span><em>文化解讀</em></div>
                  <div className="reading-symbol" aria-hidden="true">{selectedEvent ? `${selectedEvent.transitGlyph}${selectedEvent.aspectGlyph}${selectedEvent.natalGlyph}` : "···"}</div>
                  <p className="reading-date">{selectedEvent ? `${formatDate(selectedEvent.date)} · 容許度 ${selectedEvent.orb.toFixed(2)}°` : "尚未選擇事件"}</p>
                  <h4>{reading.title}</h4>
                  <p>{reading.body}</p>
                  <blockquote>{reading.question}</blockquote>
                  <span className="reading-boundary">不做因果推論 · 不產生買賣訊號</span>
                </article>
              </div>
            </section>

            <section className="method-section" id="methodology">
              <div><span className="section-index">METHOD / 06</span><h3>這張圖可以怎麼讀</h3></div>
              <div className="method-grid">
                <article><span>01</span><h4>先看基準是什麼</h4><p>「首日上市交易」用交易所 09:00 開盤作為推定時間；「公司成立日」只有日期，不延伸到宮位。</p></article>
                <article><span>02</span><h4>再看事件當天</h4><p>標記以行運火星、木星、土星與本命重要行星的主要相位為主，取最近精確的交易日。</p></article>
                <article><span>03</span><h4>最後回到實際價格</h4><p>D+5 與 D+20 是從當日原始收盤價向後對照，未還原除權息。樣本小時，它只是線索。</p></article>
              </div>
              <div className="source-row">
                <span>公司資料更新 {formatDate(payload.company.registryUpdatedAt)}</span>
                <a href={payload.sources.company} target="_blank" rel="noreferrer">公司資料來源 ↗</a>
                <a href={payload.sources.price} target="_blank" rel="noreferrer">個股日成交資訊 ↗</a>
              </div>
            </section>
          </>
        ) : null}
      </section>

      <section className="disclaimer" aria-label="重要使用界線">
        <span className="disclaimer-mark" aria-hidden="true">※</span>
        <div><b>請把它當成文化研究與資料探索工具。</b><p>命盤與價格之間的歷史重合不代表因果，也不能預測未來。本網站不構成投資、法律或財務建議。</p></div>
      </section>

      <footer>
        <a className="brand brand--footer" href="#top"><span className="brand-mark" aria-hidden="true"><i /></span><span><b>盤勢</b><small>PANSHI</small></span></a>
        <p>把時間當成索引，把價格當成證據。</p>
        <span>研究版 · 2026</span>
      </footer>
    </main>
  );
}
