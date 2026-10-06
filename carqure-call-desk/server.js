/* CarQure Call Desk — small web server for Render.
   - Serves the dashboard (index.html).
   - GET  /api/days   → every saved day (customer numbers masked unless the upload key is sent).
   - POST /api/days   → saves one day built in the browser from the six CSV exports (needs the upload key).
   Storage: one JSON file per day, either in a GitHub branch (GITHUB_TOKEN set — free and permanent)
   or in DATA_DIR on disk (use with a Render persistent disk).
   No npm packages needed (Node 18+). */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const INGEST = require("./scripts/ingest.js");

const PORT = process.env.PORT || 3000;
const KEY = process.env.UPLOAD_KEY || "";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const GH_REPO = process.env.GITHUB_REPO || "";
const GH_BRANCH = process.env.GITHUB_DATA_BRANCH || "dashboard-data";
const GH_DIR = (process.env.GITHUB_DATA_DIR || "days").replace(/^\/|\/$/g, "");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const MASK = (process.env.MASK_PHONES || "true") !== "false";
const INDEX = path.join(__dirname, "index.html");

let days = null;            // date -> day object
const shas = {};            // date -> GitHub blob sha
let loading = null;

/* ---------- GitHub storage ---------- */
async function gh(method, url, body, raw) {
  const r = await fetch("https://api.github.com" + url, {
    method,
    headers: {
      authorization: `Bearer ${GH_TOKEN}`, "x-github-api-version": "2022-11-28", "user-agent": "carqure-call-desk",
      accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return raw ? r.text() : r.json();
}
async function ensureBranch() {
  if (await gh("GET", `/repos/${GH_REPO}/git/ref/heads/${GH_BRANCH}`)) return;
  const repo = await gh("GET", `/repos/${GH_REPO}`);
  if (!repo) throw new Error(`Repository ${GH_REPO} not found or the token can't see it`);
  const base = await gh("GET", `/repos/${GH_REPO}/git/ref/heads/${repo.default_branch}`);
  await gh("POST", `/repos/${GH_REPO}/git/refs`, { ref: `refs/heads/${GH_BRANCH}`, sha: base.object.sha });
}
async function ghLoad() {
  await ensureBranch();
  const list = (await gh("GET", `/repos/${GH_REPO}/contents/${GH_DIR}?ref=${GH_BRANCH}`)) || [];
  const out = {};
  for (const f of list.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name))) {
    const text = await gh("GET", `/repos/${GH_REPO}/contents/${GH_DIR}/${f.name}?ref=${GH_BRANCH}`, null, true);
    const d = JSON.parse(text); out[d.date] = d; shas[d.date] = f.sha;
  }
  return out;
}
async function ghSave(day) {
  const body = { message: `Daily report ${day.date}`, branch: GH_BRANCH,
    content: Buffer.from(JSON.stringify(day)).toString("base64"), ...(shas[day.date] ? { sha: shas[day.date] } : {}) };
  const res = await gh("PUT", `/repos/${GH_REPO}/contents/${GH_DIR}/${day.date}.json`, body);
  shas[day.date] = res.content.sha;
}

/* ---------- Disk storage ---------- */
function diskLoad() {
  const dir = path.join(DATA_DIR, "days"); const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); out[d.date] = d;
  }
  return out;
}
function diskSave(day) {
  const dir = path.join(DATA_DIR, "days"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${day.date}.json.tmp`), JSON.stringify(day));
  fs.renameSync(path.join(dir, `${day.date}.json.tmp`), path.join(dir, `${day.date}.json`));
}

/* Days whose CSVs sit in uploads/ in the repo are shown too (saved uploads win). */
function seedFromUploads() {
  const up = path.join(__dirname, "uploads"), byDate = {}, out = {};
  if (!fs.existsSync(up)) return out;
  for (const rel of fs.readdirSync(up, { recursive: true }).filter(f => /\.csv$/i.test(f))) {
    const full = path.join(up, rel), text = fs.readFileSync(full, "utf8"), type = INGEST.detect(text);
    const date = (path.basename(rel).match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (!type || !date) continue;
    (byDate[date] = byDate[date] || {})[type] = { name: path.basename(rel), text };
  }
  for (const [date, set] of Object.entries(byDate)) {
    if (!set.production) continue;
    try { const d = INGEST.build(set); out[date] = { ...d, files: Object.values(set).map(f => f.name), uploadedAt: null }; }
    catch (e) { console.log("seed skipped", date, e.message); }
  }
  return out;
}

async function load() {
  if (days) return days;
  if (!loading) loading = (async () => {
    const stored = GH_TOKEN && GH_REPO ? await ghLoad() : diskLoad();
    days = { ...seedFromUploads(), ...stored };
    console.log(`loaded ${Object.keys(days).length} day(s) from ${GH_TOKEN ? "GitHub branch " + GH_BRANCH : DATA_DIR}`);
    return days;
  })().catch(e => { loading = null; throw e; });
  return loading;
}

/* ---------- helpers ---------- */
const keyOk = req => {
  const k = String(req.headers["x-upload-key"] || "");
  if (!KEY || !k) return false;
  const a = crypto.createHash("sha256").update(k).digest(), b = crypto.createHash("sha256").update(KEY).digest();
  return crypto.timingSafeEqual(a, b);
};
const maskNum = p => p.length > 5 ? p.slice(0, 2) + "•".repeat(p.length - 5) + p.slice(-3) : p;
function publicView(list) {
  return list.map(d => ({ ...d, missed: d.missed.map(m => ({ ...m, pk: crypto.createHash("sha1").update(m.phone).digest("hex").slice(0, 10), phone: maskNum(m.phone) })) }));
}
function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((ok, no) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { no(Object.assign(new Error("Upload too large"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", no);
  });
}
function validDay(d) {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Array.isArray(d.agents) && d.agents.length > 0 && Array.isArray(d.missed)
    && d.agents.every(a => a && a.date === d.date && typeof a.agent === "string") && d.missed.every(m => m && m.date === d.date);
}

let saving = Promise.resolve();
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(res, 200, fs.readFileSync(INDEX), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (url.pathname === "/api/check-key" && req.method === "POST") return send(res, keyOk(req) ? 200 : 401, { ok: keyOk(req) });
    if (url.pathname === "/api/days" && req.method === "GET") {
      const list = Object.values(await load()).sort((a, b) => a.date.localeCompare(b.date));
      return send(res, 200, MASK && !keyOk(req) ? publicView(list) : list);
    }
    if (url.pathname === "/api/days" && req.method === "POST") {
      if (!KEY) return send(res, 403, { error: "Uploads are switched off: set UPLOAD_KEY in Render." });
      if (!keyOk(req)) return send(res, 401, { error: "The upload key is wrong." });
      const d = JSON.parse(await readBody(req));
      if (!validDay(d)) return send(res, 400, { error: "That doesn't look like a day's report." });
      const day = { date: d.date, agents: d.agents, missed: d.missed, files: (d.files || []).slice(0, 12).map(String), uploadedAt: new Date().toISOString() };
      await load();
      saving = saving.then(() => (GH_TOKEN && GH_REPO ? ghSave(day) : diskSave(day)));
      await saving;
      days[day.date] = day;
      return send(res, 200, { ok: true, date: day.date, uploadedAt: day.uploadedAt });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    saving = Promise.resolve();
    send(res, e.code === 413 ? 413 : 500, { error: e.code === 413 ? "Upload too large" : "Server error: " + e.message });
  }
}).listen(PORT, () => console.log(`CarQure Call Desk on :${PORT} · storage: ${GH_TOKEN && GH_REPO ? "GitHub " + GH_REPO + "@" + GH_BRANCH : DATA_DIR} · uploads ${KEY ? "on" : "OFF (no UPLOAD_KEY)"}`));
