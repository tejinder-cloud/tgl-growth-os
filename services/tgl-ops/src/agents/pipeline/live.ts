// services/tgl-ops/src/agents/pipeline/live.ts
// Real wiring: Supabase deals, #revenue cards, Finance for won deals in rupees.
import { postLine, resolveChannelId } from "../../lib/post.js";
import { createPipeline, type Pipeline } from "./service.js";
import { afterCallBlocks, who, type SlackPorts } from "./slack.js";
import { money, type Currency, type Deal } from "./stages.js";
import { createSupabaseDealStore, type DealStore } from "./store.js";

export function revenueChannel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SALES_DESK_CHANNEL_ID || "#revenue").trim();
}

/** Won in rupees: Finance drafts the GST invoice (or says what it is missing). Won in dollars: an export, manual. */
export async function wonToFinance(d: Deal): Promise<string> {
  const amount = Number(d.amount);
  if ((d.currency || "INR") === "USD") {
    return `Export invoice in US dollars is manual for now: it needs a valid LUT for the financial year and the buyer's details. Finance has not drafted anything.`;
  }
  const { financeDealWon } = await import("../../routes/finance.js");
  const out = await financeDealWon({
    dealId: `pipeline:${d.id}`,
    dealName: `${d.company} retainer`,
    amountInr: amount,
    product: "services",
    wonAt: new Date().toISOString(),
    buyer: { name: d.contact_name || "", company: d.company, email: d.contact_email || undefined, country: "India" },
  });
  switch (out.status) {
    case "created": return `Finance drafted invoice ${out.number}.`;
    case "dry_run": return `Finance prepared invoice ${out.invoice.number} as a dry run (FINANCE_LIVE is off).`;
    case "duplicate": return `Finance already has invoice ${out.number} for this deal.`;
    case "held": return `Finance held the invoice: ${out.reasons.join("; ")}.`;
    case "skipped": return `Finance skipped it: ${out.reason}.`;
    default: return `Finance could not draft the invoice: ${(out as any).error || "unknown error"}.`;
  }
}

let store: DealStore | null = null;
let pipeline: Pipeline | null = null;

export function dealStore(): DealStore {
  if (!store) store = createSupabaseDealStore();
  return store;
}

export function livePipeline(): Pipeline {
  if (!pipeline) {
    pipeline = createPipeline({
      store: dealStore(),
      now: () => new Date(),
      notify: async (text) => {
        await postLine({ channel: revenueChannel(), text });
      },
      askAfterCall: async (d) => {
        const { slackClient } = await import("../../lib/slack-client.js");
        const channel = await resolveChannelId(revenueChannel());
        await slackClient.chat.postMessage({ channel, text: `Call with ${who(d)} should be over. How did it go?`, blocks: afterCallBlocks(d) as any, unfurl_links: false });
      },
      onWon: wonToFinance,
    });
  }
  return pipeline;
}

export async function liveSlackPorts(): Promise<SlackPorts> {
  const { slackClient, openModal, getActorDisplayName } = await import("../../lib/slack-client.js");
  const { isArchitectUser } = await import("../../lib/org.js");
  return {
    pipeline: livePipeline(),
    getDeal: (id) => dealStore().get(id),
    isArchitect: (u) => isArchitectUser(u),
    actorName: (u) => getActorDisplayName(u),
    updateMessage: async (channel, ts, text, blocks) => {
      await slackClient.chat.update({ channel, ts, text, blocks: blocks as any });
    },
    postThread: async (channel, ts, text) => {
      await slackClient.chat.postMessage({ channel, thread_ts: ts, text, unfurl_links: false, unfurl_media: false });
    },
    openModal: (triggerId, view) => openModal(triggerId, view as any),
  };
}

/** Pipeline signals must never break the thing that sent them: errors are logged, never thrown. */
export async function safely(label: string, fn: (p: Pipeline) => Promise<unknown>): Promise<void> {
  if (process.env.TGL_TEST_MODE === "1") return;
  try {
    await fn(livePipeline());
  } catch (err) {
    console.warn(`[Pipeline] ${label} not recorded: ${(err as Error).message}`);
  }
}

export function setPipelineForTests(p: Pipeline | null, s?: DealStore | null): void {
  pipeline = p;
  if (s !== undefined) store = s;
}

export { money, type Currency };
