-- Migration: 20261103170000_runner_state.sql
-- Description: Create runner_state table for distributed runner coordination and atomic instance claims.
-- Project: rmrauejublipukulnjou

CREATE TABLE IF NOT EXISTS public.runner_state (
    issue_number INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'idle',
    owner_instance TEXT,
    heartbeat_at TIMESTAMPTZ,
    recovery_attempts INTEGER NOT NULL DEFAULT 0,
    last_alert_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    agent TEXT,
    door TEXT,
    title TEXT,
    branch TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    run_started_at TIMESTAMPTZ,
    run_completed_at TIMESTAMPTZ,
    last_recovery_at TIMESTAMPTZ,
    error TEXT
);

COMMENT ON TABLE public.runner_state IS 'Distributed state and atomic instance lock for runner tasks across multi-container deployments';
COMMENT ON COLUMN public.runner_state.issue_number IS 'GitHub Issue Number acting as the primary key';
COMMENT ON COLUMN public.runner_state.owner_instance IS 'Random instance ID of the active container holding the run claim';
COMMENT ON COLUMN public.runner_state.heartbeat_at IS 'Heartbeat updated every 30 seconds while run is active';
COMMENT ON COLUMN public.runner_state.recovery_attempts IS 'Number of recovery attempts, incremented only when a resumed run throws';
COMMENT ON COLUMN public.runner_state.last_alert_at IS 'Timestamp of the last recovery alert sent to prevent duplicate notifications';

-- Indexes for status lookups and heartbeat timeout checks
CREATE INDEX IF NOT EXISTS idx_runner_state_status ON public.runner_state (status);
CREATE INDEX IF NOT EXISTS idx_runner_state_owner_heartbeat ON public.runner_state (owner_instance, heartbeat_at);

-- Enable Row-Level Security (RLS)
ALTER TABLE public.runner_state ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'runner_state' AND policyname = 'service_role_full_access_runner_state'
    ) THEN
        CREATE POLICY service_role_full_access_runner_state ON public.runner_state
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- Atomic claim function
CREATE OR REPLACE FUNCTION public.claim_runner_issue(
    p_issue_number INTEGER,
    p_instance_id TEXT,
    p_status TEXT DEFAULT 'in-progress',
    p_agent TEXT DEFAULT NULL,
    p_door TEXT DEFAULT NULL,
    p_title TEXT DEFAULT NULL,
    p_recovery_attempts INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rows_affected INTEGER;
BEGIN
    INSERT INTO public.runner_state (
        issue_number,
        status,
        owner_instance,
        heartbeat_at,
        recovery_attempts,
        updated_at,
        run_started_at,
        agent,
        door,
        title
    )
    VALUES (
        p_issue_number,
        COALESCE(p_status, 'in-progress'),
        p_instance_id,
        now(),
        COALESCE(p_recovery_attempts, 0),
        now(),
        now(),
        p_agent,
        p_door,
        p_title
    )
    ON CONFLICT (issue_number) DO NOTHING;

    UPDATE public.runner_state
    SET owner_instance = p_instance_id,
        heartbeat_at = now(),
        updated_at = now(),
        status = COALESCE(p_status, status),
        agent = COALESCE(p_agent, agent),
        door = COALESCE(p_door, door),
        title = COALESCE(p_title, title),
        recovery_attempts = COALESCE(p_recovery_attempts, recovery_attempts)
    WHERE issue_number = p_issue_number
      AND (
          owner_instance IS NULL
          OR heartbeat_at < now() - interval '3 minutes'
          OR owner_instance = p_instance_id
      );

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$;
