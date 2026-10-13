import * as Plot from "@observablehq/plot";
import { feature } from "topojson-client";
import countries from "world-atlas/countries-50m.json";

type Row = Record<string, any>;
interface Data {
  summary: Row;
  group_order: string[];
  weekly: { week: string; group: string; len: number; partial: boolean; iso_week: number }[];
  heat: { weekday: number; hour: number; len: number }[];
  by_type: { type: string; group: string; len: number }[];
  region_group: { region_name: string; group: string; len: number }[];
  roads: { road: string; n: number; uheld: number; median_clear: number | null; region: string }[];
  durations: { group: string; minutes: number }[];
  dur_summary: Row[];
  points: {
    id: string; lon: number; lat: number; group: string; type: string; title: string;
    road: string | null; region_name: string; n_updates: number; created: string; minutes: number | null;
    inferred: boolean;
  }[];
}

const WEEKDAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const css = (name: string) => getComputedStyle(document.querySelector(".viz-root")!).getPropertyValue(name).trim();
const fmt = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 });

function colors(order: string[]) {
  return { domain: order, range: order.map((_, i) => css(`--series-${i + 1}`)) };
}

// Each interactive legend filters only its own chart. Colours stay bound to the
// full group order, so hiding one never repaints the rest.
const hiddenWeekly = new Set<string>();
const hiddenRegion = new Set<string>();
const hiddenTypes = new Set<string>();
const hiddenRoadParts = new Set<string>();

function swatch(color: string, dot: boolean) {
  const i = document.createElement("i");
  if (dot) i.className = "dot";
  i.style.background = color;
  i.style.borderColor = color;
  return i;
}

type LegendItem = { key: string; label: string; color: string };
interface LegendState {
  keys: string;
  hidden: Set<string>;
  onChange: () => void;
  buttons: Map<string, HTMLButtonElement>;
  reset: HTMLButtonElement;
  doubleClick: boolean;
  pending?: number;
}
const legends = new WeakMap<HTMLElement, LegendState>();
// How long a single click waits to see if it becomes a double-click
const DOUBLE_CLICK_MS = 200;

/**
 * Legend whose items toggle membership in `hidden`; at least one item always
 * stays visible. Double-click shows only that item (again: show all).
 * A mouse click waits DOUBLE_CLICK_MS before toggling, and a second click
 * cancels it, so a double-click never flashes the single-click state.
 * Buttons are built once and updated in place so the click count carries
 * across both clicks.
 */
function toggleLegend(
  el: HTMLElement,
  items: LegendItem[],
  hidden: Set<string>,
  onChange: () => void,
  { doubleClick = true } = {},
) {
  const keys = items.map((i) => i.key).join("|");
  let st = legends.get(el);
  if (!st || st.keys !== keys) {
    const state: LegendState = {
      keys,
      hidden,
      onChange,
      buttons: new Map(),
      doubleClick,
      reset: Object.assign(document.createElement("button"), { type: "button", className: "reset", textContent: "Vis alle" }),
    };
    for (const { key, label } of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.append(swatch("", false), document.createTextNode(label));
      const toggle = () => {
        const h = state.hidden;
        if (h.has(key)) h.delete(key);
        else if (h.size < items.length - 1) h.add(key);
        state.onChange();
      };
      const solo = () => {
        const h = state.hidden;
        const others = items.filter((i) => i.key !== key).map((i) => i.key);
        const alreadySolo = !h.has(key) && others.every((k) => h.has(k));
        h.clear();
        if (!alreadySolo) others.forEach((k) => h.add(k));
        state.onChange();
      };
      b.addEventListener("click", (e) => {
        clearTimeout(state.pending);
        if (!doubleClick || e.detail === 0) toggle(); // keyboard: no double-click to wait for
        else if (e.detail === 1) state.pending = window.setTimeout(toggle, DOUBLE_CLICK_MS);
        else if (e.detail === 2) solo();
      });
      state.buttons.set(key, b);
    }
    state.reset.addEventListener("click", () => {
      state.hidden.clear();
      state.onChange();
    });
    el.replaceChildren(...state.buttons.values(), state.reset);
    legends.set(el, state);
    st = state;
  }
  st.hidden = hidden;
  st.onChange = onChange;
  for (const { key, label, color } of items) {
    const b = st.buttons.get(key)!;
    const on = !hidden.has(key);
    b.setAttribute("aria-pressed", String(on));
    b.title = `${on ? "Skjul" : "Vis"} ${label}` + (st.doubleClick ? ` · dobbeltklik for kun at vise ${label}` : "");
    const sw = b.querySelector("i")!;
    sw.style.background = color;
    sw.style.borderColor = color;
  }
  st.reset.hidden = hidden.size === 0;
}

