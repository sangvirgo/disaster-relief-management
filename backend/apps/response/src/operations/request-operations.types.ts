export interface RequestOperationsConfig {
  overdueMinutes: number;
}

export interface OperationRequestRow {
  id: string;
  tracking_code: string;
  tracking_secret_hash: string | null;
  reporter_user_id: string | null;
  reporter_name: string | null;
  reporter_contact_phone: string | null;
  source_ip_hash: string | null;
  report_mode: 'SELF' | 'PROXY';
  status: string;
  version: number;
  review_lane: string;
  received_at: Date | string;
  verifying_since: Date | string | null;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  description: string | null;
  incident_category_code: string;
  reporter_declared_danger: boolean;
  priority: string | null;
  priority_basis: string | null;
  work_cycle: number;
  canonical_request_id: string | null;
  attribution_locked_at: Date | string | null;
}

export interface QueueRow {
  id: string;
  tracking_code: string;
  status: string;
  priority: string | null;
  review_lane: string;
  category: string;
  people_affected: number | null;
  region_code: string | null;
  received_at: Date | string;
  cursor_received_at: string;
  declared_danger: boolean;
  overdue: boolean;
  reporter_contact_phone: string | null;
  longitude: number | string | null;
  latitude: number | string | null;
  proxy_activity_flags: string[] | null;
}

export interface RequestEventRow {
  id: string;
  event_type: string;
  visibility: 'REPORTER' | 'STAFF';
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: Date | string;
  cursor_occurred_at: string;
  actor_user_id: string | null;
}

export interface ValidatedSourceRefs {
  attempts: Array<{ id: string; outcome: string }>;
  evidence: Array<{ id: string; uploader_user_id: string | null; upload_source_ip_hash: string | null; independent: boolean }>;
  requests: Array<{ id: string; independent: boolean }>;
  independent: boolean;
}
