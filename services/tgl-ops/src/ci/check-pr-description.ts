import fs from "fs";

export interface PrLinkingCheckResult {
  valid: boolean;
  errors: string[];
  matches: Array<{
    keyword: string;
    issueNumber: number;
    rawMatch: string;
  }>;
}

const CLOSING_KEYWORD_REGEX = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s*#(\d+)\b/gi;

/**
 * Validates that PR descriptions do not use closing keywords (fixes/closes/resolves #N)
 * unless the PR branch is task/N-* (or task/N).
 */
export function verifyPrDescriptionIssueLinking(
  prBody: string | null | undefined,
  headBranch: string | null | undefined
): PrLinkingCheckResult {
  const body = prBody || "";
  const branch = (headBranch || "").trim();
  const errors: string[] = [];
  const matches: Array<{ keyword: string; issueNumber: number; rawMatch: string }> = [];

  // Reset regex state
  CLOSING_KEYWORD_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CLOSING_KEYWORD_REGEX.exec(body)) !== null) {
    const rawMatch = match[0];
    const keyword = match[1];
    const issueNum = parseInt(match[2], 10);
    matches.push({ keyword, issueNumber: issueNum, rawMatch });

    // Branch must be task/${issueNum} or start with task/${issueNum}-
    const allowedPrefix = `task/${issueNum}-`;
    const exactMatch = `task/${issueNum}`;
    const isAllowed = branch === exactMatch || branch.startsWith(allowedPrefix);

    if (!isAllowed) {
      errors.push(
        `PR description contains "${rawMatch}", which would close issue #${issueNum}. Only task branches (task/${issueNum} or task/${issueNum}-*) may close issues. Current branch: "${branch}". Use "Relates to #${issueNum}" or remove the closing keyword.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    matches,
  };
}

export function runCli(): void {
  let prBody = process.env.PR_BODY;
  let headBranch = process.env.PR_HEAD_REF || process.env.GITHUB_HEAD_REF;

  // If GITHUB_EVENT_PATH is available, read from GitHub event payload
  if (process.env.GITHUB_EVENT_PATH && fs.existsSync(process.env.GITHUB_EVENT_PATH)) {
    try {
      const eventData = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      if (eventData.pull_request) {
        if (prBody === undefined) {
          prBody = eventData.pull_request.body || "";
        }
        if (!headBranch) {
          headBranch = eventData.pull_request.head?.ref || "";
        }
      }
    } catch (err) {
      console.warn("[check-pr-description] Could not read GITHUB_EVENT_PATH:", err);
    }
  }

  // Parse command line arguments if provided: --body "..." --branch "..."
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--body" && args[i + 1] !== undefined) {
      prBody = args[i + 1];
      i++;
    } else if (args[i] === "--branch" && args[i + 1] !== undefined) {
      headBranch = args[i + 1];
      i++;
    }
  }

  // If not running in a pull request context, skip with exit code 0
  if (prBody === undefined && !headBranch) {
    console.log("[check-pr-description] No PR context detected. Skipping check.");
    process.exit(0);
  }

  console.log(`[check-pr-description] Checking PR on branch: "${headBranch || ""}"`);
  const result = verifyPrDescriptionIssueLinking(prBody, headBranch);

  if (result.matches.length > 0) {
    console.log(`[check-pr-description] Found ${result.matches.length} closing reference(s):`);
    for (const m of result.matches) {
      console.log(`  - ${m.rawMatch}`);
    }
  } else {
    console.log("[check-pr-description] No issue-closing keywords found in PR description.");
  }

  if (!result.valid) {
    console.error("\n[check-pr-description] FAILED: PR issue linking check failed:");
    for (const err of result.errors) {
      console.error(`  ERROR: ${err}`);
    }
    process.exit(1);
  }

  console.log("[check-pr-description] PASSED: PR issue linking check succeeded.");
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("check-pr-description.ts")) {
  runCli();
}
