"""Paginate DR's traffic feed backwards in time using sortTime as the cursor.

Usage: uv run scripts/scrape.py --pages 100 [--out data/posts.jsonl] [--before ISO] [--resume]
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=100)
    ap.add_argument("--out", type=Path, default=Path("data/posts.jsonl"))
    ap.add_argument("--before", help="start cursor (ISO timestamp); default = newest")
    ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--resume", action="store_true", help="start from the oldest post already saved")
    args = ap.parse_args()

    saved = [json.loads(line) for line in args.out.open()] if args.out.exists() else []
    seen = {p["_id"] for p in saved}

    cursor = args.before
    if args.resume and saved:
        cursor = min((p["createdTime"] for p in saved), key=parse)
        print(f"resuming from {cursor} ({len(saved)} posts saved)")
    new = 0
    with httpx.Client(headers=HEADERS, timeout=30) as client, args.out.open("a") as f:
        for page in range(args.pages):
            params = {"concluded": "true", "limited": "true"}
            if cursor:
                params["lastPostDate"] = cursor
            resp = client.get(URL, params=params)
            resp.raise_for_status()
            posts = resp.json()
            if not posts:
                print(f"page {page}: empty, reached start of archive")
                break
            fresh = [p for p in posts if p["_id"] not in seen]
            for p in fresh:
                seen.add(p["_id"])
                f.write(json.dumps(p, ensure_ascii=False) + "\n")
            new += len(fresh)
            # The API filters on createdTime <= lastPostDate but sorts by sortTime
            # (last update). Long-running incidents created before the cursor but
            # updated after it keep occupying the page. Follow the last sortTime
            # while it moves the cursor back; only when it doesn't (a stall) step
            # just below the newest createdTime to evict the sticky posts.
            last = posts[-1]["sortTime"]
            if cursor is None or parse(last) < parse(cursor):
                cursor = last
            else:
                newest = max(parse(p["createdTime"]) for p in posts)
                cursor = fmt(newest - timedelta(milliseconds=1))
            if page % 10 == 0:
                print(f"page {page}: +{len(fresh)} (total new {new}), cursor {cursor}")
            time.sleep(args.delay)
    print(f"done: {new} new posts, oldest cursor {cursor}")


if __name__ == "__main__":
    main()
