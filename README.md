# hafizr283.github.io

Live dev-telemetry page: Codeforces, LeetCode and GitHub statistics on one
dark terminal-styled dashboard, with zero build step and zero dependencies.

**Live:** https://hafizr283.github.io

## How the data stays fresh

| Source | In the browser (every visit) | Cached snapshot (`data/stats.json`) |
|---|---|---|
| Codeforces rating / contests | live via `codeforces.com/api` | ✔ refreshed every 6 h |
| Codeforces solved count | — (heavy endpoint) | ✔ refreshed every 6 h |
| GitHub repos / languages | live via `api.github.com` | ✔ refreshed every 6 h |
| Contribution heatmap | live via `github-contributions-api.jogruber.de` | ✔ refreshed every 6 h |
| LeetCode solved | live via a public CORS mirror (best effort) | ✔ refreshed every 6 h (primary) |

The page paints instantly from `data/stats.json`, then upgrades each card to
live data as the API calls return — the terminal header shows which sources
are `live`, `cached`, or unavailable.

`data/stats.json` is rewritten by [`scripts/fetch-stats.mjs`](scripts/fetch-stats.mjs),
run every 6 hours by the [`update-stats`](.github/workflows/update-stats.yml)
GitHub Action. If an upstream API is down, the previous snapshot for that
section is kept.

## Changing the handles

Edit the `CONFIG` object at the top of [`assets/main.js`](assets/main.js) and
`HANDLES` at the top of [`scripts/fetch-stats.mjs`](scripts/fetch-stats.mjs),
plus the links in `index.html`.

## Local preview

Any static server works, e.g.:

```
python -m http.server 8080
```

then open http://localhost:8080. (Opening `index.html` directly with `file://`
also works, but the cached snapshot can't be loaded that way — cards fill in
from the live APIs only.)

## Layout

```
index.html                     markup
assets/style.css               dark terminal theme
assets/main.js                 fetching + hand-rolled SVG charts
data/stats.json                cached snapshot (auto-committed)
scripts/fetch-stats.mjs        snapshot refresher (Node 20, no deps)
.github/workflows/update-stats.yml
```
