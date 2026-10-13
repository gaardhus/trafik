import * as Plot from "@observablehq/plot";
import geo from "./geo.json";
import { applyStatic, group, lang, region, setLang, t, type, type Lang } from "./i18n";

type Row = Record<string, any>;
interface Data {
  summary: Row;
  group_order: string[];
  weekly: {
    week: string;
    group: string;
    len: number;
    partial: boolean;
    iso_week: number;
  }[];
  heat: { weekday: number; hour: number; group: string; len: number }[];
  by_type: { type: string; group: string; len: number }[];
  region_group: { region_name: string; group: string; len: number }[];
  roads: {
    road: string;
    n: number;
    uheld: number;
    median_clear: number | null;
    region: string;
  }[];
  durations: { group: string; minutes: number }[];
  dur_summary: Row[];
  points: {
    id: string;
    lon: number;
    lat: number;
    group: string;
    type: string;
    title: string;
    road: string | null;
    region_name: string;
    n_updates: number;
    created: string;
    minutes: number | null;
    inferred: boolean;
  }[];
}

const css = (name: string) =>
  getComputedStyle(document.querySelector(".viz-root")!)
    .getPropertyValue(name)
    .trim();
const fmt = (n: number) =>
  n.toLocaleString(t.locale, { maximumFractionDigits: 1 });

function colors(order: string[]) {
  return {
    domain: order,
    range: order.map((_, i) => css(`--series-${i + 1}`)),
  };
}

// Each interactive legend filters only its own chart. Colours stay bound to the
// full group order, so hiding one never repaints the rest.
const hiddenHeat = new Set<string>();
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
  const keys = items.map((i) => `${i.key}:${i.label}`).join("|");
  let st = legends.get(el);
  if (!st || st.keys !== keys) {
    const state: LegendState = {
      keys,
      hidden,
      onChange,
      buttons: new Map(),
      doubleClick,
      reset: Object.assign(document.createElement("button"), {
        type: "button",
        className: "reset",
        textContent: t.showAll,
      }),
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
        if (!doubleClick || e.detail === 0)
          toggle(); // keyboard: no double-click to wait for
        else if (e.detail === 1)
          state.pending = window.setTimeout(toggle, DOUBLE_CLICK_MS);
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
    b.title = t.legendTitle(on, label, st.doubleClick);
    const sw = b.querySelector("i")!;
    sw.style.background = color;
    sw.style.borderColor = color;
  }
  st.reset.hidden = hidden.size === 0;
}

function groupLegend(
  id: string,
  d: Data,
  hidden: Set<string>,
  redraw: () => void,
  opts?: { doubleClick?: boolean },
) {
  const c = colors(d.group_order);
  toggleLegend(
    document.getElementById(id)!,
    d.group_order.map((g, i) => ({ key: g, label: group(g), color: c.range[i] })),
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
    style: {
      background: "transparent",
      color: css("--text-muted"),
      fontSize: "12px",
      fontFamily: "inherit",
    },
  };
}

