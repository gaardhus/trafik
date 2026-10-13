"""Paginate DR's traffic feed backwards in time using sortTime as the cursor.

Usage: uv run scripts/scrape.py --pages 100 [--out data/posts.jsonl] [--before ISO]
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=100)
    ap.add_argument("--out", type=Path, default=Path("data/posts.jsonl"))
    ap.add_argument("--before", help="start cursor (ISO timestamp); default = newest")
    ap.add_argument("--delay", type=float, default=0.5)
    args = ap.parse_args()

    seen: set[str] = set()
    if args.out.exists():
        seen = {json.loads(line)["_id"] for line in args.out.open()}

    cursor = args.before
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
            # updated after it keep occupying the page. When that stalls progress,
            # step the cursor just below the newest createdTime to evict them.
            if fresh:
                cursor = posts[-1]["sortTime"]
            else:
                newest = max(datetime.fromisoformat(p["createdTime"]) for p in posts)
                cursor = (newest - timedelta(milliseconds=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            if page % 10 == 0:
                print(f"page {page}: +{len(fresh)} (total new {new}), cursor {cursor}")
            time.sleep(args.delay)
    print(f"done: {new} new posts, oldest cursor {cursor}")


if __name__ == "__main__":
    main()
