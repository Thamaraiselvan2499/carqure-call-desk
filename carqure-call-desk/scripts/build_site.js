/* Builds the dashboard site from the CSVs in uploads/.  Run: node scripts/build_site.js
   Groups the CSV exports by the date in their file names, turns each day into one report,
   and writes site/index.html + site/data/days.json for GitHub Pages. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execSync } = require("child_process");
const INGEST = require("./ingest.js");
const ROOT = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const UP = path.join(ROOT, "uploads");

const commitTime = f => { try { return execSync(`git log -1 --format=%cI -- "${f}"`, { cwd: ROOT }).toString().trim(); } catch (_) { return ""; } };
const files = fs.existsSync(UP) ? fs.readdirSync(UP, { recursive: true }).filter(f => /\.csv$/i.test(f)) : [];
const byDate = {};
for (const rel of files) {
  const full = path.join(UP, rel), text = fs.readFileSync(full, "utf8"), type = INGEST.detect(text);
  if (!type) { console.log("skip (not recognised):", rel); continue; }
  const date = (path.basename(rel).match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!date) { console.log("skip (no date in file name):", rel); continue; }
  const day = byDate[date] = byDate[date] || {};
  const when = commitTime(full) || fs.statSync(full).mtime.toISOString();
  if (!day[type] || when >= day[type].when) day[type] = { name: path.basename(rel), text, when };
}
const mask = p => p.length > 5 ? p.slice(0, 2) + "•".repeat(p.length - 5) + p.slice(-3) : p;
const days = [];
for (const date of Object.keys(byDate).sort()) {
  const set = byDate[date];
  if (!set.production) { console.log(`skip ${date}: production export missing`); continue; }
  const day = INGEST.build(set);
  if (cfg.maskPhones) day.missed.forEach(m => { m.pk = crypto.createHash("sha1").update(m.phone).digest("hex").slice(0, 10); m.phone = mask(m.phone); });
  const uploadedAt = Object.values(set).map(f => f.when).sort().pop();
  days.push({ date: day.date, agents: day.agents, missed: day.missed, files: Object.values(set).map(f => f.name), uploadedAt: new Date(uploadedAt).toISOString() });
  console.log(`built ${date}: ${day.agents.length} agents, ${day.missed.length} missed calls (${Object.keys(set).length}/6 files)`);
}
fs.mkdirSync(path.join(ROOT, "site", "data"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "index-pages.html"), path.join(ROOT, "site", "index.html"));
fs.writeFileSync(path.join(ROOT, "site", "data", "days.json"), JSON.stringify(days));
console.log(`site ready: ${days.length} day(s)`);
