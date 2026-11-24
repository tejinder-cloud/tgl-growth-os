// services/tgl-ops/src/agents/pipeline/build-plan.ts
// The TGL build plan shown at /pipeline/build. Finish line (Architect, 24 Nov 2026): WhatsApp outreach live by
// 15 Dec 2026. Claude keeps this file current in each PR; Tejinder can edit it too. Only facts and his decisions:
// no invented numbers. Dates are IST calendar days (YYYY-MM-DD).

export type Owner = "You" | "Claude" | "Meta";
export type TaskStatus = "done" | "doing" | "todo" | "blocked";

export interface PlanPhase { name: string; start: string; end: string }
export interface PlanTask { title: string; owner: Owner; due: string; status: TaskStatus; note?: string }
export interface PlanRisk { kind: "Risk" | "Issue"; what: string; impact: "High" | "Medium" | "Low"; owner: Owner; action: string; status: "Open" | "Watching" | "Closed" }
export interface PlanDecision { date: string; what: string; why?: string }
export interface PlanAgent { key: string; name: string; job: string; when: string; live: boolean }

export interface BuildPlan {
  title: string;
  goal: string;
  start: string;
  goLive: string;
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
  phases: [
    { name: "Fix and widen", start: "2026-11-24", end: "2026-11-26" },
    { name: "Less work for you", start: "2026-11-27", end: "2026-12-03" },
    { name: "WhatsApp build", start: "2026-12-04", end: "2026-12-10" },
    { name: "Connect, test, go live", start: "2026-12-11", end: "2026-12-15" },
  ],
  tasks: [
    { title: "Replace the Gemini key so audits run again", owner: "You", due: "2026-11-24", status: "done" },
    { title: "Regenerate the GitHub token (1 year)", owner: "You", due: "2026-11-24", status: "done" },
    { title: "Resume the 10 businesses held by the Gemini failure", owner: "Claude", due: "2026-11-24", status: "done" },
    { title: "Gmail fallback sender and warm-up cap (PR #220)", owner: "Claude", due: "2026-11-24", status: "done" },
    { title: "Short daily brief in Slack (PR #221)", owner: "Claude", due: "2026-11-24", status: "done" },
    { title: "Widen the researcher: 6 industries, Tier 1/2/3 cities (PR #222)", owner: "Claude", due: "2026-11-24", status: "done" },
    { title: "Live view at /pipeline/live (PRs #223, #224)", owner: "Claude", due: "2026-11-24", status: "done" },
    { title: "Advance AI checks for phone-only businesses (PR #225)", owner: "Claude", due: "2026-11-24", status: "done" },
    { title: "Build tracker at /pipeline/build (PR #226)", owner: "Claude", due: "2026-11-24", status: "done" },
    { title: "Get the business_management test-call tick, then submit Meta App Review", owner: "You", due: "2026-11-26", status: "todo", note: "All answers and videos are entered." },
    { title: "Check the first 3 widened researcher runs", owner: "Claude", due: "2026-11-25", status: "todo" },
    { title: "One daily approval card in Slack instead of 3", owner: "Claude", due: "2026-11-27", status: "todo" },
    { title: "Events table as the record, replacing GitHub logs", owner: "Claude", due: "2026-11-30", status: "todo" },
    { title: "Suggested replies to prospect emails, with calendar slots", owner: "Claude", due: "2026-12-03", status: "todo" },
    { title: "Meta approves the app (Tech Provider)", owner: "Meta", due: "2026-12-08", status: "todo", note: "Meta sets the pace; the date is our planning guess." },
    { title: "WhatsApp first message in the sequence, dry run only", owner: "Claude", due: "2026-12-08", status: "todo" },
    { title: "Inbound WhatsApp replies reach Slack and the pipeline", owner: "Claude", due: "2026-12-10", status: "todo" },
    { title: "Publish the app and connect 98720 09997 by coexistence", owner: "You", due: "2026-12-11", status: "todo", note: "Not through the new-number flow." },
    { title: "Submit template tgl_ai_visibility_first_touch", owner: "Claude", due: "2026-12-11", status: "todo" },
    { title: "Meta approves the template", owner: "Meta", due: "2026-12-13", status: "todo" },
    { title: "Test send to your own number, then approve the first batch", owner: "You", due: "2026-12-14", status: "todo" },
    { title: "First WhatsApp messages go to phone-only businesses", owner: "Claude", due: "2026-12-15", status: "todo" },
  ],
  risks: [
    { kind: "Risk", what: "Meta App Review is slow or rejected", impact: "High", owner: "You", action: "Answers and videos are ready. If Meta asks for changes, we answer the same day. If not approved by 10 Dec, the go-live date moves.", status: "Open" },
    { kind: "Risk", what: "Resend's rules do not allow cold email", impact: "Medium", owner: "You", action: "Your decision: stay on Resend. Gmail sending is built and switched off; switching is one Railway setting.", status: "Watching" },
    { kind: "Issue", what: "30 of 35 approved businesses have only a phone number", impact: "Medium", owner: "Claude", action: "No cold calls. Their AI checks run in advance, 5 a day; WhatsApp reaches them once live.", status: "Open" },
    { kind: "Risk", what: "Gemini credits run out", impact: "Medium", owner: "You", action: "Rs 500 prepaid on 23 Nov. A failure holds sending and posts one line in alerts.", status: "Watching" },
    { kind: "Risk", what: "98720 09997 entered in the new-number flow would cut it off the WhatsApp app", impact: "High", owner: "You", action: "Connect only by coexistence, step by step with Claude.", status: "Open" },
    { kind: "Risk", what: "GitHub token expires in Nov 2027", impact: "Low", owner: "You", action: "Set a reminder a week before expiry.", status: "Watching" },
  ],
  decisions: [
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
    { key: "whatsapp", name: "WhatsApp", job: "First message and replies for phone-only businesses", when: "From 15 Dec", live: false },
  ],
};
