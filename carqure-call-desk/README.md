# CarQure Call Desk

Daily call-centre dashboard for the Customer Champion and Feedback teams.

## Live dashboard (Render)
The dashboard runs on Render (`server.js`). Open the Render link, enter the upload key once, and drop the six
call-platform CSV exports into the **Daily upload** box. The day is saved straight away for everyone.

- Viewers without the upload key see customer numbers masked.
- Each day is saved as `days/<date>.json` on the `dashboard-data` branch of this repository (needs `GITHUB_TOKEN`).
- Render settings: see `render.yaml` at the top of the repository (Root Directory `carqure-call-desk`,
  start command `node server.js`, env vars `UPLOAD_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`).

Days whose CSVs are in `uploads/` are also shown (an upload through the dashboard for the same day wins).

## GitHub Pages copy (optional)
`index-pages.html` + `scripts/build_site.js` build a static copy from `uploads/`. It only runs by hand:
**Actions → Build dashboard → Run workflow**.

## Settings
- `config.json` → `maskPhones`: `true` hides the middle digits of customer numbers on the published site. Set to `false` only if the site is private to your team.
- Targets and green/amber/red limits are at the top of the script in `index.html` (`"targets"`).

## Files
- `index.html` — the dashboard page served by Render
- `server.js`, `package.json` — the Render web server (no npm packages needed)
- `index-pages.html` — the GitHub Pages copy of the page
- `scripts/ingest.js` — reads the six CSV exports
- `scripts/build_site.js` — builds `site/` (page + `data/days.json`) for GitHub Pages
- `.github/workflows/build-dashboard.yml` — builds the GitHub Pages copy when run by hand