function groupLegend(id: string, d: Data, hidden: Set<string>, redraw: () => void, opts?: { doubleClick?: boolean }) {
  const c = colors(d.group_order);
  toggleLegend(
    document.getElementById(id)!,
    d.group_order.map((g, i) => ({ key: g, label: g, color: c.range[i] })),
    hidden,
    redraw,
    opts,
  );
}

function mount(id: string, node: Element) {
  document.getElementById(id)!.replaceChildren(node);
}

function width(id: string) {
  return document.getElementById(id)!.clientWidth || 600;
}

// Shared look: recessive axes, text tokens for ink
function base(): Plot.PlotOptions {
  return {
    style: { background: "transparent", color: css("--text-muted"), fontSize: "12px", fontFamily: "inherit" },
  };
}

function tiles(d: Data) {
  const s = d.summary;
  const acc = d.dur_summary.find((r) => r.group === "Uheld");
  const weekdays = d.heat.filter((h) => h.weekday <= 5).reduce((a, h) => a + h.len, 0);
  const weekend = d.heat.filter((h) => h.weekday > 5).reduce((a, h) => a + h.len, 0);
  const nWeeks = s.days / 7;
  const items = [
    { label: "Meldinger", value: s.n.toLocaleString("da-DK"), hint: `${fmt.format(s.days)} dage` },
    { label: "Pr. hverdag / weekenddag", value: `${fmt.format(weekdays / (nWeeks * 5))} / ${fmt.format(weekend / (nWeeks * 2))}`, hint: "gennemsnit" },
    { label: "Andel uheld", value: `${Math.round(s.accident_share * 100)} %`, hint: "af alle meldinger" },
    { label: "Median varighed, uheld", value: `${Math.round(acc?.median ?? 0)} min`, hint: `90 % inden ${Math.round(acc?.p90 ?? 0)} min` },
  ];
  document.getElementById("tiles")!.replaceChildren(
    ...items.map((t) => {
      const el = document.createElement("div");
      el.className = "tile";
      for (const [cls, text] of [["label", t.label], ["value", t.value], ["hint", t.hint]]) {
        const c = document.createElement("div");
        c.className = cls;
        c.textContent = text;
        el.append(c);
      }
      return el;
    }),
  );
  const start = new Date(s.start).toLocaleDateString("da-DK", { day: "numeric", month: "long" });
  const end = new Date(s.end).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" });
  document.getElementById("lede")!.textContent =
    `${s.n} afsluttede trafikmeldinger fra ${start} til ${end}. ` +
    `Omkring halvdelen er uheld, og de fleste er ryddet inden for en time. Togforstyrrelser trækker længst ud.`;
}

function heat(d: Data) {
  const w = width("heat");
  mount(
    "heat",
    Plot.plot({
      ...base(),
      width: w,
      height: 230,
      marginLeft: 40,
      padding: 0.06,
      x: { label: null, domain: Array.from({ length: 24 }, (_, i) => i), tickFormat: (h: number) => `${String(h).padStart(2, "0")}` },
      y: { label: null, domain: [1, 2, 3, 4, 5, 6, 7], tickFormat: (d: number) => WEEKDAYS[d - 1] },
      color: { type: "linear", range: [css("--seq-lo"), css("--seq-hi")], legend: true, label: "Meldinger" },
      marks: [
        Plot.cell(d.heat, {
          x: "hour",
          y: "weekday",
          fill: "len",
          rx: 3,
          tip: { format: { x: false, y: false, fill: false } },
          title: (r: Row) => `${WEEKDAYS[r.weekday - 1]} kl. ${String(r.hour).padStart(2, "0")}–${String(r.hour + 1).padStart(2, "0")}\n${r.len} meldinger`,
        }),
      ],
    }),
  );
}

const shortDate = (dt: Date, opts: Intl.DateTimeFormatOptions) => dt.toLocaleDateString("da-DK", opts);

function weekLabel(r: { week: string; iso_week: number; partial: boolean }) {
  const start = new Date(r.week);
  const end = new Date(start.getTime() + 6 * 86400000);
  const range = `${shortDate(start, { day: "numeric", month: "short" })}–${shortDate(end, { day: "numeric", month: "short", year: "numeric" })}`;
  return `Uge ${r.iso_week} · ${range}${r.partial ? " (delvis uge)" : ""}`;
}

