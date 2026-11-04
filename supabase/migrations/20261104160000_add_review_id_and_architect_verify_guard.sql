-- Migration: 20261104160000_add_review_id_and_architect_verify_guard.sql
-- Description: Add review_id to setup tables and enforce that setup_status can only become verified via Architect action.
-- Reference: SPEC Day 19, AGENTS.md mandate 6

ALTER TABLE public.products_icps
    ADD COLUMN IF NOT EXISTS review_id UUID REFERENCES public.setup_reviews(id) ON DELETE SET NULL;

ALTER TABLE public.competitors
    ADD COLUMN IF NOT EXISTS review_id UUID REFERENCES public.setup_reviews(id) ON DELETE SET NULL;

ALTER TABLE public.prompts
    ADD COLUMN IF NOT EXISTS review_id UUID REFERENCES public.setup_reviews(id) ON DELETE SET NULL;

ALTER TABLE public.brands
    ADD COLUMN IF NOT EXISTS review_id UUID REFERENCES public.setup_reviews(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS setup_review_id UUID REFERENCES public.setup_reviews(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_brand_verification()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.setup_status = 'verified' AND (OLD.setup_status IS NULL OR OLD.setup_status <> 'verified') THEN
        IF NEW.setup_verified_by IS NULL OR lower(trim(NEW.setup_verified_by)) NOT IN ('tejinder singh', 'architect', 'falkanmedia') THEN
            RAISE EXCEPTION 'Only the Architect may verify a brand setup profile. Rejected actor: %', NEW.setup_verified_by;
        END IF;
        IF NEW.review_id IS NULL AND NEW.setup_review_id IS NULL THEN
            RAISE EXCEPTION 'Verification requires a valid review_id.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_brand_verification ON public.brands;
CREATE TRIGGER trg_guard_brand_verification
    BEFORE INSERT OR UPDATE OF setup_status ON public.brands
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_brand_verification();
