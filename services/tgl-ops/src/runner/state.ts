import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config, isTestMode } from "../config.js";
import { octokit } from "../lib/github-client.js";
import { getSupabase } from "../agents/prospect-researcher/db.js";

/**
 * Random instance identifier assigned to each container at boot.
 * Unique per container process to coordinate distributed atomic locks.
 */
export const CONTAINER_INSTANCE_ID = `inst_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

export interface RunnerRecord {
  agent: string;
  door?: string;
  title: string;
  status: "in-progress" | "completed" | "failed" | "needs-brief" | "blocked" | "interrupted";
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  runStartedAt: string;
  runCompletedAt?: string;
  error?: string;
  recoveryAttempts?: number;
  lastRecoveryAt?: string;
  lastRecoveryAlertAt?: string;
  ownerInstance?: string | null;
  heartbeatAt?: string | null;
  toolCallsCount?: number;
  preflightHash?: string;
  preflightVerdict?: string;
  preflightReason?: string;
  lastModelMessage?: string;
}

export interface RunnerState {
  version: number;
  updatedAt: string;
  runs: Record<string, RunnerRecord>;
}

export interface RunnerStateDbRow {
  issue_number: number;
  status: string;
  owner_instance: string | null;
  heartbeat_at: string | null;
  recovery_attempts: number;
  last_alert_at: string | null;
  updated_at: string;
  agent?: string | null;
  door?: string | null;
  title?: string | null;
  branch?: string | null;
  pr_number?: number | null;
  pr_url?: string | null;
  run_started_at?: string | null;
  run_completed_at?: string | null;
  last_recovery_at?: string | null;
  error?: string | null;
  tool_calls_count?: number | null;
  preflight_hash?: string | null;
  preflight_verdict?: string | null;
  preflight_reason?: string | null;
  last_model_message?: string | null;
}

const RUNNER_STATE_PATH = "logs/.state/runner.json";

function getLocalStatePath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, "logs/.test/.state", "runner.json");
  }
  return path.join(config.repoRoot, RUNNER_STATE_PATH);
}

// In-memory table for test mode simulation across instances
const mockRunnerStateDb = new Map<number, RunnerStateDbRow>();

export function clearMockRunnerStateDbForTests(): void {
  mockRunnerStateDb.clear();
}

export function setMockRunnerStateDbForTests(rows: RunnerStateDbRow[]): void {
  mockRunnerStateDb.clear();
  for (const r of rows) {
    mockRunnerStateDb.set(r.issue_number, { ...r });
  }
}

export function getMockRunnerStateDbForTests(): Map<number, RunnerStateDbRow> {
  return mockRunnerStateDb;
}

/**
 * Writes logs/.state/runner.json as a mirror.
 * CRITICAL MANDATE: This mirror is written AFTER the table, and is READ BY NOTHING.
 */
async function syncMirrorFile(
  state: RunnerState,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  state.updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(state, null, 2);

  if (isTest) {
    try {
      const localPath = getLocalStatePath(true);
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(localPath, serialized, "utf8");
    } catch {}
    return;
  }

  // Local sync
  try {
    const localPath = getLocalStatePath(false);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localPath, serialized, "utf8");
  } catch (err) {
    console.warn("[RunnerState Mirror] Local sync warning:", err);
  }

  // GitHub sync (fire-and-forget mirror, failures do not block database state)
  if (!config.githubToken) return;

  try {
    let sha: string | undefined;
    try {
      const getRes = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: RUNNER_STATE_PATH,
        ref: "main",
      });
      if (!Array.isArray(getRes.data) && getRes.data.type === "file") {
        sha = getRes.data.sha;
      }
    } catch (err: any) {
      if (err.status !== 404) return;
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: RUNNER_STATE_PATH,
      message: `chore(state): update runner state mirror [${state.updatedAt}]`,
      content: Buffer.from(serialized, "utf8").toString("base64"),
      branch: "main",
      sha,
    });
  } catch (err: any) {
    console.warn("[RunnerState Mirror] GitHub commit warning (mirror only):", err.message);
  }
}

/**
 * Helper to transform DB rows into RunnerState structure.
 */
function rowsToRunnerState(rows: RunnerStateDbRow[]): RunnerState {
  const runs: Record<string, RunnerRecord> = {};
  for (const row of rows) {
    runs[String(row.issue_number)] = {
      agent: row.agent || "web-builder",
      door: row.door || undefined,
      title: row.title || `Issue #${row.issue_number}`,
      status: (row.status as any) || "in-progress",
      branch: row.branch || undefined,
      prNumber: row.pr_number || undefined,
      prUrl: row.pr_url || undefined,
      runStartedAt: row.run_started_at || row.updated_at,
      runCompletedAt: row.run_completed_at || undefined,
      error: row.error || undefined,
      recoveryAttempts: row.recovery_attempts ?? 0,
      lastRecoveryAt: row.last_recovery_at || undefined,
      lastRecoveryAlertAt: row.last_alert_at || undefined,
      ownerInstance: row.owner_instance,
      heartbeatAt: row.heartbeat_at,
      toolCallsCount: row.tool_calls_count ?? undefined,
      preflightHash: row.preflight_hash || undefined,
      preflightVerdict: row.preflight_verdict || undefined,
      preflightReason: row.preflight_reason || undefined,
      lastModelMessage: row.last_model_message || undefined,
    };
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs,
  };
}

