#!/usr/bin/env node
// Builds tgl-theme/assets/data/home-agents.json from config/agents.yaml for the Home page org chart
// (site/pages/home.md section 5). The page shows whatever the config says; nothing is typed by hand.
// Usage: node site/build-home-agents.js
// No dependencies: config/agents.yaml is a flat list of agents with a nested routines list, parsed here directly.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "config", "agents.yaml");
const OUT = path.join(__dirname, "..", "tgl-theme", "assets", "data", "home-agents.json");

// Department keys in agents.yaml -> the five groups named in the spec.
const GROUPS = [
  { id: "architect", label: "Office of the Architect", keys: ["office-of-the-architect"] },
  { id: "revenue", label: "Revenue", keys: ["revenue"] },
  { id: "aeo", label: "AEO delivery", keys: ["doors-aeo", "aeo-delivery", "delivery"] },
  { id: "marketing", label: "Marketing", keys: ["marketing"] },
  { id: "finance-people", label: "Finance and People", keys: ["finance", "people"] },
];

function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function parse(text) {
  const agents = [];
  let cur = null;
  let inRoutines = false;
  let curRoutine = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    let m;
    if ((m = raw.match(/^- name:\s*(.+)$/))) {
      cur = { name: unquote(m[1]), routines: [] };
      agents.push(cur);
      inRoutines = false;
      curRoutine = null;
    } else if (!cur) {
      continue;
    } else if (/^  routines:\s*$/.test(raw)) {
      inRoutines = true;
    } else if (inRoutines && (m = raw.match(/^    - name:\s*(.+)$/))) {
      curRoutine = { name: unquote(m[1]) };
      cur.routines.push(curRoutine);
    } else if (inRoutines && curRoutine && (m = raw.match(/^      (\w+):\s*(.*)$/))) {
      curRoutine[m[1]] = unquote(m[2]);
    } else if ((m = raw.match(/^  (\w+):\s*(.*)$/))) {
      inRoutines = false;
      cur[m[1]] = unquote(m[2]);
    }
  }
  return agents;
}

function titleFor(name) {
  return name
    .split("-")
    .map((w) => (w === "aeo" ? "AEO" : w === "gbp" ? "GBP" : w === "seo" ? "SEO" : w === "ops" ? "Ops" : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

const agents = parse(fs.readFileSync(SRC, "utf8"));
const unknown = [];
const groups = GROUPS.map((g) => ({ id: g.id, label: g.label, agents: [] }));
for (const a of agents) {
  const idx = GROUPS.findIndex((g) => g.keys.includes(a.department));
  if (idx < 0) {
    unknown.push(`${a.name} (${a.department})`);
    continue;
  }
  if (a.status !== "active" && a.status !== "planned") {
    unknown.push(`${a.name} (status: ${a.status})`);
    continue;
  }
  groups[idx].agents.push({
    name: a.name,
    title: titleFor(a.name),
    line: (a.routines[0] && a.routines[0].description) || "",
    status: a.status,
  });
}
if (unknown.length) {
  console.error("Not placed on the org chart: " + unknown.join("; "));
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: "config/agents.yaml", groups }, null, 2) + "\n");
console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${agents.length} agents in ${groups.length} groups`);
