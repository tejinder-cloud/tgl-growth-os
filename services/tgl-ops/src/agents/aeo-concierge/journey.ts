// Trial Concierge + Customer Success (plan Day 31). Pure: which journey email a workspace is due, if any. One email
// per workspace per run, each kind once (repeating kinds carry a period, e.g. inactive:2026-11).
export type JourneyState = {
  now: number;
  tenantCreatedAt: string;
  plan: string; status: string; trialStartedAt: string | null; trialEndsAt: string | null;
  brand: { onboardingStep: number; setupStatus: string | null; updatedAt: string } | null;
  lastSeenAt: string | null;               // most recent of the workspace's members
  diyStale: number;                         // recommendations on "Do it myself" for 14+ days, not done
  managedAskedRecently: boolean;            // a "Start managed AEO" click in the last 60 days
  sent: Set<string>;
};

const DAY = 86_400_000;
const daysSince = (iso: string | null, now: number) => (iso ? (now - Date.parse(iso)) / DAY : Infinity);
const month = (now: number) => new Date(now + 5.5 * 3600_000).toISOString().slice(0, 7);
const quarter = (now: number) => { const d = new Date(now + 5.5 * 3600_000); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };

export function dueKind(s: JourneyState): string | null {
  const age = daysSince(s.tenantCreatedAt, s.now);
  const want = (k: string) => (s.sent.has(k) ? null : k);
  const isPaid = ["track", "managed", "managed_plus"].includes(s.plan) && ["active", "past_due"].includes(s.status);

  // 1. Setup not finished (first week only).
  if ((!s.brand || s.brand.onboardingStep < 4) && age < 7) {
    if (age >= 3) return want("finish_setup_72h");
    if (age >= 1) return want("finish_setup_24h");
    return null;
  }
  // 2. Sent back for changes and not updated for two days (once per send-back).
  if (s.brand?.setupStatus === "needs_changes" && daysSince(s.brand.updatedAt, s.now) >= 2)
    return want(`needs_changes:${s.brand.updatedAt.slice(0, 10)}`);

  // 3. Trial running (the clock starts at the first verified run).
  if (s.plan === "trial" && s.status === "trialing" && s.trialStartedAt) {
    if (s.trialEndsAt && Date.parse(s.trialEndsAt) <= s.now) return null;
    const d = daysSince(s.trialStartedAt, s.now);
    if (d >= 5) return want("trial_day5");
    if (d >= 3) return want("trial_day3");
    return null;
  }
  // 4. Trial ended without upgrading (the day-7 baseline email already went).
  if (s.plan === "trial" && s.status === "expired" && s.trialEndsAt) {
    const d = daysSince(s.trialEndsAt, s.now);
    if (d >= 30) return null;
    if (d >= 14) return want("trial_ended_14d");
    if (d >= 3) return want("trial_ended_3d");
    return null;
  }
  // 5. Paying: offer help with the work they meant to do themselves (once a quarter), else nudge if away 14+ days.
  if (isPaid) {
    if (s.plan === "track" && s.diyStale >= 3 && !s.managedAskedRecently) { const k = want(`managed_offer:${quarter(s.now)}`); if (k) return k; }
    if (age >= 14 && daysSince(s.lastSeenAt, s.now) >= 14) return want(`inactive:${month(s.now)}`);
  }
  return null;
}

/** For the team's weekly health list: why an account needs a person this week (pure; tested). */
export function riskFlags(s: Omit<JourneyState, "sent">): string[] {
  const f: string[] = [];
  const seen = daysSince(s.lastSeenAt, s.now);
  if (s.status === "past_due") f.push("payment failed");
  if (s.plan === "trial" && s.status === "trialing" && s.trialStartedAt && daysSince(s.trialStartedAt, s.now) >= 4 && seen >= 3) f.push("trial: not opened in 3+ days");
  if (s.brand?.setupStatus === "needs_changes" && daysSince(s.brand.updatedAt, s.now) >= 2) f.push("setup sent back, no reply");
  if (["track", "managed", "managed_plus"].includes(s.plan) && s.status === "active" && seen >= 14) f.push("paid: not opened in 14+ days");
  if (s.plan === "track" && s.diyStale >= 3 && !s.managedAskedRecently) f.push(`${s.diyStale} DIY items stuck — managed candidate`);
  return f;
}