/**
 * Reads runner state strictly from Supabase table public.runner_state.
 * In test mode or when Supabase is not configured, reads from mockRunnerStateDb.
 * READ BY NOTHING from logs/.state/runner.json.
 */
export async function getRunnerState(options?: { testMode?: boolean }): Promise<RunnerState> {
  const isTest = options?.testMode === true || isTestMode();
  const sb = !isTest ? getSupabase() : null;

  if (sb && !isTest) {
    try {
      const { data, error } = await sb
        .from("runner_state")
        .select("*");

      if (error) {
        console.warn("[RunnerState Supabase] Query error, falling back to empty:", error.message);
        return { version: 1, updatedAt: new Date().toISOString(), runs: {} };
      }

      if (Array.isArray(data)) {
        return rowsToRunnerState(data as RunnerStateDbRow[]);
      }
    } catch (err: any) {
      console.warn("[RunnerState Supabase] Exception:", err.message);
    }
  }

  // Test mode or local mock
  const rows = Array.from(mockRunnerStateDb.values());
  return rowsToRunnerState(rows);
}

/**
 * Saves runner state into public.runner_state table and updates mirror.
 */
export async function saveRunnerState(
  state: RunnerState,
  options?: { testMode?: boolean }
): Promise<boolean> {
  const isTest = options?.testMode === true || isTestMode();
  const sb = !isTest ? getSupabase() : null;
  const nowIso = new Date().toISOString();

  const rows: RunnerStateDbRow[] = Object.entries(state.runs).map(([key, record]) => ({
    issue_number: Number(key),
    status: record.status,
    owner_instance: record.ownerInstance ?? null,
    heartbeat_at: record.heartbeatAt ?? null,
    recovery_attempts: record.recoveryAttempts ?? 0,
    last_alert_at: record.lastRecoveryAlertAt ?? null,
    updated_at: nowIso,
    agent: record.agent || null,
    door: record.door || null,
    title: record.title || null,
    branch: record.branch || null,
    pr_number: record.prNumber || null,
    pr_url: record.prUrl || null,
    run_started_at: record.runStartedAt || null,
    run_completed_at: record.runCompletedAt || null,
    last_recovery_at: record.lastRecoveryAt || null,
    error: record.error || null,
    tool_calls_count: record.toolCallsCount ?? null,
    preflight_hash: record.preflightHash || null,
    preflight_verdict: record.preflightVerdict || null,
    preflight_reason: record.preflightReason || null,
    last_model_message: record.lastModelMessage || null,
  }));

  if (sb && !isTest) {
    try {
      for (const row of rows) {
        await sb.from("runner_state").upsert(row, { onConflict: "issue_number" });
      }
    } catch (err: any) {
      console.warn("[RunnerState Supabase] Upsert error:", err.message);
    }
  }

  // Update in-memory mock
  for (const row of rows) {
    mockRunnerStateDb.set(row.issue_number, { ...row });
  }

  // Write mirror after table
  await syncMirrorFile(state, { testMode: isTest });
  return true;
}

