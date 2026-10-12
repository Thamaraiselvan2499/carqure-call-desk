/* CarQure Call Performance — small web server for Render.
   - Serves the dashboard (index.html).
   - GET    /api/snapshots       → every saved snapshot (date + 1:30 / 4:30 / 6:30 PM upload).
   - PUT    /api/snapshots/:id   → saves one snapshot built in the browser from the call reports (needs the upload key).
   - DELETE /api/snapshots/:id   → removes one snapshot (needs the upload key).
   Storage: one JSON file per snapshot, either in a GitHub branch (GITHUB_TOKEN set — free and permanent)
   or in DATA_DIR on disk (use with a Render persistent disk).
   No npm packages needed (Node 18+). */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const KEY = process.env.UPLOAD_KEY || "";
const VIEW_PASSWORD = process.env.VIEW_PASSWORD || "";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const GH_REPO = process.env.GITHUB_REPO || "";
const GH_BRANCH = process.env.GITHUB_DATA_BRANCH || "performance-data";
const GH_DIR = (process.env.GITHUB_DATA_DIR || "snapshots").replace(/^\/|\/$/g, "");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const INDEX = path.join(__dirname, "index.html");
const ID_RE = /^\d{4}-\d{2}-\d{2}_(1330|1630|1830)$/;
const useGh = !!(GH_TOKEN && GH_REPO);

let snaps = null;      // id -> snapshot
const shas = {};       // id -> GitHub blob sha
let loading = null;

/* ---------- GitHub storage ---------- */
async function gh(method, url, body, raw) {
  const r = await fetch("https://api.github.com" + url, {
    method,
    headers: {
      authorization: `Bearer ${GH_TOKEN}`, "x-github-api-version": "2022-11-28", "user-agent": "carqure-call-performance",
      accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return raw ? r.text() : (r.status === 204 ? {} : r.json());
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
  for (const f of list.filter(f => /\.json$/.test(f.name))) {
    const id = f.name.replace(/\.json$/, "");
    if (!ID_RE.test(id)) continue;
    const text = await gh("GET", `/repos/${GH_REPO}/contents/${GH_DIR}/${f.name}?ref=${GH_BRANCH}`, null, true);
    out[id] = JSON.parse(text); shas[id] = f.sha;
  }
  return out;
}
async function ghSave(id, snap) {
  const body = { message: `Call snapshot ${id}`, branch: GH_BRANCH,
    content: Buffer.from(JSON.stringify(snap)).toString("base64"), ...(shas[id] ? { sha: shas[id] } : {}) };
  const res = await gh("PUT", `/repos/${GH_REPO}/contents/${GH_DIR}/${id}.json`, body);
  shas[id] = res.content.sha;
}
async function ghDelete(id) {
  if (!shas[id]) return;
  await gh("DELETE", `/repos/${GH_REPO}/contents/${GH_DIR}/${id}.json`, { message: `Remove call snapshot ${id}`, branch: GH_BRANCH, sha: shas[id] });
  delete shas[id];
}

/* ---------- disk storage ---------- */
function diskLoad() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = {};
  for (const f of fs.readdirSync(DATA_DIR)) {
    const id = f.replace(/\.json$/, "");
    if (f.endsWith(".json") && ID_RE.test(id)) out[id] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
  }
  return out;
}
const diskSave = (id, snap) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, id + ".json"), JSON.stringify(snap)); };
const diskDelete = id => { try { fs.unlinkSync(path.join(DATA_DIR, id + ".json")); } catch (e) {} };

async function all() {
  if (snaps) return snaps;
  if (!loading) loading = (useGh ? ghLoad() : Promise.resolve(diskLoad()))
    .then(s => { snaps = s; console.log(`loaded ${Object.keys(s).length} snapshot(s) from ${useGh ? "GitHub branch " + GH_BRANCH : DATA_DIR}`); return s; })
    .finally(() => { loading = null; });
  return loading;
}

/* ---------- helpers ---------- */
const same = (a, b) => { const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const keyOk = req => !!KEY && !!req.headers["x-upload-key"] && same(req.headers["x-upload-key"], KEY);
function viewOk(req) {
  if (!VIEW_PASSWORD) return true;
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Basic ")) return false;
  const pass = Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":");
  return same(pass, VIEW_PASSWORD);
}
function send(res, code, body, type) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(code, { "content-type": type || (isObj ? "application/json" : "text/plain; charset=utf-8"), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((ok, bad) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { bad(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", bad);
  });
}
function clean(id, s) {
  if (!s || typeof s !== "object" || typeof s.agents !== "object") throw Object.assign(new Error("bad snapshot"), { code: 400 });
  const [date, slot] = id.split("_");
  const agents = {};
  for (const [k, a] of Object.entries(s.agents)) {
    if (!/^Hue\d+$/i.test(k) || typeof a !== "object") continue;
    const o = {};
    for (const f of ["login", "ready", "notready", "brk", "lunch", "meet", "query", "inTot", "inAns", "outTot", "outAns", "talkIn", "talkOut", "missed"]) o[f] = Number(a[f]) || 0;
    o.firstLogin = a.firstLogin == null ? null : Number(a.firstLogin);
    o.lastLogout = a.lastLogout == null ? null : Number(a.lastLogout);
    o.hourly = Array.isArray(a.hourly) ? a.hourly.slice(0, 24).map(v => Number(v) || 0) : null;
    o.ext = String(a.ext || "").slice(0, 20);
    agents[k] = o;
  }
  const files = Array.isArray(s.files) ? s.files.slice(0, 20).map(f => ({ name: String(f.name || "").slice(0, 200), kind: f.kind ? String(f.kind).slice(0, 20) : null, rows: Number(f.rows) || 0 })) : [];
  return { date, slot, savedAt: new Date().toISOString(), files, hasCdr: !!s.hasCdr, agents };
}

/* ---------- server ---------- */
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (!viewOk(req)) { res.writeHead(401, { "www-authenticate": 'Basic realm="CarQure Call Performance", charset="UTF-8"' }); return res.end("Password required"); }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(res, 200, fs.readFileSync(INDEX), "text/html; charset=utf-8");
    if (url.pathname === "/api/snapshots" && req.method === "GET") return send(res, 200, Object.values(await all()));
    const m = url.pathname.match(/^\/api\/snapshots\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!ID_RE.test(id)) return send(res, 400, { error: "Snapshot id must look like 2026-10-12_1330." });
      if (!KEY) return send(res, 403, { error: "Uploads are switched off: set UPLOAD_KEY in Render." });
      if (!keyOk(req)) return send(res, 401, { error: "The upload key is wrong." });
      const s = await all();
      if (req.method === "PUT") {
        const snap = clean(id, JSON.parse(await readBody(req)));
        if (useGh) await ghSave(id, snap); else diskSave(id, snap);
        s[id] = snap; return send(res, 200, { ok: true, id });
      }
      if (req.method === "DELETE") {
        if (useGh) await ghDelete(id); else diskDelete(id);
        delete s[id]; return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    send(res, e.code === 413 ? 413 : e.code === 400 || e instanceof SyntaxError ? 400 : 500, { error: e.code === 413 ? "Upload too large." : e.code === 400 || e instanceof SyntaxError ? "That upload could not be read." : "Server error — try again in a minute." });
  }
}).listen(PORT, () => console.log(`CarQure Call Performance on :${PORT} · storage: ${useGh ? "GitHub " + GH_REPO + "@" + GH_BRANCH : DATA_DIR} · uploads ${KEY ? "on" : "OFF (no UPLOAD_KEY)"} · view password ${VIEW_PASSWORD ? "on" : "off"}`));
