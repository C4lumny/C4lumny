// Builds an activity card (contributions + streaks) from the public
// contribution calendar, which includes private contributions when the
// profile setting is on. Runs in CI with the default GITHUB_TOKEN.
import { mkdirSync, writeFileSync } from "node:fs";

const user = process.env.GITHUB_USER;
const token = process.env.GITHUB_TOKEN;
const outDir = process.argv[2] ?? "dist";

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const { user: u } = await gql(
  `query($login: String!) { user(login: $login) { createdAt contributionsCollection { contributionYears contributionCalendar { totalContributions } } } }`,
  { login: user },
);

const days = [];
for (const year of u.contributionsCollection.contributionYears) {
  const data = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) { contributionsCollection(from: $from, to: $to) {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      } }
    }`,
    { login: user, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
  );
  for (const w of data.user.contributionsCollection.contributionCalendar.weeks) days.push(...w.contributionDays);
}

const today = new Date().toISOString().slice(0, 10);
const series = [...new Map(days.map((d) => [d.date, d.contributionCount])).entries()]
  .filter(([date]) => date <= today)
  .sort(([a], [b]) => a.localeCompare(b));

// Same window and total as the calendar on the profile page.
const lastYear = u.contributionsCollection.contributionCalendar.totalContributions;
const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const total = series.reduce((s, [, c]) => s + c, 0);
const activeDays = series.filter(([d, c]) => d > yearAgo && c > 0).length;

let longest = { len: 0 }, run = { len: 0 };
for (const [date, count] of series) {
  if (count > 0) {
    run = run.len ? { ...run, len: run.len + 1, end: date } : { len: 1, start: date, end: date };
    if (run.len > longest.len) longest = run;
  } else run = { len: 0 };
}
// A streak is still alive if today has no contributions yet.
let current = { len: 0 };
for (let i = series.length - 1; i >= 0; i--) {
  const [date, count] = series[i];
  if (count > 0) current = { len: current.len + 1, start: date, end: current.end ?? date };
  else if (date === today && i === series.length - 1) continue;
  else break;
}

const fmt = (n) => n.toLocaleString("en-US");
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const range = (s) => (s.len ? `${fmtDate(s.start)} – ${fmtDate(s.end)}` : "—");

const stats = [
  { value: fmt(lastYear), label: "contributions, last 12 months", note: `${activeDays} active days` },
  { value: fmt(total), label: "contributions in total", note: `since ${fmtDate(series.find(([, c]) => c > 0)?.[0] ?? u.createdAt.slice(0, 10))}` },
  { value: `${current.len} ${current.len === 1 ? "day" : "days"}`, label: "current streak", note: range(current) },
  { value: `${longest.len} days`, label: "longest streak", note: range(longest) },
];

const themes = {
  light: { bg: "#ffffff", border: "#d0d7de", value: "#1f2328", label: "#2f5a9e", note: "#656d76" },
  dark: { bg: "#0d1117", border: "#30363d", value: "#e6edf3", label: "#86a8de", note: "#8b949e" },
};

const W = 880, colW = W / stats.length, H = 120;
const svg = (t) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${stats.map((s) => `${s.value} ${s.label}`).join(", ")}">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>
  <g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">
${stats.map((s, i) => `    <g transform="translate(${i * colW + 24}, 0)">
      ${i ? `<line x1="-24" y1="24" x2="-24" y2="${H - 24}" stroke="${t.border}"/>` : ""}
      <text y="50" font-size="26" font-weight="600" fill="${t.value}">${s.value}</text>
      <text y="74" font-size="13" fill="${t.label}">${s.label}</text>
      <text y="94" font-size="11" fill="${t.note}">${s.note}</text>
    </g>`).join("\n")}
  </g>
</svg>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/activity.svg`, svg(themes.light));
writeFileSync(`${outDir}/activity-dark.svg`, svg(themes.dark));
console.log(stats.map((s) => `${s.value} ${s.label} (${s.note})`).join("\n"));
