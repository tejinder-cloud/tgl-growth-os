// services/tgl-ops/src/agents/sales-desk/dossier.ts
// Pre-call dossier (SKILL.md Playbook A). Pure: takes a prospect and an appointment, reads the data the
// researcher and sequencer already stored, returns markdown. It makes no network calls, so it spends no
// Places quota. A missing source is stated as "not available"; nothing is estimated.
import type { Appointment, SalesProspect } from "./types.js";

export const DEFAULT_AUDIT_MAX_AGE_DAYS = 14;

export interface PlacesView {
  reviews?: number;
  rating?: number;
  ownerReplies?: boolean;
  reviewSurge?: boolean;
  branchCount?: number;
  phone?: string;
  mapsUrl?: string;
}

export interface MetaAdsView {
  active?: boolean;
  count?: number;
  adLibraryUrl?: string;
}

export interface AuditView {
  visibilityPercent: number;
  mentions: number;
  totalQueries: number;
  mentionsByEngine: Record<string, number>;
  topCompetitors: string[];
  topCitedDomains: string[];
  auditedAt: string;
  stale: boolean;
}

export interface DossierSources {
  places: PlacesView | null;
  metaAds: MetaAdsView | null;
  audit: AuditView | null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function readPlaces(p: SalesProspect): PlacesView | null {
  const s = p.signals || {};
  const maps = (p.source_refs || []).find((r) => /maps\.google\.com|google\.com\/maps/i.test(r));
  const view: PlacesView = {
    reviews: num(s.gbp_reviews),
    rating: num(s.gbp_rating),
    ownerReplies: typeof s.gbp_owner_replies === "boolean" ? s.gbp_owner_replies : undefined,
    reviewSurge: typeof s.review_surge === "boolean" ? s.review_surge : undefined,
    branchCount: num(s.branch_count),
    phone: p.decision_maker?.phone,
    mapsUrl: maps,
  };
  const has = Object.values(view).some((v) => v !== undefined);
  return has ? view : null;
}

export function readMetaAds(p: SalesProspect): MetaAdsView | null {
  const s = p.signals || {};
  const url = (p.source_refs || []).find((r) => /facebook\.com\/ads\/library/i.test(r));
  const view: MetaAdsView = {
    active: typeof s.meta_ads_active === "boolean" ? s.meta_ads_active : undefined,
    count: num(s.meta_ad_count),
    adLibraryUrl: url,
  };
  const has = Object.values(view).some((v) => v !== undefined);
  return has ? view : null;
}

export function readAudit(p: SalesProspect, now: Date, maxAgeDays = DEFAULT_AUDIT_MAX_AGE_DAYS): AuditView | null {
  const a = (p.signals as any)?.outreach?.audit;
  if (!a || typeof a !== "object") return null;
  const t = Date.parse(a.audited_at);
  const stale = !Number.isFinite(t) || now.getTime() - t > maxAgeDays * 86_400_000;
  return {
    visibilityPercent: Number(a.visibility_percent) || 0,
    mentions: Number(a.mentions) || 0,
    totalQueries: Number(a.total_queries) || 0,
    mentionsByEngine: a.mentions_by_engine && typeof a.mentions_by_engine === "object" ? a.mentions_by_engine : {},
    topCompetitors: Array.isArray(a.top_competitors) ? a.top_competitors.map(String) : [],
    topCitedDomains: Array.isArray(a.top_cited_domains) ? a.top_cited_domains.map(String) : [],
    auditedAt: String(a.audited_at || ""),
    stale,
  };
}

export function gatherSources(p: SalesProspect, now: Date, maxAgeDays = DEFAULT_AUDIT_MAX_AGE_DAYS): DossierSources {
  return { places: readPlaces(p), metaAds: readMetaAds(p), audit: readAudit(p, now, maxAgeDays) };
}

const NA = "Not available (no stored data).";

export function placesLines(v: PlacesView | null): string[] {
  if (!v) return [NA];
  const out: string[] = [];
  if (v.reviews !== undefined) out.push(`Google reviews: ${v.reviews}${v.rating !== undefined ? ` at ${v.rating} stars` : ""}`);
  if (v.ownerReplies !== undefined) out.push(`Owner replies to reviews: ${v.ownerReplies ? "yes" : "no"}`);
  if (v.reviewSurge !== undefined) out.push(`Recent review surge (15+ in 30 days): ${v.reviewSurge ? "yes" : "no"}`);
  if (v.branchCount !== undefined) out.push(`Branches: ${v.branchCount}`);
  if (v.phone) out.push(`Business phone: ${v.phone}`);
  if (v.mapsUrl) out.push(`Maps listing: ${v.mapsUrl}`);
  return out.length ? out : [NA];
}

export function metaLines(v: MetaAdsView | null): string[] {
  if (!v) return [NA];
  const out: string[] = [];
  if (v.active !== undefined) out.push(`Active Meta ads: ${v.active ? "yes" : "no"}${v.count !== undefined ? ` (${v.count} active creatives)` : ""}`);
  else if (v.count !== undefined) out.push(`Active creatives: ${v.count}`);
  if (v.adLibraryUrl) out.push(`Ad Library page: ${v.adLibraryUrl}`);
  return out.length ? out : [NA];
}

export function auditLines(v: AuditView | null): string[] {
  if (!v) return ["Not available: the outreach audit has not run for this prospect."];
  const out = [
    `Mentioned in ${v.mentions} of ${v.totalQueries} AI answers (${v.visibilityPercent}% visibility), audited ${v.auditedAt.slice(0, 10) || "date unknown"}${v.stale ? " (STALE: re-run before quoting)" : ""}`,
  ];
  const engines = Object.entries(v.mentionsByEngine).map(([k, n]) => `${k}: ${n}`);
  if (engines.length) out.push(`By engine: ${engines.join(", ")}`);
  if (v.topCompetitors.length) out.push(`Competitors named most: ${v.topCompetitors.slice(0, 5).join(", ")}`);
  if (v.topCitedDomains.length) out.push(`Domains cited most: ${v.topCitedDomains.slice(0, 5).join(", ")}`);
  return out;
}

/** Three questions, each tied to a finding that actually exists. */
export function suggestedQuestions(p: SalesProspect, s: DossierSources): string[] {
  const q: string[] = [];
  if (s.audit && s.audit.topCompetitors.length) {
    q.push(`AI assistants name ${s.audit.topCompetitors[0]} before you. Do patients or students mention them when they call?`);
  } else {
    q.push("When a new enquiry comes in, how do they say they found you?");
  }
  if (s.metaAds?.active) {
    q.push(`You run ${s.metaAds.count ?? "several"} active Meta creatives. Which enquiries from those turn into bookings, and who tracks that?`);
  } else {
    q.push("Where does most of your new business come from today, and which source would you want more of?");
  }
  if (s.places?.branchCount && s.places.branchCount > 1) {
    q.push(`With ${s.places.branchCount} locations, who decides marketing spend, and does each location want its own visibility?`);
  } else {
    q.push("Who else, besides you, needs to agree before you start something like this?");
  }
  return q;
}

function outreachHistory(p: SalesProspect): string[] {
  const o = (p.signals as any)?.outreach;
  if (!o) return ["No outreach history on file (inbound or manual booking)."];
  const touches = Array.isArray(o.touches) ? o.touches : [];
  const out = [`Touches sent: ${touches.length}`];
  if (o.last_reply_intent) out.push(`Last reply intent: ${o.last_reply_intent}${o.last_reply_at ? ` on ${String(o.last_reply_at).slice(0, 10)}` : ""}`);
  return out;
}

export interface Dossier {
  prospectId: string;
  appointmentId: string;
  markdown: string;
  sources: DossierSources;
}

function bullets(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

export function buildDossier(p: SalesProspect, appt: Appointment, now: Date, maxAgeDays = DEFAULT_AUDIT_MAX_AGE_DAYS): Dossier {
  const sources = gatherSources(p, now, maxAgeDays);
  const dm = p.decision_maker || {};
  const who = [dm.name, dm.role].filter(Boolean).join(", ") || "Not available";
  const contact = [dm.email, dm.phone].filter(Boolean).join(" / ") || "Not available";
  const md = [
    `*Pre-call dossier: ${p.company}*`,
    `Call: ${appt.title || "Diagnostic call"} at ${appt.startTime}`,
    `${[p.category, p.city].filter(Boolean).join(" · ") || "Category and city not available"}${p.website ? ` · ${p.website}` : ""}`,
    "",
    "*Decision-maker*",
    bullets([`${who}`, `Contact: ${contact}`, `Fit score: ${p.fit_score ?? "not available"}`]),
    p.fit_reasons?.length ? "\n*Why they fit*\n" + bullets(p.fit_reasons) : "",
    "",
    "*Places*",
    bullets(placesLines(sources.places)),
    "",
    "*Meta Ads*",
    bullets(metaLines(sources.metaAds)),
    "",
    "*AI visibility audit*",
    bullets(auditLines(sources.audit)),
    "",
    "*Outreach history*",
    bullets(outreachHistory(p)),
    "",
    "*Suggested questions*",
    suggestedQuestions(p, sources).map((x, i) => `${i + 1}. ${x}`).join("\n"),
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  return { prospectId: p.id, appointmentId: appt.id, markdown: md, sources };
}
