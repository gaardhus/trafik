// UI strings in Danish and English. Data values (groups, regions, the types'
// codes) stay Danish/raw in data.json and are translated here at draw time;
// headlines and road names are DR's own text and are left as they are.

export type Lang = "da" | "en";

const hh = (h: number) => String(h).padStart(2, "0");

const da = {
  locale: "da-DK",
  title: "Hvor og hvornår går trafikken i stå?",
  tileReports: "Meldinger",
  tilePerDay: "Pr. hverdag / weekenddag",
  tileAccidentShare: "Andel uheld",
  tileAccidentDuration: "Median varighed, uheld",
  heatTitle: "Hvornår skrives der?",
  heatSub:
    "Nye meldinger pr. ugedag og time (dansk tid). Tomme felter betyder ingen meldinger.",
  weeklyTitle: "Meldinger pr. uge",
  weeklySub:
    "Fordelt på hændelsestype. Før DR's omlægning i april 2026 er vejmeldingernes type udledt af overskriften. Første og sidste uge er kun delvist med (lysere).",
  roadsTitle: "Mest nævnte veje",
  roadsSub:
    "Vejen er udtrukket af overskriften og delt i uheld og øvrige meldinger.",
  durTitle: "Hvor længe varer det?",
  durSub:
    "Tid fra første melding, til vejen meldes ryddet eller genåbnet (ellers til sidste opdatering). Logaritmisk akse.",
  mapsTitle: "Hvor sker det?",
  mapsSub:
    "Ét kort pr. hændelsestype. De grå prikker er de øvrige meldinger, til sammenligning.",
  regionTitle: "Typer pr. region",
  regionSub: "Andel af regionens meldinger blandt de viste typer.",
  typesTitle: "Alle hændelsestyper",
  typesSub:
    "DR's egne kategorier, før de er samlet i grupper. Vejmeldinger fra før april 2026 har ingen kategori og er ikke med.",
  tableTitle: "Alle meldinger",
  searchPlaceholder: "Søg i overskrifter, fx E45 eller Storebælt",
  themeToDark: "Skift til mørkt tema",
  themeToLight: "Skift til lyst tema",
  footer:
    "Kilde: DR's trafikmeldinger (api.dr.dk/trafik/posts), kun afsluttede meldinger. Siden opdateres dagligt. Vej og ryddet-tidspunkt er udtrukket af fritekst med regulære udtryk og er derfor tilnærmelser. Indtil 14. april 2026 skelnede DR kun mellem privat og offentlig trafik, så vejmeldingernes type er udledt af overskriften med nøgleord. Holdt op mod DR's egne kategorier efter omlægningen rammer det rigtigt i ca. 80 % af tilfældene (uheld og havari ca. 93 %, kø og andet væsentligt lavere).",

  pct: (n: number) => `${n} %`,
  hours: "t",
  weekdays: ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"],
  showAll: "Vis alle",
  legendTitle: (on: boolean, label: string, solo: boolean) =>
    `${on ? "Skjul" : "Vis"} ${label}` +
    (solo ? ` · dobbeltklik for kun at vise ${label}` : ""),

  days: (n: number) => `${n} dage`,
  average: "gennemsnit",
  ofAllReports: "af alle meldinger",
  p90Within: (m: number) => `90 % inden ${m} min`,
  lede: (
    n: string,
    start: string,
    end: string,
    acc: number,
    hour: number,
    group: string,
    median: string,
  ) =>
    `${n} afsluttede trafikmeldinger fra DR i perioden ${start} til ${end}. ` +
    `${acc} % er uheld, og ${hour} % er afsluttet inden for en time. ` +
    `Meldinger om ${group} varer længst, med en median på ${median}.`,

  reports: "Meldinger",
  heatCell: (day: string, h: number, n: number) =>
    `${day} kl. ${hh(h)}–${hh(h + 1)}\n${n} meldinger`,
  heatNight: (from: number, to: number) =>
    ` Mellem kl. ${hh(from)} og ${hh(to)} er der næsten ingen meldinger.`,
  heatNote: (morning: string, evening: string, night: string) =>
    `På hverdage topper meldingerne i myldretiden, omkring kl. ${morning} og kl. ${evening}. ` +
    `I weekenden er der langt færre, spredt over dagen.${night} ` +
    `Mønsteret afspejler både trafikken og redaktionens vagter, og de to kan ikke skilles ad i data.`,

  week: (n: number, range: string, partial: boolean) =>
    `Uge ${n} · ${range}${partial ? " (delvis uge)" : ""}`,
  inferredFromTitle: "← type udledt af overskrift",
  drCategories: "DR's kategorier →",

  otherReports: "Øvrige meldinger",
  roadTip: (road: string, part: string, n: number, total: number, med: string) =>
    `${road}\n${part}: ${n} af ${total}\nMedian varighed: ${med}`,
  durTip: (g: string, n: number, med: number, p25: number, p75: number, p90: number) =>
    `${g} (n=${n})\nMedian: ${med} min\n25–75 %: ${p25}–${p75} min\n90 %: ${p90} min`,

  inferred: "udledt af overskrift",
  inferredShort: "udledt",
  time: "Tidspunkt",
  duration: "Varighed",
  road: "Vej",
  region: "Region",
  updates: "Opdateringer",

  colTime: "Tid",
  colTitle: "Overskrift",
  colType: "Type",
  colUpdates: "Opd.",
  colUpdatesTitle: "Antal opdateringer",
  showing: (n: string, total: string) => `Viser ${n} af ${total} meldinger`,

  groups: {} as Record<string, string>,
  regions: {} as Record<string, string>,
  types: {
    ACCIDENT: "Uheld",
    BREAKDOWN: "Havareret køretøj",
    LORRY: "Lastbil",
    AUTOMOBILE: "Bil",
    MC: "Motorcykel",
    QUEUE: "Kø",
    TRAIN: "Tog",
    LIGHTRAIL: "Letbane",
    METRO: "Metro",
    BUS: "Bus",
    FERRY: "Færge",
    BLOCKED: "Spærret vej",
    CLEANUP: "Oprydning",
    FIRE: "Brand",
    WIND: "Blæst",
    ROADWORK: "Vejarbejde",
    SLIPPERY: "Glat vej / spild",
    FLOOD: "Oversvømmelse",
    PIG: "Dyr på vejen",
    EMERGENCY: "Politi / beredskab",
  } as Record<string, string>,
};

