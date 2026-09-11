#!/usr/bin/env python3
"""
Download recent Instagram media so curate.py can score and grade it.

    export IG_TOKEN=...
    tools/.venv/bin/python tools/fetch_instagram.py --out tools/feed --limit 25
    tools/.venv/bin/python tools/curate.py tools/feed --out src/assets/instagram --top 4

WHAT THIS NEEDS BEFORE IT CAN RUN
---------------------------------
Meta retired the old Basic Display API, so a personal account can no longer be
read with a simple token. The replacement needs all of the following, and all
of it has to come from Jacob:

  1. His Instagram account switched to Professional (Business or Creator).
     Free, in the app, and reversible.
  2. A Meta app with "Instagram" added as a product.
  3. Jacob authorising that app against his account, which grants
     instagram_business_basic. He has to click it; it cannot be done for him.
  4. The short-lived token exchanged for a long-lived one.

Long-lived tokens last 60 days. `refresh()` below extends one, and the intended
home for it is a scheduled GitHub Action that refreshes monthly, re-fetches,
re-curates and commits the result — so the row stays current without anyone
touching it.

Until that exists the row is curated by hand from the archive, which is why
nothing on the site claims to be a live feed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://graph.instagram.com"
FIELDS = "id,caption,media_type,media_url,permalink,timestamp"

# Where the token may live. All of these are gitignored; the value is never
# printed, logged or committed.
TOKEN_FILES = (Path("tools/.env"), Path(".env"))


def load_token() -> str | None:
    """Environment first, then a local env file. Never echoes the value."""
    token = os.environ.get("IG_TOKEN")
    if token:
        return token.strip()
    for f in TOKEN_FILES:
        if not f.exists():
            continue
        for line in f.read_text().splitlines():
            line = line.strip()
            if line.startswith("IG_TOKEN="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return None


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def fetch(token: str, limit: int) -> list[dict]:
    """Newest media first. Carousels report their first image."""
    q = urllib.parse.urlencode({"fields": FIELDS, "limit": limit, "access_token": token})
    data = _get(f"{API}/me/media?{q}")
    items = data.get("data", [])
    # Videos have no still worth grading; reels would need a frame pulled first.
    return [i for i in items if i.get("media_type") in {"IMAGE", "CAROUSEL_ALBUM"}]


def refresh(token: str) -> dict:
    """Extend a long-lived token by another 60 days. Safe to run monthly."""
    q = urllib.parse.urlencode({"grant_type": "ig_refresh_token", "access_token": token})
    return _get(f"{API}/refresh_access_token?{q}")


def download(items: list[dict], out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    saved = 0
    for item in items:
        url = item.get("media_url")
        if not url:
            continue
        # Timestamp-led names keep the folder in posting order.
        stamp = (item.get("timestamp") or "")[:10].replace("-", "")
        dest = out / f"{stamp}-{item['id']}.jpg"
        if dest.exists():
            saved += 1
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
                f.write(r.read())
            saved += 1
        except Exception as exc:  # a single bad asset should not stop the run
            print(f"  skipped {item['id']}: {exc}", file=sys.stderr)

    # Keep the permalinks so the published row can link to the actual post.
    (out / "index.json").write_text(json.dumps(items, indent=2))
    return saved


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=Path("tools/feed"))
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--refresh-token", action="store_true", help="extend the token and exit")
    args = ap.parse_args()

    token = load_token()
    if not token:
        print(
            "No IG_TOKEN found.\n\n"
            "Put it in tools/.env as a single line:\n"
            "    IG_TOKEN=your-long-lived-token\n\n"
            "That file is gitignored and the value is never printed or committed.\n"
            "Getting a token needs a Professional account and a Meta app — see the\n"
            "notes at the top of this file.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    if args.refresh_token:
        print(json.dumps(refresh(token), indent=2))
        return

    items = fetch(token, args.limit)
    n = download(items, args.out)
    print(f"fetched {len(items)} posts, {n} images into {args.out}/")
    print("next: tools/.venv/bin/python tools/curate.py", args.out, "--out src/assets/instagram --top 4")


if __name__ == "__main__":
    main()