function tiles(d: Data) {
  const s = d.summary;
  const acc = d.dur_summary.find((r) => r.group === "Uheld");
  const weekdays = d.heat
    .filter((h) => h.weekday <= 5)
    .reduce((a, h) => a + h.len, 0);
  const weekend = d.heat
    .filter((h) => h.weekday > 5)
    .reduce((a, h) => a + h.len, 0);
  const nWeeks = s.days / 7;
  // In the order of the tiles in index.html, which holds the labels
  const items = [
    { value: s.n.toLocaleString(t.locale), hint: t.days(Math.round(s.days)) },
    {
      value: `${fmt(weekdays / (nWeeks * 5))} / ${fmt(weekend / (nWeeks * 2))}`,
      hint: t.average,
    },
    {
      value: t.pct(Math.round(s.accident_share * 100)),
      hint: t.ofAllReports,
    },
    {
      value: `${Math.round(acc?.median ?? 0)} min`,
      hint: t.p90Within(Math.round(acc?.p90 ?? 0)),
    },
  ];
  document.querySelectorAll("#tiles .tile").forEach((el, i) => {
    el.querySelector(".value")!.textContent = items[i].value;
    el.querySelector(".hint")!.textContent = items[i].hint;
  });
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(t.locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const withinHour =
    d.durations.filter((r) => r.minutes < 60).length / d.durations.length;
  const longest = d.dur_summary.reduce((a, r) => (r.median > a.median ? r : a));
  document.getElementById("lede")!.textContent = t.lede(
    s.n.toLocaleString(t.locale),
    date(s.start),
    date(s.end),
    Math.round(s.accident_share * 100),
    Math.round(withinHour * 100),
    group(longest.group).toLowerCase(),
    duration(longest.median),
  );
}

function heat(d: Data) {
  groupLegend("heat-legend", d, hiddenHeat, () => heat(d));
  // Sum the visible groups per cell; the colour scale follows what's shown
  const cells = new Map<string, Row>();
  for (const r of d.heat) {
    if (hiddenHeat.has(r.group)) continue;
    const key = `${r.weekday}-${r.hour}`;
    const cell =
      cells.get(key) ??
      cells.set(key, { weekday: r.weekday, hour: r.hour, len: 0 }).get(key)!;
    cell.len += r.len;
  }
  const w = width("heat");
  mount(
    "heat",
    Plot.plot({
      ...base(),
      width: w,
      height: 230,
      marginLeft: 40,
      padding: 0.06,
      x: {
        label: null,
        domain: Array.from({ length: 24 }, (_, i) => i),
        tickFormat: (h: number) => `${String(h).padStart(2, "0")}`,
      },
      y: {
        label: null,
        domain: [1, 2, 3, 4, 5, 6, 7],
        tickFormat: (d: number) => t.weekdays[d - 1],
      },
      color: {
        type: "linear",
        range: [css("--seq-lo"), css("--seq-hi")],
        legend: true,
        label: t.reports,
      },
      marks: [
        Plot.cell([...cells.values()], {
          x: "hour",
          y: "weekday",
          fill: "len",
          rx: 3,
          tip: { format: { x: false, y: false, fill: false } },
          title: (r: Row) => t.heatCell(t.weekdays[r.weekday - 1], r.hour, r.len),
        }),
      ],
    }),
  );
}

const shortDate = (dt: Date, opts: Intl.DateTimeFormatOptions) =>
  dt.toLocaleDateString(t.locale, opts);

function weekLabel(r: { week: string; iso_week: number; partial: boolean }) {
  const start = new Date(r.week);
  const end = new Date(start.getTime() + 6 * 86400000);
  const range = `${shortDate(start, { day: "numeric", month: "short" })}–${shortDate(end, { day: "numeric", month: "short", year: "numeric" })}`;
  return t.week(r.iso_week, range, r.partial);
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
  const night = best.len
    ? t.heatNight(best.start, (best.start + best.len) % 24)
    : "";
  document.getElementById("heat-note")!.textContent = t.heatNote(
    peak(5, 12),
    peak(12, 20),
    night,
  );
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
          return shortDate(
            dt,
            dt.getMonth() === 0 || i === firstLabel
              ? { month: "short", year: "numeric" }
              : { month: "short" },
          );
        },
      },
      y: { label: null, grid: true, nice: true },
      color: c,
      marks: [
        Plot.barY(
          d.weekly.filter((r) => !hiddenWeekly.has(r.group)),
          {
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
            title: (r: Row) =>
              `${weekLabel(r as any)}\n${group(r.group)}: ${r.len}`,
          },
        ),
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
      text: () => t.inferredFromTitle,
    }),
    Plot.text([at], {
      x: (v: string) => v,
      frameAnchor: "top",
      lineAnchor: "bottom",
      dy: -8,
      dx: 6,
      textAnchor: "start",
      fill: css("--text-secondary"),
      text: () => t.drCategories,
    }),
  ];
}

