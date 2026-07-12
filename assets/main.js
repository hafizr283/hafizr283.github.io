/* hafizr283.github.io — live dev telemetry
   Data flow:
     1. paint immediately from data/stats.json (refreshed every 6 h by GitHub Actions)
     2. re-fetch Codeforces / GitHub / contributions live in the browser (CORS-friendly APIs)
     3. LeetCode live via a public CORS mirror, falling back to the cached snapshot */
"use strict";

const CONFIG = { github: "hafizr283", codeforces: "hafizr283", leetcode: "hafizr283",
  atcoder: "hafizr283", uva: "hafizr283", codechef: "hafizr283", vjudge: "hafizr283" };

const PAL = {
  accent: "#3987e5", good: "#0ca30c", warn: "#fab219", crit: "#d03b3b", down: "#e66767",
  ink: "#ffffff", ink2: "#c3c2b7", muted: "#898781",
  grid: "#2c2c2a", baseline: "#383835", surface: "#1a1a19",
  cat: ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"],
  heat: ["#232321", "#104281", "#1c5cab", "#2a78d6", "#5598e7"],
};

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = { cf: null, lc: null, gh: null, contrib: null, judges: null, seedAt: null };
const langColor = {};   // language name -> color, shared by bars + repo dots

/* ── utils ─────────────────────────────────────────────────── */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n).toLocaleString("en-US");
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString("en-US",
  { month: "short", day: "numeric", year: "numeric" });

function fetchJSON(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(url, { signal: ctl.signal })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .finally(() => clearTimeout(timer));
}

function svg(tag, attrs = {}, parent = null) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

