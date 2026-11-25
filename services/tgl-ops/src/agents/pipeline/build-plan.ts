// services/tgl-ops/src/agents/pipeline/build-plan.ts
// The TGL build plan shown at /pipeline/build. Finish line (Architect, 24 Nov 2026): WhatsApp outreach live by
// 15 Dec 2026. A "day" is a block of work, not a calendar day (Architect, 25 Nov 2026): several can be finished
// in one sitting. Calendar dates appear only where someone else sets the pace (Meta) and on the go-live target.
// Claude keeps this file current in each PR; Tejinder can edit it too. Only facts and his decisions.

export type Owner = "You" | "Claude" | "Meta";
export type TaskStatus = "done" | "doing" | "todo" | "blocked";

/** A phase covers a range of work days, inclusive. */
export interface PlanPhase { name: string; from: number; to: number }
export interface PlanTask {
  title: string;
  owner: Owner;
  /** The work day this task belongs to. */
  day: number;
  status: TaskStatus;
  /** Only for tasks whose timing someone else sets (YYYY-MM-DD, IST): the date we plan around. */
  date?: string;
  note?: string;
}
export interface PlanRisk { kind: "Risk" | "Issue"; what: string; impact: "High" | "Medium" | "Low"; owner: Owner; action: string; status: "Open" | "Watching" | "Closed" }
export interface PlanDecision { date: string; what: string; why?: string }
export interface PlanAgent { key: string; name: string; job: string; when: string; live: boolean }

export interface BuildPlan {
  title: string;
  goal: string;
  /** Calendar day the build started. */
  start: string;
  /** Calendar target for go-live. */
  goLive: string;
  totalDays: number;
  phases: PlanPhase[];
  tasks: PlanTask[];
  risks: PlanRisk[];
  decisions: PlanDecision[];
  agents: PlanAgent[];
}