const en: typeof da = {
  locale: "en-GB",
  title: "Where and when does traffic grind to a halt?",
  tileReports: "Reports",
  tilePerDay: "Per weekday / weekend day",
  tileAccidentShare: "Accident share",
  tileAccidentDuration: "Median duration, accidents",
  heatTitle: "When are reports posted?",
  heatSub:
    "New reports by weekday and hour (Danish time). Empty cells mean no reports.",
  weeklyTitle: "Reports per week",
  weeklySub:
    "By incident type. Before DR's overhaul in April 2026, the type of road reports is inferred from the headline. The first and last weeks are only partly covered (lighter).",
  roadsTitle: "Most mentioned roads",
  roadsSub:
    "The road is extracted from the headline and split into accidents and other reports.",
  durTitle: "How long does it last?",
  durSub:
    "Time from the first report until the road is reported cleared or reopened (otherwise until the last update). Logarithmic axis.",
  mapsTitle: "Where does it happen?",
  mapsSub:
    "One map per incident type. The grey dots are the other reports, for comparison.",
  regionTitle: "Types by region",
  regionSub: "Share of the region's reports among the types shown.",
  typesTitle: "All incident types",
  typesSub:
    "DR's own categories, before they are merged into groups. Road reports from before April 2026 have no category and are left out.",
  tableTitle: "All reports",
  searchPlaceholder: "Search headlines (in Danish), e.g. E45 or Storebælt",
  themeToDark: "Switch to dark theme",
  themeToLight: "Switch to light theme",
  footer:
    "Source: DR's traffic reports (api.dr.dk/trafik/posts), closed reports only. The page is updated daily. Road and cleared time are extracted from free text with regular expressions and are therefore approximations. Until 14 April 2026, DR only distinguished between private and public traffic, so the type of road reports is inferred from keywords in the headline. Checked against DR's own categories after the overhaul, this is right in about 80% of cases (accidents and breakdowns about 93%, queues and other considerably lower).",

  pct: (n) => `${n}%`,
  hours: "h",
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  showAll: "Show all",
  legendTitle: (on, label, solo) =>
    `${on ? "Hide" : "Show"} ${label}` +
    (solo ? ` · double-click to show only ${label}` : ""),

  days: (n) => `${n} days`,
  average: "average",
  ofAllReports: "of all reports",
  p90Within: (m) => `90% within ${m} min`,
  lede: (n, start, end, acc, hour, group, median) =>
    `${n} closed traffic reports from DR, the Danish public broadcaster, between ${start} and ${end}. ` +
    `${acc}% are accidents, and ${hour}% are closed within an hour. ` +
    `Reports of ${group} last longest, with a median of ${median}.`,

  reports: "Reports",
  heatCell: (day, h, n) => `${day} ${hh(h)}–${hh(h + 1)}\n${n} reports`,
  heatNight: (from, to) =>
    ` Between ${hh(from)} and ${hh(to)} there are almost no reports.`,
  heatNote: (morning, evening, night) =>
    `On weekdays, reports peak in the rush hours, around ${morning} and ${evening}. ` +
    `At weekends there are far fewer, spread over the day.${night} ` +
    `The pattern reflects both the traffic and the newsroom's shifts, and the data can't tell the two apart.`,

  week: (n, range, partial) =>
    `Week ${n} · ${range}${partial ? " (partial week)" : ""}`,
  inferredFromTitle: "← type inferred from headline",
  drCategories: "DR's categories →",

  otherReports: "Other reports",
  roadTip: (road, part, n, total, med) =>
    `${road}\n${part}: ${n} of ${total}\nMedian duration: ${med}`,
  durTip: (g, n, med, p25, p75, p90) =>
    `${g} (n=${n})\nMedian: ${med} min\n25–75%: ${p25}–${p75} min\n90%: ${p90} min`,

  inferred: "inferred from headline",
  inferredShort: "inferred",
  time: "Time",
  duration: "Duration",
  road: "Road",
  region: "Region",
  updates: "Updates",

  colTime: "Time",
  colTitle: "Headline",
  colType: "Type",
  colUpdates: "Upd.",
  colUpdatesTitle: "Number of updates",
  showing: (n, total) => `Showing ${n} of ${total} reports`,

  groups: {
    Uheld: "Accidents",
    Havari: "Breakdowns",
    Kø: "Queues",
    "Kollektiv trafik": "Public transport",
    Andet: "Other",
    Øvrige: "Other",
  },
  regions: {
    "Hovedstaden/Sjælland": "Capital/Zealand",
    Syddanmark: "Southern Denmark",
    "Midt/Nord": "Central/North",
  },
  types: {
    ACCIDENT: "Accident",
    BREAKDOWN: "Broken-down vehicle",
    LORRY: "Lorry",
    AUTOMOBILE: "Car",
    MC: "Motorcycle",
    QUEUE: "Queue",
    TRAIN: "Train",
    LIGHTRAIL: "Light rail",
    METRO: "Metro",
    BUS: "Bus",
    FERRY: "Ferry",
    BLOCKED: "Road closed",
    CLEANUP: "Clean-up",
    FIRE: "Fire",
    WIND: "Wind",
    ROADWORK: "Roadworks",
    SLIPPERY: "Slippery road / spill",
    FLOOD: "Flooding",
    PIG: "Animals on the road",
    EMERGENCY: "Police / emergency",
  },
};

