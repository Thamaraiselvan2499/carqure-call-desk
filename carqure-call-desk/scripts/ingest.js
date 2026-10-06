/* Browser-side port of ingest.py: turns the six call-platform CSV exports into one day's records. */
const INGEST = (() => {
  const AGENTS = {
    Hue1001: ["Krishnaveni", "Customer Champion"], Hue1002: ["Abdul", "Customer Champion"],
    Hue1003: ["Rakesh", "Customer Champion"], Hue1004: ["Rohit", "Customer Champion"],
    Hue1007: ["Mani", "Customer Champion"], Hue1008: ["Madhi", "Customer Champion"],
    Hue1010: ["Suganya", "Customer Champion"], Hue1011: ["Khizer", "Customer Champion"],
    Hue1012: ["Sam", "Customer Champion"], Hue1005: ["Catharine", "Feedback"], Hue1009: ["Nasreen", "Feedback"],
  };
  const RENAME = { Lokesh: "Sam" };
  const EXT = { 3941001: "Hue1001", 3941002: "Hue1002", 3941003: "Hue1003", 3941004: "Hue1004", 3941005: "Hue1005",
    3941007: "Hue1007", 3941008: "Hue1008", 3941009: "Hue1009", 3941011: "Hue1010", 3941012: "Hue1011", 3941013: "Hue1012" };
  const nameTeam = hid => AGENTS[hid] || [`${hid} (unmapped)`, "Unmapped"];

  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ""));
  }
  const objects = rows => { const h = rows[0].map(s => s.trim()); return rows.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? "").trim()]))); };

  const TYPES = [
    { key: "production", label: "Production export", required: true, test: h => h.includes("Ready Time") && h.includes("Inbound Talk Time") },
    { key: "break", label: "Break report", test: h => h.includes("Break Time") && h.includes("Lunch Time") && !h.includes("Ready Time") },
    { key: "login", label: "Login report", test: h => h.includes("Duration Formatted") || (h.includes("Login Time") && h.includes("Total Seconds")) },
    { key: "cdr", label: "Call detail (CDR) export", test: h => h.includes("CallDisposition") && h.includes("CustomerPhoneNumber") },
    { key: "missed", label: "Missed calls report", test: h => h.includes("Customer Phone") && h.includes("Disposition") && !h.includes("CallDisposition") },
    { key: "queue", label: "Queue missed export", test: h => h.includes("Queue Call Date") },
  ];
  function detect(text) {
    const first = parseCSV(text.slice(0, 4000))[0] || [];
    const h = first.map(s => s.trim());
    const t = TYPES.find(t => t.test(h));
    return t ? t.key : null;
  }

  const secs = t => { if (!t) return 0; const p = String(t).trim().split(":").map(x => parseInt(parseFloat(x) || 0, 10)); while (p.length < 3) p.unshift(0); return p[0] * 3600 + p[1] * 60 + p[2]; };
  const last10 = n => String(n || "").replace(/\D/g, "").slice(-10);
  const int = x => parseInt(parseFloat(x || 0), 10) || 0;

  function readCdr(text) {
    let header = null; const out = [];
    for (const r of parseCSV(text)) {
      if (r[0] === "SNo") { header = r.slice(0, 26).map(s => s.trim()); continue; }
      if (!header) continue;
      const o = Object.fromEntries(header.map((k, i) => [k, (r[i] ?? "").trim()]));
      o.AgentDisposition = r.length > 26 ? r[26] : "";
      o.num = last10(o.CustomerPhoneNumber);
      out.push(o);
    }
    return out;
  }

  /** files: { production: {name, text}, break?: ..., login?, cdr?, missed?, queue? } */
  function build(files) {
    if (!files.production) throw new Error("The production export is required.");
    const prod = objects(parseCSV(files.production.text));
    let date = (files.production.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    const brkRows = files.break ? objects(parseCSV(files.break.text)) : [];
    const loginRows = files.login ? objects(parseCSV(files.login.text)) : [];
    if (!date) date = (brkRows[0] && brkRows[0]["S.NoDate"]) || (loginRows[0] && loginRows[0]["Work Date"]);
    const cdr = files.cdr ? readCdr(files.cdr.text) : [];
    if (!date && cdr[0]) date = cdr[0].CallDateTime.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Could not find the report date. Keep the original file names from the call platform.");

    const firstLogin = {};
    loginRows.forEach(r => { const k = r["Member Name"], v = r["Login Time"]; if (k && v && (!firstLogin[k] || v < firstLogin[k])) firstLogin[k] = v; });
    const lastCall = {}, uniq = {};
    cdr.forEach(c => {
      const m = c.MemberName;
      if (c.CallDirection === "Outbound" || c.CallDisposition === "ANSWERED") { if (!lastCall[m] || c.CallEndTime > lastCall[m]) lastCall[m] = c.CallEndTime; }
      if (c.CallDirection === "Outbound") (uniq[m] = uniq[m] || new Set()).add(c.num);
    });
    const brk = Object.fromEntries(brkRows.map(r => [r["Member Name"], r]));

    const agents = [];
    prod.forEach(r => {
      const raw = r["Member Name"], hid = RENAME[raw] || raw;
      const n = { inTot: int(r["Inbound Total"]), inAns: int(r["Inbound Answered"]), inMiss: int(r["Inbound Unanswered"]),
        outTot: int(r["Outbound Total"]), outCon: int(r["Outbound Answered"]), outNot: int(r["Outbound Unanswered"]) };
      const login = secs(r["Login Time"]);
      const activity = Object.values(n).reduce((a, b) => a + b, 0);
      if (hid === "AI Bot" || (login === 0 && activity === 0)) return;
      const b = brk[raw] || r;
      const [agent, team] = nameTeam(hid);
      const fl = firstLogin[raw], lc = lastCall[raw];
      agents.push({ date, team, agent, hue: hid, first: fl ? fl.slice(11, 16) : "", last: lc ? lc.slice(11, 16) : "",
        login, ready: secs(r["Ready Time"]), notReady: secs(r["Not Ready Time"]), brk: secs(b["Break Time"]),
        lunch: secs(b["Lunch Time"]), meeting: secs(b["Meeting Time"]), ...n,
        inTalk: secs(r["Inbound Talk Time"]), outTalk: secs(r["Outbound Talk Time"]),
        uniq: uniq[raw] ? uniq[raw].size : 0, remarks: login === 0 ? "Not logged in - calls routed & missed" : "" });
    });

    const qinfo = {};
    if (files.queue) objects(parseCSV(files.queue.text)).forEach(q => { const k = last10(q["Member CID Number"]); (qinfo[k] = qinfo[k] || []).push(q); });
    const answered = cdr.filter(c => c.CallDisposition === "ANSWERED");
    const missed = [];
    if (files.missed) objects(parseCSV(files.missed.text)).forEach(r => {
      const hid = r["Member Name"]; const num = last10(r["Customer Phone"]); const t = r["Call Date"];
      let agent, team, type, offered = "";
      if (hid) { [agent, team] = nameTeam(RENAME[hid] || hid); type = "Missed by agent"; }
      else {
        agent = "No agent (queue)"; team = "Queue"; type = "Unanswered in queue";
        const qs = qinfo[num];
        if (qs && qs.length) {
          const ids = String(qs[0]["Offered Agents"] || "").split(",").filter(Boolean);
          offered = ids.map(i => EXT[i] ? nameTeam(EXT[i])[0] : i).join(", ");
          if (!offered) {
            const g = String(qs[0]["Queue Group Name"] || ""); const part = g.includes("-") ? g.split("-").slice(1).join("-") : g;
            offered = "Line group: " + part.split(",").map(x => AGENTS["Hue" + x] ? AGENTS["Hue" + x][0] : "Hue" + x).join(", ");
          }
        }
      }
      const reached = answered.some(c => c.num === num && c.CallStartTime > t);
      missed.push({ date, time: t.slice(11, 19), agent, team, phone: num, type, offered, reached });
    });
    const cnt = {}; missed.forEach(m => cnt[m.phone] = (cnt[m.phone] || 0) + 1);
    missed.forEach(m => m.attempts = cnt[m.phone]);
    return { date, agents, missed };
  }
  return { TYPES, detect, build };
})();
if (typeof module !== "undefined") module.exports = INGEST;