function roads(d: Data) {
  const top = d.roads.slice(0, 15);
  const long = top.flatMap((r) => [
    {
      road: r.road,
      part: "Uheld",
      n: r.uheld,
      total: r.n,
      med: r.median_clear,
    },
    {
      road: r.road,
      part: "Øvrige",
      n: r.n - r.uheld,
      total: r.n,
      med: r.median_clear,
    },
  ]);
  const acc = css("--series-1");
  const rest = css("--seq-light");
  toggleLegend(
    document.getElementById("roads-legend")!,
    [
      { key: "Uheld", label: group("Uheld"), color: acc },
      { key: "Øvrige", label: t.otherReports, color: rest },
    ],
    hiddenRoadParts,
    () => roads(d),
  );
  const visibleParts = long.filter((r) => !hiddenRoadParts.has(r.part));
  // Total label tracks what's shown, so it always sits at the bar end
  const totals = top.map((r) => ({
    road: r.road,
    n: visibleParts
      .filter((p) => p.road === r.road)
      .reduce((a, p) => a + p.n, 0),
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
          title: (r: Row) =>
            t.roadTip(
              r.road,
              group(r.part),
              r.n,
              r.total,
              r.med == null ? "–" : Math.round(r.med) + " min",
            ),
        }),
        Plot.text(totals, {
          y: "road",
          x: "n",
          text: (r: Row) => String(r.n),
          dx: 6,
          textAnchor: "start",
          fill: css("--text-secondary"),
        }),
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
      y: { label: null, domain: d.group_order, tickFormat: group },
      color: c,
      marks: [
        // Grid and axis first so they sit behind the boxes
        Plot.gridX(DUR_TICKS, { stroke: css("--grid"), strokeOpacity: 1 }),
        // Units on the ticks instead of an axis label
        Plot.axisX(DUR_TICKS, {
          label: null,
          tickFormat: (m: number) =>
            m === 0 ? "0" : m >= 60 ? `${m / 60} ${t.hours}` : `${m} min`,
        }),
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
        Plot.tickX(d.dur_summary, {
          x: "median",
          y: "group",
          stroke: surface,
          strokeWidth: 2,
          insetTop: 4,
          insetBottom: 4,
        }),
        Plot.tip(
          d.dur_summary,
          Plot.pointerY({
            y: "group",
            x: "median",
            title: (r: Row) =>
              t.durTip(
                group(r.group),
                r.n,
                Math.round(r.median),
                Math.round(r.p25),
                Math.round(r.p75),
                Math.round(r.p90),
              ),
          }),
        ),
      ],
    }),
  );
}

// Country outlines, pre-extracted by scripts/geo.ts
const neighbours = {
  type: "FeatureCollection",
  features: geo.features.filter((f: any) => f.properties.name !== "Denmark"),
} as any;
const denmark = {
  type: "FeatureCollection",
  features: geo.features.filter((f: any) => f.properties.name === "Denmark"),
} as any;

