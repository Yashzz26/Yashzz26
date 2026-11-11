#!/usr/bin/env python3
"""Generate contribution cards from the authenticated GitHub GraphQL API."""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

USERNAME = os.environ.get("PROFILE_USERNAME", "Yashzz26")
TOKEN = os.environ.get("GITHUB_TOKEN")
API_URL = "https://api.github.com/graphql"
OUTPUT = Path(__file__).resolve().parents[1] / "cards"


def fetch_contributions() -> dict:
    if not TOKEN:
        raise RuntimeError("GITHUB_TOKEN is required to query GitHub GraphQL.")
    query = """
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { contributionCount date } }
          }
        }
      }
    }
    """
    payload = json.dumps({"query": query, "variables": {"login": USERNAME}}).encode()
    request = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Authorization": f"bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.URLError as error:
        raise RuntimeError(f"GitHub GraphQL request failed: {error}") from error
    if result.get("errors") or not result.get("data", {}).get("user"):
        raise RuntimeError(f"GitHub GraphQL returned an error: {result.get('errors', result)}")
    return result["data"]["user"]["contributionsCollection"]["contributionCalendar"]


def colour(count: int) -> str:
    return ["#241044", "#3b1b70", "#5b21b6", "#7c3aed", "#a78bfa"][min(count, 4)]


def make_svg(calendar: dict, title: str, subtitle: str) -> str:
    cells = []
    days = [day for week in calendar["weeks"] for day in week["contributionDays"]]
    for index, day in enumerate(days[-371:]):
        x = 48 + (index // 7) * 16
        y = 140 + (index % 7) * 16
        cells.append(
            f'<rect x="{x}" y="{y}" width="11" height="11" rx="2" fill="{colour(day["contributionCount"])}"/>'
        )
    total = calendar["totalContributions"]
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 270" role="img">
<defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#0f0a1e"/><stop offset="1" stop-color="#32145e"/></linearGradient></defs>
<rect width="1200" height="270" rx="24" fill="url(#g)" stroke="#7c3aed"/>
<text x="48" y="52" fill="#c4a7ff" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="3">{escape(title.upper())}</text>
<text x="48" y="100" fill="#fff" font-family="Arial,sans-serif" font-size="30" font-weight="800">{total:,} contributions</text>
<text x="48" y="125" fill="#c4b5fd" font-family="Arial,sans-serif" font-size="14">{escape(subtitle)} · Updated {generated}</text>
<g>{''.join(cells)}</g>
</svg>
"""


def main() -> int:
    calendar = fetch_contributions()
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / "contributions.svg").write_text(
        make_svg(calendar, "GitHub contributions", f"@{USERNAME} · contribution calendar"),
        encoding="utf-8",
    )
    (OUTPUT / "activity.svg").write_text(
        make_svg(calendar, "Activity pulse", f"@{USERNAME} · daily activity"),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError) as error:
        print(f"update_stats.py: {error}", file=sys.stderr)
        raise SystemExit(1)
