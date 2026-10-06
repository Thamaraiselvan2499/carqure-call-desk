# CarQure Call Desk

Daily call-centre dashboard for the Customer Champion and Feedback teams.

## Add a day
1. Open the `uploads` folder → **Add file → Upload files**.
2. Drop the six call-platform CSV exports (production, break, login, CDR, missed calls, queue missed). Keep their original file names — the date is read from them.
3. Click **Commit changes**. The **Build dashboard** action runs and the site updates in about two minutes.

Uploading the same day again replaces it (the newest file of each type wins).

## Settings
- `config.json` → `maskPhones`: `true` hides the middle digits of customer numbers on the published site. Set to `false` only if the site is private to your team.
- Targets and green/amber/red limits are at the top of the script in `index.html` (`"targets"`).

## Files
- `index.html` — the dashboard page
- `scripts/ingest.js` — reads the six CSV exports
- `scripts/build_site.js` — builds `site/` (page + `data/days.json`) for GitHub Pages
- `.github/workflows/build-dashboard.yml` — runs the build and publishes on every push to `main`
