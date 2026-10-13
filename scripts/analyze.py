"""Turn raw posts into tidy tables + a data.json for the report site.

Usage: uv run scripts/analyze.py [data/posts.jsonl] [site/public/data.json]
"""

import json
import re
import sys
from datetime import timedelta
from pathlib import Path

import polars as pl

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "data/posts.jsonl")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "site/public/data.json")
TZ = "Europe/Copenhagen"

# Coarse groups so charts stay within a readable number of series
GROUPS = {
    "ACCIDENT": "Uheld",
    "BREAKDOWN": "Havari",
    "LORRY": "Havari",
    "AUTOMOBILE": "Havari",
    "MC": "Havari",
    "QUEUE": "Kø",
    "TRAIN": "Kollektiv trafik",
    "LIGHTRAIL": "Kollektiv trafik",
    "METRO": "Kollektiv trafik",
    "BUS": "Kollektiv trafik",
    "FERRY": "Kollektiv trafik",
}
REGIONS = {"CPH": "Hovedstaden/Sjælland", "SOUTH": "Syddanmark", "MID-NORTH": "Midt/Nord"}

ROAD = re.compile(
    r"\b(E ?\d{2}|[Rr]ute \d+|Motorring \d|Ring \d"
    r"|[A-ZÆØÅ][a-zæøå]+(?:[- ][A-ZÆØÅ][a-zæøå]+)*[ -]?[Mm]otorvej(?:en)?"
    r"|[A-ZÆØÅ][a-zæøå]+(?:broen|tunnelen))"
)
CLEARED = re.compile(r"ryddet|genåbnet|fjernet|overstået|afsluttet|kører igen|åben igen|normalt|væk")
# Before DR's schema change (2026-04-14) posts only had type PRIVATE/PUBLIC and a
# subtype (CAR, TRAIN, FERRY, ...); the API reports incidentType AUTOMOBILE for all
# of them. Road posts from then get a group inferred from the headline. Checked
# against post-change posts with real labels: ~80% agreement overall; precision
# Uheld 93%, Havari 93%, Kollektiv 96%, Kø 58%, Andet 33%.
HEADLINE_RULES = [
    ("Kø", re.compile(r"^kø")),
    ("Kollektiv trafik", re.compile(r"\btog|s-tog|togbus|letban|metro|\bbus|færge|sporskift|signalfejl")),
    ("Uheld", re.compile(r"uheld|sammenstød|harmonika|påkør|kollision|trafikulykke")),
    ("Havari", re.compile(r"havar|punkter|motorstop|i brand|brand i|væltet lastbil|lastbil")),
    ("Kø", re.compile(r"\bkø")),
]
DIRECTION = re.compile(r"(nordgående|sydgående|østgående|vestgående|mod København|mod [A-ZÆØÅ]\w+)")


def norm_road(m: str | None) -> str | None:
    if m is None:
        return None
    m = m.replace("E ", "E")
    m = re.sub(r"^rute", "Rute", m)
    # "Vestmotorvej" -> "Vestmotorvejen"; "Køge Bugt Motorvej" -> "Køge Bugt Motorvejen";
    # adjective forms ("Østjyske Motorvej") are left alone
    m = re.sub(r"(\w)motorvej$", r"\1motorvejen", m)
    m = re.sub(r"(\w[^e]) Motorvej$", r"\1 Motorvejen", m)
    return m


def infer_group(title: str) -> str:
    t = title.lower()
    return next((g for g, rx in HEADLINE_RULES if rx.search(t)), "Andet")


def categorise(r: dict) -> tuple[str, str, bool]:
    """(DR type, group, inferred) for a raw post, handling the legacy schema."""
    sub = r.get("subtype")
    # Posts from the switchover can carry both fields; a real incidentType wins
    if sub is None or r["incidentType"] != "AUTOMOBILE":
        return r["incidentType"], GROUPS.get(r["incidentType"], "Andet"), False
    if sub != "CAR":
        return sub, GROUPS.get(sub, "Kollektiv trafik"), False
    return "VEJ (før 14/4-26)", infer_group(r["text"]), True


def cleared_time(updates: list[dict]) -> str | None:
    """Earliest update that announces the incident is over."""
    hits = [u["createdTime"] for u in updates if CLEARED.search(u["text"].lower())]
    return min(hits) if hits else None


def load() -> pl.DataFrame:
    rows = [json.loads(line) for line in SRC.open()]
    recs = []
    for r in rows:
        m = ROAD.search(r["text"])
        lon, lat = r["location"][0]["coordinates"] if r["location"] else (None, None)
        typ, group, inferred = categorise(r)
        recs.append(
            {
                "id": r["_id"],
                "type": typ,
                "group": group,
                "inferred": inferred,
                "region": r["region"],
                "title": r["text"],
                "road": norm_road(m.group(1) if m else None),
                "lon": lon,
                "lat": lat,
                "created": r["createdTime"],
                "last_update": r["sortTime"],
                "cleared": cleared_time(r["updates"]),
                "n_updates": len(r["updates"]),
                "link": r.get("link") or None,
                "direction": (d.group(1) if (d := DIRECTION.search(r["text"])) else None),
            }
        )
    ts = ["created", "last_update", "cleared"]
    df = pl.DataFrame(recs).with_columns(
        [pl.col(c).str.to_datetime(time_zone="UTC").dt.convert_time_zone(TZ) for c in ts]
    )
    return df.with_columns(
        region_name=pl.col("region").replace_strict(REGIONS, default=pl.col("region")),
        life_min=(pl.col("last_update") - pl.col("created")).dt.total_minutes(),
        clear_min=(pl.col("cleared") - pl.col("created")).dt.total_minutes(),
        date=pl.col("created").dt.date(),
        hour=pl.col("created").dt.hour(),
        weekday=pl.col("created").dt.weekday(),  # 1 = Monday
    )


