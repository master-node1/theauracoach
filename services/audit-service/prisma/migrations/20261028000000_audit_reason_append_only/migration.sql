-- The staff member's reason for a sensitive action (TAC-32).
ALTER TABLE "AuditLog" ADD COLUMN "reason" VARCHAR(200);

-- Filters of the audit viewer: by action and by time.
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- Append-only (admin LLD §5): no role can change or remove an entry once written, whatever its
-- grants. The one exception is account deletion (TAC-7), which keeps the row as the record but
-- clears its snapshots and IP hash; every other column must stay as it was. Retention, if it is
-- ever needed, is a reviewed migration that drops this trigger first.
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."before" IS NULL AND NEW."after" IS NULL AND NEW."ipHash" IS NULL
     AND NEW."id" = OLD."id"
     AND NEW."actorId" IS NOT DISTINCT FROM OLD."actorId"
     AND NEW."actorRole" IS NOT DISTINCT FROM OLD."actorRole"
     AND NEW."action" = OLD."action"
     AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" = OLD."entityId"
     AND NEW."reason" IS NOT DISTINCT FROM OLD."reason"
     AND NEW."requestId" IS NOT DISTINCT FROM OLD."requestId"
     AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
