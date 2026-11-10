// services/tgl-ops/src/scripts/sync-assets.ts
// Copies config/agents.yaml and agents/outreach-sequencer/templates into
// services/tgl-ops/src/assets so the bundled assets never drift from repo sources.
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string = process.cwd()): string | null {
  let cur = path.resolve(startDir);
  for (let i = 0; i < 5; i++) {
    if (
      fs.existsSync(path.join(cur, "config", "agents.yaml")) ||
      fs.existsSync(path.join(cur, "agents", "outreach-sequencer", "templates"))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

export function syncAssets(cwd: string = process.cwd()): { agentsSynced: boolean; templatesSynced: boolean } {
  const repoRoot = findRepoRoot(cwd);
  const srcAssetsDir = path.resolve(cwd, fs.existsSync(path.join(cwd, "src", "assets")) ? "src/assets" : "assets");

  let agentsSynced = false;
  let templatesSynced = false;

  if (repoRoot) {
    // 1. Sync config/agents.yaml
    const srcAgentsYaml = path.join(repoRoot, "config", "agents.yaml");
    const destAgentsDir = path.join(srcAssetsDir, "config");
    const destAgentsYaml = path.join(destAgentsDir, "agents.yaml");

    if (fs.existsSync(srcAgentsYaml)) {
      fs.mkdirSync(destAgentsDir, { recursive: true });
      fs.copyFileSync(srcAgentsYaml, destAgentsYaml);
      agentsSynced = true;
      console.log(`[Sync Assets] Synced ${srcAgentsYaml} -> ${destAgentsYaml}`);
    }

    // 2. Sync outreach sequencer templates
    const srcTemplatesDir = path.join(repoRoot, "agents", "outreach-sequencer", "templates");
    const destTemplatesDir = path.join(srcAssetsDir, "outreach-templates");

    if (fs.existsSync(srcTemplatesDir)) {
      fs.mkdirSync(destTemplatesDir, { recursive: true });
      const entries = fs.readdirSync(srcTemplatesDir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          fs.copyFileSync(path.join(srcTemplatesDir, entry), path.join(destTemplatesDir, entry));
        }
      }
      templatesSynced = true;
      console.log(`[Sync Assets] Synced outreach templates from ${srcTemplatesDir} -> ${destTemplatesDir}`);
    }
  } else {
    console.log(`[Sync Assets] Repo root not detected (container build). Verifying bundled assets...`);
    const bundledAgents = path.join(srcAssetsDir, "config", "agents.yaml");
    const bundledTemplates = path.join(srcAssetsDir, "outreach-templates", "touch-1.md");

    if (fs.existsSync(bundledAgents)) {
      agentsSynced = true;
    } else {
      console.warn(`[Sync Assets Warning] Bundled config/agents.yaml missing at ${bundledAgents}`);
    }

    if (fs.existsSync(bundledTemplates)) {
      templatesSynced = true;
    } else {
      console.warn(`[Sync Assets Warning] Bundled outreach templates missing at ${bundledTemplates}`);
    }
  }

  return { agentsSynced, templatesSynced };
}

// Run immediately if invoked as CLI script
if (process.argv[1] && process.argv[1].endsWith("sync-assets.ts")) {
  syncAssets();
}
