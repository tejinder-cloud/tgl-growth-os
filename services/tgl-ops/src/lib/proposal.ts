import { config, isTestMode } from "../config.js";
import { createIssue, addLabelsToIssue } from "./github-client.js";
import { postCard } from "./post.js";
import { findAgentByName } from "./agents.js";

export interface CreateProposalParams {
  agent: string;
  title: string;
  caseText: string;
  costEstimate: string;
  whatItWouldChange: string;
  door?: string;
  testMode?: boolean;
}

export interface ProposalIssueResult {
  number: number;
  url: string;
  title: string;
  cardTs?: string;
}

/**
 * Opens an issue labelled `type:proposal` with structured body:
 * - One-paragraph case
 * - Cost estimate
 * - What it would change
 * Also posts a review card to #approvals (or #ops in test mode).
 */
export async function createProposalIssue(params: CreateProposalParams): Promise<ProposalIssueResult> {
  const {
    agent,
    title,
    caseText,
    costEstimate,
    whatItWouldChange,
    door = "core",
    testMode = isTestMode(),
  } = params;

  const agentRecord = await findAgentByName(agent);
  const resolvedAgent = agentRecord?.name || agent;

  const body = `### Case
${caseText.trim()}

### Cost Estimate
${costEstimate.trim()}

### What It Would Change
${whatItWouldChange.trim()}

### Metadata
- **Proposed By:** \`@${resolvedAgent}\`
- **Door:** \`${door}\`
`;

  const labels = ["type:proposal", `for:${resolvedAgent}`, `door:${door}`, "status:in-progress"];

  const issueRes = await createIssue({
    title: `[PROPOSAL]: ${title.replace(/^\[PROPOSAL\]:\s*/i, "")}`,
    body,
    labels,
  });

  // Post approval card to #approvals (or #ops in test mode)
  const targetChannel = testMode ? (config.opsChannelId || "#ops") : config.approvalsChannelId;
  const cardSummary = `*Case:* ${caseText.trim()}\n*Cost:* ${costEstimate.trim()}\n*Changes:* ${whatItWouldChange.trim()}`;

  const cardRes = await postCard({
    channel: targetChannel,
    agent: resolvedAgent,
    door,
    title: `Proposal: ${title.replace(/^\[PROPOSAL\]:\s*/i, "")}`,
    summary: cardSummary,
    issue: issueRes.number,
    actions: ["approve", "reject", "discuss"],
    extraMeta: {
      type: "proposal",
      brief: caseText,
      costEstimate,
      whatItWouldChange,
    },
  });

  return {
    number: issueRes.number,
    url: issueRes.html_url,
    title: `[PROPOSAL]: ${title.replace(/^\[PROPOSAL\]:\s*/i, "")}`,
    cardTs: cardRes.ts,
  };
}

