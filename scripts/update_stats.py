#!/usr/bin/env python3
"""Generate self-hosted GitHub profile cards from the GitHub GraphQL API."""

import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

USERNAME = os.environ.get("PROFILE_USERNAME", "Yashzz26")
TOKEN = os.environ.get("GITHUB_TOKEN")
API_URL = "https://api.github.com/graphql"
OUTPUT = Path(__file__).resolve().parents[1] / "cards"
BG = "#100b20"
PANEL = "#1a1031"
PURPLE = "#a78bfa"
VIOLET = "#8b5cf6"
TEXT = "#f5f3ff"
MUTED = "#c4b5fd"


def graphql(query: str, variables: dict) -> dict:
    if not TOKEN:
        raise RuntimeError("GITHUB_TOKEN is required to query GitHub GraphQL.")
    payload = json.dumps({"query": query, "variables": variables}).encode()
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
    if result.get("errors"):
        raise RuntimeError(f"GitHub GraphQL returned an error: {result['errors']}")
    return result["data"]


def fetch_profile() -> dict:
    query = """
    query($login: String!) {
      user(login: $login) {
        followers { totalCount }
        following { totalCount }
        repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
          nodes {
            stargazerCount
            languages(first: 20, orderBy: {field: SIZE, direction: DESC}) {
              edges { size node { name color } }
            }
          }
        }
        contributionsCollection {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks { contributionDays { contributionCount date } }
          }
        }
      }
    }
    """
    profile = graphql(query, {"login": USERNAME}).get("user")
    if not profile:
        raise RuntimeError(f"GitHub user not found: {USERNAME}")
    return profile


def esc(value: object) -> str:
    return escape(str(value))


def date_label() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def calendar_days(profile: dict) -> list[dict]:
    calendar = profile["contributionsCollection"]["contributionCalendar"]
    return [
        day
        for week in calendar["weeks"]
        for day in week["contributionDays"]
    ]


def streaks(days: list[dict]) -> tuple[int, int]:
    active = {date.fromisoformat(day["date"]): day["contributionCount"] > 0 for day in days}
    if not active:
        return 0, 0
    today = max(active)
    current = 0
    cursor = today
    while active.get(cursor, False):
        current += 1
        cursor -= timedelta(days=1)
    longest = 0
    run = 0
    for day in sorted(active):
        run = run + 1 if active[day] else 0
        longest = max(longest, run)
    return current, longest


def colour(count: int) -> str:
    return ["#241044", "#3b1b70", "#5b21b6", "#7c3aed", "#a78bfa"][min(count, 4)]