const hh = (h: number) => String(h).padStart(2, "0");

// Commute peaks and the quiet night window, read from the data so the text stays true
function heatNote(d: Data) {
  const weekday = Array(24).fill(0);
  const all = Array(24).fill(0);
  for (const r of d.heat) {
    all[r.hour] += r.len;
    if (r.weekday <= 5) weekday[r.hour] += r.len;
  }
  const peak = (from: number, to: number) => {
    const hours = Array.from({ length: to - from }, (_, i) => from + i);
    const max = Math.max(...hours.map((h) => weekday[h]));
    const top = hours.filter((h) => weekday[h] >= 0.9 * max);
    return top.length > 1 ? `${hh(top[0])}–${hh(top.at(-1)! + 1)}` : hh(top[0]);
  };
  // Longest run of near-empty hours, wrapping past midnight
  const quiet = all.map((n) => n < 0.01 * Math.max(...all));
  let best = { start: 0, len: 0 };
  for (let s = 0; s < 24; s++) {
    if (!quiet[s] || quiet[(s + 23) % 24]) continue;
    let len = 0;
    while (len < 24 && quiet[(s + len) % 24]) len++;
    if (len > best.len) best = { start: s, len };
  }
  const night = best.len ? ` Mellem kl. ${hh(best.start)} og ${hh((best.start + best.len) % 24)} er der næsten ingen meldinger.` : "";
  document.getElementById("heat-note")!.textContent =
    `På hverdage topper meldingerne i myldretiden, omkring kl. ${peak(5, 12)} og kl. ${peak(12, 20)}. ` +
    `I weekenden er der langt færre, spredt over dagen.${night} ` +
    `Det afspejler både trafikken og redaktionens vagter. Uheld sker også om natten, så vi kan ikke skille de to ad.`;
}

function weekly(d: Data) {
  const c = colors(d.group_order);
  groupLegend("weekly-legend", d, hiddenWeekly, () => weekly(d));
  const weeks = [...new Set(d.weekly.map((r) => r.week))];
  const firstLabel = weeks.findIndex((w) => new Date(w).getDate() <= 7);
  mount(
    "weekly",
    Plot.plot({
      ...base(),
      width: width("weekly"),
      height: 270,
      marginTop: 30,
      x: {
        type: "band",
        label: null,
        domain: weeks,
        tickSize: 0,
        // Label the first week of each month; add the year in January and on the first label
        tickFormat: (w: string, i: number) => {
          const dt = new Date(w);
          if (dt.getDate() > 7) return "";
          return shortDate(dt, dt.getMonth() === 0 || i === firstLabel ? { month: "short", year: "numeric" } : { month: "short" });
        },
      },
      y: { label: null, grid: true, nice: true },
      color: c,
      marks: [
        Plot.barY(d.weekly.filter((r) => !hiddenWeekly.has(r.group)), {
          x: "week",
          y: "len",
          fill: "group",
          // Partial first/last weeks are faded so their low totals don't read as a dip
          fillOpacity: (r: Row) => (r.partial ? 0.45 : 1),
          order: d.group_order,
          insetTop: 1,
          insetBottom: 1,
          insetLeft: 1,
          insetRight: 1,
          tip: true,
          title: (r: Row) => `${weekLabel(r as any)}\n${r.group}: ${r.len}`,
        }),
        Plot.ruleY([0], { stroke: css("--baseline") }),
        ...schemaMarker(d),
      ],
    }),
  );
}

// Divider at DR's schema change: road categories to its left are inferred
function schemaMarker(d: Data) {
  const at = d.summary.schema_change_week;
  if (!at || !d.weekly.some((r) => r.week === at)) return [];
  return [
    Plot.ruleX([at], { stroke: css("--text-secondary"), strokeWidth: 1 }),
    Plot.text([at], {
      x: (v: string) => v,
      frameAnchor: "top",
      lineAnchor: "bottom",
      dy: -8,
      dx: -6,
      textAnchor: "end",
      fill: css("--text-secondary"),
      text: () => "← type udledt af overskrift",
    }),
    Plot.text([at], {
      x: (v: string) => v,
      frameAnchor: "top",
      lineAnchor: "bottom",
      dy: -8,
      dx: 6,
      textAnchor: "start",
      fill: css("--text-secondary"),
      text: () => "DR's kategorier →",
    }),
  ];
}

