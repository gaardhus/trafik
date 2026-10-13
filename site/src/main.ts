import * as Plot from "@observablehq/plot";
import { feature } from "topojson-client";
import countries from "world-atlas/countries-50m.json";

type Row = Record<string, any>;
interface Data {
  summary: Row;
  group_order: string[];
  daily: { date: string; group: string; len: number }[];
  heat: { weekday: number; hour: number; len: number }[];
  by_type: { type: string; group: string; len: number }[];
  region_group: { region_name: string; group: string; len: number }[];
  roads: { road: string; n: number; uheld: number; median_clear: number | null; region: string }[];
  durations: { group: string; minutes: number }[];
  dur_summary: Row[];
  points: {
    id: string; lon: number; lat: number; group: string; type: string; title: string;
    road: string | null; region_name: string; n_updates: number; created: string; minutes: number | null;
  }[];
}

const WEEKDAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const css = (name: string) => getComputedStyle(document.querySelector(".viz-root")!).getPropertyValue(name).trim();
const fmt = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 });

function colors(order: string[]) {
  return { domain: order, range: order.map((_, i) => css(`--series-${i + 1}`)) };
}

// Category filter shared by every group-coloured view (daily, maps, regions, table).
// Colours stay bound to the full group order, so hiding one never repaints the rest.
const hiddenGroups = new Set<string>();
// Local filter for the roads chart's two parts
const hiddenRoadParts = new Set<string>();

function swatch(color: string, dot: boolean) {
  const i = document.createElement("i");
  if (dot) i.className = "dot";
  i.style.background = color;
  i.style.borderColor = color;
  return i;
}

/** Legend whose items toggle membership in `hidden`; at least one item always stays visible. */
function toggleLegend(
  el: HTMLElement,
  items: { key: string; label: string; color: string }[],
  hidden: Set<string>,
  onChange: () => void,
  dot = false,
) {
  const buttons = items.map(({ key, label, color }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(!hidden.has(key)));
    b.title = hidden.has(key) ? `Vis ${label}` : `Skjul ${label}`;
    b.append(swatch(color, dot), document.createTextNode(label));
    b.addEventListener("click", () => {
      if (hidden.has(key)) hidden.delete(key);
      else if (hidden.size < items.length - 1) hidden.add(key);
      onChange();
    });
    return b;
  });
  const extra: HTMLElement[] = [];
  if (hidden.size) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "reset";
    reset.textContent = "Vis alle";
    reset.addEventListener("click", () => {
      hidden.clear();
      onChange();
    });
    extra.push(reset);
  } else {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Klik for at skjule";
    extra.push(hint);
  }
  el.replaceChildren(...buttons, ...extra);
}

function groupLegend(id: string, d: Data, dot = false) {
  const c = colors(d.group_order);
  toggleLegend(
    document.getElementById(id)!,
    d.group_order.map((g, i) => ({ key: g, label: g, color: c.range[i] })),
    hiddenGroups,
    drawGroupViews,
    dot,
  );
}

const shown = (g: string) => !hiddenGroups.has(g);

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

function daily(d: Data) {
  const c = colors(d.group_order);
  groupLegend("daily-legend", d);
  mount(
    "daily",
    Plot.plot({
      ...base(),
      width: width("daily"),
      height: 260,
      x: { type: "band", label: null, domain: [...new Set(d.daily.map((r) => r.date))], tickFormat: (s: string) => (s.endsWith("-01") || s.endsWith("-15") ? new Date(s).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "") , tickSize: 0 },
      y: { label: null, grid: true, nice: true },
      color: c,
      marks: [
        Plot.barY(d.daily.filter((r) => shown(r.group)), {
          x: "date",
          y: "len",
          fill: "group",
          order: d.group_order,
          insetTop: 1,
          insetBottom: 1,
          insetLeft: 1,
          insetRight: 1,
          tip: true,
          channels: { Dag: "date", Type: "group", Antal: "len" },
          title: (r: Row) => `${r.date}\n${r.group}: ${r.len}`,
        }),
        Plot.ruleY([0], { stroke: css("--baseline") }),
      ],
    }),
  );
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

function durations(d: Data) {
  const order = d.dur_summary.map((r) => r.group);
  mount(
    "dur",
    Plot.plot({
      ...base(),
      width: width("dur"),
      height: 260,
      marginLeft: 120,
      marginRight: 30,
      x: { type: "log", label: "minutter", grid: true, domain: [3, 3000], ticks: [5, 15, 30, 60, 240, 1440], tickFormat: (m: number) => (m >= 60 ? `${m / 60} t` : `${m}`) },
      y: { label: null, domain: order },
      marks: [
        Plot.boxX(d.durations.filter((r) => r.minutes >= 3), { x: "minutes", y: "group", fill: css("--seq-light"), stroke: css("--text-secondary"), r: 2 }),
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
  groupLegend("map-legend", d, true);
  const container = document.getElementById("maps")!;
  const visible = d.group_order.filter(shown);
  const pts = d.points.filter((p) => shown(p.group));
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
        Plot.tip(own, Plot.pointer({
          x: "lon",
          y: "lat",
          maxRadius: 20,
          title: (p: Row) => `${p.title}\n${p.created} · ${p.type}${p.minutes != null ? ` · ${p.minutes} min` : ""}`,
        })),
      ],
    });
    panel.replaceChildren(h, plot);
  });
}

function regions(d: Data) {
  const c = colors(d.group_order);
  groupLegend("region-legend", d);
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
        Plot.barX(d.region_group.filter((r) => shown(r.group)), Plot.stackX({
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
  mount(
    "types",
    Plot.plot({
      ...base(),
      width: width("types"),
      height: d.by_type.length * 20 + 30,
      marginLeft: 100,
      marginRight: 36,
      x: { label: null, axis: null },
      y: { label: null, domain: d.by_type.map((r) => r.type) },
      marks: [
        Plot.barX(d.by_type, { y: "type", x: "len", fill: css("--series-1"), insetTop: 3, insetBottom: 3, rx2: 4 } as any),
        Plot.text(d.by_type, { y: "type", x: "len", text: (r: Row) => String(r.len), dx: 6, textAnchor: "start", fill: css("--text-secondary") }),
      ],
    }),
  );
}

let renderTable = () => {};

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
  renderTable = () => {
    const ql = search.value.toLowerCase();
    const match = rows.filter(
      (p) => shown(p.group) && (!ql || p.title.toLowerCase().includes(ql) || (p.road ?? "").toLowerCase().includes(ql)),
    );
    const scope = hiddenGroups.size ? ` · skjult: ${[...hiddenGroups].join(", ")}` : "";
    count.textContent = `Viser ${match.length} af ${rows.length} meldinger${scope}`;
    body.replaceChildren(
      ...match.map((p) => {
        const tr = document.createElement("tr");
        const cells: [string, string][] = [
          [p.created, "muted"], [p.title, ""], [p.type, "muted"], [p.region_name, "muted"],
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
  renderTable();
  search.addEventListener("input", renderTable);
}

const data: Data = await fetch(`${import.meta.env.BASE_URL}data.json`).then((r) => r.json());

// Everything the shared category filter scopes
function drawGroupViews() {
  daily(data);
  maps(data);
  regions(data);
  renderTable();
}

const drawCharts = () => {
  heat(data);
  roads(data);
  durations(data);
  types(data);
  drawGroupViews();
};
tiles(data);
table(data);
drawCharts();

// Redraw on theme change and resize (colors are read from CSS vars at draw time)
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawCharts);
let raf = 0;
addEventListener("resize", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(drawCharts);
});
