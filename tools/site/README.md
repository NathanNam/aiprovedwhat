# Site builder

`build.py` turns OpenAI's math catalog into the results pages of
aiprovedwhat.com. It lists every result family in the catalog, keeps the
hand-made episode pages, and writes everything else into `docs/`.

## Setup (once)

```
cd tools/site
npm install          # installs KaTeX into tools/site/node_modules (not into docs/)
```

You also need a clone of OpenAI's repository, for example:

```
git clone https://github.com/openai/math /home/claude/work/math
```

## Build

From the project folder:

```
python3 tools/site/build.py /home/claude/work/math    # path is optional; this is the default
python3 tools/site/check_links.py                     # every internal link must resolve
```

The builder is safe to re-run. It only rewrites files whose content changed,
and it never overwrites a page that lacks its generator tag
(`<meta name="generator" content="tools/site/build.py">`), so hand-made
episode pages stay as they are. On those pages it only touches the header
navigation and two marked blocks (below).

## Results and papers

OpenAI groups its papers into results (721 papers in 373 results as of
October 26, 2026; `docs/data/results.json` has the current figures). The site labels the first paper OpenAI lists for a result as
the **main paper** and the others as **companions**; it uses no other roles.
The counts on the home and results pages come from the data.

## Marked blocks on hand-made episode pages

Every hand-made episode page (any `docs/episodes/<slug>/index.html` without
the generator tag) gets two blocks that the builder owns:

```
<p class="subtitle">…</p>
<!-- papers-note:start -->
<p class="papers-note">Covers result 003 in OpenAI’s catalog: <a href="#papers-in-result">all 3 papers</a>.</p>
<!-- papers-note:end -->
…
<!-- papers-list:start -->
<section aria-labelledby="papers-in-result"> … The 3 papers in this result … </section>
<!-- papers-list:end -->

<section aria-labelledby="transcript-h">
```

- On the first build after a page is created, the builder inserts each block:
  the note right after the `<p class="subtitle">` line, the list right before
  the Transcript section. If either anchor line is missing it warns and skips.
- After that it rewrites only the text between each start and end marker.
  Don't edit inside the markers (changes are overwritten); edit anywhere else
  freely. You may move a whole marked block, markers included.
- Deleting both markers of a block makes the builder insert it again. If only
  one marker of a pair is present, it warns and leaves the page alone.
- Hand-made pages don't load KaTeX, so formulas in paper titles there are
  shown as plain text (for example "ℜ s > 7/8").

What it reads:

| File | What it holds |
| --- | --- |
| `<math>/CONTENTS.md` | Titles, summaries and papers of every result family |
| `<math>/overview.tex` | The subject of each result |
| `tools/site/episodes.json` | Episodes made so far, the home page hero, and the "last checked" date |
| `tools/site/lean_status.json` | Lean status of each family, classified by hand from OpenAI's scope notes |
| `docs/data/results.json` | The previous build's slugs, so URLs never change |

What it writes: `docs/index.html`, `docs/episodes/index.html` (all results),
`docs/episodes/<slug>/index.html` for every result without a hand-made page,
`docs/subjects/`, the short links `docs/NNN/` and `docs/NNN/paper/`,
`docs/data/results.json`, `docs/assets/katex/`, `docs/sitemap.xml` and
`docs/robots.txt`.

Math in titles and summaries is rendered to HTML with KaTeX at build time, so
the pages need no JavaScript to show it. A formula KaTeX cannot render is
shown as its TeX source in a `<code>` element and listed at the end of the
build output.

## Adding an episode

1. Make the hand-made page as before: copy `docs/episodes/002-bsd-formula/`
   to `docs/episodes/<slug>/`, where `<slug>` is the result's existing slug
   (see `docs/data/results.json`; 003 is `003-quasi-riemann-hypothesis`).
   This replaces the generated "Episode coming" page. Delete the generator
   `<meta>` line if you copied it from a generated page, so the builder
   leaves your page alone. Put `thumbnail.jpg` (1280×720) in the same folder.
2. Add the episode to `tools/site/episodes.json`:

   ```json
   {
     "num": "003",
     "slug": "003-quasi-riemann-hypothesis",
     "title": "Episode title",
     "subtitle": "One-line description shown under the thumbnail",
     "video_id": "YouTubeID",
     "length": "7:42",
     "published": "2026-11",
     "hero": {
       "claim": "The big sentence at the top of the home page.",
       "lede": "The paragraph under it.",
       "image_alt": "Alt text for the thumbnail on the home page.",
       "preprint": "OpenAI, October 2026",
       "note": "Sentences after \"Last checked …\" under the home page record."
     }
   }
   ```

   The newest episode (latest `published`, then highest number) becomes the
   home page hero, so it needs a `hero` block; older episodes can drop theirs.
   `hero` strings are inserted as HTML, so `<i>` and `&amp;` work.
