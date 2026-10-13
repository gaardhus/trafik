"""Fetch DR's traffic feed into data/posts.jsonl.

Two modes:
  --full      one limited=false request returning the whole archive; adds every
              post not yet saved. This is the authoritative sweep.
  (default)   page backwards from the newest post, 10 per request, and stop once
              caught up with what is already saved. Quick top-up of new posts.

Paging can't guarantee completeness: the API filters on createdTime but sorts by
sortTime (last update), so on busy days long-running incidents fill every page
and the stall escape below may skip a post. Run --full now and then to fill gaps.

Usage: uv run scripts/scrape.py [--full] [--pages 100] [--out data/posts.jsonl]
                                [--before ISO] [--resume] [--delay 0.5]
"""

import argparse
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx

URL = "https://api.dr.dk/trafik/posts"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0",
    "Accept": "*/*",
    "Referer": "https://www.dr.dk/",
    "Origin": "https://www.dr.dk",
}


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def fmt(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def fetch(client: httpx.Client, **params: str) -> list[dict]:
    resp = client.get(URL, params={"concluded": "true", **params})
    resp.raise_for_status()
    return resp.json()


def full(client: httpx.Client, seen: set[str], f) -> None:
    posts = fetch(client, limited="false")
    fresh = [p for p in posts if p["_id"] not in seen]
    for p in sorted(fresh, key=lambda p: p["createdTime"], reverse=True):
        f.write(json.dumps(p, ensure_ascii=False) + "\n")
    oldest = min((p["createdTime"] for p in posts), default="-")
    print(f"full: {len(posts)} posts in archive (oldest {oldest}), {len(fresh)} new")


def paged(client: httpx.Client, seen: set[str], newest_saved: str | None, f, args, cursor_file: Path) -> None:
    cursor = args.before
    if args.resume:
        if cursor_file.exists():
            cursor = cursor_file.read_text().strip()
            print(f"resuming from saved cursor {cursor}")
        else:
            print(f"no {cursor_file.name}; starting from newest")
    new = 0
    for page in range(args.pages):
        posts = fetch(client, limited="true", **({"lastPostDate": cursor} if cursor else {}))
        if not posts:
            print(f"page {page}: empty, reached start of archive")
            break
        fresh = [p for p in posts if p["_id"] not in seen]
        for p in fresh:
            seen.add(p["_id"])
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
        f.flush()
        new += len(fresh)
        # Follow the last sortTime while it moves the cursor back; only when it
        # doesn't (a stall) step just below the newest createdTime to evict the
        # sticky posts. That step can skip a post created in between; --full fills it.
        last = posts[-1]["sortTime"]
        if cursor is None or parse(last) < parse(cursor):
            cursor = last
        else:
            newest = max(parse(p["createdTime"]) for p in posts)
            cursor = fmt(newest - timedelta(milliseconds=1))
        # Saved after every page so --resume continues exactly here
        cursor_file.write_text(cursor)
        if page % 10 == 0:
            print(f"page {page}: +{len(fresh)} (total new {new}), cursor {cursor}")
        # A top-up is done once a page brings nothing new and the cursor is
        # below everything saved before this run started
        if not args.resume and not args.before and not fresh and newest_saved and parse(cursor) < parse(newest_saved):
            print(f"page {page}: caught up with saved posts")
            break
        time.sleep(args.delay)
    print(f"done: {new} new posts, cursor {cursor}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="fetch the whole archive in one request")
    ap.add_argument("--pages", type=int, default=100)
    ap.add_argument("--out", type=Path, default=Path("data/posts.jsonl"))
    ap.add_argument("--before", help="start cursor (ISO timestamp); default = newest")
    ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--resume", action="store_true", help="continue from the cursor saved by the last paged run")
    args = ap.parse_args()

    saved = [json.loads(line) for line in args.out.open() if line.strip()] if args.out.exists() else []
    seen = {p["_id"] for p in saved}
    newest_saved = max((p["createdTime"] for p in saved), key=parse, default=None)
    cursor_file = args.out.with_suffix(".cursor")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(headers=HEADERS, timeout=60) as client, args.out.open("a") as f:
        if args.full:
            full(client, seen, f)
        else:
            paged(client, seen, newest_saved, f, args, cursor_file)


if __name__ == "__main__":
    main()
