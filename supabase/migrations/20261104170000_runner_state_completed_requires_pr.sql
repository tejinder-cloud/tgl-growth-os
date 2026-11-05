-- Migration: 20261104170000_runner_state_completed_requires_pr.sql
-- Description: Add check constraint ensuring runner_state status = 'completed' requires pr_number IS NOT NULL

-- 1. Clean up any invalid legacy rows where status = 'completed' but pr_number is null
UPDATE public.runner_state
SET status = 'in-progress',
    owner_instance = NULL,
    heartbeat_at = NULL,
    tool_calls_count = 0,
    run_completed_at = NULL
WHERE status = 'completed' AND pr_number IS NULL;

-- 2. Add DB check constraint requiring status = 'completed' to have a non-null pr_number
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'runner_state_completed_requires_pr'
    ) THEN
        ALTER TABLE public.runner_state
            ADD CONSTRAINT runner_state_completed_requires_pr
            CHECK (status != 'completed' OR pr_number IS NOT NULL);
    END IF;
END $$;
