// services/tgl-ops/src/lib/plain-error.ts
// Turns a provider error (often a raw JSON body) into one plain sentence for Slack, so the Architect reads
// what happened and what to do, not a 15-line dump. The full error stays in the server log and the database.

const MAX = 180;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function plainError(raw: unknown): string {
  const text = oneLine(String((raw as any)?.message ?? raw ?? ""));
  if (!text) return "no reason was reported";
  if (/prepayment credits are depleted|credits? (are|is) depleted|insufficient (credits|balance)/i.test(text)) {
    return "Gemini has run out of credits. Top up in Google AI Studio (Billing), and check that the Gemini key in Railway belongs to the project you topped up";
  }
  if (/HTTP 429|\b429\b.*(quota|rate)|RESOURCE_EXHAUSTED|rate limit|quota exceeded/i.test(text)) {
    return "the provider's usage limit was reached; it will be tried again later";
  }
  if (/HTTP 40[13]\b|\b40[13]\b.*(unauthori[sz]ed|forbidden|invalid api key|permission)/i.test(text)) {
    return "the provider refused our key (not authorised); check the key in Railway";
  }
  // A JSON error body: keep only its message (or its "error" text); never show the raw JSON.
  const m = /"message"\s*:\s*"([^"]{3,})"/.exec(text) || /"error"\s*:\s*"([^"]{3,})"/.exec(text);
  let core = oneLine(m ? m[1] : text);
  if (!m && core.includes("{")) core = oneLine(core.slice(0, core.indexOf("{")).replace(/[\s:]+$/, "")) || "the provider returned an error";
  return core.length > MAX ? `${core.slice(0, MAX - 3)}...` : core;
}
