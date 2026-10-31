// Manual run of the Citation Tracker (same code path as the 06:00 IST cron). Usage on Railway shell:
//   npm run citations                 → all eligible brands
//   npm run citations -- <brand-uuid> → one brand
import { runCitationTracking } from "../agents/aeo-audit-engine/worker.js";

runCitationTracking({ brandId: process.argv[2] })
  .then((s) => { console.log(JSON.stringify(s, null, 2)); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
