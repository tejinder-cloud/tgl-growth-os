-- Migration: 20261030000000_prospects_unique_constraint.sql
-- Description: Add unique constraint on (tenant_id, door, website) to support PostgREST upserts

-- Clean any trailing whitespace or casing on website first
UPDATE public.prospects
SET website = lower(trim(website));

-- Add unique constraint if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_prospects_tenant_door_website'
    ) THEN
        ALTER TABLE public.prospects 
        ADD CONSTRAINT uq_prospects_tenant_door_website UNIQUE (tenant_id, door, website);
    END IF;
END $$;