function roads(d: Data) {
  const top = d.roads.slice(0, 15);
  const long = top.flatMap((r) => [
    { road: r.road, part: "Uheld", n: r.uheld, total: r.n, med: r.median_clear },
    { road: r.road, part: "Øvrige", n: r.n - r.uheld, total: r.n, med: r.median_clear },
  ]);
  const acc = css("--series-1");
  const rest = css("--seq-light");
  toggleLegend(
    document.getElementById("roads-legend")!,
    [
      { key: "Uheld", label: "Uheld", color: acc },
      { key: "Øvrige", label: "Øvrige meldinger", color: rest },
    ],
    hiddenRoadParts,
    () => roads(d),
  );
  const visibleParts = long.filter((r) => !hiddenRoadParts.has(r.part));
  // Total label tracks what's shown, so it always sits at the bar end
  const totals = top.map((r) => ({
    road: r.road,
    n: visibleParts.filter((p) => p.road === r.road).reduce((a, p) => a + p.n, 0),
  }));
  mount(
    "roads",
    Plot.plot({
      ...base(),
      width: width("roads"),
      height: top.length * 26 + 30,
      marginLeft: 150,
      marginRight: 36,
      x: { label: null, grid: true, axis: "top" },
      y: { label: null, domain: top.map((r) => r.road) },
      color: { domain: ["Uheld", "Øvrige"], range: [acc, rest] },
      marks: [
        Plot.barX(visibleParts, {
          y: "road",
          x: "n",
          fill: "part",
          order: ["Uheld", "Øvrige"],
          insetTop: 4,
          insetBottom: 4,
          insetLeft: 1,
          insetRight: 1,
          tip: true,
          title: (r: Row) => `${r.road}\n${r.part}: ${r.n} af ${r.total}\nMedian varighed: ${r.med == null ? "–" : Math.round(r.med) + " min"}`,
        }),
        Plot.text(totals, { y: "road", x: "n", text: (r: Row) => String(r.n), dx: 6, textAnchor: "start", fill: css("--text-secondary") }),
        Plot.ruleX([0], { stroke: css("--baseline") }),
      ],
    }),
  );
}

const DUR_TICKS = [0, 5, 30, 60, 240, 1440];

function durations(d: Data) {
  const c = colors(d.group_order);
  const surface = css("--surface-1");
  mount(
    "dur",
    Plot.plot({
      ...base(),
      width: width("dur"),
      height: 300,
      marginLeft: 120,
      marginRight: 30,
      // Symlog: logarithmic for long durations, linear near zero so 0 has a place
      x: { type: "symlog", constant: 5, domain: [0, 3000], clamp: true },
      y: { label: null, domain: d.group_order },
      color: c,
      marks: [
        // Grid and axis first so they sit behind the boxes
        Plot.gridX(DUR_TICKS, { stroke: css("--grid"), strokeOpacity: 1 }),
        // Units on the ticks instead of an axis label
        Plot.axisX(DUR_TICKS, { label: null, tickFormat: (m: number) => (m === 0 ? "0" : m >= 60 ? `${m / 60} t` : `${m} min`) }),
        Plot.boxX(d.durations, {
          x: "minutes",
          y: "group",
          fill: "group",
          stroke: css("--text-muted"),
          r: 2,
          insetTop: 4,
          insetBottom: 4,
        }),
        // Median as a surface-coloured cut through the box, legible on every hue
        Plot.tickX(d.dur_summary, { x: "median", y: "group", stroke: surface, strokeWidth: 2, insetTop: 4, insetBottom: 4 }),
        Plot.tip(d.dur_summary, Plot.pointerY({
          y: "group",
          x: "median",
          title: (r: Row) => `${r.group} (n=${r.n})\nMedian: ${Math.round(r.median)} min\n25–75 %: ${Math.round(r.p25)}–${Math.round(r.p75)} min\n90 %: ${Math.round(r.p90)} min`,
        })),
      ],
    }),
  );
}

const geo = feature(countries as any, (countries as any).objects.countries) as any;
const neighbours = { type: "FeatureCollection", features: geo.features.filter((f: any) => ["Sweden", "Germany"].includes(f.properties.name)) };
const denmark = { type: "FeatureCollection", features: geo.features.filter((f: any) => f.properties.name === "Denmark") };

