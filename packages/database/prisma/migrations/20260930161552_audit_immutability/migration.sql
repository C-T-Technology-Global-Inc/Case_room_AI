-- Audit events are append-only.
-- Any attempt to UPDATE or DELETE a row in "AuditEvent" raises an error,
-- regardless of which application or user issues the statement.
-- (TRUNCATE remains available to database administrators for resetting
-- demo environments; it is not reachable from the application.)

CREATE OR REPLACE FUNCTION audit_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are immutable (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
