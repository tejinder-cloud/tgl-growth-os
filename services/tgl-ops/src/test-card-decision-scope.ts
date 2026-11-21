// services/tgl-ops/src/test-card-decision-scope.ts
// Approve or reject on a prospect card changes only the rows that card put up for review (status "new").
import assert from "node:assert/strict";
import { scopeStatusUpdate } from "./agents/prospect-researcher/db.js";

type Call = [string, string, unknown];
function fakeQuery(calls: Call[]) {
  const q = {
    eq(col: string, v: string) { calls.push(["eq", col, v]); return q; },
    in(col: string, v: readonly string[]) { calls.push(["in", col, [...v]]); return q; },
  };
  return q;
}

const calls: Call[] = [];
scopeStatusUpdate(fakeQuery(calls), { city: "Hyderabad", category: "cosmetic_dental" });
assert.deepEqual(calls, [
  ["in", "status", ["new"]],
  ["eq", "city", "Hyderabad"],
  ["eq", "category", "cosmetic_dental"],
]);
const bare: Call[] = [];
scopeStatusUpdate(fakeQuery(bare), {});
assert.deepEqual(bare, [["in", "status", ["new"]]], "never an unscoped update");
console.log("test-card-decision-scope: all checks passed");