// Small multiples: one panel per group, so each keeps its own colour and no
// scatter needs more than one hue (all-pairs colour separation doesn't apply).
function maps(d: Data) {
  const c = colors(d.group_order);
  const container = document.getElementById("maps")!;
  const visible = d.group_order;
  const pts = d.points;
  // Measure one grid column; panels are drawn at that width
  container.replaceChildren(...visible.map(() => document.createElement("div")));
  const w = (container.firstElementChild as HTMLElement)?.clientWidth || 340;

  visible.forEach((g, idx) => {
    const own = pts.filter((p) => p.group === g);
    const others = pts.filter((p) => p.group !== g);
    const panel = container.children[idx] as HTMLElement;
    panel.className = "map-panel";

    const h = document.createElement("h3");
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(own.length);
    h.append(swatch(c.range[d.group_order.indexOf(g)], true), document.createTextNode(g), count);

    const plot = Plot.plot({
      ...base(),
      width: w,
      height: Math.round(w * 0.8),
      margin: 0,
      projection: { type: "transverse-mercator", rotate: [-10.5, -56], domain: { type: "MultiPoint", coordinates: [[8, 54.55], [12.7, 57.8]] } },
      marks: [
        Plot.geo(neighbours, { fill: css("--land-other") }),
        Plot.geo(denmark, { fill: css("--land"), stroke: css("--baseline"), strokeWidth: 0.5 }),
        Plot.dot(others, { x: "lon", y: "lat", r: 1.5, fill: css("--text-muted"), fillOpacity: 0.35 }),
        Plot.dot(own, {
          x: "lon",
          y: "lat",
          r: 4,
          fill: c.range[d.group_order.indexOf(g)],
          stroke: css("--surface-1"),
          strokeWidth: 1.5,
        }),
        // Hovered dot lifts: larger, with an ink ring
        Plot.dot(own, Plot.pointer({
          x: "lon",
          y: "lat",
          maxRadius: 20,
          r: 6.5,
          fill: c.range[d.group_order.indexOf(g)],
          stroke: css("--text-primary"),
          strokeWidth: 2,
        })),
      ],
    });
    const color = c.range[d.group_order.indexOf(g)];
    plot.addEventListener("input", () => {
      const p = (plot as any).value as Point | null;
      if (p) showTooltip(pointTooltip(p, color));
      else hideTooltip();
    });
    plot.addEventListener("pointermove", (e) => moveTooltip(e as PointerEvent));
    plot.addEventListener("pointerleave", hideTooltip);
    panel.replaceChildren(h, plot);
  });
}

type Point = Data["points"][number];

const TYPE_LABELS: Record<string, string> = {
  ACCIDENT: "Uheld", BREAKDOWN: "Havareret køretøj", LORRY: "Lastbil", AUTOMOBILE: "Bil",
  MC: "Motorcykel", QUEUE: "Kø", TRAIN: "Tog", LIGHTRAIL: "Letbane", METRO: "Metro",
  BUS: "Bus", FERRY: "Færge", BLOCKED: "Spærret vej", CLEANUP: "Oprydning", FIRE: "Brand",
  WIND: "Blæst", ROADWORK: "Vejarbejde", SLIPPERY: "Glat vej / spild", FLOOD: "Oversvømmelse",
  PIG: "Dyr på vejen", EMERGENCY: "Politi / beredskab",
};