function relAge(iso) {
  if (!iso) return "";
  const mins = Math.max(0, (Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/* ── tooltip ───────────────────────────────────────────────── */

const tip = $("#tooltip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let tx = x + 14, ty = y + 14;
  if (tx + w > innerWidth - 8) tx = x - w - 12;
  if (ty + h > innerHeight - 8) ty = y - h - 12;
  tip.style.left = tx + "px";
  tip.style.top = ty + "px";
}
function hideTip() { tip.hidden = true; }

/* ── terminal header ───────────────────────────────────────── */

const SOURCES = [
  ["codeforces", "codeforces"],
  ["github", "github"],
  ["contribs", "contributions"],
  ["leetcode", "leetcode"],
  ["judges", "other judges"],
];

function initStatus() {
  const ul = $("#statusLines");
  ul.innerHTML = SOURCES.map(([key, label]) =>
    `<li><span class="src">&gt; ${label}</span><span class="leader"></span>` +
    `<span class="state" id="st-${key}">fetching…</span></li>`).join("");
}
function setStatus(key, cls, text) {
  const el = $("#st-" + key);
  if (!el) return;
  el.className = "state " + cls;
  el.textContent = text;
}

function typeCommand() {
  const cmdText = `./stats --live --user ${CONFIG.github}`;
  const el = $("#cmd");
  if (reduceMotion) { el.textContent = cmdText; return; }
  let i = 0;
  (function tick() {
    el.textContent = cmdText.slice(0, ++i);
    if (i < cmdText.length) setTimeout(tick, 26);
  })();
}

/* ── stat tiles ────────────────────────────────────────────── */

const TILES = [
  ["cfRating", "CF rating"],
  ["cfSolved", "CF solved"],
  ["cfContests", "CF contests"],
  ["lcSolved", "LeetCode solved"],
  ["ghRepos", "Repositories"],
  ["contribYear", "Contributions"],
];
const tileEls = {};

function ensureTiles() {
  const host = $("#tiles");
  if (host.childElementCount) return;
  for (const [id, label] of TILES) {
    const div = document.createElement("div");
    div.className = "tile";
    div.innerHTML = `<div class="t-label">${label}</div>` +
      `<div class="t-value" data-v="0">—</div><div class="t-sub"></div>`;
    host.appendChild(div);
    tileEls[id] = { value: div.querySelector(".t-value"), sub: div.querySelector(".t-sub") };
  }
}

function setTile(id, value, subHTML) {
  const t = tileEls[id];
  if (!t || value == null) return;
  const from = Number(t.value.dataset.v || 0), to = Number(value);
  t.value.dataset.v = to;
  if (reduceMotion || from === to) t.value.textContent = fmt(to);
  else {
    const t0 = performance.now(), dur = 550;
    (function step(now) {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      t.value.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  t.sub.innerHTML = subHTML || "";
}

function renderTiles() {
  ensureTiles();
  const { cf, lc, gh, contrib } = state;
  if (cf) {
    setTile("cfRating", cf.rating, `max ${fmt(cf.maxRating)} · ${esc(cf.rank || "")}`);
    if (cf.solved) setTile("cfSolved", cf.solved, `${fmt(cf.submissions)} submissions`);
    let deltaHtml = "rated rounds";
    const h = cf.history;
    if (h && h.length > 1) {
      const d = h[h.length - 1][1] - h[h.length - 2][1];
      deltaHtml = `last round <span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${d}</span>`;
    }
    setTile("cfContests", cf.contests, deltaHtml);
  }
  if (lc) setTile("lcSolved", lc.all, `${lc.easy}E · ${lc.medium}M · ${lc.hard}H`);
  if (gh) setTile("ghRepos", gh.repos, `${fmt(gh.followers)} followers · ${fmt(gh.stars)} ★`);
  if (contrib) setTile("contribYear", contrib.total, "last 12 months");
}

/* ── codeforces rating chart ───────────────────────────────── */

function renderCF() {
  const cf = state.cf;
  if (!cf || !cf.history || cf.history.length < 2) return;
  const hist = cf.history;
  $("#cfSub").textContent =
    `now ${fmt(cf.rating)} · peak ${fmt(cf.maxRating)} · ${fmt(cf.contests)} rated rounds`;

  const W = 720, H = 260, m = { l: 46, r: 18, t: 16, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  const ts = hist.map((d) => d[0]), rs = hist.map((d) => d[1]);
  const tMin = Math.min(...ts), tMax = Math.max(...ts), tPad = (tMax - tMin) * 0.02 || 1;
  const rMinD = Math.max(0, Math.floor((Math.min(...rs) - 40) / 100) * 100);
  const rMaxD = Math.ceil((Math.max(...rs) + 40) / 100) * 100;
  const x = (t) => m.l + ((t - (tMin - tPad)) / ((tMax + tPad) - (tMin - tPad))) * pw;
  const y = (r) => m.t + (1 - (r - rMinD) / (rMaxD - rMinD)) * ph;

  const box = $("#cfChart");
  box.innerHTML = "";
  const el = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Codeforces rating over time" }, box);

  // horizontal gridlines + y ticks (clean hundreds)
  const step = (rMaxD - rMinD) > 900 ? 200 : 100;
  for (let r = Math.ceil(rMinD / step) * step; r <= rMaxD; r += step) {
    svg("line", { x1: m.l, x2: W - m.r, y1: y(r), y2: y(r),
      stroke: r === 1200 ? PAL.baseline : PAL.grid, "stroke-width": 1 }, el);
    const t = svg("text", { x: m.l - 8, y: y(r) + 3.5, "text-anchor": "end",
      "font-size": 10.5, fill: PAL.muted }, el);
    t.textContent = fmt(r);
  }
  if (rMaxD >= 1200 && rMinD < 1200) {   // next CF rank threshold
    const t = svg("text", { x: W - m.r, y: y(1200) - 5, "text-anchor": "end",
      "font-size": 10, fill: PAL.muted }, el);
    t.textContent = "pupil · 1200";
  }

  // x ticks: January 1 of each year in domain
  const y0 = new Date(tMin * 1000).getFullYear(), y1 = new Date(tMax * 1000).getFullYear();
  for (let yr = y0 + 1; yr <= y1; yr++) {
    const t = Date.UTC(yr, 0, 1) / 1000;
    if (t < tMin || t > tMax) continue;
    const t2 = svg("text", { x: x(t), y: H - 8, "text-anchor": "middle",
      "font-size": 10.5, fill: PAL.muted }, el);
    t2.textContent = yr;
  }

  // baseline
  svg("line", { x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph,
    stroke: PAL.baseline, "stroke-width": 1 }, el);

  // area wash + 2px line
  const pts = hist.map((d) => `${x(d[0]).toFixed(1)},${y(d[1]).toFixed(1)}`);
  svg("path", { d: `M${x(ts[0]).toFixed(1)},${m.t + ph} L${pts.join(" L")} L${x(ts[ts.length - 1]).toFixed(1)},${m.t + ph} Z`,
    fill: PAL.accent, opacity: 0.1 }, el);
  svg("path", { d: `M${pts.join(" L")}`, fill: "none", stroke: PAL.accent,
    "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, el);

  // peak label (direct label on the extreme)
  const iMax = rs.indexOf(Math.max(...rs));
  svg("circle", { cx: x(ts[iMax]), cy: y(rs[iMax]), r: 4,
    fill: PAL.accent, stroke: PAL.surface, "stroke-width": 2 }, el);
  const above = y(rs[iMax]) > m.t + 20;
  const lx = Math.min(Math.max(x(ts[iMax]), m.l + 34), W - m.r - 40);
  const peak = svg("text", { x: lx, y: y(rs[iMax]) + (above ? -10 : 18),
    "text-anchor": "middle", "font-size": 11, fill: PAL.ink2 }, el);
  peak.textContent = `max ${fmt(rs[iMax])}`;

  // current end-dot with surface ring
  svg("circle", { cx: x(ts[ts.length - 1]), cy: y(rs[rs.length - 1]), r: 4.5,
    fill: PAL.accent, stroke: PAL.surface, "stroke-width": 2 }, el);

  // crosshair + hover layer
  const vline = svg("line", { y1: m.t, y2: m.t + ph, stroke: PAL.baseline,
    "stroke-width": 1, visibility: "hidden" }, el);
  const focus = svg("circle", { r: 4.5, fill: PAL.accent, stroke: PAL.surface,
    "stroke-width": 2, visibility: "hidden" }, el);
  const overlay = svg("rect", { x: m.l, y: m.t, width: pw, height: ph,
    fill: "transparent", style: "cursor:crosshair" }, el);

  overlay.addEventListener("pointermove", (e) => {
    const rect = el.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    let best = 0, bd = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const d = Math.abs(x(ts[i]) - sx);
      if (d < bd) { bd = d; best = i; }
    }
    const [t, r, name, rank] = hist[best];
    vline.setAttribute("x1", x(t)); vline.setAttribute("x2", x(t));
    vline.setAttribute("visibility", "visible");
    focus.setAttribute("cx", x(t)); focus.setAttribute("cy", y(r));
    focus.setAttribute("visibility", "visible");
    const d = best > 0 ? r - hist[best - 1][1] : r;
    showTip(
      `<div class="tt-title">${esc(name)}</div>` +
      `${fmtDate(t)} · rank ${fmt(rank)}<br>` +
      `rating ${fmt(r)} · <span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${d}</span>`,
      e.clientX, e.clientY);
  });
  overlay.addEventListener("pointerleave", () => {
    vline.setAttribute("visibility", "hidden");
    focus.setAttribute("visibility", "hidden");
    hideTip();
  });

  // table view (newest first)
  $("#cfTable").innerHTML =
    "<tr><th>date</th><th>contest</th><th>rank</th><th>rating</th><th>Δ</th></tr>" +
    hist.slice().reverse().map((d, i, arr) => {
      const prev = i < arr.length - 1 ? arr[i + 1][1] : 0;
      const dd = d[1] - prev;
      return `<tr><td>${fmtDate(d[0])}</td><td>${esc(d[2])}</td>` +
        `<td>${fmt(d[3])}</td><td>${fmt(d[1])}</td><td>${dd >= 0 ? "+" : ""}${dd}</td></tr>`;
    }).join("");
}

/* ── generic horizontal bars ───────────────────────────────── */

function barRows(host, rows, maxV) {
  host.innerHTML = "";
  for (const r of rows) {
    const div = document.createElement("div");
    div.className = "bar-row";
    div.innerHTML =
      `<span class="b-label" title="${esc(r.label)}">${esc(r.label)}</span>` +
      `<span class="b-track"><span class="b-fill" style="width:0%;background:${r.color}"></span>` +
      `<span class="b-val">${esc(r.val)}</span></span>`;
    host.appendChild(div);
    const w = Math.max(1.5, (r.value / maxV) * 100) + "%";
    const fill = div.querySelector(".b-fill");
    if (reduceMotion) fill.style.width = w;
    else requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = w; }));
  }
}

/* ── leetcode card ─────────────────────────────────────────── */

function renderLC() {
  const lc = state.lc;
  if (!lc) return;
  $("#lcSub").textContent = `${fmt(lc.all)} problems`;
  const maxV = Math.max(lc.easy, lc.medium, lc.hard, 1);
  barRows($("#lcBars"), [
    { label: "Easy",   value: lc.easy,   val: fmt(lc.easy),   color: PAL.good },
    { label: "Medium", value: lc.medium, val: fmt(lc.medium), color: PAL.warn },
    { label: "Hard",   value: lc.hard,   val: fmt(lc.hard),   color: PAL.crit },
  ], maxV);
  $("#lcFoot").textContent = lc.ranking ? `global ranking #${fmt(lc.ranking)}` : "";
  $("#lcTable").innerHTML =
    "<tr><th>difficulty</th><th>solved</th></tr>" +
    [["Easy", lc.easy], ["Medium", lc.medium], ["Hard", lc.hard], ["Total", lc.all]]
      .map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`).join("");
}

/* ── languages card ────────────────────────────────────────── */

function renderLangs() {
  const gh = state.gh;
  if (!gh || !gh.languages || !gh.languages.length) return;
  const langs = gh.languages;
  const top = langs.slice(0, 6);
  const restCount = langs.slice(6).reduce((a, l) => a + l.count, 0);

  top.forEach((l, i) => { langColor[l.name] = PAL.cat[i]; });
  const rows = top.map((l, i) => ({
    label: l.name, value: l.count,
    val: `${l.count} repo${l.count > 1 ? "s" : ""}`, color: PAL.cat[i],
  }));
  if (restCount) rows.push({ label: "Other", value: restCount,
    val: `${restCount} repos`, color: PAL.baseline });

  const total = langs.reduce((a, l) => a + l.count, 0);
  $("#langSub").textContent = `across ${fmt(total)} source repos`;
  barRows($("#langBars"), rows, Math.max(...rows.map((r) => r.value)));
  $("#langTable").innerHTML =
    "<tr><th>language</th><th>repos</th></tr>" +
    langs.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.count}</td></tr>`).join("");
}

/* ── contribution heatmap ──────────────────────────────────── */

function renderHeatmap() {
  const c = state.contrib;
  if (!c || !c.days || !c.days.length) return;
  $("#contribSub").textContent = `${fmt(c.total)} in the last year`;

  const days = c.days;                             // [dateStr, count, level]
  const cell = 11, gap = 3, unit = cell + gap;
  const firstDow = new Date(days[0][0] + "T00:00:00").getDay();
  const weeks = Math.ceil((days.length + firstDow) / 7);
  const left = 30, top = 16;
  const W = left + weeks * unit + 2, H = top + 7 * unit + 2;

  const box = $("#heatmap");
  box.innerHTML = "";
  const el = svg("svg", { width: W, height: H, role: "img",
    "aria-label": "GitHub contribution heatmap, last 12 months" }, box);

  // weekday labels
  [["Mon", 1], ["Wed", 3], ["Fri", 5]].forEach(([lbl, row]) => {
    const t = svg("text", { x: left - 6, y: top + row * unit + cell - 2.5,
      "text-anchor": "end", "font-size": 9.5, fill: PAL.muted }, el);
    t.textContent = lbl;
  });

  // cells + month labels
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  let lastMonth = -1, lastLabelWeek = -5;
  for (let i = 0; i < days.length; i++) {
    const [date, count, level] = days[i];
    const idx = i + firstDow, wk = Math.floor(idx / 7), dow = idx % 7;
    svg("rect", {
      x: left + wk * unit, y: top + dow * unit, width: cell, height: cell,
      rx: 2.5, fill: PAL.heat[Math.min(level, 4)], "data-i": i,
    }, el);
    const mo = Number(date.slice(5, 7)) - 1;
    if (dow === 0 && mo !== lastMonth) {
      if (wk - lastLabelWeek >= 3 && wk < weeks - 1) {
        const t = svg("text", { x: left + wk * unit, y: 9, "font-size": 9.5,
          fill: PAL.muted }, el);
        t.textContent = MONTHS[mo];
        lastLabelWeek = wk;
      }
      lastMonth = mo;
    }
  }

  el.addEventListener("pointermove", (e) => {
    const i = e.target && e.target.getAttribute && e.target.getAttribute("data-i");
    if (i === null || i === undefined) { hideTip(); return; }
    const [date, count] = days[Number(i)];
    const nice = new Date(date + "T00:00:00").toLocaleDateString("en-US",
      { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    showTip(`<span class="tt-title">${count} contribution${count === 1 ? "" : "s"}</span><br>${nice}`,
      e.clientX, e.clientY);
  });
  el.addEventListener("pointerleave", hideTip);

  // legend
  const legend = document.createElement("div");
  legend.className = "heat-legend";
  legend.innerHTML = "less " +
    PAL.heat.map((h) => `<i style="background:${h}"></i>`).join("") + " more";
  box.appendChild(legend);

  // monthly table view
  const byMonth = {};
  for (const [date, count] of days) {
    const k = date.slice(0, 7);
    byMonth[k] = (byMonth[k] || 0) + count;
  }
  $("#contribTable").innerHTML =
    "<tr><th>month</th><th>contributions</th></tr>" +
    Object.entries(byMonth).map(([k, v]) => {
      const [yy, mm] = k.split("-");
      return `<tr><td>${MONTHS[Number(mm) - 1]} ${yy}</td><td>${v}</td></tr>`;
    }).join("");
}

/* ── repositories ──────────────────────────────────────────── */

function renderRepos() {
  const gh = state.gh;
  if (!gh || !gh.topRepos || !gh.topRepos.length) return;
  $("#repoSub").textContent = "by recent activity";
  $("#repoGrid").innerHTML = gh.topRepos.map((r) => {
    const dot = langColor[r.language] || PAL.baseline;
    return `<a class="repo" href="${esc(r.url)}" target="_blank" rel="noopener">` +
      `<span class="r-name">${esc(r.name)}</span>` +
      `<span class="r-desc">${esc(r.description || "")}</span>` +
      `<span class="r-meta">` +
      (r.language ? `<span><i class="r-dot" style="background:${dot}"></i>${esc(r.language)}</span>` : "") +
      `<span>★ ${fmt(r.stars || 0)}</span><span>⑂ ${fmt(r.forks || 0)}</span>` +
      `</span></a>`;
  }).join("");
}

/* ── other judges ──────────────────────────────────────────── */

function ccStars(rating) {
  if (!rating) return "";
  const bands = [1400, 1600, 1800, 2000, 2200, 2500];
  return (bands.filter((b) => rating >= b).length + 1) + "★";
}

function renderJudges() {
  const j = state.judges;
  if (!j) return;
  const tiles = [];
  if (j.atcoder) tiles.push({
    url: `https://atcoder.jp/users/${CONFIG.atcoder}`, name: "AtCoder",
    value: j.atcoder.solved, sub: j.atcoder.rated
      ? `solved · rating ${fmt(j.atcoder.rating)} (${j.atcoder.rated} rated)`
      : "solved",
  });
  if (j.codechef) tiles.push({
    url: `https://www.codechef.com/users/${CONFIG.codechef}`, name: "CodeChef",
    value: j.codechef.rating,
    sub: `rating · ${ccStars(j.codechef.rating)}` +
      (j.codechef.solved ? ` · ${fmt(j.codechef.solved)} solved` : ""),
  });
  if (j.uva) tiles.push({
    url: `https://uhunt.onlinejudge.org/id/${j.uva.uid || ""}`, name: "UVa",
    value: j.uva.solved, sub: `solved · ${fmt(j.uva.subs)} submissions`,
  });
  if (j.vjudge) tiles.push({
    url: `https://vjudge.net/user/${CONFIG.vjudge}`, name: "VJudge",
    value: j.vjudge.total, sub: `solved · ${j.vjudge.perJudge.length} judges`,
  });
  if (!tiles.length) return;

  $("#judgeSub").textContent = "AtCoder & UVa live · CodeChef & VJudge from snapshot";
  $("#judgeGrid").innerHTML = tiles.map((t) =>
    `<a class="judge" href="${esc(t.url)}" target="_blank" rel="noopener">` +
    `<span class="j-name">${t.name}</span>` +
    `<span class="j-value">${fmt(t.value)}</span>` +
    `<span class="j-sub">${esc(t.sub)}</span></a>`).join("");

  $("#judgeChips").innerHTML = (j.vjudge && j.vjudge.perJudge.length)
    ? `<span class="chip-label">vjudge by judge ↳</span>` +
      j.vjudge.perJudge.map(([name, n]) =>
        `<span class="chip">${esc(name)} <b>${fmt(n)}</b></span>`).join("")
    : "";
}

function renderAll() {
  renderTiles(); renderCF(); renderLC(); renderLangs(); renderHeatmap();
  renderRepos(); renderJudges();
}

/* ── live fetchers ─────────────────────────────────────────── */

function fallbackStatus(key) {
  setStatus(key, state.seedAt ? "cached" : "error",
    state.seedAt ? `cached · ${relAge(state.seedAt)}` : "unavailable");
}

async function cfLive() {
  try {
    const [info, rating] = await Promise.all([
      fetchJSON(`https://codeforces.com/api/user.info?handles=${CONFIG.codeforces}`),
      fetchJSON(`https://codeforces.com/api/user.rating?handle=${CONFIG.codeforces}`),
    ]);
    if (info.status !== "OK" || rating.status !== "OK") throw new Error("cf");
    const u = info.result[0];
    state.cf = Object.assign({}, state.cf, {
      rating: u.rating, maxRating: u.maxRating, rank: u.rank,
      contests: rating.result.length,
      history: rating.result.map((c) =>
        [c.ratingUpdateTimeSeconds, c.newRating, c.contestName, c.rank]),
    });
    renderTiles(); renderCF();
    setStatus("codeforces", "live", "ok · live");
  } catch (e) { fallbackStatus("codeforces"); }
}

async function ghLive() {
  try {
    const [user, repos] = await Promise.all([
      fetchJSON(`https://api.github.com/users/${CONFIG.github}`),
      fetchJSON(`https://api.github.com/users/${CONFIG.github}/repos?per_page=100&sort=pushed`),
    ]);
    const src = repos.filter((r) => !r.fork);
    const counts = {};
    for (const r of src) if (r.language) counts[r.language] = (counts[r.language] || 0) + 1;
    state.gh = {
      repos: user.public_repos, followers: user.followers, following: user.following,
      stars: repos.reduce((a, r) => a + r.stargazers_count, 0),
      languages: Object.entries(counts).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      topRepos: src.filter((r) => r.description)
        .sort((a, b) => b.stargazers_count - a.stargazers_count ||
          new Date(b.pushed_at) - new Date(a.pushed_at))
        .slice(0, 8)
        .map((r) => ({ name: r.name, description: r.description, language: r.language,
          stars: r.stargazers_count, forks: r.forks_count, url: r.html_url })),
    };
    renderTiles(); renderLangs(); renderRepos();
    setStatus("github", "live", "ok · live");
  } catch (e) { fallbackStatus("github"); }
}

async function contribLive() {
  try {
    const c = await fetchJSON(
      `https://github-contributions-api.jogruber.de/v4/${CONFIG.github}?y=last`);
    state.contrib = {
      total: c.total.lastYear,
      days: c.contributions.map((d) => [d.date, d.count, d.level]),
    };
    renderTiles(); renderHeatmap();
    setStatus("contribs", "live", "ok · live");
  } catch (e) { fallbackStatus("contribs"); }
}

async function lcLive() {
  try {
    const r = await fetchJSON(
      `https://leetcode-api-faisalshohag.vercel.app/${CONFIG.leetcode}`);
    if (typeof r.totalSolved !== "number") throw new Error("lc");
    state.lc = {
      all: r.totalSolved,
      easy: r.easySolved ?? (state.lc ? state.lc.easy : 0),
      medium: r.mediumSolved ?? (state.lc ? state.lc.medium : 0),
      hard: r.hardSolved ?? (state.lc ? state.lc.hard : 0),
      ranking: r.ranking ?? (state.lc ? state.lc.ranking : null),
    };
    renderTiles(); renderLC();
    setStatus("leetcode", "live", "ok · live");
  } catch (e) { fallbackStatus("leetcode"); }
}

async function judgesLive() {
  // Only AtCoder (kenkoooo) and UVa (uHunt) allow browser CORS;
  // CodeChef and VJudge stay on the 6 h snapshot.
  const [ac, uva] = await Promise.allSettled([
    fetchJSON(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user=${CONFIG.atcoder}`),
    (async () => {
      const uid = await fetchJSON(
        `https://uhunt.onlinejudge.org/api/uname2uid/${CONFIG.uva}`);
      if (!uid) throw new Error("uva uid");
      const s = await fetchJSON(`https://uhunt.onlinejudge.org/api/subs-user/${uid}`);
      const solved = new Set(s.subs.filter((x) => x[2] === 90).map((x) => x[1])).size;
      return { uid, solved, subs: s.subs.length };
    })(),
  ]);
  const j = state.judges || (state.judges = {});
  let ok = 0;
  if (ac.status === "fulfilled" && typeof ac.value.count === "number") {
    j.atcoder = Object.assign({}, j.atcoder, { solved: ac.value.count, rank: ac.value.rank });
    ok++;
  }
  if (uva.status === "fulfilled") {
    j.uva = Object.assign({}, j.uva, uva.value);
    ok++;
  }
  if (ok) {
    renderJudges();
    setStatus("judges", "live", ok === 2 ? "ok · live" : "ok · partial");
  } else fallbackStatus("judges");
}

/* ── boot ──────────────────────────────────────────────────── */

(async function boot() {
  initStatus();
  typeCommand();

  let seed = window.__SEED__ || null;
  if (!seed) seed = await fetchJSON("data/stats.json").catch(() => null);
  if (seed) {
    state.seedAt = seed.fetchedAt;
    state.cf = seed.codeforces || null;
    state.lc = seed.leetcode ? {
      all: seed.leetcode.all, easy: seed.leetcode.easy, medium: seed.leetcode.medium,
      hard: seed.leetcode.hard, ranking: seed.leetcode.ranking,
    } : null;
    state.gh = seed.github || null;
    state.contrib = seed.contributions || null;
    state.judges = seed.judges || null;
    renderAll();
    for (const [key] of SOURCES) fallbackStatus(key);
  }

  $("#updatedAt").textContent = "rendered " +
    new Date().toLocaleString("en-US", { month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit" }) +
    (seed ? ` · snapshot ${relAge(seed.fetchedAt)}` : "");

  cfLive(); ghLive(); contribLive(); lcLive(); judgesLive();
})();