def shell(title: str, subtitle: str, body: str, height: int = 270) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 {height}" role="img">
<title>{esc(title)}</title>
<defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="{BG}"/><stop offset="1" stop-color="#32145e"/></linearGradient></defs>
<rect width="1200" height="{height}" rx="24" fill="url(#bg)" stroke="{VIOLET}"/>
<text x="48" y="46" fill="{PURPLE}" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="3">{esc(title.upper())}</text>
<text x="48" y="72" fill="{MUTED}" font-family="Arial,sans-serif" font-size="14">{esc(subtitle)}</text>
{body}
<text x="1152" y="{height - 20}" text-anchor="end" fill="#8b7aa8" font-family="Arial,sans-serif" font-size="11">Updated {date_label()}</text>
</svg>
"""


def make_calendar(profile: dict, title: str, subtitle: str, detail: str) -> str:
    days = calendar_days(profile)
    cells = []
    for index, day in enumerate(days[-371:]):
        x = 48 + (index // 7) * 16
        y = 104 + (index % 7) * 16
        cells.append(
            f'<rect x="{x}" y="{y}" width="11" height="11" rx="2" fill="{colour(day["contributionCount"])}"><title>{esc(day["date"])}: {day["contributionCount"]} contributions</title></rect>'
        )
    total = profile["contributionsCollection"]["contributionCalendar"]["totalContributions"]
    body = (
        f'<text x="48" y="96" fill="{TEXT}" font-family="Arial,sans-serif" font-size="27" font-weight="800">{total:,} contributions</text>'
        f'<text x="390" y="96" fill="{MUTED}" font-family="Arial,sans-serif" font-size="14">{esc(detail)}</text>'
        f'<g>{ "".join(cells) }</g>'
    )
    return shell(title, subtitle, body)


def make_stats(profile: dict) -> str:
    repositories = profile["repositories"]["nodes"]
    stars = sum(repo["stargazerCount"] for repo in repositories)
    contributions = profile["contributionsCollection"]["contributionCalendar"]["totalContributions"]
    values = [
        ("PUBLIC REPOSITORIES", len(repositories)),
        ("STARS RECEIVED", stars),
        ("YEARLY CONTRIBUTIONS", contributions),
        ("FOLLOWERS", profile["followers"]["totalCount"]),
    ]
    body = []
    for index, (label, value) in enumerate(values):
        x = 48 + (index % 2) * 560
        y = 128 + (index // 2) * 62
        body.append(
            f'<text x="{x}" y="{y}" fill="{TEXT}" font-family="Arial,sans-serif" font-size="25" font-weight="800">{value:,}</text>'
            f'<text x="{x}" y="{y + 22}" fill="{MUTED}" font-family="Arial,sans-serif" font-size="12" letter-spacing="1">{label}</text>'
        )
    return shell("GitHub statistics", f"@{USERNAME} · public account overview", "".join(body), 270)


def make_languages(profile: dict) -> str:
    totals = Counter()
    colours = {}
    for repo in profile["repositories"]["nodes"]:
        for edge in repo["languages"]["edges"]:
            name = edge["node"]["name"]
            totals[name] += edge["size"]
            colours[name] = edge["node"].get("color") or VIOLET
    top = totals.most_common(6)
    total = sum(totals.values())
    if not top or not total:
        return shell("Top programming languages", f"@{USERNAME} · public repositories", '<text x="48" y="140" fill="#c4b5fd" font-family="Arial,sans-serif" font-size="16">No public language data is available yet.</text>')
    bars = []
    x = 48
    for name, size in top:
        percent = size / total * 100
        width = max(3, 1100 * percent / 100)
        bars.append(f'<rect x="{x}" y="122" width="{width:.2f}" height="18" fill="{colours[name]}" />')
        x += width
    rows = []
    for index, (name, size) in enumerate(top):
        x = 48 + (index % 2) * 560
        y = 180 + (index // 2) * 28
        percent = size / total * 100
        rows.append(
            f'<circle cx="{x}" cy="{y - 5}" r="5" fill="{colours[name]}"/><text x="{x + 14}" y="{y}" fill="{TEXT}" font-family="Arial,sans-serif" font-size="14">{esc(name)}</text><text x="{x + 520}" y="{y}" text-anchor="end" fill="{MUTED}" font-family="Arial,sans-serif" font-size="14">{percent:.1f}%</text>'
        )
    return shell("Top programming languages", f"@{USERNAME} · measured by public repository bytes", "".join(bars) + "".join(rows), 270)


def make_streak(profile: dict) -> str:
    current, longest = streaks(calendar_days(profile))
    body = (
        f'<text x="48" y="145" fill="{TEXT}" font-family="Arial,sans-serif" font-size="46" font-weight="800">{current}</text><text x="48" y="172" fill="{MUTED}" font-family="Arial,sans-serif" font-size="14">CURRENT STREAK · DAYS</text>'
        f'<text x="610" y="145" fill="{TEXT}" font-family="Arial,sans-serif" font-size="46" font-weight="800">{longest}</text><text x="610" y="172" fill="{MUTED}" font-family="Arial,sans-serif" font-size="14">LONGEST STREAK · DAYS</text>'
    )
    return shell("Contribution streak", f"@{USERNAME} · same trailing-year calendar source", body)


def main() -> int:
    profile = fetch_profile()
    OUTPUT.mkdir(exist_ok=True)
    calendar = profile["contributionsCollection"]["contributionCalendar"]
    total = calendar["totalContributions"]
    days = calendar_days(profile)
    current, longest = streaks(days)
    (OUTPUT / "contributions.svg").write_text(
        make_calendar(profile, "GitHub contributions", f"@{USERNAME} · trailing 12-month contribution calendar", f"{total:,} total in this window"),
        encoding="utf-8",
    )
    (OUTPUT / "activity.svg").write_text(
        make_calendar(profile, "Activity pulse", f"@{USERNAME} · daily activity from the same source", f"Current streak: {current} days · Longest: {longest} days"),
        encoding="utf-8",
    )
    (OUTPUT / "github-stats.svg").write_text(make_stats(profile), encoding="utf-8")
    (OUTPUT / "top-languages.svg").write_text(make_languages(profile), encoding="utf-8")
    (OUTPUT / "streak.svg").write_text(make_streak(profile), encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"update_stats.py: {error}", file=sys.stderr)
        raise SystemExit(1)