/**
 * Atomically claims an issue for an instance (start, resume, recovery).
 * One atomic UPDATE ... WHERE owner_instance IS NULL OR heartbeat_at < now() - interval '3 minutes' OR owner_instance = :instanceId.
 * A claim that affects 0 rows means another instance owns it, and this instance does nothing and alerts nothing.
 */
export async function claimRunnerIssue(
  issueNumber: number,
  params?: Partial<RunnerRecord>,
  options?: { instanceId?: string; testMode?: boolean }
): Promise<boolean> {
  const isTest = options?.testMode === true || isTestMode();
  const instanceId = options?.instanceId || CONTAINER_INSTANCE_ID;
  const now = new Date();
  const nowIso = now.toISOString();
  const threeMinutesAgoMs = now.getTime() - 3 * 60 * 1000;
  const threeMinutesAgoIso = new Date(threeMinutesAgoMs).toISOString();

  const sb = !isTest ? getSupabase() : null;

  if (sb && !isTest) {
    try {
      // 1. Try atomic database function if exists
      const { data: rpcClaimed, error: rpcError } = await sb.rpc("claim_runner_issue", {
        p_issue_number: issueNumber,
        p_instance_id: instanceId,
        p_status: params?.status || "in-progress",
        p_agent: params?.agent || null,
        p_door: params?.door || null,
        p_title: params?.title || null,
        p_recovery_attempts: params?.recoveryAttempts ?? null,
      });

      if (!rpcError && typeof rpcClaimed === "boolean") {
        if (rpcClaimed) {
          const fresh = await getRunnerState({ testMode: false });
          syncMirrorFile(fresh, { testMode: false }).catch(() => {});
        }
        return rpcClaimed;
      }

      // 2. Direct atomic fallback via SQL WHERE condition
      try {
        await sb.from("runner_state").insert({
          issue_number: issueNumber,
          status: params?.status || "in-progress",
          owner_instance: instanceId,
          heartbeat_at: nowIso,
          recovery_attempts: params?.recoveryAttempts ?? 0,
          updated_at: nowIso,
          run_started_at: params?.runStartedAt || nowIso,
          agent: params?.agent || null,
          door: params?.door || null,
          title: params?.title || null,
        }).select();
      } catch {}

      const updatePayload: any = {
        owner_instance: instanceId,
        heartbeat_at: nowIso,
        updated_at: nowIso,
      };
      if (params?.status) updatePayload.status = params.status;
      if (params?.agent) updatePayload.agent = params.agent;
      if (params?.door) updatePayload.door = params.door;
      if (params?.title) updatePayload.title = params.title;
      if (params?.branch) updatePayload.branch = params.branch;
      if (params?.recoveryAttempts !== undefined) updatePayload.recovery_attempts = params.recoveryAttempts;
      if (params?.toolCallsCount !== undefined) updatePayload.tool_calls_count = params.toolCallsCount;
      if (params?.preflightHash) updatePayload.preflight_hash = params.preflightHash;
      if (params?.preflightVerdict) updatePayload.preflight_verdict = params.preflightVerdict;
      if (params?.preflightReason) updatePayload.preflight_reason = params.preflightReason;

      const { data, error } = await sb
        .from("runner_state")
        .update(updatePayload)
        .eq("issue_number", issueNumber)
        .or(`owner_instance.is.null,heartbeat_at.lt.${threeMinutesAgoIso},owner_instance.eq.${instanceId}`)
        .select();

      const claimed = !error && Array.isArray(data) && data.length > 0;
      if (claimed) {
        const fresh = await getRunnerState({ testMode: false });
        syncMirrorFile(fresh, { testMode: false }).catch(() => {});
      }
      return claimed;
    } catch (err: any) {
      console.warn("[RunnerState Claim] Supabase claim error:", err.message);
      return false;
    }
  }

  // In-memory atomic claim logic for test mode & mocks
  let row = mockRunnerStateDb.get(issueNumber);
  if (!row) {
    // Unclaimed new issue: create row and acquire claim
    const newRow: RunnerStateDbRow = {
      issue_number: issueNumber,
      status: params?.status || "in-progress",
      owner_instance: instanceId,
      heartbeat_at: nowIso,
      recovery_attempts: params?.recoveryAttempts ?? 0,
      last_alert_at: params?.lastRecoveryAlertAt || null,
      updated_at: nowIso,
      agent: params?.agent || "web-builder",
      door: params?.door || "core",
      title: params?.title || `Issue #${issueNumber}`,
      run_started_at: params?.runStartedAt || nowIso,
      error: params?.error || null,
    };
    mockRunnerStateDb.set(issueNumber, newRow);
    const state = rowsToRunnerState(Array.from(mockRunnerStateDb.values()));
    syncMirrorFile(state, { testMode: true }).catch(() => {});
    return true;
  }

  // Atomic check: owner_instance IS NULL OR heartbeat_at < now() - 3 mins OR owner_instance = instanceId
  const isUnowned = !row.owner_instance;
  const isSelf = row.owner_instance === instanceId;
  const heartbeatMs = row.heartbeat_at ? new Date(row.heartbeat_at).getTime() : 0;
  const isTimedOut = heartbeatMs === 0 || heartbeatMs < threeMinutesAgoMs;

  if (isUnowned || isSelf || isTimedOut) {
    row.owner_instance = instanceId;
    row.heartbeat_at = nowIso;
    row.updated_at = nowIso;
    if (params?.status) row.status = params.status;
    if (params?.agent) row.agent = params.agent;
    if (params?.door) row.door = params.door;
    if (params?.title) row.title = params.title;
    if (params?.branch) row.branch = params.branch;
    if (params?.recoveryAttempts !== undefined) row.recovery_attempts = params.recoveryAttempts;
    if (params?.lastRecoveryAlertAt) row.last_alert_at = params.lastRecoveryAlertAt;
    if (params?.toolCallsCount !== undefined) row.tool_calls_count = params.toolCallsCount;
    if (params?.preflightHash) row.preflight_hash = params.preflightHash;
    if (params?.preflightVerdict) row.preflight_verdict = params.preflightVerdict;
    if (params?.preflightReason) row.preflight_reason = params.preflightReason;

    const state = rowsToRunnerState(Array.from(mockRunnerStateDb.values()));
    syncMirrorFile(state, { testMode: true }).catch(() => {});
    return true;
  }

  // 0 rows affected: owned by another live instance
  return false;
}

