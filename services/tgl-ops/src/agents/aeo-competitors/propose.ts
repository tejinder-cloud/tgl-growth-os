// The model's two jobs (plan Day 30): name the businesses AI recommends that aren't tracked, and explain — from the
// evidence we give it — why AI picks the top rivals and what the client can do about it. Code verifies names and refs.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "../../lib/anthropic-pricing.js";
import { callStructuredTool } from "../../lib/anthropic-structured.js";
import type { Ans, Rival } from "./analyse.js";

export const DISCOVER_TOOL: Anthropic.Tool = {
  name: "list_businesses",
  description: "Businesses the answers recommend",
  input_schema: { type: "object", properties: { names: { type: "array", items: { type: "string" }, description: "Business / agency / brand names exactly as written in the answers" } }, required: ["names"] },
};

export function discoverMessage(brand: string, market: string, sample: Ans[]): string {
  return [
    `These are AI assistants' answers to buyers' questions in this market: ${market}. The client is ${brand}.`,
    `List every business, agency or brand the answers recommend or name as a provider — exactly as written. Leave out ${brand}, AI products (ChatGPT, Gemini…), directories and listing sites (Justdial, Clutch…), media and generic terms.`,
    ...sample.map((a, i) => `\n[A${i + 1}] Q: ${a.prompt}\n${a.text.replace(/\s+/g, " ").slice(0, 700)}`),
  ].join("\n");
}

export const PLAYBOOK_TOOL: Anthropic.Tool = {
  name: "write_playbooks",
  description: "Why AI picks each rival, and what the client can do",
  input_schema: {
    type: "object",
    properties: {
      playbooks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rival: { type: "string" },
            why: { type: "array", items: { type: "object", properties: { text: { type: "string" }, refs: { type: "array", items: { type: "string" } } }, required: ["text", "refs"] }, description: "2–3 reasons AI names them, each citing evidence refs (Q…, S…, E…)" },
            moves: { type: "array", items: { type: "string" }, description: "2–3 concrete things the client can do to be named instead or alongside" },
          },
          required: ["rival", "why", "moves"],
        },
      },
    },
    required: ["playbooks"],
  },
};

export function playbookMessage(brand: string, top: Rival[], excerpts: Map<string, Ans[]>): string {
  const lines = [`Client: ${brand}. For each rival, explain from the evidence only why AI names them where it doesn't name ${brand}, and what ${brand} can do. Put evidence refs (Q…, S…, E…) only in the refs field — never in the text, which the client reads; name the question or site in words instead. No numbers — they are attached by code. No guarantees.`];
  for (const r of top) {
    lines.push(``, `RIVAL: ${r.name}`);
    r.questions.forEach((q, i) => lines.push(`Q${i + 1}. "${q.prompt}"`));
    r.sites.forEach((s, i) => lines.push(`S${i + 1}. ${s.domain} (cited in answers naming them)`));
    (excerpts.get(r.name) ?? []).slice(0, 4).forEach((a, i) => lines.push(`E${i + 1}. ${a.text.replace(/\s+/g, " ").slice(0, 500)}`));
  }
  return lines.join("\n");
}

export type Playbook = { rival: string; why: { text: string; refs: string[] }[]; moves: string[] };
const NUM = /\b\d+(?:\.\d+)?\s?(?:%|percent|x\b|times)/i;
const PROMISE = /\b(guarantee[ds]?|will (?:be )?(?:named|cited|recommended|rank))\b/i;
/** Evidence codes (Q3, S1, E2, "(Q3)", "questions Q1 and Q2") are for us; the client reads words (pure; tested). */
export function stripCodes(t: string): string {
  return t
    .replace(/\s*\((?:\s*[QSE]\d{1,2}\s*(?:[,/&]|and)?\s*)+\)/g, "")
    .replace(/\b(?:questions?|sites?|answers?|excerpts?)\s+[QSE]\d{1,2}(?:\s*(?:,|and|&|\/)\s*[QSE]\d{1,2})*\b/gi, (m) => m.replace(/\s+[QSE]\d.*$/, ""))
    .replace(/\b[QSE]\d{1,2}(?:\s*(?:,|and|&|\/)\s*[QSE]\d{1,2})*\b/g, "")
    .replace(/[,;]\s*\)/g, ")").replace(/\(\s*\)/g, "").replace(/\s+([,.;:])/g, "$1").replace(/\.(\s*\.)+/g, ".").replace(/\s{2,}/g, " ").trim();
}
const clean = (s: unknown, n: number) => stripCodes(String(s ?? "").replace(/\s+/g, " ").trim()).slice(0, n);

/** Keep reasons whose refs exist for that rival; drop invented numbers and promises (pure; tested). */
export function validatePlaybooks(raw: any, top: Rival[], excerptCount: Map<string, number>): Playbook[] {
  const out: Playbook[] = [];
  for (const p of raw?.playbooks ?? []) {
    const r = top.find((x) => x.name.toLowerCase() === String(p?.rival ?? "").toLowerCase());
    if (!r) continue;
    const okRef = (ref: string) => { const m = /^([QSE])(\d+)$/.exec(ref.trim()); if (!m) return false; const n = Number(m[2]); return m[1] === "Q" ? n <= r.questions.length : m[1] === "S" ? n <= r.sites.length : n <= (excerptCount.get(r.name) ?? 0); };
    const why = (p.why ?? []).map((w: any) => ({ text: clean(w?.text, 300), refs: (w?.refs ?? []).map(String).filter(okRef) }))
      .filter((w: any) => w.text && w.refs.length && !NUM.test(w.text) && !PROMISE.test(w.text)).slice(0, 3);
    const moves = (p.moves ?? []).map((m: any) => clean(m, 300)).filter((m: string) => m && !NUM.test(m) && !PROMISE.test(m)).slice(0, 3);
    if (why.length) out.push({ rival: r.name, why, moves });
  }
  return out;
}

export async function callTool<T>(system: string, user: string, tool: Anthropic.Tool, maxTokens: number, client?: Pick<Anthropic, "messages">) {
  return callStructuredTool<T>({ client: client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), model: getAnthropicModel(), maxTokens, system, messages: [{ role: "user", content: user }], tool, agent: "aeo-competitors" });
}
