/* Refreshes data/stats.json — run by .github/workflows/update-stats.yml every 6 h.
   Each section is fetched independently; on failure the previous snapshot's
   section is kept, so a flaky upstream never blanks the site. */
import { readFileSync, writeFileSync } from "node:fs";

const HANDLES = { github: "hafizr283", codeforces: "hafizr283", leetcode: "hafizr283",
  atcoder: "hafizr283", uva: "hafizr283", codechef: "hafizr283", vjudge: "hafizr283" };
const OUT = new URL("../data/stats.json", import.meta.url);

const UA = { "User-Agent": "hafizr283.github.io stats updater" };
const ghHeaders = process.env.GITHUB_TOKEN
  ? { ...UA, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : UA;

async function getJSON(url, opts = {}) {
  const r = await fetch(url, { headers: UA, ...opts });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

let previous = {};
try { previous = JSON.parse(readFileSync(OUT, "utf8").replace(/^\uFEFF/, "")); } catch {}

async function codeforces() {
  const h = HANDLES.codeforces;
  const [info, rating, status] = await Promise.all([
    getJSON(`https://codeforces.com/api/user.info?handles=${h}`),
    getJSON(`https://codeforces.com/api/user.rating?handle=${h}`),
    getJSON(`https://codeforces.com/api/user.status?handle=${h}`),
  ]);
  if (info.status !== "OK" || rating.status !== "OK" || status.status !== "OK")
    throw new Error("codeforces API returned FAILED");
  const u = info.result[0];
  const ok = status.result.filter((s) => s.verdict === "OK");
  const solved = new Set(ok.map((s) => `${s.problem.contestId}-${s.problem.index}`)).size;
  return {
    handle: h, rating: u.rating, maxRating: u.maxRating, rank: u.rank,
    maxRank: u.maxRank, friendOfCount: u.friendOfCount, organization: u.organization ?? "",
    solved, submissions: status.result.length, contests: rating.result.length,
    history: rating.result.map((c) =>
      [c.ratingUpdateTimeSeconds, c.newRating, c.contestName, c.rank]),
  };
}

async function leetcode() {
  const u = HANDLES.leetcode;
  try {
    const body = JSON.stringify({
      query: `query($u:String!){
        matchedUser(username:$u){
          profile{ranking}
          submitStatsGlobal{acSubmissionNum{difficulty count}}
        }}`,
      variables: { u },
    });
    const r = await getJSON("https://leetcode.com/graphql", {
      method: "POST", body,
      headers: { ...UA, "Content-Type": "application/json", Referer: "https://leetcode.com" },
    });
    const m = r.data.matchedUser;
    const n = (d) => m.submitStatsGlobal.acSubmissionNum
      .find((x) => x.difficulty === d)?.count ?? 0;
    return { username: u, all: n("All"), easy: n("Easy"), medium: n("Medium"),
      hard: n("Hard"), ranking: m.profile.ranking };
  } catch (e) {
    // Cloudflare sometimes blocks CI runners — fall back to a public mirror
    const r = await getJSON(`https://leetcode-api-faisalshohag.vercel.app/${u}`);
    return { username: u, all: r.totalSolved, easy: r.easySolved,
      medium: r.mediumSolved, hard: r.hardSolved, ranking: r.ranking };
  }
}

async function github() {
  const g = HANDLES.github;
  const [user, repos] = await Promise.all([
    getJSON(`https://api.github.com/users/${g}`, { headers: ghHeaders }),
    getJSON(`https://api.github.com/users/${g}/repos?per_page=100&sort=pushed`,
      { headers: ghHeaders }),
  ]);
  const src = repos.filter((r) => !r.fork);
  const counts = {};
  for (const r of src) if (r.language) counts[r.language] = (counts[r.language] || 0) + 1;
  return {
    login: g, repos: user.public_repos, followers: user.followers,
    following: user.following, createdAt: user.created_at,
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
}

async function contributions() {
  const c = await getJSON(
    `https://github-contributions-api.jogruber.de/v4/${HANDLES.github}?y=last`);
  return {
    total: c.total.lastYear,
    days: c.contributions.map((d) => [d.date, d.count, d.level]),
  };
}

async function judges() {
  // one sub-try per judge so a single flaky site never blanks the rest
  const prev = previous.judges || {};
  const out = {};

  try {                                                       // AtCoder
    const [hist, ac] = await Promise.all([
      getJSON(`https://atcoder.jp/users/${HANDLES.atcoder}/history/json`),
      getJSON(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user=${HANDLES.atcoder}`),
    ]);
    const rated = hist.filter((h) => h.IsRated);
    out.atcoder = {
      solved: ac.count, rank: ac.rank, contests: hist.length, rated: rated.length,
      rating: rated.length ? rated[rated.length - 1].NewRating : null,
      maxRating: rated.length ? Math.max(...rated.map((h) => h.NewRating)) : null,
    };
  } catch (e) { console.warn(`keep atcoder: ${e.message}`); out.atcoder = prev.atcoder ?? null; }

  try {                                                       // CodeChef (profile scrape)
    const r = await fetch(`https://www.codechef.com/users/${HANDLES.codechef}`,
      { headers: { ...UA, Accept: "text/html" } });
    if (!r.ok) throw new Error(`codechef ${r.status}`);
    const html = await r.text();
    const rating = Number((html.match(/class="rating-number">\s*(\d+)/) || [])[1]) || null;
    const solved = Number((html.match(/Total Problems Solved:\s*(\d+)/) || [])[1]) || null;
    if (!rating && !solved) throw new Error("codechef markers not found");
    out.codechef = { rating, solved };
  } catch (e) { console.warn(`keep codechef: ${e.message}`); out.codechef = prev.codechef ?? null; }

  try {                                                       // UVa via uHunt
    const uid = await getJSON(`https://uhunt.onlinejudge.org/api/uname2uid/${HANDLES.uva}`);
    if (!uid) throw new Error("uva user not found");
    const s = await getJSON(`https://uhunt.onlinejudge.org/api/subs-user/${uid}`);
    const solved = new Set(s.subs.filter((x) => x[2] === 90).map((x) => x[1])).size;
    out.uva = { uid, solved, subs: s.subs.length };
  } catch (e) { console.warn(`keep uva: ${e.message}`); out.uva = prev.uva ?? null; }

  try {                                                       // VJudge
    const v = await getJSON(`https://vjudge.net/user/solveDetail/${HANDLES.vjudge}`);
    const perJudge = Object.entries(v.acRecords)
      .map(([name, arr]) => [name, arr.length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.vjudge = { total: perJudge.reduce((a, [, n]) => a + n, 0), perJudge };
  } catch (e) { console.warn(`keep vjudge: ${e.message}`); out.vjudge = prev.vjudge ?? null; }

  return out;
}

const sections = { codeforces, leetcode, github, contributions, judges };
const out = { fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
let failures = 0;

for (const [key, fn] of Object.entries(sections)) {
  try {
    out[key] = await fn();
    console.log(`ok   ${key}`);
  } catch (e) {
    failures++;
    out[key] = previous[key] ?? null;
    console.warn(`keep ${key} (previous snapshot): ${e.message}`);
  }
}

if (failures === Object.keys(sections).length)
  throw new Error("every source failed — refusing to overwrite snapshot");

writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote data/stats.json (${failures} section(s) kept from previous run)`);
