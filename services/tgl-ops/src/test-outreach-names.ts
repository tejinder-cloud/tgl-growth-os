// services/tgl-ops/src/test-outreach-names.ts
// What outreach calls a business and a person. Fixtures are the shapes of names stored on 13 Nov 2026.
import assert from "node:assert/strict";
import { cleanBusinessName, greetingName } from "./agents/outreach-sequencer/names.js";
import { categoryLabel } from "./agents/outreach-sequencer/sequence.js";
import { buildTemplateVars, fixArticles } from "./agents/outreach-sequencer/templates.js";

const names: Array<[string, string]> = [
  ["Luma Fertility : Top IVF Centre in Bandra Mumbai l Best IVF Fertility Treatment in Mumbai I IVF,Egg Freezing Clinic in Mumbai", "Luma Fertility"],
  ["Dr. Akash Surana | IVF & Fertility Specialist in Vashi", "Dr. Akash Surana"],
  ["Womb IVF & Fertility Center in Kandivali, Mumbai", "Womb IVF & Fertility Center"],
  ["Nulife IVF Centre in Seawoods, Navi Mumbai", "Nulife IVF Centre"],
  ["Miraai Fertility by Dr Priya Khamatkar - IVF Center in Navi Mumbai", "Miraai Fertility by Dr Priya Khamatkar"],
  ["Shape Dental Aesthetics Clinics", "Shape Dental Aesthetics Clinics"],
  ["Dr Swarupa Iyer‘s Total Fertility solutions", "Dr Swarupa Iyer‘s Total Fertility solutions"],
  ["Best Smile Dental Clinic", "Smile Dental Clinic"],
  ["Dr.Trupti Kharosekar", "Dr.Trupti Kharosekar"],
  ["AB", "AB"],
];
for (const [raw, want] of names) assert.equal(cleanBusinessName(raw), want, raw);
assert.ok(cleanBusinessName("x".repeat(90)).length <= 60);

const people: Array<[string | undefined, string]> = [
  ["Dr. Ila Yadav. Root (Founder & Lead Doctor)", "Dr Yadav"],
  ["Dr Nitendra Singh", "Dr Singh"],
  ["Asha Rao", "Asha"],
  ["Owner / Lead Doctor", ""],
  ["DM unknown", ""],
  ["Lead Doctor", ""],
  ["", ""],
  [undefined, ""],
];
for (const [raw, want] of people) assert.equal(greetingName(raw), want, String(raw));

assert.equal(categoryLabel("ivf_fertility"), "IVF centre");
assert.equal(categoryLabel("cosmetic_dental"), "dental clinic");
assert.equal(categoryLabel("high_ticket_coaching"), "coaching institute");
assert.equal(categoryLabel("hospitals"), "hospital");

const v = buildTemplateVars({ company: "Womb IVF & Fertility Center in Kandivali, Mumbai", category: "ivf_fertility", city: "Mumbai", decisionMakerName: "Owner / Lead Doctor" } as any);
assert.equal(v.company, "Womb IVF & Fertility Center");
assert.equal(v.first_name, "Hello");
assert.equal(v.category, "IVF centre");

assert.equal(fixArticles("choosing a IVF centre"), "choosing an IVF centre");
assert.equal(fixArticles("a hospital, a dental clinic, a CT scan, a university, a one-page report"), "a hospital, a dental clinic, a CT scan, a university, a one-page report");
assert.equal(fixArticles("a MRI centre and a eye clinic"), "an MRI centre and an eye clinic");
assert.equal(fixArticles("A IVF"), "An IVF");

console.log("test-outreach-names: all checks passed");
