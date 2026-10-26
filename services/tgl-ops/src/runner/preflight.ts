export interface PreflightResult {
  passed: boolean;
  reason?: string;
  questions?: string[];
}

export interface IssueBriefContext {
  issueNumber: number;
  title: string;
  body: string;
  deliverable: string;
  agentName: string;
}

/**
 * Checks the issue brief against SKILL.md "Never" section, Mandate 2 (challenge the brief),
 * and v1 protected paths before any branch creation or tool calls.
 */
export function runPreflightCheck(context: IssueBriefContext): PreflightResult {
  const { title, deliverable, body, agentName } = context;
  const fullText = `${title}\n${deliverable}\n${body}`.toLowerCase();

  // 1. Protected paths refusal in v1 (services/ and .github/ are read-only)
  const servicesRegex = /(?:modify|edit|update|change|write|create|delete)\s+(?:in\s+|to\s+)?(?:services\/|\.github\/)/i;
  const directPathRegex = /(?:services\/[a-z0-9_\-\/.]+|\.github\/[a-z0-9_\-\/.]+)/i;
  if (servicesRegex.test(fullText) || (directPathRegex.test(deliverable) && !deliverable.includes("README.md"))) {
    return {
      passed: false,
      reason: "Refusal: Files under services/ and .github/ are read-only for this runner in v1 (docs, site/, agents/, config only).",
      questions: [
        "1. The brief requests modifications inside protected paths (services/ or .github/), which are read-only in v1. Can this task be scoped strictly to docs, site/, agents/, or config?",
        "2. If service infrastructure changes are required, can this be escalated directly to the Architect for manual review?",
      ],
    };
  }

  // 2. SKILL.md "Never" Guardrails
  // a. Never publish to live / touch DNS / prod deploy
  if (
    /\b(publish to live|deploy to prod|change dns|live site publish)\b/i.test(fullText)
  ) {
    return {
      passed: false,
      reason: "SKILL.md Never violation: Never publish or change a live page status directly.",
      questions: [
        "1. The task asks for live deployment. Web Builder builds strictly on staging or draft. Can we deliver to a staging/draft branch instead?",
        "2. Will the Architect deploy after review per AGENTS.md workflow?",
      ],
    };
  }

  // b. Never change positioning copy or pricing without Architect approval
  if (
    /\b(change (?:the )?(?:pricing|prices|fee|rates|positioning))\b/i.test(fullText)
  ) {
    return {
      passed: false,
      reason: "SKILL.md Never violation: Never change positioning copy or pricing without prior Architect approval.",
      questions: [
        "1. The task requests pricing or positioning modifications. What is the approved decision reference in decisions/?",
        "2. Can the exact approved figures and copy claims be provided?",
      ],
    };
  }

  // c. Never add plugins or external scripts
  if (
    /\b(install (?:a )?plugin|add (?:an )?external script|embed script tag)\b/i.test(fullText)
  ) {
    return {
      passed: false,
      reason: "SKILL.md Never violation: Never add plugins, font files, or external scripts.",
      questions: [
        "1. External scripts and plugins are forbidden by brand and craft standards. Can this be implemented using native theme tokens or GTM?",
      ],
    };
  }

  // 3. Mandate 2: Vagueness / Underspecified Brief
  const trimmedDeliverable = deliverable.trim();
  const vaguePatterns = [
    /^fix stuff$/i,
    /^make it better$/i,
    /^do work$/i,
    /^update website$/i,
    /^help with site$/i,
    /^please check$/i,
    /^improve ui$/i,
  ];

  const isVague =
    trimmedDeliverable.length < 15 ||
    vaguePatterns.some((p) => p.test(trimmedDeliverable));

  if (isVague) {
    return {
      passed: false,
      reason: "Mandate 2 pushback: The brief is vague or lacks a concrete deliverable and file target.",
      questions: [
        "1. What exact file(s) or WordPress template should be modified for this task?",
        "2. What is the precise deliverable and expected user-visible outcome?",
        "3. Are there specific copy, tokens, or references from BRAND-BRIEF.md or ORG.md to follow?",
      ],
    };
  }

  return { passed: true };
}
