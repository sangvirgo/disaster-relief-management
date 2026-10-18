// Types định nghĩa theo hợp đồng API C48 (Identity, Response, Logistics)

export type UserRole = 'CITIZEN' | 'VOLUNTEER' | 'COORDINATOR' | 'OPERATIONS_MANAGER' | 'ADMIN';

export interface User {
  id: string;
  username: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  must_change_password?: boolean;
}

export interface RoleGrant {
  id: string;
  role_code: UserRole;
  scope_type: 'SYSTEM' | 'ORGANIZATION' | 'REGION' | 'CAMPAIGN';
  organization_id?: string;
  region_code?: string;
  campaign_id?: string;
}

export interface NativeLoginResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password?: boolean;
}

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  field_errors?: Record<string, string>;
  correlation_id?: string;
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
  reporter_name?: string;
  reporter_contact_phone?: string;
  reporter_declared_danger?: boolean;
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
  review_lane?: string;
}

export interface RequestTimelineEvent {
  event_type: string;
  occurred_at: string;
  public_text_code: string;
  payload?: any;
}

export interface RequestTrackingDetail {
  id: string;
  tracking_code: string;
  status: RequestStatus;
  version: number;
  received_at: string;
  timeline: RequestTimelineEvent[];
  rejection_reason?: string;
  duplicate_of_code?: string;
  can_supplement: boolean;
  people_affected?: number;
  description?: string;
  location?: GeoLocation;
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

export interface Mission {
  id: string;
  request_id: string;
  team_id?: string;
  team?: { id: string; name: string };
  version?: number;
  work_cycle?: number;
  status: MissionStatus;
  category: IncidentCategoryCode;
  description?: string;
  people_affected?: number | null;
  declared_danger: boolean;
  location: GeoLocation;
  reporter_contact_phone?: string | null; // Chỉ dành cho Đội trưởng
  beneficiary_contact_phone?: string | null;
  alternate_contact_phone?: string;
  alternate_contact?: {
    name: string;
    phone?: string;
  } | null;
  created_at: string;
  distance_m?: number;
}

export interface RescueTeam {
  id: string;
  name: string;
  version?: number;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  team_kind?: 'VOLUNTEER' | 'MILITARY' | 'GOVERNMENT' | 'OTHER';
  kind?: 'VOLUNTEER' | 'MILITARY' | 'GOVERNMENT' | 'OTHER';
  reporting_mode: 'APP' | 'COORDINATOR';
  operating_region_code?: string;
  skills: Array<string | { id: string; code: string; name: string }>;
  position?: {
    location?: GeoLocation;
    age_s?: number;
    accuracy_m?: number | null;
    source?: string;
  } | null;
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
  description?: string;
  status: string;
  region_code?: string;
  created_at: string;
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
  opens_at?: string;
  closes_at?: string;
  status: 'DRAFT' | 'OPEN' | 'PAUSED' | 'CLOSED';
  items: DonationDriveItem[];
  created_at?: string;
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
      declared_quantity?: string | number;
      counted_quantity?: string | number;
      accepted_quantity?: string | number;
      held_quantity?: string | number;
      rejected_quantity?: string | number;
      condition_note?: string | null;
    }[];
  } | null;
  disputes?: Array<{
    id: string;
    status: string;
    reason: string;
    opened_at: string;
    resolution_note?: string | null;
  }>;
}
