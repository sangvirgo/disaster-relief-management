// Types định nghĩa theo hợp đồng API Reliva (Identity, Response, Logistics).

export type UserRole =
  | 'CITIZEN'
  | 'VOLUNTEER'
  | 'COORDINATOR'
  | 'CAMPAIGN_MANAGER'
  | 'OPERATIONS_MANAGER'
  | 'INTAKE_STAFF'
  | 'REVIEWER'
  | 'DISTRIBUTION_STAFF'
  | 'ADMIN';

export interface User {
  id: string;
  username: string;
  display_name: string;
  must_change_password?: boolean;
}

export interface RoleGrant {
  id: string;
  role_code: UserRole;
  scope_type: 'SYSTEM' | 'ORGANIZATION' | 'REGION' | 'CAMPAIGN';
  organization_id?: string | null;
  region_code?: string | null;
  campaign_id?: string | null;
}

export interface NativeLoginResponse {
  user: Pick<User, 'id' | 'username' | 'display_name'>;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password: boolean;
}

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  field_errors?: Record<string, string | string[]>;
  correlation_id?: string;
}

export interface CollectionPage<T> {
  items: T[];
  more: boolean;
  cursor?: string;
  generated_at?: string;
}

export type IncidentCategoryCode =
  | 'FLOOD'
  | 'LANDSLIDE'
  | 'STORM'
  | 'FIRE'
  | 'MEDICAL'
  | 'TRAPPED'
  | 'SUPPLY_SHORTAGE'
  | 'OTHER'
  | 'UNKNOWN';

export type RequestStatus =
  | 'SUBMITTED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'TRIAGED'
  | 'DISPATCHED'
  | 'IN_PROGRESS'
  | 'RESOLVING'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED';

export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4';

export interface GeoLocation {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
  source: 'GPS' | 'MANUAL_PIN';
  accuracy_m?: number;
  captured_at: string;
}

export interface CreateSOSPayload {
  incident_category_code: IncidentCategoryCode;
  description?: string;
  people_affected?: number | null;
  children_count?: number | null;
  elderly_count?: number | null;
  reporter_name?: string;
  reporter_contact_phone?: string;
  reporter_declared_danger?: boolean;
  needs_rescue: boolean;
  needs_relief_supplies: boolean;
  location: GeoLocation;
}

export interface CreateProxySOSPayload extends CreateSOSPayload {
  relationship: string;
  information_source: string;
  last_known_situation_at: string;
  contactability: 'REACHABLE' | 'UNREACHABLE' | 'UNKNOWN';
  beneficiary_contact_phone?: string;
  alternate_contact?: {
    name: string;
    phone?: string;
  };
}

export interface CreateSOSResponse {
  id: string;
  tracking_code: string;
  status: RequestStatus;
  received_at: string;
  review_lane: 'NORMAL' | 'RATE_LIMITED_REVIEW' | 'PROXY_QUOTA_REVIEW';
}

export interface RequestTimelineEvent {
  event_type: string;
  occurred_at: string;
  public_text_code: string;
}

export interface RequestTrackingDetail {
  id: string;
  tracking_code: string;
  status: RequestStatus;
  version: number;
  received_at: string;
  timeline: RequestTimelineEvent[];
  more: boolean;
  cursor?: string;
  priority_visible: false;
  rejection_reason?: string;
  duplicate_of_code?: string;
  can_supplement: boolean;
}

export interface MyRequestItem {
  id: string;
  tracking_code: string;
  status: RequestStatus;
  received_at: string;
}

// ==================== MISSIONS & RESCUE TEAMS ====================

export type MissionStatus =
  | 'OFFERED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EN_ROUTE'
  | 'ON_SCENE'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type MissionKind = 'RESCUE' | 'DELIVERY' | 'COMBINED';

export interface MissionTimelineEvent {
  id: string;
  actor_user_id?: string | null;
  from_status?: string | null;
  to_status: string;
  recorded_basis?: string | null;
  reported_by?: string | null;
  reason?: string | null;
  outcome_note?: string | null;
  occurred_at: string;
  recorded_at: string;
  recorded_on_behalf: boolean;
}

export interface MissionEvidenceItem {
  id: string;
  state: string;
  size_bytes: number;
  detected_mime: string;
  checksum: string;
  created_at: string;
}

export interface MissionTimelinePage {
  items: MissionTimelineEvent[];
}

export interface MissionEvidencePage {
  items: MissionEvidenceItem[];
}

export interface Mission {
  id: string;
  request_id: string;
  team: { id: string; name: string };
  version: number;
  work_cycle: number;
  status: MissionStatus;
  mission_kind?: MissionKind;
  category: IncidentCategoryCode | null;
  description: string | null;
  people_affected: number | null;
  declared_danger: boolean;
  location: GeoLocation | null;
  reporter_contact_phone?: string | null; // Chỉ dành cho Đội trưởng
  beneficiary_contact_phone?: string | null;
  alternate_contact?: {
    name: string;
    phone?: string | null;
  } | null;
  created_at: string;
}

