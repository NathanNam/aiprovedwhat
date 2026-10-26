#!/usr/bin/env python3
"""Leads from the community notes site mathcommunity.github.io/oai-math-revised.

The site (repo github.com/mathcommunity/oai-math-revised) adds human-written
NOTES.md items -- corrections, reviews, follow-up works -- to the papers of
OpenAI's math catalog, the same catalog this series covers. This helper lists
what is new since the last run, mapped to our result families and episodes.

Everything it reports is a LEAD ONLY. The community site is never a source to
cite: every item must be confirmed at its primary source (arXiv/ECCC/DOI, the
author's own post, the openai/math repo, Lean files) before a correction is
drafted. AGENT_NOTES.md files there are AI-collected and unreviewed; this
helper ignores them.

Sources:
  1. the Atom feed activity.xml (human changes, stable <id>s, slug in the link);
  2. with gh: commits since the last run that edit a NOTES.md but have no
     feed entry yet (upstream-sync merges and AGENT_NOTES.md-only edits are
     skipped);
  3. with gh: open issues titled [problem] or [reference] (pull requests are
     skipped).

Usage (run from the project folder, stdlib only):
  python3 -I tools/site/mathcommunity_fetch.py            # read-only, JSON
  python3 -I tools/site/mathcommunity_fetch.py --text     # read-only, short text
  python3 -I tools/site/mathcommunity_fetch.py --update   # also save state

State: pipeline/mathcommunity_seen.json (seen ids + last run time). With no
state file, every current item is reported once with "backlog": true; the
--update run then seeds the state. Network or gh failures never raise: the
output carries an "errors" list and the exit code is 0.
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FEED_URL = "https://mathcommunity.github.io/oai-math-revised/activity.xml"
REPO = "mathcommunity/oai-math-revised"
STATE = os.path.join(ROOT, "pipeline", "mathcommunity_seen.json")
CONTENTS = os.path.join(ROOT, "work", "math", "CONTENTS.md")
PREPRINTS = os.path.join(ROOT, "work", "math", "preprints")
EPISODES = os.path.join(ROOT, "episodes")
ATOM = "{http://www.w3.org/2005/Atom}"
UA = "aiprovedwhat-mathcommunity-check"
ISSUE_TAGS = ("[problem]", "[reference]")
# housekeeping commits on a note (link fixes, disclosure wording)
LINK_ONLY_RE = re.compile(r"NOTES: (link (PR|issue)s? #\d+.*|accurate tool disclosure"
                          r"|source checked by .*)$", re.I)
SYNC_RE = re.compile(r"upstream[- ]sync|merge openai/math|sync with openai/math", re.I)


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- catalogue

def load_catalogue():
    """slug -> family number (3 digits), plus a title index for issue matching."""
    slug_family, titles = {}, {}
    family = None
    try:
        with open(CONTENTS, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"\*\*(\d{3})\. ", line)
                if m:
                    family = m.group(1)
                    continue
                m = re.search(r"\[(.+?)\]\(preprints/([^/)]+)/", line)
                if m and family:
                    slug_family.setdefault(m.group(2), family)
                    titles[norm(m.group(1))] = m.group(2)
    except OSError:
        pass
    episodes = {}
    try:
        for d in os.listdir(EPISODES):
            m = re.match(r"(\d{3})-", d)
            if m and os.path.isdir(os.path.join(EPISODES, d)):
                episodes.setdefault(m.group(1), d)
    except OSError:
        pass
    return slug_family, titles, episodes


def norm(s):
    s = html.unescape(s).lower().replace("’", "'")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def map_slug(slug, cat):
    slug_family, _, episodes = cat
    fam = slug_family.get(slug) if slug else None
    ep = episodes.get(fam) if fam else None
    published = False
    if ep:
        vid = os.path.join(EPISODES, ep, "youtube", "video_id.txt")
        try:
            published = os.path.getsize(vid) > 0
        except OSError:
            published = False
    return {
        "slug": slug,
        "in_catalogue": bool(slug) and os.path.isdir(os.path.join(PREPRINTS, slug)),
        "family": fam,
        "episode_dir": "episodes/" + ep if ep else None,
        "published": published,
    }


# ---------------------------------------------------------------- sources

def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def strip_html(s):
    links = re.findall(r'href="([^"]+)"', s)
    text = html.unescape(re.sub(r"<[^>]+>", "", s))
    return re.sub(r"\s+", " ", text).strip(), [html.unescape(u) for u in links]


def kind_from_text(text):
    t = text.lower()
    if "signed up as interested" in t:
        return "interested"  # no claim about the paper; low signal
    m = re.search(r"\bunder [\"“]?([A-Z][A-Za-z /'-]+?)[\"”]?(?: \(|[.;,]|$)", text)
    if m:
        return m.group(1).strip().lower()
    for k in ("correction", "erratum", "error", "gap", "review", "follow-up",
              "reference", "problem", "remark"):
        if k in t:
            return k
    return "note"


def notes_url(slug):
    return "https://github.com/%s/blob/main/preprints/%s/NOTES.md" % (REPO, slug)


def fetch_feed():
    root = ET.fromstring(http_get(FEED_URL))
    out = []
    for e in root.findall(ATOM + "entry"):
        eid = (e.findtext(ATOM + "id") or "").strip()
        link_el = e.find(ATOM + "link")
        link = link_el.get("href", "") if link_el is not None else ""
        m = re.search(r"/papers/([^/#]+)/", link)
        slug = m.group(1) if m else None
        if not slug:  # fall back to the slug inside the tag: id
            m = re.match(r"tag:[^:]+:([^/]+)/", eid)
            slug = m.group(1) if m else None
        text, links = strip_html(e.findtext(ATOM + "content") or "")
        out.append({
            "id": eid,
            "source": "feed",
            "date": (e.findtext(ATOM + "updated") or "")[:10],
            "author": (e.findtext(ATOM + "author/" + ATOM + "name") or "").strip(),
            "title": (e.findtext(ATOM + "title") or "").strip(),
            "kind": kind_from_text(text),
            "summary": text[:500],
            "links": [link] + [u for u in links if u != link]
                     + ([notes_url(slug)] if slug else []),
            "_slug": slug,
        })
    return out


def gh_json(path):
    if not shutil.which("gh"):
        raise RuntimeError("gh not installed")
    p = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        raise RuntimeError("gh api %s failed: %s" % (path.split("?")[0], p.stderr.strip()[:200]))
    return json.loads(p.stdout)


def fetch_commits(since, feed_new, feed_seen):
    """NOTES.md edits since `since`.

    A commit on the same paper and day as a feed entry that is new in this run
    is folded into that entry (its link is added there). Otherwise it is its
    own lead; when an already-seen feed entry shares paper and day, the lead
    names it in "possible_duplicate_of" (the feed is dated by day only, so a
    later note the same day may not have a feed line yet).
    """
    out = []
    commits = gh_json("repos/%s/commits?since=%s&per_page=100" % (REPO, since))
    for c in commits:
        msg = c.get("commit", {}).get("message", "")
        if len(c.get("parents", [])) > 1 or SYNC_RE.search(msg) or LINK_ONLY_RE.match(msg.strip()):
            continue  # merges (their commits are listed separately), upstream syncs, link-only fixups
        sha = c["sha"]
        files = gh_json("repos/%s/commits/%s" % (REPO, sha)).get("files", [])
        if any(not fobj.get("filename", "").startswith("preprints/") for fobj in files):
            continue  # site or tooling commit, not a note
        slugs = []
        for fobj in files:
            m = re.match(r"preprints/([^/]+)/NOTES\.md$", fobj.get("filename", ""))
            if m and m.group(1) not in slugs:
                slugs.append(m.group(1))
        date = c["commit"].get("author", {}).get("date", "")[:10]
        for slug in slugs:
            cid = "commit:%s:%s" % (sha, slug)
            if (slug, date) in feed_new:
                for f in feed_new[(slug, date)]:
                    if c.get("html_url") and c["html_url"] not in f["links"]:
                        f["links"].append(c["html_url"])
                    f.setdefault("_folded", []).append(cid)
                continue
            first = msg.split("\n")[0]
            out.append({
                "possible_duplicate_of": feed_seen.get((slug, date)),
                "id": cid,
                "source": "commit",
                "date": date,
                "author": c["commit"].get("author", {}).get("name", ""),
                "title": first,
                "kind": kind_from_text(msg),
                "summary": msg.strip()[:500],
                "links": [c.get("html_url", ""), notes_url(slug)],
                "_slug": slug,
            })
    return out


def fetch_issues(since, cat):
    q = "repos/%s/issues?state=open&per_page=100" % REPO
    if since:
        q += "&since=" + since
    out = []
    titles = cat[1]
    for i in gh_json(q):
        if "pull_request" in i:
            continue
        title = i.get("title", "")
        tag = next((t for t in ISSUE_TAGS if title.lower().startswith(t)), None)
        if not tag:
            continue
        body = i.get("body") or ""
        m = re.search(r"### Paper\s+(\S+)", body)
        slug = m.group(1).strip() if m else None
        if not slug or slug not in cat[0]:
            slug = titles.get(norm(title[len(tag):])) or slug
        text = re.sub(r"\s+", " ", body).strip()
        out.append({
            "id": "issue:%d" % i["number"],
            "source": "issue",
            "date": (i.get("created_at") or "")[:10],
            "author": (i.get("user") or {}).get("login", ""),
            "title": title,
            "kind": tag.strip("[]"),
            "summary": text[:500],
            "links": [i.get("html_url", "")] + re.findall(r"https?://\S+", body)[:5],
            "_slug": slug,
        })
    return out


# ---------------------------------------------------------------- main

def load_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--update", action="store_true", help="write pipeline/mathcommunity_seen.json")
    ap.add_argument("--text", action="store_true", help="concise text instead of JSON")
    ap.add_argument("--no-gh", action="store_true", help="feed only; skip commits and issues")
    args = ap.parse_args()

    state = load_state()
    backlog = state is None
    seen = set((state or {}).get("seen", []))
    last_run = (state or {}).get("last_run")
    started = now_iso()
    cat = load_catalogue()
    errors, items, feed_ok = [], [], False

    try:
        feed = fetch_feed()
        feed_ok = True
        items += feed
    except Exception as e:  # network, HTTP or XML error
        feed = []
        errors.append("feed: %s" % e)

    if not args.no_gh:
        feed_new, feed_seen = {}, {}
        for f in feed:
            key = (f["_slug"], f["date"])
            if f["id"] in seen:
                feed_seen.setdefault(key, f["id"])
            else:
                feed_new.setdefault(key, []).append(f)
        # Look back 3 days before the last run: a PR's commits keep their own
        # dates, so a note written earlier but merged later is still caught;
        # the seen list stops repeats.
        base = dt.datetime.strptime(last_run or started, "%Y-%m-%dT%H:%M:%SZ")
        window = (base - dt.timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            items += fetch_commits(window, feed_new, feed_seen)
        except Exception as e:
            errors.append("commits: %s" % e)
        try:
            items += fetch_issues(last_run, cat)
        except Exception as e:
            errors.append("issues: %s" % e)

    leads, folded = [], set()
    for it in items:
        if it["id"] in seen:
            continue
        folded.update(it.get("_folded", []))
        lead = {k: v for k, v in it.items() if not k.startswith("_")}
        m = map_slug(it["_slug"], cat)
        lead.update({"paper_slug": m["slug"], "in_catalogue": m["in_catalogue"],
                     "family": m["family"], "episode_dir": m["episode_dir"],
                     "published": m["published"], "backlog": backlog})
        leads.append(lead)
    leads.sort(key=lambda x: (x["date"], x["id"]), reverse=True)

    if args.update and (feed_ok or not backlog):
        new_state = {
            "note": "Seen ids for tools/site/mathcommunity_fetch.py (leads only; confirm at the primary source).",
            # keep the old window after any failure, so nothing is skipped;
            # the seen list stops repeats when it is fetched again
            "last_run": started if not errors else (last_run or started),
            "seen": sorted(seen | folded | {l["id"] for l in leads}),
        }
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        tmp = STATE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(new_state, f, indent=1, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, STATE)

    published_eps = sorted({l["family"] for l in leads if l["published"] and l["family"]})
    result = {
        "checked_at": started,
        "since": last_run,
        "backlog": backlog,
        "state_written": bool(args.update and (feed_ok or not backlog)),
        "errors": errors,
        "new": len(leads),
        "on_published_episodes": published_eps,
        "leads": leads,
        "reminder": "Leads only. Confirm each at its primary source before drafting; never cite the community site.",
    }
    if args.text:
        print("mathcommunity: %d new item(s)%s; published episodes: %s"
              % (len(leads), " (backlog, first run)" if backlog else "",
                 ", ".join(published_eps) or "none"))
        for e in errors:
            print("  error: " + e)
        for l in leads:
            ep = l["episode_dir"] or "no episode"
            print("- %s %s [%s] %s -- %s (%s%s)" % (
                l["date"], l["source"], l["kind"], l["title"], l["family"] or "?",
                ep, ", published" if l["published"] else ""))
            print("    " + (l["links"][0] if l["links"] else ""))
    else:
        json.dump(result, sys.stdout, indent=1, ensure_ascii=False)
        print()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never break the daily job
        print(json.dumps({"errors": ["unexpected: %s" % e], "new": 0, "leads": []}))
        sys.exit(0)