function duration(min: number) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} t ${m} min` : `${h} t`;
}

const tooltip = Object.assign(document.createElement("div"), { className: "tooltip", role: "tooltip" });
tooltip.hidden = true;
document.querySelector(".viz-root")!.append(tooltip);

function el(tag: string, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Event first (what happened), then the facts as a small label/value grid. */
function pointTooltip(p: Point, color: string) {
  const key = el("div", "tt-key");
  const line = el("i", "");
  line.style.background = color;
  key.append(line, document.createTextNode(p.inferred ? `${p.group} · udledt af overskrift` : (TYPE_LABELS[p.type] ?? p.type)));

  const when = new Date(p.created.replace(" ", "T")).toLocaleString("da-DK", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const rows: [string, string][] = [["Tidspunkt", when]];
  if (p.minutes != null) rows.push(["Varighed", duration(p.minutes)]);
  if (p.road) rows.push(["Vej", p.road]);
  rows.push(["Region", p.region_name], ["Opdateringer", String(p.n_updates)]);

  const grid = el("dl", "tt-grid");
  for (const [k, v] of rows) grid.append(el("dt", "", k), el("dd", "", v));
  return [key, el("div", "tt-title", p.title), grid];
}

function showTooltip(content: Node[]) {
  tooltip.replaceChildren(...content);
  tooltip.hidden = false;
}

function hideTooltip() {
  tooltip.hidden = true;
}

// Follow the pointer, flipping to the other side near the viewport edges
function moveTooltip(e: PointerEvent) {
  if (tooltip.hidden) return;
  const pad = 14;
  const { width: w, height: h } = tooltip.getBoundingClientRect();
  const x = e.clientX + pad + w > innerWidth ? e.clientX - pad - w : e.clientX + pad;
  const y = e.clientY + pad + h > innerHeight ? e.clientY - pad - h : e.clientY + pad;
  tooltip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}

function regions(d: Data) {
  const c = colors(d.group_order);
  // Shares of 100 %: showing a single group would just fill every bar
  groupLegend("region-legend", d, hiddenRegion, () => regions(d), { doubleClick: false });
  mount(
    "region",
    Plot.plot({
      ...base(),
      width: width("region"),
      height: 140,
      marginLeft: 150,
      x: { label: null, percent: true, tickFormat: (v: number) => `${v} %`, grid: true },
      y: { label: null },
      color: c,
      marks: [
        Plot.barX(d.region_group.filter((r) => !hiddenRegion.has(r.group)), Plot.stackX({
          offset: "normalize",
          order: d.group_order,
          y: "region_name",
          x: "len",
          fill: "group",
          insetLeft: 1,
          insetRight: 1,
          insetTop: 6,
          insetBottom: 6,
          tip: true,
          title: (r: Row) => `${r.region_name}\n${r.group}: ${r.len}`,
        })),
        Plot.ruleX([0], { stroke: css("--baseline") }),
      ],
    }),
  );
}

function types(d: Data) {
  const c = colors(d.group_order);
  groupLegend("types-legend", d, hiddenTypes, () => types(d));
  // Hidden groups drop their rows entirely, so the list closes up
  const rows = d.by_type.filter((r) => !hiddenTypes.has(r.group));
  mount(
    "types",
    Plot.plot({
      ...base(),
      width: width("types"),
      height: rows.length * 20 + 30,
      marginLeft: 100,
      marginRight: 36,
      x: { label: null, axis: null },
      y: { label: null, domain: rows.map((r) => r.type) },
      color: c,
      marks: [
        Plot.barX(rows, {
          y: "type",
          x: "len",
          fill: "group",
          insetTop: 3,
          insetBottom: 3,
          tip: true,
          title: (r: Row) => `${r.type} · ${TYPE_LABELS[r.type] ?? r.type}\n${r.group}: ${r.len}`,
        }),
        Plot.text(rows, { y: "type", x: "len", text: (r: Row) => String(r.len), dx: 6, textAnchor: "start", fill: css("--text-secondary") }),
        Plot.ruleX([0], { stroke: css("--baseline") }),
      ],
    }),
  );
}

function table(d: Data) {
  const t = document.getElementById("table") as HTMLTableElement;
  const head = t.createTHead().insertRow();
  for (const h of ["Tid", "Overskrift", "Type", "Region", "Opd.", "Min."]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  }
  const body = t.createTBody();
  const search = document.getElementById("search") as HTMLInputElement;
  const count = document.getElementById("table-count")!;
  const rows = [...d.points].sort((a, b) => b.created.localeCompare(a.created));
  const render = () => {
    const ql = search.value.toLowerCase();
    const match = rows.filter((p) => !ql || p.title.toLowerCase().includes(ql) || (p.road ?? "").toLowerCase().includes(ql));
    count.textContent = `Viser ${match.length} af ${rows.length} meldinger`;
    body.replaceChildren(
      ...match.map((p) => {
        const tr = document.createElement("tr");
        const cells: [string, string][] = [
          [p.created, "muted"], [p.title, ""], [p.inferred ? `${p.group} (udledt)` : p.type, "muted"], [p.region_name, "muted"],
          [String(p.n_updates), "num"], [p.minutes == null ? "–" : String(p.minutes), "num"],
        ];
        for (const [text, cls] of cells) {
          const td = tr.insertCell();
          td.textContent = text;
          if (cls) td.className = cls;
        }
        return tr;
      }),
    );
  };
  render();
  search.addEventListener("input", render);
}

const data: Data = await fetch(`${import.meta.env.BASE_URL}data.json`).then((r) => r.json());

const drawCharts = () => {
  heat(data);
  weekly(data);
  roads(data);
  durations(data);
  maps(data);
  regions(data);
  types(data);
};
tiles(data);
heatNote(data);
table(data);
drawCharts();

// Redraw on theme change and resize (colors are read from CSS vars at draw time)
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawCharts);
let raf = 0;
addEventListener("resize", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(drawCharts);
});