def main() -> None:
    df = load()
    start, end = df["created"].min(), df["created"].max()
    days = (end - start).total_seconds() / 86400

    group_order = ["Uheld", "Havari", "Kø", "Kollektiv trafik", "Andet"]

    daily = df.group_by("date", "group").len().sort("date")
    # Weeks start Monday; the first and last weeks may only be partly covered
    first_day, last_day = df["date"].min(), df["date"].max()
    weekly = (
        df.with_columns(week=pl.col("date").dt.truncate("1w"))
        .group_by("week", "group").len().sort("week")
        .with_columns(
            partial=(pl.col("week") < first_day) | (pl.col("week") + pl.duration(days=6) > last_day),
            iso_week=pl.col("week").dt.week(),
            week=pl.col("week").cast(pl.String),
        )
    )
    heat = df.group_by("weekday", "hour").len()
    heat_acc = df.filter(pl.col("group") == "Uheld").group_by("weekday", "hour").len()
    by_type = df.filter(~pl.col("inferred")).group_by("type", "group").len().sort("len", descending=True)
    region_group = df.group_by("region_name", "group").len()
    roads = (
        df.drop_nulls("road")
        .group_by("road")
        .agg(
            n=pl.len(),
            uheld=(pl.col("group") == "Uheld").sum(),
            median_clear=pl.col("clear_min").median(),
            region=pl.col("region_name").mode().first(),
        )
        .sort(["n", "road"], descending=[True, False])
        .head(20)
    )
    durations = (
        df.select("group", "type", "title", minutes=pl.coalesce("clear_min", "life_min"))
        .filter(pl.col("minutes") > 0)
    )
    dur_summary = (
        durations.group_by("group")
        .agg(
            n=pl.len(),
            p25=pl.col("minutes").quantile(0.25),
            median=pl.col("minutes").median(),
            p75=pl.col("minutes").quantile(0.75),
            p90=pl.col("minutes").quantile(0.9),
        )
        .sort("median")
    )
    directions = (
        df.filter(pl.col("road").is_in(["E45", "E20", "Motorring 3", "Køge Bugt Motorvejen", "Helsingørmotorvejen", "Hillerødmotorvejen"]))
        .drop_nulls("direction")
        .group_by("road", "direction").len().sort("road", "len", descending=[False, True])
    )

    # Last road post without a DR category; up to here groups are inferred
    last_inferred = df.filter(pl.col("inferred"))["created"].max()

    summary = {
        "n": df.height,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": round(days, 1),
        "per_day": round(df.height / days, 1),
        "share_with_road": round(df["road"].is_not_null().mean(), 3),
        "share_with_cleared": round(df["cleared"].is_not_null().mean(), 3),
        "median_updates": df["n_updates"].median(),
        "accident_share": round((df["group"] == "Uheld").mean(), 3),
        "n_inferred": int(df["inferred"].sum()),
        "schema_change": last_inferred.isoformat() if last_inferred else None,
        # Monday of that week, matching the weekly chart's bands
        "schema_change_week": (last_inferred.date() - timedelta(days=last_inferred.weekday())).isoformat() if last_inferred else None,
        "busiest_day": daily.group_by("date").agg(pl.col("len").sum()).sort("len", descending=True).row(0, named=True),
    }

    def recs(frame: pl.DataFrame) -> list[dict]:
        return frame.to_dicts()

    points = df.select(
        "id", "lon", "lat", "group", "type", "inferred", "title", "road", "region_name", "n_updates",
        created=pl.col("created").dt.strftime("%Y-%m-%d %H:%M"),
        minutes=pl.coalesce("clear_min", "life_min").round(0),
    )

    out = {
        "summary": summary,
        "group_order": group_order,
        "weekly": recs(weekly),
        "heat": recs(heat),
        "heat_accidents": recs(heat_acc),
        "by_type": recs(by_type),
        "region_group": recs(region_group),
        "roads": recs(roads),
        "durations": recs(durations.select("group", "minutes")),
        "dur_summary": recs(dur_summary),
        "directions": recs(directions),
        "points": recs(points),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, default=str))

    pl.Config.set_tbl_rows(25)
    print(json.dumps(summary, indent=1, default=str, ensure_ascii=False))
    print(dur_summary)
    print(roads)
    print(directions)
    print(region_group.pivot("group", index="region_name", values="len"))
    print(df.group_by("hour").len().sort("hour").transpose(include_header=False))
    print(df.group_by("weekday").len().sort("weekday"))


if __name__ == "__main__":
    main()