/**
 * Updates the 30-second heartbeat while a run is active on this instance.
 */
export async function updateRunnerHeartbeat(
  issueNumber: number,
  instanceId?: string,
  options?: { testMode?: boolean }
): Promise<boolean> {
  const isTest = options?.testMode === true || isTestMode();
  const instId = instanceId || CONTAINER_INSTANCE_ID;
  const nowIso = new Date().toISOString();
  const sb = !isTest ? getSupabase() : null;

  if (sb && !isTest) {
    try {
      const { data, error } = await sb
        .from("runner_state")
        .update({ heartbeat_at: nowIso, updated_at: nowIso })
        .eq("issue_number", issueNumber)
        .eq("owner_instance", instId)
        .select();

      return !error && Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  }

  const row = mockRunnerStateDb.get(issueNumber);
  if (row && row.owner_instance === instId) {
    row.heartbeat_at = nowIso;
    row.updated_at = nowIso;
    return true;
  }
  return false;
}

/**
 * Releases the instance claim on an issue (SIGTERM, run completion, or failure).
 * Sets owner_instance = NULL and heartbeat_at = NULL.
 */
export async function releaseRunnerClaim(
  issueNumber: number,
  instanceId?: string,
  updates?: Partial<RunnerRecord>,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  const instId = instanceId || CONTAINER_INSTANCE_ID;
  const nowIso = new Date().toISOString();
  const sb = !isTest ? getSupabase() : null;

  const row = mockRunnerStateDb.get(issueNumber);

  let targetStatus = updates?.status;
  if (targetStatus === "completed") {
    // Completed is set ONLY when a PR exists for the issue (or specialized agent like prospect-researcher)
    const hasPr = Boolean(updates?.prNumber || (row && row.pr_number));
    const isDbAgent = updates?.agent === "prospect-researcher" || (row && row.agent === "prospect-researcher");
    if (!hasPr && !isDbAgent) {
      console.warn(
        `[RunnerState Invariant Gate] Cannot set status='completed' for issue #${issueNumber} without a PR. Retaining status='in-progress'.`
      );
      targetStatus = "in-progress";
    }
  }

  const payload: any = {
    owner_instance: null,
    heartbeat_at: null,
    updated_at: nowIso,
  };
  if (targetStatus) payload.status = targetStatus;
  if (updates?.error) payload.error = updates.error;
  if (updates?.runCompletedAt) payload.run_completed_at = updates.runCompletedAt;
  if (updates?.recoveryAttempts !== undefined) payload.recovery_attempts = updates.recoveryAttempts;
  if (updates?.lastRecoveryAt) payload.last_recovery_at = updates.lastRecoveryAt;
  if (updates?.lastRecoveryAlertAt) payload.last_alert_at = updates.lastRecoveryAlertAt;
  if (updates?.branch) payload.branch = updates.branch;
  if (updates?.prNumber !== undefined) payload.pr_number = updates.prNumber;
  if (updates?.prUrl) payload.pr_url = updates.prUrl;
  if (updates?.toolCallsCount !== undefined) payload.tool_calls_count = updates.toolCallsCount;
  if (updates?.preflightHash) payload.preflight_hash = updates.preflightHash;
  if (updates?.preflightVerdict) payload.preflight_verdict = updates.preflightVerdict;
  if (updates?.preflightReason) payload.preflight_reason = updates.preflightReason;
  if (updates?.lastModelMessage) payload.last_model_message = updates.lastModelMessage;

  if (sb && !isTest) {
    try {
      let query = sb.from("runner_state").update(payload).eq("issue_number", issueNumber);
      if (instId) {
        query = query.or(`owner_instance.eq.${instId},owner_instance.is.null`);
      }
      await query;
      const fresh = await getRunnerState({ testMode: false });
      syncMirrorFile(fresh, { testMode: false }).catch(() => {});
    } catch (err: any) {
      console.warn("[RunnerState Release] Supabase release error:", err.message);
    }
  }

  if (row) {
    row.owner_instance = null;
    row.heartbeat_at = null;
    row.updated_at = nowIso;
    if (targetStatus) row.status = targetStatus;
    if (updates?.error) row.error = updates.error;
    if (updates?.runCompletedAt) row.run_completed_at = updates.runCompletedAt;
    if (updates?.recoveryAttempts !== undefined) row.recovery_attempts = updates.recoveryAttempts;
    if (updates?.lastRecoveryAt) row.last_recovery_at = updates.lastRecoveryAt;
    if (updates?.lastRecoveryAlertAt) row.last_alert_at = updates.lastRecoveryAlertAt;
    if (updates?.branch) row.branch = updates.branch;
    if (updates?.prNumber !== undefined) row.pr_number = updates.prNumber;
    if (updates?.prUrl) row.pr_url = updates.prUrl;
    if (updates?.toolCallsCount !== undefined) row.tool_calls_count = updates.toolCallsCount;
    if (updates?.preflightHash) row.preflight_hash = updates.preflightHash;
    if (updates?.preflightVerdict) row.preflight_verdict = updates.preflightVerdict;
    if (updates?.preflightReason) row.preflight_reason = updates.preflightReason;
    if (updates?.lastModelMessage) row.last_model_message = updates.lastModelMessage;

    const state = rowsToRunnerState(Array.from(mockRunnerStateDb.values()));
    syncMirrorFile(state, { testMode: true }).catch(() => {});
  } else {
    mockRunnerStateDb.set(issueNumber, {
      issue_number: issueNumber,
      status: targetStatus || "interrupted",
      owner_instance: null,
      heartbeat_at: null,
      recovery_attempts: updates?.recoveryAttempts || 0,
      updated_at: nowIso,
      agent: updates?.agent || "web-builder",
      door: updates?.door || "core",
      title: updates?.title || `Issue #${issueNumber}`,
      pr_number: updates?.prNumber || null,
      pr_url: updates?.prUrl || null,
      branch: updates?.branch || null,
      error: updates?.error || null,
      last_model_message: updates?.lastModelMessage || null,
    });
    const state = rowsToRunnerState(Array.from(mockRunnerStateDb.values()));
    syncMirrorFile(state, { testMode: true }).catch(() => {});
  }
}

/**
 * Increments recovery_attempts ONLY when a resumed run throws during execution.
 * If attempts >= 2: sets status = 'blocked'.
 */
export async function incrementRecoveryAttempts(
  issueNumber: number,
  errorMsg: string,
  options?: { instanceId?: string; testMode?: boolean }
): Promise<{ attempts: number; isBlocked: boolean }> {
  const isTest = options?.testMode === true || isTestMode();
  const instId = options?.instanceId || CONTAINER_INSTANCE_ID;
  const nowIso = new Date().toISOString();
  const state = await getRunnerState({ testMode: isTest });
  const existing = state.runs[String(issueNumber)];
  const attempts = (existing?.recoveryAttempts || 0) + 1;
  const isBlocked = attempts >= 2;

  const updates: Partial<RunnerRecord> = {
    status: isBlocked ? "blocked" : "failed",
    recoveryAttempts: attempts,
    error: errorMsg,
    runCompletedAt: nowIso,
  };

  await releaseRunnerClaim(issueNumber, instId, updates, { testMode: isTest });
  return { attempts, isBlocked };
}

/**
 * Atomically claims an alert slot for an issue.
 * Max 1 alert per issue per hour (3,600,000 ms).
 */
export async function claimAlertSlot(
  issueNumber: number,
  options?: { testMode?: boolean }
): Promise<boolean> {
  const isTest = options?.testMode === true || isTestMode();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const oneHourAgoMs = now - 60 * 60 * 1000;
  const oneHourAgoIso = new Date(oneHourAgoMs).toISOString();

  const sb = !isTest ? getSupabase() : null;

  if (sb && !isTest) {
    try {
      const { data, error } = await sb
        .from("runner_state")
        .update({ last_alert_at: nowIso, updated_at: nowIso })
        .eq("issue_number", issueNumber)
        .or(`last_alert_at.is.null,last_alert_at.lt.${oneHourAgoIso}`)
        .select();

      const claimed = !error && Array.isArray(data) && data.length > 0;
      if (claimed) {
        const fresh = await getRunnerState({ testMode: false });
        syncMirrorFile(fresh, { testMode: false }).catch(() => {});
      }
      return claimed;
    } catch {
      return false;
    }
  }

  const row = mockRunnerStateDb.get(issueNumber);
  if (!row) {
    mockRunnerStateDb.set(issueNumber, {
      issue_number: issueNumber,
      status: "in-progress",
      owner_instance: null,
      heartbeat_at: null,
      recovery_attempts: 0,
      last_alert_at: nowIso,
      updated_at: nowIso,
    });
    return true;
  }

  const lastAlertTs = row.last_alert_at ? new Date(row.last_alert_at).getTime() : 0;
  if (lastAlertTs === 0 || now - lastAlertTs >= 60 * 60 * 1000) {
    row.last_alert_at = nowIso;
    row.updated_at = nowIso;
    const s = rowsToRunnerState(Array.from(mockRunnerStateDb.values()));
    syncMirrorFile(s, { testMode: true }).catch(() => {});
    return true;
  }

  return false;
}

/**
 * Resets runner issue state for Architect resume (#N: resume).
 * Clears recovery_attempts to 0, sets status in-progress, releases owner claim.
 */
export async function resetRunnerIssue(
  issueNumber: number,
  updates?: Partial<RunnerRecord>,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  const nowIso = new Date().toISOString();
  const sb = !isTest ? getSupabase() : null;

  const rowData: Partial<RunnerStateDbRow> = {
    recovery_attempts: 0,
    status: "in-progress",
    owner_instance: null,
    heartbeat_at: null,
    error: null,
    tool_calls_count: 0,
    updated_at: nowIso,
    agent: updates?.agent || "web-builder",
    door: updates?.door || "core",
    title: updates?.title || `Issue #${issueNumber}`,
  };
  if (updates?.branch) {
    rowData.branch = updates.branch;
  }

  if (sb && !isTest) {
    try {
      await sb.from("runner_state").upsert({
        issue_number: issueNumber,
        ...rowData,
      }, { onConflict: "issue_number" });
      const fresh = await getRunnerState({ testMode: false });
      syncMirrorFile(fresh, { testMode: false }).catch(() => {});
    } catch (err: any) {
      console.warn("[RunnerState Reset] Supabase error:", err.message);
    }
  }

  const existing = mockRunnerStateDb.get(issueNumber);
  mockRunnerStateDb.set(issueNumber, {
    issue_number: issueNumber,
    status: "in-progress",
    owner_instance: null,
    heartbeat_at: null,
    recovery_attempts: 0,
    tool_calls_count: 0,
    branch: updates?.branch || existing?.branch || null,
    last_alert_at: existing?.last_alert_at || null,
    updated_at: nowIso,
    agent: updates?.agent || existing?.agent || "web-builder",
    door: updates?.door || existing?.door || "core",
    title: updates?.title || existing?.title || `Issue #${issueNumber}`,
    error: null,
  });

  const state = rowsToRunnerState(Array.from(mockRunnerStateDb.values()));
  await syncMirrorFile(state, { testMode: true });
}

/**
 * Records or updates an issue run record in runner state and syncs mirror.
 */
export async function recordRunnerIssue(
  issueNumber: number,
  record: Partial<RunnerRecord>,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  const sb = !isTest ? getSupabase() : null;
  const nowIso = new Date().toISOString();

  if (sb && !isTest) {
    try {
      const payload: any = {
        issue_number: issueNumber,
        updated_at: nowIso,
      };
      if (record.status) payload.status = record.status;
      if (record.agent) payload.agent = record.agent;
      if (record.door) payload.door = record.door;
      if (record.title) payload.title = record.title;
      if (record.branch) payload.branch = record.branch;
      if (record.prNumber !== undefined) payload.pr_number = record.prNumber;
      if (record.prUrl) payload.pr_url = record.prUrl;
      if (record.runStartedAt) payload.run_started_at = record.runStartedAt;
      if (record.runCompletedAt) payload.run_completed_at = record.runCompletedAt;
      if (record.error !== undefined) payload.error = record.error;
      if (record.recoveryAttempts !== undefined) payload.recovery_attempts = record.recoveryAttempts;
      if (record.lastRecoveryAt) payload.last_recovery_at = record.lastRecoveryAt;
      if (record.lastRecoveryAlertAt) payload.last_alert_at = record.lastRecoveryAlertAt;
      if (record.toolCallsCount !== undefined) payload.tool_calls_count = record.toolCallsCount;
      if (record.preflightHash) payload.preflight_hash = record.preflightHash;
      if (record.preflightVerdict) payload.preflight_verdict = record.preflightVerdict;
      if (record.preflightReason) payload.preflight_reason = record.preflightReason;
      if (record.lastModelMessage) payload.last_model_message = record.lastModelMessage;

      await sb.from("runner_state").upsert(payload, { onConflict: "issue_number" });
      const fresh = await getRunnerState({ testMode: false });
      syncMirrorFile(fresh, { testMode: false }).catch(() => {});
    } catch (err: any) {
      console.warn("[RunnerState Record] Supabase upsert error:", err.message);
    }
  }

  // Update mock DB
  const existing = mockRunnerStateDb.get(issueNumber) || {
    issue_number: issueNumber,
    status: record.status || "in-progress",
    owner_instance: null,
    heartbeat_at: null,
    recovery_attempts: record.recoveryAttempts ?? 0,
    last_alert_at: record.lastRecoveryAlertAt || null,
    updated_at: nowIso,
    agent: record.agent || "web-builder",
    door: record.door || "core",
    title: record.title || `Issue #${issueNumber}`,
  };

  const updatedRow: RunnerStateDbRow = {
    ...existing,
    updated_at: nowIso,
    status: record.status || existing.status,
    agent: record.agent || existing.agent,
    door: record.door !== undefined ? record.door : existing.door,
    title: record.title || existing.title,
    branch: record.branch !== undefined ? record.branch : existing.branch,
    pr_number: record.prNumber !== undefined ? record.prNumber : existing.pr_number,
    pr_url: record.prUrl !== undefined ? record.prUrl : existing.pr_url,
    run_started_at: record.runStartedAt || existing.run_started_at,
    run_completed_at: record.runCompletedAt !== undefined ? record.runCompletedAt : existing.run_completed_at,
    error: record.error !== undefined ? record.error : existing.error,
    recovery_attempts: record.recoveryAttempts !== undefined ? record.recoveryAttempts : existing.recovery_attempts,
    last_recovery_at: record.lastRecoveryAt || existing.last_recovery_at,
    last_alert_at: record.lastRecoveryAlertAt || existing.last_alert_at,
    tool_calls_count: record.toolCallsCount !== undefined ? record.toolCallsCount : existing.tool_calls_count,
    preflight_hash: record.preflightHash || existing.preflight_hash,
    preflight_verdict: record.preflightVerdict || existing.preflight_verdict,
    preflight_reason: record.preflightReason || existing.preflight_reason,
    last_model_message: record.lastModelMessage || existing.last_model_message,
  };

  mockRunnerStateDb.set(issueNumber, updatedRow);

  const state = rowsToRunnerState(Array.from(mockRunnerStateDb.values()));
  await syncMirrorFile(state, { testMode: true });
}

/**
 * Returns any runner records currently in "in-progress" or "interrupted" status.
 */
export async function getInterruptedRuns(
  options?: { testMode?: boolean }
): Promise<{ issueNumber: number; record: RunnerRecord }[]> {
  const isTest = options?.testMode === true || isTestMode();
  const state = await getRunnerState({ testMode: isTest });
  const result: { issueNumber: number; record: RunnerRecord }[] = [];

  for (const [key, record] of Object.entries(state.runs)) {
    const num = Number(key);
    if (!isNaN(num) && (record.status === "in-progress" || record.status === "interrupted")) {
      result.push({ issueNumber: num, record });
    }
  }

  return result;
}
