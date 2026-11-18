BEGIN;

ALTER TABLE room_members
    DROP CONSTRAINT IF EXISTS room_members_role_check,
    ADD CONSTRAINT room_members_role_check
        CHECK (role IN ('creator', 'admin', 'moderator', 'speaker', 'member', 'host'));

COMMIT;
