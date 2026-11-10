// Journey emails (plan Day 31) — one person writing to another (SPEC §6): short, specific, one next step.
// Every number comes from stored answers; when there's none, the line is left out rather than guessed.
import { render, type Email } from "../aeo-reports/email.js";

export type Facts = { brand: string; named: number | null; answers: number | null; topRec: string | null; diy: string[]; note: string | null; thisWeek: { n: number; of: number } | null; lastWeek: { n: number; of: number } | null };
const ratio = (n: number | null, of: number | null) => (n !== null && of ? `named in ${n} of ${of} AI answers` : null);

export function journeyEmail(kind: string, f: Facts, appUrl: string, managedUrl: string): Email | null {
  const base = kind.split(":")[0];
  const footer = `${appUrl}/dashboard/settings#email`;
  const dash = (path = "") => ({ label: "Open your dashboard", url: `${appUrl}/dashboard${path}` });
  const made = (subject: string, blocks: { title?: string; lines: string[] }[], cta: { label: string; url: string }, cta2?: { label: string; url: string }): Email => ({ subject, ...render(blocks.map((b) => ({ ...b, lines: b.lines.filter(Boolean) })), cta, footer, cta2) });
  const so = ratio(f.named, f.answers);
  switch (base) {
    case "finish_setup_24h":
      return made(`Your AI visibility check is two minutes from starting`, [{ lines: [
        `You started setting up TrueVisible yesterday. A few questions are left — your brand, who you sell to and the questions buyers ask AI.`,
        `Once you finish, we check your setup and ask ChatGPT, Gemini and Perplexity those questions. You'll see who they recommend.` ] }], { label: "Finish setup", url: `${appUrl}/onboarding` });
    case "finish_setup_72h":
      return made(`Still want to see what AI says about ${f.brand === "your brand" ? "you" : f.brand}?`, [{ lines: [
        `Your setup is waiting where you left it. When it's done, your trial starts with real answers from ChatGPT, Gemini and Perplexity.`,
        `If something in the setup was unclear, just reply — a person reads every reply.` ] }], { label: "Finish setup", url: `${appUrl}/onboarding` });
    case "needs_changes":
      return made(`One thing to change before your first check`, [{ lines: [
        `We looked at your setup for ${f.brand} and asked for a change before running your first AI check.`,
        f.note ? `Our note: “${f.note}”` : `The details are on your dashboard.`,
        `As soon as you save it, we check again.` ] }], { label: "Update your setup", url: `${appUrl}/dashboard` });
    case "trial_day3":
      return made(`${f.brand}: the first thing to fix`, [
        { lines: [so ? `So far AI has ${so}.` : `Your first answers are in.`, f.topRec ? `If you do one thing this week, make it this:` : `Your recommendations are ready on the dashboard.`] },
        ...(f.topRec ? [{ title: f.topRec, lines: [`It comes with a ready-to-use draft — copy it or download it.`] }] : []),
      ], dash("/recommendations"));
    case "trial_day5":
      return made(`Two days left in your trial`, [
        { lines: [so ? `${f.brand} has been ${so} this week.` : `Your trial has two days to go.`, `On day 7 you'll get your baseline: who AI names instead of you, and three fixes to start with. After that, checks pause — your dashboard stays.`] },
        { title: "Two ways to keep going", lines: [`Track — we keep asking the AIs every week and show what changes.`, `Managed — our team does the fixes for you and shows every change.`] },
      ], { label: "See the options", url: `${appUrl}/dashboard/upgrade` });
    case "trial_ended_3d":
      return made(`Your AI checks are paused`, [{ lines: [
        so ? `In your trial, ${f.brand} was ${so}.` : `Your trial results are still on your dashboard.`,
        `Answers change week to week. Track keeps checking and shows when you start being named — or when a competitor takes your place.` ] }], { label: "Keep tracking", url: `${appUrl}/dashboard/upgrade/track` }, { label: "Have us do it", url: managedUrl });
    case "trial_ended_14d":
      return made(`Can we ask what stopped you?`, [{ lines: [
        `You tried TrueVisible for ${f.brand} a couple of weeks ago and didn't continue. That's fine — we'd just like to know why.`,
        `Too expensive, not useful, wrong timing, something broken? One line in reply helps us more than you'd think.` ] }], dash());
    case "inactive": {
      const tw = f.thisWeek, lw = f.lastWeek;
      return made(`What changed for ${f.brand} while you were away`, [{ lines: [
        tw ? `Last 7 days: named in ${tw.n} of ${tw.of} AI answers${lw ? ` (the week before: ${lw.n} of ${lw.of})` : ""}.` : `Your weekly checks have kept running.`,
        f.topRec ? `Top thing to do next: ${f.topRec}.` : ``,
        `It takes two minutes to see who AI names instead of you.` ] }], dash());
    }
    case "managed_offer":
      return made(`Want us to do these for you?`, [
        { lines: [`You picked these to do yourself a while ago, and they're still open:`] },
        { lines: f.diy.slice(0, 3).map((t) => `• ${t}`) },
        { lines: [`With Managed, our team does them — pages on your site, listings and outreach — and shows each change on your dashboard.`] },
      ], { label: "Have us do it", url: managedUrl }, { label: "Do them myself", url: `${appUrl}/dashboard/recommendations` });
    default:
      return null;
  }
}
