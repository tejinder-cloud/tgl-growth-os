-- Migration: 20261104130000_runner_state_budget_and_preflight.sql
-- Description: Add tool_calls_count, preflight cache, and last_model_message columns to runner_state

ALTER TABLE public.runner_state
    ADD COLUMN IF NOT EXISTS tool_calls_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS preflight_hash TEXT,
    ADD COLUMN IF NOT EXISTS preflight_verdict TEXT,
    ADD COLUMN IF NOT EXISTS preflight_reason TEXT,
    ADD COLUMN IF NOT EXISTS last_model_message TEXT;
