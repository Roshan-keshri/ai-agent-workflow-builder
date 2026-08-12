// ✅ Verified directly against Hasura pg_enum + Relationships tabs.
export const RUN_STATUS = ["pending", "running", "paused", "success", "failed"] as const;
export const STEP_RUN_STATUS = ["pending", "running", "paused", "success", "failed", "skipped"] as const;
export const STEP_TYPES = [
  "llm_call",
  "http_request",
  "db_write",
  "notify",
  "conditional_branch",
  "approval_gate",
] as const;
export const TRIGGER_TYPES = ["manual", "webhook", "scheduled", "db_event"] as const;
export const ORG_ROLES = ["owner", "editor", "viewer"] as const;

export const OWNER_ONLY_STEP_TYPES = ["db_write", "notify"];
export const OWNER_ONLY_TRIGGER_TYPES = ["webhook"];