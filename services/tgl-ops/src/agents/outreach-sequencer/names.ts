// services/tgl-ops/src/agents/outreach-sequencer/names.ts
// What a message calls the business and the person. Google listing names are often stuffed with search terms
// ("Luma Fertility : Top IVF Centre in Bandra Mumbai l Best IVF Treatment"), and many prospects have a role in
// place of a name ("Owner / Lead Doctor"). A message must never greet anyone that way. Pure; the stored record
// is not changed.

// Separators listing owners put between the name and the keywords. " l " and " I " are a letter used as a bar.
const SEPARATORS = /\s+[|:–—]\s+|\s+-\s+|\s+[lI]\s+(?=[A-Z])|\s*,\s*/;
// A trailing "in <Place>" or "near <Place>".
const TRAILING_PLACE = /\s+(?:in|near|at)\s+[A-Z][\w.'’&-]*(?:\s+[A-Z][\w.'’&-]*)*\s*$/;
const LEADING_PROMO = /^(?:best|top|no\.?\s*1|#1|leading|famous)\s+/i;

/** "Luma Fertility : Top IVF Centre in Bandra Mumbai l Best IVF" -> "Luma Fertility". */
export function cleanBusinessName(listingName: string): string {
  const raw = String(listingName || "").replace(/\s+/g, " ").trim();
  if (!raw) return raw;
  let name = raw.split(SEPARATORS)[0].trim();
  name = name.replace(TRAILING_PLACE, "").trim();
  name = name.replace(LEADING_PROMO, "").trim();
  name = name.replace(/[.\s]+$/, "");
  if (name.length < 3) name = raw.slice(0, 60).trim();
  return name.length > 60 ? `${name.slice(0, 57).trimEnd()}...` : name;
}

const HONORIFIC = /^(?:dr|doctor|prof|professor)\.?\s+/i;
const ROLE_WORDS = /\b(?:owner|lead|doctor|founder|director|manager|team|unknown|admin|clinic|centre|center|hospital|head|chief|ceo|md|partner)\b/i;

/**
 * How to address the person: "Dr Yadav" for "Dr. Ila Yadav. Root", "Asha" for "Asha Rao", and "" for a role
 * placeholder such as "Owner / Lead Doctor" or "DM unknown" (the template then opens without a name).
 */
export function greetingName(personName: string | undefined | null): string {
  const raw = String(personName || "").replace(/\s+/g, " ").trim();
  if (!raw || raw.includes("/") || /dm unknown/i.test(raw)) return "";
  const isDoctor = HONORIFIC.test(raw);
  // Cut at a sentence break left by a scrape ("Ila Yadav. Root (Founder)") and drop bracketed roles.
  const core = raw.replace(HONORIFIC, "").split(/\.\s+|\s*\(|\s*,|\s+[|:–—-]\s+/)[0].replace(/[.]+$/, "").trim();
  const words = core.split(" ").filter((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w));
  if (words.length === 0 || words.every((w) => ROLE_WORDS.test(w))) return "";
  if (isDoctor) return words.length >= 2 ? `Dr ${words[words.length - 1]}` : `Dr ${words[0]}`;
  return words[0];
}