export interface MissionDetail extends Mission {
  timeline: MissionTimelinePage;
  evidence: MissionEvidencePage;
}

export interface TeamMemberItem {
  team_id: string;
  user_id: string;
  member_role: 'LEADER' | 'MEMBER';
  joined_at: string;
}

export interface TeamSkillOption {
  code: string;
  display_name: string;
}

export interface RegionItem {
  code: string;
  name: string;
  status: string;
}

export interface TeamPositionLocation {
  type: 'Point';
  coordinates: [number, number];
}

export interface TeamPositionSummary {
  location?: TeamPositionLocation;
  age_s: number;
  accuracy_m: number | null;
  source: 'GPS' | 'MANUAL_PIN' | 'COORDINATOR_REPORTED';
}

export interface RescueTeam {
  id: string;
  name: string;
  version: number;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  status: 'ACTIVE' | 'INACTIVE';
  kind: 'VOLUNTEER' | 'MILITARY' | 'GOVERNMENT' | 'OTHER';
  reporting_mode: 'APP' | 'COORDINATOR';
  skills: string[];
  position: TeamPositionSummary | null;
}

export type TeamMemberRole = 'LEADER' | 'MEMBER';

export interface TeamMember {
  user_id: string;
  display_name: string;
  member_role: TeamMemberRole;
  joined_at: string;
}

export interface TeamMembersPage extends CollectionPage<TeamMember> {
  team_id: string;
  can_manage_members: boolean;
}

export interface TeamMemberCandidate {
  user_id: string;
  username: string;
  display_name: string;
}

// ==================== NOTICES & CAMPAIGNS ====================

export interface NoticeItem {
  id: string;
  notice_type: string;
  payload: Record<string, any>;
  created_at: string;
  read_at: string | null;
}

export interface PublicCampaign {
  id: string;
  title: string;
  objective?: string | null;
  status: 'ACTIVE' | 'PAUSED';
  region_name?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

// ==================== LOGISTICS (DONATIONS) ====================

export interface DonationDriveItem {
  item_id: string;
  name?: string;
  item_name?: string;
  item_type_code?: string;
  item_type_name?: string;
  unit_code: string;
  unit_name: string;
  target_quantity: string;
  accepted_total?: string;
  acceptance_note?: string;
}

export interface DonationDrive {
  id: string;
  title: string;
  description?: string;
  intake_warehouse_name?: string;
  address_note?: string;
  intake_location?: {
    warehouse_name: string;
    address_note?: string | null;
    location?: {
      type: 'Point';
      coordinates: [number, number];
    } | null;
  };
  opens_at?: string | null;
  closes_at?: string | null;
  status: 'OPEN';
  campaign_status?: 'ACTIVE' | 'PAUSED' | 'CLOSED' | null;
  items: DonationDriveItem[];
  accepted_total?: string;
  generated_at?: string;
}

export interface DonationDeclarationPayload {
  donor_name: string;
  donor_phone: string;
  lines: {
    item_id: string;
    declared_quantity: string;
  }[];
}

export interface DonationTrackingDetail {
  id: string;
  public_code: string;
  status: 'DECLARED' | 'COUNTING' | 'PENDING_REVIEW' | 'APPROVED' | 'POSTED' | string;
  declaration: {
    revision: number | null;
    created_by_kind?: string | null;
    lines: {
      item_id?: string;
      item_name?: string;
      unit_name?: string;
      declared_quantity: string;
    }[];
  };
  receipt?: {
    count_revision: number;
    lines: {
      item_id?: string;
      item_name?: string;
      unit_name?: string;
      declared_quantity?: string;
      counted_quantity?: string;
      accepted_quantity?: string;
      held_quantity?: string;
      rejected_quantity?: string;
      condition_note?: string | null;
    }[];
  } | null;
  disputes?: {
    id: string;
    status: string;
    reason: string;
    opened_at: string;
    resolution_note?: string | null;
  }[];
}

// Bằng chứng đa phương tiện (Ảnh / Video)
export interface EvidenceDownload {
  url: string;
  expires_in: number;
}

// Nhật ký sự kiện chi tiết của Yêu cầu cứu hộ
export interface ReporterEvent {
  event_type: string;
  public_text_code: string;
  occurred_at: string;
}

export interface ReporterEventPage {
  items: ReporterEvent[];
  more: boolean;
  cursor?: string;
}

// Báo cáo tổng hợp quyên góp công khai (Minh bạch)
export interface PublicDonationSummaryItem {
  item?: {
    id: string;
    name: string;
  };
  unit?: {
    code: string;
    display_name: string;
    scale: number;
  };
  accepted?: string;
  distributed?: string;
}

export interface PublicDonationReportSummary {
  view: string;
  filter_id: string;
  items: PublicDonationSummaryItem[];
  more: boolean;
  cursor?: string;
  generated_at: string;
}

// Cập nhật lại bản khai quyên góp
export interface ReviseDonationDeclarationPayload {
  expected_version: number;
  lines: {
    item_id: string;
    declared_quantity: string;
  }[];
}

// Chi tiết mở rộng của Đội cứu hộ
export type RescueTeamDetail = RescueTeam;
