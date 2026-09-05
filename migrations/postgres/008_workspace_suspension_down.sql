-- Fail rather than silently restoring access to a suspended workspace.
ALTER TABLE workspaces DROP CONSTRAINT chk_workspaces_status;
ALTER TABLE workspaces ADD CONSTRAINT chk_workspaces_status
  CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'deleted'));