const STRINGS = { da, en };
const KEY = "lang";

function initial(): Lang {
  const param = new URLSearchParams(location.search).get("lang");
  if (param === "da" || param === "en") return param;
  const saved = localStorage.getItem(KEY);
  if (saved === "da" || saved === "en") return saved;
  return navigator.languages.some((l) => /^da\b/.test(l)) ? "da" : "en";
}

export let lang: Lang = initial();
export let t = STRINGS[lang];

export function setLang(l: Lang) {
  lang = l;
  t = STRINGS[l];
  localStorage.setItem(KEY, l);
}

export const group = (g: string) => t.groups[g] ?? g;
export const region = (r: string) => t.regions[r] ?? r;
export const type = (code: string) => t.types[code] ?? code;

/** Static text in index.html, keyed by data-i18n / data-i18n-placeholder. */
export function applyStatic() {
  document.documentElement.lang = lang;
  document.title = t.title;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]"))
    el.textContent = t[el.dataset.i18n as keyof typeof t] as string;
  for (const el of document.querySelectorAll<HTMLInputElement>(
    "[data-i18n-placeholder]",
  ))
    el.placeholder = t[el.dataset.i18nPlaceholder as keyof typeof t] as string;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#lang button"))
    b.setAttribute("aria-pressed", String(b.value === lang));
  const dark = document.documentElement.dataset.theme === "dark";
  const theme = document.getElementById("theme")!;
  theme.setAttribute("aria-label", dark ? t.themeToLight : t.themeToDark);
  theme.title = theme.getAttribute("aria-label")!;
}