export const BUILD_PLAN: BuildPlan = {
  title: "WhatsApp outreach build",
  goal: "Email and WhatsApp outreach both running on their own, so phone-only businesses are reached too.",
  start: "2026-11-24",
  goLive: "2026-12-15",
  totalDays: 22,
  phases: [
    { name: "Fix and widen", from: 1, to: 3 },
    { name: "Less work for you", from: 4, to: 10 },
    { name: "WhatsApp build", from: 11, to: 17 },
    { name: "Connect, test, go live", from: 18, to: 22 },
  ],
  tasks: [
    { day: 1, title: "Replace the Gemini key so audits run again", owner: "You", status: "done" },
    { day: 1, title: "Regenerate the GitHub token (1 year)", owner: "You", status: "done" },
    { day: 1, title: "Resume the 10 businesses held by the Gemini failure", owner: "Claude", status: "done" },
    { day: 1, title: "Gmail fallback sender and warm-up cap (PR #220)", owner: "Claude", status: "done" },
    { day: 1, title: "Short daily brief in Slack (PR #221)", owner: "Claude", status: "done" },
    { day: 2, title: "Widen the researcher: 6 industries, Tier 1/2/3 cities (PR #222)", owner: "Claude", status: "done" },
    { day: 2, title: "Live view at /pipeline/live (PRs #223, #224)", owner: "Claude", status: "done" },
    { day: 3, title: "Advance AI checks for phone-only businesses (PR #225)", owner: "Claude", status: "done" },
    { day: 3, title: "Build tracker at /pipeline/build (PR #226)", owner: "Claude", status: "done" },
    { day: 3, title: "Check the first 3 widened researcher runs: 31 qualified, 24 with an email", owner: "Claude", status: "done" },
    { day: 4, title: "Submit Meta App Review; all 3 test calls complete", owner: "You", status: "done", note: "Meta shows Review in progress (checked 25 Nov)." },
    { day: 5, title: "Dashboard rebuilt: Overview, Outreach, Pipeline, Build in one frame (PR #227)", owner: "Claude", status: "done" },
    { day: 6, title: "One daily approval card in Slack instead of 3 (PR #228)", owner: "Claude", status: "done" },
    { day: 7, title: "Events table as the record, replacing GitHub logs (PR #230)", owner: "Claude", status: "done", note: "Log files stay as a backup for now." },
    { day: 9, title: "Suggested replies to prospect emails, with calendar slots (PR #231)", owner: "Claude", status: "done", note: "Sent only when you press a button." },
    { day: 10, title: "Build plan counted in work days, not calendar days", owner: "Claude", status: "done" },
    { day: 11, title: "WhatsApp first message in the sequence, dry run only", owner: "Claude", status: "todo" },
    { day: 14, title: "Inbound WhatsApp replies reach Slack and the pipeline", owner: "Claude", status: "todo" },
    { day: 16, title: "Meta approves the app (Tech Provider)", owner: "Meta", status: "doing", date: "2026-12-08", note: "In review. Meta says most reviews finish within 20 days; the date is our planning guess." },
    { day: 17, title: "Publish the app and connect 98720 09997 by coexistence", owner: "You", status: "todo", note: "After Meta approves. Not through the new-number flow." },
    { day: 18, title: "Submit template tgl_ai_visibility_first_touch", owner: "Claude", status: "todo" },
    { day: 19, title: "Meta approves the template", owner: "Meta", status: "todo", date: "2026-12-13" },
    { day: 20, title: "Test send to your own number, then approve the first batch", owner: "You", status: "todo" },
    { day: 22, title: "First WhatsApp messages go to phone-only businesses", owner: "Claude", status: "todo", date: "2026-12-15" },
  ],
  risks: [
    { kind: "Risk", what: "Meta App Review is slow or rejected", impact: "High", owner: "You", action: "Submitted and in review (25 Nov); Meta says most finish within 20 days. If Meta asks for changes, we answer the same day. If not approved by 10 Dec, the go-live date moves.", status: "Open" },
    { kind: "Risk", what: "Resend's rules do not allow cold email", impact: "Medium", owner: "You", action: "Your decision: stay on Resend. Gmail sending is built and switched off; switching is one Railway setting.", status: "Watching" },
    { kind: "Issue", what: "{phone_only} approved businesses have only a phone number", impact: "Medium", owner: "Claude", action: "No cold calls. Their AI checks run in advance, 5 a day; WhatsApp reaches them once live.", status: "Open" },
    { kind: "Risk", what: "Gemini credits run out", impact: "Medium", owner: "You", action: "Rs 500 prepaid on 23 Nov. A failure holds sending and posts one line in alerts.", status: "Watching" },
    { kind: "Risk", what: "98720 09997 entered in the new-number flow would cut it off the WhatsApp app", impact: "High", owner: "You", action: "Connect only by coexistence, step by step with Claude.", status: "Open" },
    { kind: "Risk", what: "GitHub token expires in Nov 2027", impact: "Low", owner: "You", action: "Set a reminder a week before expiry.", status: "Watching" },
  ],
  decisions: [
    { date: "2026-11-25", what: "A build day is a block of work, not a calendar day; several can be done in one sitting" },
    { date: "2026-11-24", what: "Finish line: WhatsApp outreach live by 15 Dec 2026", why: "Phone-only businesses can only be reached on WhatsApp." },
    { date: "2026-11-24", what: "No cold calls. Phone-only businesses wait for WhatsApp" },
    { date: "2026-11-24", what: "Outreach starts at fit 65 (was 70)" },
    { date: "2026-11-24", what: "An email a business publishes on its own website, info@ included, is usable for any size of business" },
    { date: "2026-11-24", what: "Industries: hospitals, dental, IVF, coaching, hotels, real estate. No D2C; more can be added later" },
    { date: "2026-11-24", what: "Cities: 40% Tier 1, 40% Tier 2, 20% Tier 3" },
    { date: "2026-11-24", what: "Keep cold email on Resend from tejinder@mail.thegrowthlab.co.in; Gmail stays a switched-off fallback" },
    { date: "2026-11-24", what: "Claude runs Supabase changes directly" },
    { date: "2026-11-24", what: "Port the My LabOS outreach design into TGL, keeping audits, one-pagers, claim guard, booking and pipeline" },
    { date: "2026-11-21", what: "WhatsApp through Meta App Review as a Tech Provider; 98720 09997 joins by coexistence" },
    { date: "2026-11-21", what: "The WhatsApp console uses the mylabos admin system-user token" },
  ],
  agents: [
    { key: "prospect-researcher", name: "Prospect researcher", job: "Finds businesses on Google Places and scores fit", when: "09:30 daily, 3 city-industry pairs", live: true },
    { key: "outreach-sequencer", name: "Outreach", job: "Sends approved emails with each business's AI check", when: "09:30 to 16:30, on the half hour", live: true },
    { key: "aeo-audit-engine", name: "Citation tracker and audits", job: "Asks AI engines about each business and its rivals", when: "With each touch, and 11:00 for phone-only", live: true },
    { key: "chief-of-staff", name: "Chief of staff", job: "Morning plan and evening brief in Slack", when: "09:00 and 18:00", live: true },
    { key: "booking", name: "Booking", job: "Books calls into your calendar and checks cancellations", when: "When someone books", live: true },
    { key: "whatsapp", name: "WhatsApp", job: "First message and replies for phone-only businesses", when: "From go-live", live: false },
  ],
};
