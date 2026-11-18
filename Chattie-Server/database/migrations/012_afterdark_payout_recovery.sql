BEGIN;

DO $$
DECLARE
    status_check_name TEXT;
BEGIN
    FOR status_check_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'ad_withdrawals'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE ad_withdrawals DROP CONSTRAINT %I', status_check_name);
    END LOOP;
END;
$$;

ALTER TABLE ad_withdrawals
    ADD CONSTRAINT ad_withdrawals_status_check
        CHECK (status IN ('requested', 'submitting', 'submission_unknown', 'processing', 'paid', 'failed', 'reversed'));

UPDATE ad_withdrawals
SET status = 'submission_unknown',
    failure_reason = COALESCE(failure_reason, 'Legacy payout requires provider reconciliation')
WHERE status = 'requested';

DROP INDEX IF EXISTS idx_ad_withdrawals_user_unresolved;
CREATE INDEX idx_ad_withdrawals_user_unresolved
    ON ad_withdrawals (user_id, created_at DESC)
    WHERE status IN ('requested', 'submitting', 'submission_unknown', 'processing');

COMMIT;