// Small multiples: one panel per group, so each keeps its own colour and no
// scatter needs more than one hue (all-pairs colour separation doesn't apply).
function maps(d: Data) {
  const c = colors(d.group_order);
  const container = document.getElementById("maps")!;
  const visible = d.group_order;
  const pts = d.points;
  // Measure one grid column on the current panels (placeholders on first draw);
  // panels are drawn at that width. Emptying the grid first would shrink the
  // page for a layout, and the browser would clamp a restored scroll position.
  const w = (container.firstElementChild as HTMLElement)?.clientWidth || 340;
  const panels = visible.map(() => document.createElement("div"));

  visible.forEach((g, idx) => {
    const own = pts.filter((p) => p.group === g);
    const others = pts.filter((p) => p.group !== g);
    const panel = panels[idx];
    panel.className = "map-panel";

    const h = document.createElement("h3");
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(own.length);
    h.append(
      swatch(c.range[d.group_order.indexOf(g)], true),
      document.createTextNode(group(g)),
      count,
    );

    const plot = Plot.plot({
      ...base(),
      width: w,
      height: Math.round(w * 0.8),
      margin: 0,
      projection: {
        type: "transverse-mercator",
        rotate: [-10.5, -56],
        domain: {
          type: "MultiPoint",
          coordinates: [
            [8, 54.55],
            [12.7, 57.8],
          ],
        },
      },
      marks: [
        Plot.geo(neighbours, { fill: css("--land-other") }),
        Plot.geo(denmark, {
          fill: css("--land"),
          stroke: css("--baseline"),
          strokeWidth: 0.5,
        }),
        Plot.dot(others, {
          x: "lon",
          y: "lat",
          r: 1.5,
          fill: css("--text-muted"),
          fillOpacity: 0.35,
        }),
        Plot.dot(own, {
          x: "lon",
          y: "lat",
          r: 4,
          fill: c.range[d.group_order.indexOf(g)],
          stroke: css("--surface-1"),
          strokeWidth: 1.5,
        }),
        // Hovered dot lifts: larger, with an ink ring
        Plot.dot(
          own,
          Plot.pointer({
            x: "lon",
            y: "lat",
            maxRadius: 20,
            r: 6.5,
            fill: c.range[d.group_order.indexOf(g)],
            stroke: css("--text-primary"),
            strokeWidth: 2,
          }),
        ),
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
  container.replaceChildren(...panels);
}

type Point = Data["points"][number];

function duration(min: number) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} ${t.hours} ${m} min` : `${h} ${t.hours}`;
}

const tooltip = Object.assign(document.createElement("div"), {
  className: "tooltip",
  role: "tooltip",
});
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
  key.append(
    line,
    document.createTextNode(
      p.inferred ? `${group(p.group)} · ${t.inferred}` : type(p.type),
    ),
  );

  const when = new Date(p.created.replace(" ", "T")).toLocaleString(t.locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const rows: [string, string][] = [[t.time, when]];
  if (p.minutes != null) rows.push([t.duration, duration(p.minutes)]);
  if (p.road) rows.push([t.road, p.road]);
  rows.push([t.region, region(p.region_name)], [t.updates, String(p.n_updates)]);

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
  const x =
    e.clientX + pad + w > innerWidth ? e.clientX - pad - w : e.clientX + pad;
  const y =
    e.clientY + pad + h > innerHeight ? e.clientY - pad - h : e.clientY + pad;
  tooltip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}

function regions(d: Data) {
  const c = colors(d.group_order);
  // Shares of 100 %: showing a single group would just fill every bar
  groupLegend("region-legend", d, hiddenRegion, () => regions(d), {
    doubleClick: false,
  });
  mount(
    "region",
    Plot.plot({
      ...base(),
      width: width("region"),
      height: 140,
      marginLeft: 150,
      x: {
        label: null,
        percent: true,
        tickFormat: (v: number) => t.pct(v),
        grid: true,
      },
      y: { label: null, tickFormat: region },
      color: c,
      marks: [
        Plot.barX(
          d.region_group.filter((r) => !hiddenRegion.has(r.group)),
          Plot.stackX({
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
            title: (r: Row) =>
              `${region(r.region_name)}\n${group(r.group)}: ${r.len}`,
          }),
        ),
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
      marginLeft: 130,
      marginRight: 36,
      x: { label: null, axis: null },
      y: {
        label: null,
        domain: rows.map((r) => r.type),
        tickFormat: type,
      },
      color: c,
      marks: [
        Plot.barX(rows, {
          y: "type",
          x: "len",
          fill: "group",
          insetTop: 3,
          insetBottom: 3,
          tip: true,
          title: (r: Row) =>
            `${type(r.type)} (${r.type})\n${group(r.group)}: ${r.len}`,
        }),
        Plot.text(rows, {
          y: "type",
          x: "len",
          text: (r: Row) => String(r.len),
          dx: 6,
          textAnchor: "start",
          fill: css("--text-secondary"),
        }),
        Plot.ruleX([0], { stroke: css("--baseline") }),
      ],
    }),
  );
}

/** Sets up the table; returns a function that redraws it in the current language. */
function table(d: Data) {
  const tbl = document.getElementById("table") as HTMLTableElement;
  const head = tbl.createTHead().insertRow();
  const header = () =>
    head.replaceChildren(
      ...[
        [t.colTime, "", ""],
        [t.colTitle, "", ""],
        [t.colType, "", ""],
        [t.region, "", ""],
        [t.colUpdates, t.colUpdatesTitle, "num"],
        [t.duration, "", "num"],
      ].map(([h, title, cls]) => {
        const th = document.createElement("th");
        th.textContent = h;
        if (title) th.title = title;
        if (cls) th.className = cls;
        return th;
      }),
    );
  const body = tbl.createTBody();
  const search = document.getElementById("search") as HTMLInputElement;
  const count = document.getElementById("table-count")!;
  const wrap = tbl.parentElement!;
  const rows = [...d.points].sort((a, b) => b.created.localeCompare(a.created));
  const row = (p: Point) => {
    const tr = document.createElement("tr");
    const cells: [string, string][] = [
      [p.created, "muted"],
      [p.title, ""],
      [
        p.inferred ? `${group(p.group)} (${t.inferredShort})` : type(p.type),
        "muted",
      ],
      [region(p.region_name), "muted"],
      [String(p.n_updates), "num"],
      [p.minutes == null ? "–" : duration(p.minutes), "num"],
    ];
    for (const [text, cls] of cells) {
      const td = tr.insertCell();
      td.textContent = text;
      if (cls) td.className = cls;
    }
    return tr;
  };
  // Laying out all ~7k rows at once blocks the first paint, so rows are added
  // in chunks as the scroll box nears its end
  const CHUNK = 100;
  let match: Point[] = [];
  let shown = 0;
  const more = () => {
    body.append(...match.slice(shown, shown + CHUNK).map(row));
    shown = Math.min(shown + CHUNK, match.length);
  };
  const render = () => {
    const ql = search.value.toLowerCase();
    match = rows.filter(
      (p) =>
        !ql ||
        p.title.toLowerCase().includes(ql) ||
        (p.road ?? "").toLowerCase().includes(ql),
    );
    count.textContent = t.showing(
      match.length.toLocaleString(t.locale),
      rows.length.toLocaleString(t.locale),
    );
    body.replaceChildren();
    wrap.scrollTop = 0;
    shown = 0;
    more();
  };
  header();
  render();
  search.addEventListener("input", render);
  wrap.addEventListener("scroll", () => {
    if (
      shown < match.length &&
      wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 200
    )
      more();
  });
  return () => {
    header();
    render();
  };
}

// Before the data wait, so the static text is in the right language on first paint
applyStatic();

const data: Data = await fetch(`${import.meta.env.BASE_URL}data.json`).then(
  (r) => r.json(),
);

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
const redrawTable = table(data);
drawCharts();

document.getElementById("lang")!.addEventListener("click", (e) => {
  const b = (e.target as Element).closest("button");
  if (!b || b.value === lang) return;
  setLang(b.value as Lang);
  applyStatic();
  tiles(data);
  heatNote(data);
  redrawTable();
  drawCharts();
});

// Redraw on theme change and resize (colors are read from CSS vars at draw time)
const setTheme = (theme: string) => {
  document.documentElement.dataset.theme = theme;
  applyStatic();
  drawCharts();
};
document.getElementById("theme")!.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  setTheme(next);
});
// Follow the system setting until the visitor picks a theme
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!localStorage.getItem("theme")) setTheme(e.matches ? "dark" : "light");
});
let raf = 0;
addEventListener("resize", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(drawCharts);
});
