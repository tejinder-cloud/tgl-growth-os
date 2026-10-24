import { syncLabels } from "../lib/labels.js";

async function main(): Promise<void> {
  console.log("=== TGL Labels Sync Tool ===");
  try {
    const res = await syncLabels();
    console.log(`\nSync finished: ${res.created} created, ${res.updated} updated, ${res.unchanged} unchanged.`);
    if (res.errors.length > 0) {
      console.error(`Encountered ${res.errors.length} errors:`);
      res.errors.forEach((e) => console.error(` - ${e}`));
      process.exit(1);
    }
  } catch (err) {
    console.error("Fatal error during label sync:", err);
    process.exit(1);
  }
}

main();
