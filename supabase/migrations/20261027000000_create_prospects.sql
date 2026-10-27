-- Migration: 20261027000000_create_prospects.sql
-- Description: Create prospects table for Prospect Researcher with tenant-level RLS
-- Reference: ORG.md §2, products/truevisible/SPEC.md §11, products/truelead/SPEC-v0.md §5

CREATE TABLE IF NOT EXISTS public.prospects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'tgl',
    company TEXT NOT NULL,
    category TEXT NOT NULL,
    city TEXT NOT NULL,
    website TEXT NOT NULL,
    door TEXT NOT NULL,
    fit_score INTEGER NOT NULL CHECK (fit_score >= 0 AND fit_score <= 100),
    fit_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    decision_maker JSONB NOT NULL DEFAULT '{}'::jsonb,
    signals JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'rejected', 'handed_to_outreach')),
    source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rescored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- Comments on table and schema structure
COMMENT ON TABLE public.prospects IS 'Outbound prospect accounts sourced, qualified, and scored by Prospect Researcher per door';
COMMENT ON COLUMN public.prospects.decision_maker IS 'JSON payload containing {name, role, email, phone, source}';
COMMENT ON COLUMN public.prospects.signals IS 'JSON payload of observed budget/intent signals (meta_ads_active, hiring, review_surge, site_age_years)';
COMMENT ON COLUMN public.prospects.fit_reasons IS 'Array of quantitative scoring justifications contributing to fit_score';
COMMENT ON COLUMN public.prospects.source_refs IS 'Array of URLs/APIs documenting where data was publicly observed for DPDP auditability';

-- Indexes for efficient querying, deduplication, and pipeline handoffs
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_tenant_door_website 
ON public.prospects (tenant_id, door, lower(trim(website))) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_door_status 
ON public.prospects (tenant_id, door, status);

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_fit_score 
ON public.prospects (tenant_id, door, fit_score DESC);

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_city_category 
ON public.prospects (tenant_id, city, category);

CREATE INDEX IF NOT EXISTS idx_prospects_rescored_at 
ON public.prospects (rescored_at);

-- Enable Row-Level Security (RLS)
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
-- Evaluates current tenant from app setting, request JWT claims, or defaults to 'tgl'
CREATE POLICY prospects_tenant_isolation_select ON public.prospects
    FOR SELECT
    USING (
        tenant_id = coalesce(
            current_setting('app.current_tenant_id', true),
            (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'),
            'tgl'
        )
    );

CREATE POLICY prospects_tenant_isolation_insert ON public.prospects
    FOR INSERT
    WITH CHECK (
        tenant_id = coalesce(
            current_setting('app.current_tenant_id', true),
            (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'),
            'tgl'
        )
    );

CREATE POLICY prospects_tenant_isolation_update ON public.prospects
    FOR UPDATE
    USING (
        tenant_id = coalesce(
            current_setting('app.current_tenant_id', true),
            (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'),
            'tgl'
        )
    )
    WITH CHECK (
        tenant_id = coalesce(
            current_setting('app.current_tenant_id', true),
            (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'),
            'tgl'
        )
    );

CREATE POLICY prospects_tenant_isolation_delete ON public.prospects
    FOR DELETE
    USING (
        tenant_id = coalesce(
            current_setting('app.current_tenant_id', true),
            (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'),
            'tgl'
        )
    );
