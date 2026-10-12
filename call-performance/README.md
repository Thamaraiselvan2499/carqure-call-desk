# CarQure Call Performance

Call performance dashboard for the Customer Champion and Feedback teams, with a **Daily** tab for
report uploads at **1:30 PM, 4:30 PM and 6:30 PM**, plus the September monthly, Go-Axen deficit and Feedback tabs.

## How the daily upload works
Open the site, drop today's call-platform CSV exports into the upload box (the Production report is required;
Login, Missed Calls and the call log add more detail), pick the time, enter the upload key once, and click **Save snapshot**.
Each snapshot is saved as `snapshots/<date>_<1330|1630|1830>.json` on the `performance-data` branch of this repository.

## Render settings
- Branch: `call-performance` · Build: `cd call-performance && npm install` · Start: `node call-performance/server.js`
- Environment variables:
  - `UPLOAD_KEY` — needed to save or delete snapshots
  - `GITHUB_TOKEN` — lets the server save snapshots to this repository (same token as the Call Desk)
  - `GITHUB_REPO` — `Thamaraiselvan2499/carqure-call-desk`
  - `GITHUB_DATA_BRANCH` — `performance-data`
  - `VIEW_PASSWORD` (optional) — asks for a password before anyone can open the site