3. Re-run `build.py` and `check_links.py`.

If an episode is listed but has no hand-made page yet, the builder generates a
result page that shows the video and prints a warning.

## When OpenAI updates the catalog

Pull the clone, re-run the builder, and read its warnings:

- A family with a new Lean link but no entry in `lean_status.json` is shown as
  "part of the claim" until you read its scope note (`lean/docs/NNN.md`) and
  add `"NNN": {"status": "main"}` or `"partial"`. `main` means the scope note
  says the family's headline theorem is formalized; `partial` means only
  supporting results, a consequence, a special case or a weaker form.
  Entries marked `"uncertain": true` are judgment calls worth a second look.
- New results get new slugs; existing slugs are kept.
- Update `last_checked` in `episodes.json` when you have re-checked the record.

## Community notes (leads only)

`mathcommunity_fetch.py` lists what is new on
[oai-math-revised](https://mathcommunity.github.io/oai-math-revised/), a
community-notes site over the same OpenAI catalog: human NOTES.md items
(corrections, reviews, follow-up works) from its Atom feed, NOTES.md commits
that have no feed line yet, and open `[problem]` / `[reference]` issues. Each
item is mapped to its result family, episode folder and whether that episode
is published. AGENT_NOTES.md (AI-collected, unreviewed) and upstream syncs are
skipped.

```
python3 -I tools/site/mathcommunity_fetch.py --text     # read-only
python3 -I tools/site/mathcommunity_fetch.py --update   # JSON, saves pipeline/mathcommunity_seen.json
```

Without a state file every current item is reported once with
`"backlog": true`. Network or `gh` failures go in an `errors` list and the
exit code stays 0. These are leads, never sources: confirm each one at its
primary source (arXiv/ECCC/DOI, the author's post, openai/math, the Lean
files) before drafting a correction, and never cite the community site. The
daily up-to-date check runs it as step 2b.

## Checks

```
python3 -m http.server 8765 --directory docs &
python3 tools/site/screenshots.py /home/claude/work/site-shots --sweep
```

`screenshots.py` saves full-page screenshots at 1280px and 390px, exercises
the search and filters on the results page, and with `--sweep` checks every
page for sideways scrolling at 390px. It uses Playwright with the Chromium at
`/opt/pw-browsers/chromium`.

## The next version (tools/site_next, October 2026)

Same builder plus What's new, /updates/ and its RSS feed, Specials, a four-step record
(preprint, under expert review, peer reviewed, Lean), revised banners, "Versions of this episode"
lists and Specials/relations on the Connections map.

Where it writes: installed as `tools/site/` it builds `docs/` in place as before. As `tools/site_next/`
it mirrors `docs/` into a preview folder (default: the session scratchpad `apw-next/`) and builds
there; it refuses `docs/` unless given `--out docs --write-docs`. `--preview-episode NNN=VIDEOID`
(preview only) shows a finished, unpublished episode by running its `production/page.py` in a sandbox.

Hand-maintained inputs (all small JSON files here):

| File | What it holds |
| --- | --- |
| `updates.json` | What's new, /updates/ and feed.xml entries, newest first, each with a source |
| `specials.json` | Claims announced outside the catalogue (S01, S02), with record and sources |
| `specials/<id>_refs.json` | A Special's reference lists, read from its PDFs by `specials_refs.py` |
| `revisions.json` | Revised / implied-by / record-updated banners per result |
| `status_overrides.json` | Record steps the catalogue lacks: expert review (OSVerify's published reviews, kind "reviewed"; or a group OpenAI says is checking, kind "announced", quoted), preprint text |
| `relations.json` | Our own links between results (implies, same equations), drawn on the map |
| `sources.json` | The labs covered (OpenAI, Axiom Math, PSI, Anthropic): names, repos, ID prefixes, announcement pages |
| `version_notes.json` | Labels for episode versions the default names don't fit (e.g. a fix release) |
| `connections.baseline.json` | The connections.json a revised result's references are compared against |

`static/` is copied over the output (`assets/connections.js`); `static/assets/next.css` is appended to
`assets/site.css` between marker comments. `share_card.js [OUT] [SITE_DIR] [BASE_URL]` renders the card
from `SITE_DIR/data/connections.json`. `check_links.py` also requires the addresses printed in YouTube
descriptions (`REQUIRED`).

The four-step record on every page: posted as a preprint, under expert review, peer reviewed, checked in Lean.
Every 'Last checked' date comes from the latest daily-check entry in `pipeline/UP_TO_DATE.md`
(hand-made pages carry it between `<!-- last-checked:start/end -->` markers).
