import { Dropdown } from '../../components/ui/Dropdown';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { DetailSurface } from '../../components/DetailSurface';
import { PriorityBadge } from '../../components/PriorityBadge';
import { StatusBadge } from '../../components/StatusBadge';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { label, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { AsyncRequestForm } from './AsyncRequestForm';
import { HeatmapPanel } from './HeatmapPanel';
import { ContactAttemptPanel } from './ContactAttemptPanel';
import { CoordinatorTeamPositionForm } from './CoordinatorTeamPositionForm';
import { operationIdFromTimeline, ResolutionOperationPanel } from './ResolutionOperationPanel';
import { RequestTimeline } from './RequestTimeline';
import { RequestEvidencePanel } from './RequestEvidencePanel';
import { TeamReadinessQueue } from './TeamReadinessQueue';
import { MissionSupplyPanel } from '../supply/MissionSupplyPanel';
import { type Me } from '../../auth/session';
import './coordinator-detail.css';

type QueueItem = {
  handled_by?: string | null;
  handled_at?: string | null;
  handled_by_name?: string | null;
  id: string;
  tracking_code: string;
  status: string;
  priority?: string | null;
  campaign_id?: string | null;
  campaign_match_state?: 'UNMATCHED' | 'AUTO_ATTACHED' | 'CONFLICT' | 'MANUAL';
  campaign_candidate_ids?: string[] | null;
  category: string;
  received_at: string;
  review_lane: string;
  declared_danger: boolean;
  people_affected?: number | null;
  priority_advisory?: {
    score: number | null;
    level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'STANDARD' | null;
    outcome: 'SUGGESTION' | 'INSUFFICIENT_DATA';
    reason_codes: string[];
    source: 'BACKEND_RULES';
    rules_version: string;
  };
  ai_priority_advisory?: AiPriorityAdvisory | null;
  fast_track?: FastTrack;
};
type FastTrack = {
  eligible: boolean;
  blockers: string[];
  suggested_priority: 'P1' | 'P2' | 'P3' | 'P4';
  suggestion_confidence?: 'NORMAL' | 'LOW';
  suggested_priority_basis: 'COMPLETE' | 'INCOMPLETE_INFO';
  sources: Array<'BACKEND_RULES' | 'AI'>;
  reason_codes: string[];
};
const fastTrackBlockerLabels: Record<string, string> = {
  PROXY_REPORT: 'SOS báo hộ — cần hai điều phối viên xác minh độc lập',
  REVIEW_LANE: 'Đang nằm trong nhóm cần rà soát (báo lặp hoặc báo hộ)',
  PROXY_FLAGS: 'Có tín hiệu báo hộ bất thường',
  PENDING_SUPPLEMENT: 'Người báo vừa bổ sung thông tin chưa được đối chiếu',
  POSSIBLE_DUPLICATE: 'Có SOS cùng loại ở gần — cần kiểm tra trùng',
  URGENT_MEDICAL_REVIEW: 'Có dấu hiệu cấp cứu — điều phối viên cần tự đánh giá ngay',
  INSUFFICIENT_DATA: 'Chưa đủ thông tin để hệ thống gợi ý mức ưu tiên',
  STATE_NOT_FAST_TRACKABLE: 'Trạng thái hiện tại không áp dụng xử lý nhanh',
};
const priorityMeaning: Record<string, string> = {
  P1: 'P1 · Rất khẩn cấp', P2: 'P2 · Nguy cơ cao', P3: 'P3 · Cần ưu tiên', P4: 'P4 · Theo dõi thông thường',
};
function OptionalFold({ fold, summary, children }: { fold: boolean; summary: string; children: React.ReactNode }) {
  return fold ? <details className="sos-fold"><summary>{summary}</summary>{children}</details> : <>{children}</>;
}
function reliefDescription(description: string | null | undefined) {
  const value = description ?? '';
  const match = value.match(/(?:^|\n)Hàng cứu trợ cần:\s*([^\n]+)\s*$/);
  return {
    narrative: match ? value.slice(0, match.index).trim() : value.trim(),
    items: match?.[1].trim() || '',
  };
}
function weatherImpactText(value: string | null | undefined) {
  return (value ?? '').replace(/(?:,\s*(?:đòi hỏi\s+)?|[.!?]\s*)(?:[Đđ]iều phối viên cần|[Cc]ần xác minh)[^.!?]*[.!?]?$/u, '.').trim();
}
type AiPriorityAdvisory = {
  status: string;
  suggested_priority?: 'P1' | 'P2' | 'P3' | 'P4' | null;
  score: number | null;
  level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'STANDARD' | null;
  reasons: string[];
  confidence: number | null;
  source: 'GEMINI' | 'DEMO_FIXTURE';
  human_review_required: true;
  review_status: string | null;
};
type Queue = { items: QueueItem[]; cursor?: string; more: boolean; generated_at: string };
type Event = {
  id: string;
  actor_user_id?: string | null;
  event_type: string;
  occurred_at: string;
  payload?: Record<string, unknown>;
};
const supplementLabels: Record<string, string> = {
  description: 'Mô tả tình hình',
  household_reference_note: 'Ghi chú về hộ gia đình',
  people_affected: 'Số người cần hỗ trợ',
  children_count: 'Số trẻ em',
  elderly_count: 'Số người cao tuổi',
  location: 'Vị trí cần hỗ trợ',
  reporter_declared_danger: 'Có nguy hiểm tính mạng',
  needs_rescue: 'Cần đội cứu hộ',
  needs_relief_supplies: 'Cần hàng cứu trợ',
};
function supplementValue(value: unknown): string {
  if (value === null) return 'Chưa rõ';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object' && value && 'coordinates' in value) {
    const coordinates = (value as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coordinates) && coordinates.length === 2)
      return `${coordinates[1]}, ${coordinates[0]}`;
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Xem chi tiết trong hồ sơ';
}
type Detail = QueueItem & {
  campaign_match_state?: 'UNMATCHED' | 'AUTO_ATTACHED' | 'CONFLICT' | 'MANUAL';
  campaign_candidate_ids?: string[] | null;
  handled_by?: string | null;
  handled_at?: string | null;
  handled_by_name?: string | null;
  canonical?: { id: string; tracking_code: string; status: string } | null;
  version: number;
  work_cycle?: number;
  description?: string | null;
  report_mode: string;
  campaign_id?: string | null;
  needs_rescue: boolean;
  needs_relief_supplies: boolean;
  reporter: { user_id?: string | null; name?: string | null; contact_phone?: string | null };
  subject: {
    people_affected?: number | null;
    children_count?: number | null;
    elderly_count?: number | null;
    location?: { coordinates: [number, number]; source: string; accuracy_m?: number | string | null };
    reporter_relationship?: string | null;
    beneficiary_contact_phone?: string | null;
    alternate_contact?: { name?: string | null; phone?: string | null };
    information_source?: string | null;
    last_known_situation_at?: string | null;
    contactability?: string | null;
    household_reference_note?: string | null;
  };
  contact_attempts: {
    items: { id: string; contact_target: string; outcome: string; actor_user_id?: string | null; note?: string | null; attempted_at?: string }[];
    more: boolean;
  };
  timeline: { items: Event[]; more: boolean };
  proxy_activity_flags: unknown[];
  active_missions?: {
    items: { id: string; status: string; created_at: string; team_id: string }[];
  };
  mission_history?: {
    items: {
      id: string;
      status: string;
      mission_kind: string;
      created_at: string;
      team_id: string;
      team_name: string;
      suggested_team_id?: string | null;
      override_reason?: string | null;
      last_status?: string | null;
      last_occurred_at?: string | null;
      recorded_basis?: string | null;
      reported_by?: string | null;
    }[];
  };
  ai_advisory?: {
    id: string;
    model: string;
    status: string;
    risk_score: number | null;
    reason_codes: string[];
    extracted_json?: {
      summary?: string;
      suggested_priority?: 'P1' | 'P2' | 'P3' | 'P4' | null;
      weather_impact?: string;
      indicators?: string[];
      facts?: Record<string, unknown>;
      confidence?: number;
      priority_score?: number;
      priority_reasons?: string[];
      /** Set by the backend when the local fallback model answered instead of Gemini. */
      ai_source?: 'FALLBACK';
    } | null;
    review_status?: string | null;
    review_note?: string | null;
    error_code?: string | null;
    human_review_required: boolean;
  } | null;
  evidence?: { items: { id: string; state: string; size_bytes: number; detected_mime?: string; created_at: string }[] };
};
type Candidate = {
  team: { id: string; name: string; reporting_mode: 'APP' | 'COORDINATOR'; external_contact_note?: string | null };
  distance_m: number | null;
  position_age_s: number | null;
  recent_missions_24h: number;
  recent_missions_7d: number;
  recent_history: {
    id: string;
    status: string;
    mission_kind: string;
    created_at: string;
    override_reason?: string | null;
    last_progress?: {
      status?: string;
      occurred_at?: string;
      recorded_basis?: string;
      reported_by?: string;
    } | null;
  }[];
  in_band: boolean;
  suggested: boolean;
};
type Candidates = { items: Candidate[]; unknown_position: Candidate[] };

function NearbyAddress({ coordinates }: { coordinates?: [number, number] }) {
  const longitude = coordinates?.[0];
  const latitude = coordinates?.[1];
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    if (longitude === undefined || latitude === undefined) return;
    const controller = new AbortController();
    setAddress(null);
    void fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${encodeURIComponent(`${longitude},${latitude}`)}&langCode=VI&featureTypes=Locality&forStorage=false&f=json`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value: { address?: { Match_addr?: string; CountryCode?: string } } | null) => {
        if (!controller.signal.aborted) setAddress(value?.address?.CountryCode === 'VNM' ? value.address.Match_addr?.trim() || '' : '');
      })
      .catch(() => { if (!controller.signal.aborted) setAddress(''); });
    return () => controller.abort();
  }, [longitude, latitude]);
  if (longitude === undefined || latitude === undefined) return <>Chưa có vị trí</>;
  return <>{address === null ? 'Đang tìm khu vực gần vị trí SOS…' : address ? `Gần ${address}` : 'Chưa tìm được khu vực gần đúng; xem ghim trên bản đồ.'}</>;
}

type DuplicateCandidate = {
  id: string;
  tracking_code?: string;
  category: string;
  status: string;
  received_at: string;
  distance_m: number;
};

function DuplicateComparison({ id, code }: { id: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let live = true;
    setDetail(null);
    setError('');
    api<Detail>('response', `/requests/${id}`).then(value => {
      if (live) setDetail(value);
    }).catch(cause => {
      if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải hồ sơ để đối chiếu.');
    });
    return () => { live = false; };
  }, [id, open]);
  return <div className="form-stack">
    <button type="button" className="button secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Ẩn thông tin đối chiếu' : `Xem hồ sơ ${code} để đối chiếu`}
    </button>
    {open && <section aria-label={`Thông tin đối chiếu ${code}`}>
      {error ? <p className="notice error" role="alert">{error}</p> : !detail ? <p role="status">Đang tải hồ sơ đối chiếu…</p> : <>
        <p><strong>{detail.tracking_code}</strong> · {requestStatusLabel(detail.status)}</p>
        <p>{detail.description || 'Chưa có mô tả tình huống.'}</p>
        <p>{detail.subject.people_affected == null ? 'Chưa rõ số người cần hỗ trợ' : `${detail.subject.people_affected} người cần hỗ trợ`}</p>
        <p>{detail.declared_danger ? 'Người báo có khai nguy hiểm tính mạng.' : 'Chưa khai báo nguy hiểm tính mạng.'}</p>
        {detail.subject.location && <p>Vị trí: {detail.subject.location.coordinates[1].toFixed(6)}, {detail.subject.location.coordinates[0].toFixed(6)}</p>}
        <p>Hai vị trí gần nhau chưa đủ để kết luận cùng một hộ hoặc cùng sự việc.</p>
      </>}
    </section>}
  </div>;
}

function MissionOutcome({ id }: { id: string }) {
  const [events, setEvents] = useState<{ reason?: string; outcome_note?: string; to_status?: string; occurred_at?: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api<{ timeline: { items: typeof events } }>('response', '/missions/' + id)
      .then((value) => { if (live) setEvents(value.timeline.items); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải ghi chú nhiệm vụ.'); });
    return () => { live = false; };
  }, [id]);
  return <>{events.filter((event) => event.reason || event.outcome_note).map((event, index) => <p key={index}>
    <strong>{label(event.to_status)}:</strong> {event.reason}{event.reason && event.outcome_note ? ' · ' : ''}{event.outcome_note}
  </p>)}{error && <p role="alert" className="notice error">{error}</p>}</>;
}

function SosCommandPopup({ spec, onSuccess, onStale }: { spec: CommandSpec; onSuccess: () => void; onStale: () => void }) {
  const [open, setOpen] = useState(false);
  if (!spec.fields) return <CommandForm spec={spec} onSuccess={onSuccess} onStale={onStale} />;
  return <div className="sos-action-entry">
    <button type="button" className="button" onClick={() => setOpen(true)}>{spec.title}</button>
    <DetailSurface modal open={open} label={spec.title} className="sos-command-dialog" onClose={() => setOpen(false)}>
      <CommandForm spec={spec} onSuccess={() => { setOpen(false); onSuccess(); }} onStale={onStale} />
    </DetailSurface>
  </div>;
}

function CancelRequestPopup({ requestId, version, onCompleted, onStale }: {
  requestId: string; version: number; onCompleted: () => void; onStale: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="secondary-command">
    <button type="button" className="secondary-action-button" onClick={() => setOpen(true)}>Hủy yêu cầu</button>
    <DetailSurface modal open={open} label="Hủy yêu cầu" onClose={() => setOpen(false)}>
      <AsyncRequestForm requestId={requestId} version={version} kind="cancel"
        onCompleted={() => { setOpen(false); onCompleted(); }}
        onStale={() => { setOpen(false); onStale(); }} />
    </DetailSurface>
  </div>;
}

const recordedBasisLabel: Record<string, string> = {
  RADIO: 'Bộ đàm', PHONE: 'Điện thoại', IN_PERSON: 'Trao đổi trực tiếp', OTHER: 'Cách khác',
};
/** Who reported a coordinator-recorded update and over which channel; empty for updates the team sent itself. */
function recordedByLabel(basis?: string | null, reportedBy?: string | null): string {
  return basis ? `Ghi nhận thay · ${recordedBasisLabel[basis] ?? 'Cách khác'}${reportedBy ? ` · người báo: ${reportedBy}` : ''}` : '';
}
function localDateTimeValue(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

function CoordinatorMissionControl({ missionId, teamId, revision, onSuccess, onStale }: {
  missionId: string; teamId: string; revision: number; onSuccess: () => void; onStale: () => void;
}) {
  const [mission, setMission] = useState<{ status: string; version: number } | null>(null);
  const [reportingMode, setReportingMode] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [loadError, setLoadError] = useState('');
  const [teamError, setTeamError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  useEffect(() => {
    let live = true;
    // Keep the mounted form during polling; its version key resets stale drafts.
    Promise.allSettled([
      api<{ status: string; version: number }>('response', `/missions/${missionId}`),
      api<{ reporting_mode: string; external_contact_note?: string | null }>('response', `/teams/${teamId}`),
    ]).then(([missionResult, teamResult]) => {
      if (!live) return;
      setMission(missionResult.status === 'fulfilled' ? missionResult.value : null);
      setLoadError(missionResult.status === 'rejected'
        ? missionResult.reason instanceof Error ? missionResult.reason.message : 'Không thể tải nhiệm vụ.' : '');
      setReportingMode(teamResult.status === 'fulfilled' ? teamResult.value.reporting_mode : '');
      setContactNote(teamResult.status === 'fulfilled' ? teamResult.value.external_contact_note?.trim() ?? '' : '');
      setTeamError(teamResult.status === 'rejected'
        ? teamResult.reason instanceof Error ? teamResult.reason.message : 'Không thể tải đội cứu hộ.' : '');
    });
    return () => { live = false; };
  }, [missionId, teamId, revision, loadRevision]);
  const retry = <button type="button" className="button secondary" onClick={() => setLoadRevision(value => value + 1)}>Thử tải lại điều khiển nhiệm vụ</button>;
  if (loadError) return <><p role="alert" className="notice error">Không tải được trạng thái nhiệm vụ: {loadError}</p>{retry}</>;
  if (!mission) return <p role="status">Đang tải nhiệm vụ…</p>;
  if (!['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(mission.status)) return <p className="notice">Nhiệm vụ đã chuyển sang {label(mission.status)}. Bấm Làm mới SOS để tải lại hồ sơ.</p>;
  const cancel = <SosCommandPopup
    key={`${missionId}-${mission.version}-cancel`}
    spec={{ title: 'Hủy giao nhiệm vụ', service: 'response', path: `/missions/${missionId}/cancel`,
      version: mission.version, warning: 'Xác nhận hủy nhiệm vụ này? Đội sẽ không tiếp tục xử lý nhiệm vụ đã hủy.',
      fields: [{ name: 'reason', label: 'Lý do hủy nhiệm vụ', type: 'textarea', required: true, maxLength: 2000 }] }}
    onSuccess={onSuccess} onStale={onStale}
  />;
  if (teamError) return <><p role="alert" className="notice warning">Không tải được chế độ báo cáo của đội: {teamError} Chưa thể ghi tiến độ thay đội.</p>{retry}{cancel}</>;
  if (!reportingMode) return <p role="status">Đang tải thông tin đội…</p>;
  if (reportingMode !== 'COORDINATOR') return cancel;
  const next = { OFFERED: 'ACCEPTED', ACCEPTED: 'EN_ROUTE', EN_ROUTE: 'ON_SCENE', ON_SCENE: 'COMPLETED' }[mission.status];
  if (!next) return cancel;
  return <>{contactNote && <p className="notice"><strong>Đầu mối liên hệ của đội:</strong> {contactNote}</p>}<CommandForm
    key={`${missionId}-${mission.version}`}
    spec={{
      title: 'Ghi tiến độ qua liên lạc',
      service: 'response', path: `/missions/${missionId}/record-on-behalf`, version: mission.version,
      fields: [
        { name: 'to', label: 'Trạng thái được đội báo', type: 'select', required: true,
          options: [
            { value: next, label: { ACCEPTED: 'Đội đã nhận', EN_ROUTE: 'Đội đang di chuyển', ON_SCENE: 'Đội đã đến nơi', COMPLETED: 'Đội đã hoàn thành' }[next] || 'Tiến độ tiếp theo' },
            ...(mission.status === 'OFFERED' ? [{ value: 'DECLINED', label: 'Đội từ chối nhiệm vụ' }] : []),
            { value: 'FAILED', label: 'Nhiệm vụ thất bại' },
          ] },
        { name: 'recorded_basis', label: 'Cách nhận thông tin', type: 'select', required: true,
          options: [{ value: 'RADIO', label: 'Bộ đàm' }, { value: 'PHONE', label: 'Điện thoại' },
            { value: 'IN_PERSON', label: 'Trao đổi trực tiếp' }, { value: 'OTHER', label: 'Cách khác' }] },
        { name: 'reported_by', label: 'Người báo từ đội', required: true, maxLength: 200 },
        { name: 'occurred_at', label: 'Thời điểm đội báo', type: 'datetime-local', required: true, initialValue: localDateTimeValue() },
        { name: 'reason', label: 'Nội dung xác nhận', required: true, type: 'textarea', maxLength: 2000 },
        { name: 'outcome_note', label: 'Kết quả nhiệm vụ', required: true, type: 'textarea', maxLength: 2000,
          visibleWhen: { field: 'to', value: 'COMPLETED' } },
      ],
      build: (values) => ({ to: values.to, recorded_basis: values.recorded_basis, reported_by: values.reported_by,
        reason: values.reason, occurred_at: new Date(values.occurred_at).toISOString(),
        ...(values.to === 'COMPLETED' ? { result: { outcome_note: values.outcome_note } } : {}) }),
    }}
    onSuccess={onSuccess} onStale={onStale}
  />{cancel}</>;
}
const priorities = ['P1', 'P2', 'P3', 'P4'].map((value) => ({ value, label: value }));
const stateFilter: Record<string, string> = {
  verify: '',
  triage: 'VERIFIED',
  assign: 'TRIAGED',
};
const queueStatuses = [
  ['', 'Tất cả trạng thái'],
  ['SUBMITTED', 'Chờ xác minh'],
  ['VERIFYING', 'Đang xác minh'],
  ['VERIFIED', 'Đã xác minh'],
  ['TRIAGED', 'Đã quyết định ưu tiên'],
  ['DISPATCHED', 'Đã giao đội'],
  ['IN_PROGRESS', 'Đang thực hiện'],
  ['RESOLVING', 'Đang kết thúc'],
  ['RESOLVED', 'Đã giải quyết'],
  ['CLOSED', 'Đã đóng'],
  ['REJECTED', 'Đã từ chối'],
  ['DUPLICATE', 'Trùng yêu cầu'],
  ['CANCELLED', 'Đã hủy'],
] as const;
const reviewLanes = ['NORMAL', 'RATE_LIMITED_REVIEW', 'PROXY_QUOTA_REVIEW'] as const;
type QueueView = { status: string; reviewLane: string; overdue: boolean };
const sosTabs = ['overview', 'dispatch', 'history'] as const;
type SosTab = typeof sosTabs[number];

function sosRoute(page: string): { id: string | null; tab: SosTab } {
  const params = new URL(window.location.href).searchParams;
  const id = ['queue', 'verify', 'triage', 'assign'].includes(page) ? params.get('sos_id') : null;
  const rawTab = params.get('sos_tab');
  return {
    id: id && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) ? id : null,
    tab: rawTab === 'review' || rawTab === 'ai' ? 'overview' : sosTabs.find((tab) => tab === rawTab) ?? 'overview',
  };
}

function queueViewKey(userId: string, page: string): string {
  return `c48:coordinator-queue:${userId}:${page}`;
}

function readQueueView(userId: string, page: string): QueueView {
  const fallback: QueueView = { status: stateFilter[page] || '', reviewLane: 'NORMAL', overdue: false };
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(queueViewKey(userId, page)) || 'null') as Partial<QueueView> | null;
    if (!stored || typeof stored !== 'object') return fallback;
    return {
      status: queueStatuses.some(([value]) => value === stored.status) ? stored.status! : fallback.status,
      reviewLane: reviewLanes.some((value) => value === stored.reviewLane) ? stored.reviewLane! : 'NORMAL',
      overdue: stored.overdue === true,
    };
  } catch {
    return fallback;
  }
}
const title: Record<string, string> = {
  queue: 'Danh sách SOS',
  verify: 'Xác minh yêu cầu',
  triage: 'Quyết định ưu tiên',
  assign: 'Chọn đội cứu hộ',
};
const advisoryFactLabels: Record<string, string> = {
  people_affected: 'Tổng số người cần hỗ trợ',
  children_count: 'Số trẻ em',
  elderly_count: 'Số người cao tuổi',
  life_threat: 'Có nguy cơ tính mạng',
  needs_rescue: 'Cần đội cứu hộ',
  needs_relief_supplies: 'Cần hàng cứu trợ',
};
const advisoryReasonLabels: Record<string, string> = {
  CATASTROPHIC_TRAPPING: 'Có người mắc kẹt sau nổ hoặc sập',
  FIRE_SMOKE_ENTRAPMENT: 'Có người kẹt trong khói lửa hoặc thiếu oxy',
  DECLARED_LIFE_DANGER: 'Người báo khai có nguy hiểm tính mạng',
  FLOOD_OR_TRAPPED: 'Có dấu hiệu ngập lụt hoặc mắc kẹt',
  CHILDREN_PRESENT: 'Có trẻ em',
  ELDERLY_PRESENT: 'Có người cao tuổi',
  LARGE_GROUP_AFFECTED: 'Có nhiều người cần hỗ trợ',
  INJURY_OR_MEDICAL: 'Có dấu hiệu chấn thương hoặc cần cấp cứu',
  URGENT_MEDICAL_REVIEW_REQUIRED: 'Có dấu hiệu cấp cứu cần điều phối viên rà soát ngay',
  RESCUE_REQUESTED: 'Có yêu cầu cứu hộ',
  RELIEF_SUPPLIES_ONLY: 'Chỉ yêu cầu hàng cứu trợ',
};
const advisoryLevelLabels: Record<string, string> = {
  CRITICAL: 'Rất khẩn cấp',
  HIGH: 'Nguy cơ cao',
  ELEVATED: 'Cần ưu tiên rà soát',
  STANDARD: 'Theo dõi thông thường',
};
const advisoryStatusLabels: Record<string, string> = {
  QUEUED: 'Đang chờ AI đánh giá',
  PROCESSING: 'AI đang đánh giá',
  COMPLETED: 'Đã có kết quả AI',
  STALE: 'Thông tin SOS đã đổi; kết quả AI cần cập nhật',
  SKIPPED: 'Chưa thực hiện đánh giá AI',
  FAILED: 'Chưa có kết quả AI dùng được',
  UNKNOWN: 'Chưa rõ trạng thái đánh giá AI',
};
const advisoryFailureLabels: Record<string, string> = {
  AI_PROVIDER_ERROR: 'Dịch vụ AI tạm thời không phản hồi. Lượt đánh giá này đã thất bại; không còn chờ kết quả.',
  AI_DAILY_LIMIT: 'Đã hết lượt gọi AI trong ngày. Hãy tiếp tục xác minh thủ công.',
  AI_INVALID_OUTPUT: 'AI đã trả dữ liệu không hợp lệ nên hệ thống không sử dụng kết quả.',
  AI_DISABLED: 'Chức năng AI hiện chưa được bật.',
};
function campaignDistanceMeters(point: [number, number], center: { lat: number; lng: number } | null): number {
  if (!center) return Number.POSITIVE_INFINITY;
  const [lng, lat] = point;
  const latRadians = (center.lat - lat) * Math.PI / 180;
  const lngRadians = (center.lng - lng) * Math.PI / 180;
  const meanLatitude = (center.lat + lat) * Math.PI / 360;
  return Math.hypot(latRadians, lngRadians * Math.cos(meanLatitude)) * 6_371_000;
}

function advisoryScoreLabel(score: number | null, level: string | null): string {
  if (score === null || !level || !advisoryLevelLabels[level]) return 'Chưa đủ thông tin để đánh giá';
  return `${advisoryLevelLabels[level]} · ${score}/100`;
}

/** Claim window mirrored from the server (CLAIM_TTL_MINUTES = 15); the server remains the authority. */
const CLAIM_WINDOW_MS = 15 * 60_000;

function claimActive(detail: Pick<Detail, 'handled_at'>): boolean {
  return Boolean(detail.handled_at) && Date.now() - Date.parse(detail.handled_at as string) < CLAIM_WINDOW_MS;
}

function claimBlockedBy(detail: Pick<Detail, 'handled_by' | 'handled_at'>, currentUserId: string): boolean {
  return Boolean(detail.handled_by) && detail.handled_by !== currentUserId && claimActive(detail);
}

export function Coordinator({ page, initialRequestId, currentUserId, canSeeUnassigned = false,
  campaignId, campaignMatchState, initialUnassignedOnly = false }: {
  page: string; initialRequestId?: string; currentUserId: string; canSeeUnassigned?: boolean;
  campaignId?: string; campaignMatchState?: 'UNMATCHED' | 'CONFLICT'; initialUnassignedOnly?: boolean;
  user?: Me;
}) {
  const restoredView = useRef<QueueView | null>(null);
  if (!restoredView.current) restoredView.current = readQueueView(currentUserId, page);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueStatus, setQueueStatus] = useState(restoredView.current.status);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [selected, setSelected] = useState<string | null>(() => initialRequestId || sosRoute(page).id);
  const [activeTab, setActiveTab] = useState<SosTab>(() => sosRoute(page).tab);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [candidateError, setCandidateError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateError, setDuplicateError] = useState('');
  const [reviewLane, setReviewLane] = useState(restoredView.current.reviewLane);
  const [overdue, setOverdue] = useState(restoredView.current.overdue);
  const [unassignedOnly, setUnassignedOnly] = useState(initialUnassignedOnly);
  const [queueSearch, setQueueSearch] = useState('');
  const [queueSearchTerm, setQueueSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [completedMissionCycle, setCompletedMissionCycle] = useState<{
    requestId: string; missionId: string; cycle: number | null; error: boolean
  } | null>(null);
  const [showAdditionalDispatch, setShowAdditionalDispatch] = useState(false);
  const [campaignOptions, setCampaignOptions] = useState<{
    value: string; label: string; center: { lat: number; lng: number } | null
  }[]>([]);
  useEffect(() => {
    let live = true;
    async function loadCampaigns() {
      try {
        const campaigns: { id: string; name: string; status: string; center: { lat: number; lng: number } | null }[] = [];
        let cursor = '';
        do {
          const query = new URLSearchParams({ limit: '100' });
          if (cursor) query.set('cursor', cursor);
          const page = await api<{ items: typeof campaigns; more: boolean; cursor?: string }>('response', `/campaigns?${query}`);
          campaigns.push(...page.items);
          cursor = page.more ? page.cursor || '' : '';
        } while (cursor);
        if (live) setCampaignOptions(campaigns
          .filter((campaign) => campaign.status === 'ACTIVE')
          .map((campaign) => ({ value: campaign.id, label: campaign.name, center: campaign.center })));
      } catch {
        if (live) setCampaignOptions([]);
      }
    }
    void loadCampaigns();
    return () => { live = false; };
  }, [revision]);
  const refreshReasonRef = useRef<'success' | 'stale' | null>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const listScrollRef = useRef(0);
  useEffect(() => {
    const restored = readQueueView(currentUserId, page);
    setQueueStatus(restored.status);
    setCursor('');
    const route = sosRoute(page);
    const requestId = initialRequestId || route.id;
    setSelected(requestId);
    setActiveTab(route.tab);
    if (initialRequestId && route.id !== initialRequestId) {
      const url = new URL(window.location.href);
      url.searchParams.set('sos_id', initialRequestId);
      url.searchParams.delete('sos_tab');
      window.history.replaceState(null, '', url);
    }
    setReviewLane(restored.reviewLane);
    setOverdue(restored.overdue);
    setDetail(null);
    setUpdateMessage('');
    refreshReasonRef.current = null;
  }, [page, initialRequestId, currentUserId]);
  useEffect(() => {
    const restore = () => {
      const route = sosRoute(page);
      setSelected(route.id);
      setActiveTab(route.tab);
      setDetail(null);
      setDetailError('');
      setUpdateMessage('');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [page]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(queueViewKey(currentUserId, page), JSON.stringify({
        status: queueStatus, reviewLane, overdue,
      } satisfies QueueView));
    } catch {
      // The queue remains usable when session storage is unavailable.
    }
  }, [currentUserId, page, queueStatus, reviewLane, overdue]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRevision((value) => value + 1);
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);
  const hasActiveMissions = Boolean(detail?.active_missions?.items.length);
  const hasPendingAi = [detail?.ai_advisory?.status, detail?.ai_priority_advisory?.status]
    .some((status) => status === 'QUEUED' || status === 'PROCESSING');
  useEffect(() => {
    if (!selected) return;
    const refreshActiveMissionDetail = () => {
      if (document.visibilityState === 'visible') setDetailRevision((value) => value + 1);
    };
    const timer = hasActiveMissions || hasPendingAi ? window.setInterval(refreshActiveMissionDetail, 5000) : null;
    window.addEventListener('focus', refreshActiveMissionDetail);
    document.addEventListener('visibilitychange', refreshActiveMissionDetail);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('focus', refreshActiveMissionDetail);
      document.removeEventListener('visibilitychange', refreshActiveMissionDetail);
    };
  }, [selected, hasActiveMissions, hasPendingAi]);
  const latestCompletedMissionId = detail?.id === selected && ['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(detail.status)
    ? detail.mission_history?.items.find((mission) => mission.status === 'COMPLETED')?.id
    : undefined;
  useEffect(() => {
    setShowAdditionalDispatch(false);
  }, [selected, detail?.work_cycle, latestCompletedMissionId]);
  useEffect(() => {
    if (!selected || !latestCompletedMissionId) return;
    let live = true;
    api<{ work_cycle: number }>('response', `/missions/${latestCompletedMissionId}`)
      .then((mission) => {
        if (live) setCompletedMissionCycle({ requestId: selected, missionId: latestCompletedMissionId,
          cycle: mission.work_cycle, error: false });
      })
      .catch(() => {
        if (live) setCompletedMissionCycle({ requestId: selected, missionId: latestCompletedMissionId,
          cycle: null, error: true });
      });
    return () => { live = false; };
  }, [selected, latestCompletedMissionId]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(LIST_PAGE_SIZE) });
    if (queueStatus) params.set('status', queueStatus);
    if (cursor) params.set('cursor', cursor);
    if (reviewLane) params.set('review_lane', reviewLane);
    if (overdue) params.set('overdue', 'true');
    if (unassignedOnly && canSeeUnassigned) params.set('unassigned', 'true');
    if (campaignId) params.set('campaign_id', campaignId);
    if (campaignMatchState && canSeeUnassigned) params.set('campaign_match_state', campaignMatchState);
    const request = queueSearchTerm
      ? api<Queue>('response', '/requests/search', {
        method: 'POST',
        body: { ...Object.fromEntries(params.entries()), q: queueSearchTerm },
      })
      : api<Queue>('response', `/requests${params.size ? '?' + params : ''}`);
    request
      .then((value) => {
        if (live) setQueue({ ...value, items: value.items.filter((item) => !claimBlockedBy(item, currentUserId)) });
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải hàng đợi.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, queueStatus, cursor, revision, reviewLane, overdue, unassignedOnly, canSeeUnassigned, campaignId, campaignMatchState, currentUserId, queueSearchTerm]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDetailError('');
    setCandidateError('');
    api<Detail>('response', `/requests/${selected}`)
      .then((value) => {
        if (live) {
          setDetail(value);
          if (refreshReasonRef.current) {
            const reason = refreshReasonRef.current;
            refreshReasonRef.current = null;
            if (reason === 'success' && value.status === 'TRIAGED') {
              setActiveTab('dispatch');
              const url = new URL(window.location.href);
              url.searchParams.set('sos_tab', 'dispatch');
              window.history.replaceState(null, '', url);
            }
            setQueueStatus(value.status);
            setCursor('');
            setUpdateMessage(reason === 'success'
                ? `Đã cập nhật. Trạng thái hiện tại: ${requestStatusLabel(value.status)}.`
                : `Đã tải lại hồ sơ. Trạng thái hiện tại: ${requestStatusLabel(value.status)}.`);
          }
        }
      })
      .catch((cause) => {
        if (live) {
          refreshReasonRef.current = null;
          setUpdateMessage('');
          setDetail(null);
          if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
            setDetailError('Hồ sơ này không còn trong phạm vi được phép xem. Quay về Danh sách SOS để chọn hồ sơ khác.');
          } else {
            setDetailError(cause instanceof Error ? cause.message : 'Không thể tải lại hồ sơ.');
          }
        }
      });
    return () => {
      live = false;
    };
  }, [selected, revision, detailRevision]);
  useEffect(() => { setCandidates(null); }, [selected]);
  useEffect(() => {
    if (!selected || !detail || detail.status !== 'TRIAGED') return;
    let live = true;
    setCandidateError('');
    api<Candidates>('response', `/requests/${selected}/team-candidates`)
      .then((value) => {
        if (live) setCandidates(value);
      })
      .catch((cause) => {
        if (live)
          setCandidateError(cause instanceof Error ? cause.message : 'Không thể tải đội phù hợp.');
      });
    return () => {
      live = false;
    };
  }, [selected, detail]);
  useEffect(() => {
    if (!selected || detail?.status !== 'VERIFYING') {
      setDuplicates([]);
      setDuplicateError('');
      return;
    }
    let live = true;
    setDuplicateError('');
    api<{ items: DuplicateCandidate[] }>('response', `/requests/${selected}/duplicate-candidates`)
      .then((value) => {
        if (live) setDuplicates(value.items);
      })
      .catch((cause) => {
        if (live)
          setDuplicateError(
            cause instanceof Error ? cause.message : 'Không thể kiểm tra yêu cầu có thể trùng.'
          );
      });
    return () => {
      live = false;
    };
  }, [selected, detail?.status, revision]);
  const done = useCallback(() => {
    refreshReasonRef.current = 'success';
    setUpdateMessage('Đã lưu thay đổi. Đang tải trạng thái mới từ máy chủ…');
    setRevision((value) => value + 1);
  }, []);
  const referralDone = useCallback(() => {
    if (!detail) return;
    const requestId = detail.id;
    void (async () => {
      setUpdateMessage('Đã ghi nhận chuyển cơ quan chức năng. Đang kiểm tra điều kiện đóng SOS…');
      try {
        let current = await api<Detail>('response', `/requests/${requestId}`);
        if (!['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(current.status)) {
          setUpdateMessage('Đã ghi nhận chuyển cơ quan. SOS cần được xác minh và đặt ưu tiên trước khi kết thúc.');
          return;
        }
        const resolution = await api<{ operation_id: string }>('response', `/requests/${requestId}/resolve`, {
          method: 'POST', idempotencyKey: newCommandKey(),
          body: { expected_version: current.version, outcome_basis: 'NO_ACTION_REQUIRED',
            resolution_reason: 'Đã chuyển thông tin cho cơ quan chức năng tiếp nhận; Reliva không tiếp tục điều đội hoặc cấp phát cho yêu cầu này.' },
        });
        for (let attempt = 0; attempt < 6; attempt++) {
          const operation = await api<{ state: string }>('response', `/operations/${resolution.operation_id}`);
          if (operation.state === 'ABORTED') throw new Error('Thao tác kết thúc đã bị hủy. Hãy kiểm tra lịch sử SOS.');
          if (operation.state === 'COMPLETED') break;
          if (attempt === 5) {
            setUpdateMessage('Đã ghi nhận chuyển cơ quan. Thao tác kết thúc đang chờ; xem trạng thái trong hồ sơ trước khi đóng.');
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
        current = await api<Detail>('response', `/requests/${requestId}`);
        if (current.status !== 'RESOLVED') throw new Error('SOS chưa ở trạng thái đã xử lý. Hãy kiểm tra lịch sử trước khi đóng.');
        await api('response', `/requests/${requestId}/close`, {
          method: 'POST', idempotencyKey: newCommandKey(), body: { expected_version: current.version },
        });
        setUpdateMessage('Đã ghi nhận chuyển cơ quan chức năng và đóng SOS.');
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : 'Không thể tự đóng SOS.';
        setUpdateMessage(`Đã ghi nhận chuyển cơ quan. Chưa thể đóng SOS: ${reason} Kiểm tra điều kiện kết thúc trong hồ sơ.`);
      } finally {
        setRevision((value) => value + 1);
      }
    })();
  }, [detail]);
  const runClaim = useCallback(async (action: 'claim' | 'release') => {
    if (!detail) return;
    setClaimBusy(true);
    setClaimError('');
    try {
      await api('response', `/requests/${detail.id}/${action}`, {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : 'Không thể cập nhật trạng thái nhận xử lý.');
    } finally {
      setClaimBusy(false);
      setDetailRevision((value) => value + 1);
    }
  }, [detail]);
  const refreshAfterConflict = useCallback(() => {
    refreshReasonRef.current = 'stale';
    setUpdateMessage('Đang tải lại hồ sơ để kiểm tra trạng thái.');
    setRevision((value) => value + 1);
  }, []);
  function command(spec: CommandSpec, onSuccess = done) {
    return (
      <SosCommandPopup
        key={spec.path + spec.title + detail?.version}
        spec={spec}
        onSuccess={onSuccess}
        onStale={refreshAfterConflict}
      />
    );
  }
  function secondaryCommand(spec: CommandSpec, tone?: 'danger', onSuccess = done) {
    return (
      <div className={`secondary-command${tone ? ` secondary-command--${tone}` : ''}`}>
        {command(spec, onSuccess)}
      </div>
    );
  }
  function aiResubmitAction(status: string | undefined) {
    if (!detail) return null;
    if (!reliefDescription(detail.description).narrative.trim() && !detail.description?.trim()) {
      return <small className="muted">AI cần mô tả tình huống để đánh giá; hồ sơ này chưa có nên hãy xác minh trực tiếp.</small>;
    }
    const title = status === 'SKIPPED' || status === 'STALE' || !detail.ai_advisory
      ? 'Yêu cầu AI đánh giá' : 'Gửi lại cho AI đánh giá';
    if (status === 'FAILED' && detail.ai_advisory && !detail.ai_advisory.review_status) {
      return command({
        title, hideTitle: true, service: 'response',
        path: `/requests/${detail.id}/ai-advisories/${detail.ai_advisory.id}/retry`,
        version: detail.version,
        warning: 'Gửi lại yêu cầu đánh giá AI? Kết quả vẫn chỉ để tham khảo.',
      });
    }
    if (!detail.ai_advisory || status === 'STALE' || status === 'SKIPPED') {
      return command({
        title, hideTitle: true, service: 'response',
        path: `/requests/${detail.id}/ai-advisories`,
        version: detail.version,
        warning: 'Gửi thông tin SOS đã rút gọn cho AI đánh giá? Kết quả chỉ để tham khảo.',
      });
    }
    const reason = status === 'QUEUED' || status === 'PROCESSING'
      ? 'Yêu cầu AI đã ở trong hàng đợi; gửi thêm lúc này không tạo lượt đánh giá mới.'
      : 'Đã có kết quả AI. Hệ thống hiện chỉ cho gửi lại khi đánh giá lỗi hoặc thông tin SOS thay đổi.';
    return <div className="sos-ai-resubmit">
      <button type="button" className="button secondary" disabled aria-describedby="sos-ai-resubmit-reason">{title}</button>
      <small id="sos-ai-resubmit-reason">{reason}</small>
    </div>;
  }
  const aiFacts = detail?.ai_advisory?.extracted_json?.facts;
  const hasReadyEvidence = Boolean(detail?.evidence?.items.some((item) => item.state === 'READY'));
  const aiCountMismatches = detail
    ? (['people_affected', 'children_count', 'elderly_count'] as const).filter(key =>
      typeof aiFacts?.[key] === 'number' && aiFacts[key] !== detail.subject[key])
    : [];
  const aiNeedsMismatch = Boolean(detail && typeof aiFacts?.needs_rescue === 'boolean' &&
    aiFacts.needs_rescue !== detail.needs_rescue);
  const reviewedSupplementIds = new Set(
    detail?.timeline.items.filter((event) => event.event_type === 'SUPPLEMENT_REVIEW')
      .map((event) => event.payload?.reviewed_event_id).filter((id): id is string => typeof id === 'string') ?? []
  );
  const pendingSupplements = detail?.timeline.items.filter((event) =>
    event.event_type === 'REPORTER_SUPPLEMENT' && event.payload?.pending_review === true && !reviewedSupplementIds.has(event.id)
  ) ?? [];
  const pendingOperationId = detail?.status === 'RESOLVING'
    ? operationIdFromTimeline(detail.timeline.items)
    : undefined;
  const completionCheck = latestCompletedMissionId && completedMissionCycle?.requestId === selected &&
    completedMissionCycle.missionId === latestCompletedMissionId ? completedMissionCycle : null;
  const completedInCurrentCycle = Boolean(detail && completionCheck &&
    completionCheck.cycle === detail.work_cycle);
  const showTeamCandidates = !latestCompletedMissionId ||
    (completionCheck && !completionCheck.error && (!completedInCurrentCycle || showAdditionalDispatch));
  function openRequest(id: string) {
    if (selected === id) { if (detailError) setDetailRevision(value => value + 1); return; }
    if (!selected) listScrollRef.current = window.scrollY;
    const url = new URL(window.location.href);
    url.searchParams.set('sos_id', id);
    url.searchParams.delete('sos_tab');
    window.history.pushState(null, '', url);
    setSelected(id);
    setActiveTab('overview');
    setDetail(null);
    setDetailError('');
    setUpdateMessage('');
    window.scrollTo({ top: 0 });
  }
  function submitQueueSearch(event: React.FormEvent) {
    event.preventDefault();
    const nextTerm = queueSearch.trim();
    setCursor('');
    setSelected(null);
    setDetail(null);
    if (nextTerm === queueSearchTerm) setRevision((value) => value + 1);
    else setQueueSearchTerm(nextTerm);
  }
  function returnToList() {
    const url = new URL(window.location.href);
    url.searchParams.delete('sos_id');
    url.searchParams.delete('sos_tab');
    window.history.replaceState(null, '', url);
    setSelected(null);
    setDetail(null);
    setDetailError('');
    setUpdateMessage('');
    requestAnimationFrame(() => window.scrollTo({ top: listScrollRef.current }));
  }
  function changeTab(tab: SosTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('sos_tab');
    else url.searchParams.set('sos_tab', tab);
    window.history.replaceState(null, '', url);
    requestAnimationFrame(() => document.getElementById('sos-detail-content')?.scrollIntoView({ block: 'start' }));
  }
  return (
    <div className="coordinator-layout coordinator-sos-layout">
      {!selected && <section className="card">
        <h2>{title[page] || title.queue}</h2>
        <div className="queue-filter-toolbar">
          <button
            type="button"
            className="button secondary queue-refresh-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            <span aria-hidden="true">↻</span> Làm mới SOS
          </button>
          <TeamReadinessQueue refreshRevision={revision} onChanged={() => { setRevision(value => value + 1); setDetailRevision(value => value + 1); }} />
        </div>
        <form className="queue-search-form" onSubmit={submitQueueSearch} role="search">
          <label htmlFor="coordinator-sos-search">Tìm SOS theo mã SOS hoặc số điện thoại</label>
          <div className="queue-search-row">
            <input
              id="coordinator-sos-search"
              type="search"
              value={queueSearch}
              maxLength={32}
              onChange={(event) => setQueueSearch(event.target.value)}
              placeholder="Nhập mã SOS hoặc số điện thoại"
              autoComplete="off"
            />
            <button type="submit" className="button secondary" disabled={loading}>Tìm kiếm</button>
            {queueSearchTerm && <button type="button" className="button secondary" disabled={loading}
              onClick={() => { setQueueSearch(''); setQueueSearchTerm(''); setCursor(''); setSelected(null); setDetail(null); }}>
              Xóa lọc
            </button>}
          </div>
        </form>
        <div className="queue-filter-fields queue-filter-quick">
            <label className="queue-status-field">
            <span>Trạng thái yêu cầu</span>
            <span className="queue-status-select-wrap">
              <Dropdown
                value={queueStatus}
                onChange={(event) => {
                  setQueueStatus(event.target.value);
                  setCursor('');
                }}
              >
                {queueStatuses.map(([status, name]) => (
                  <option key={status} value={status}>
                    {name}
                  </option>
                ))}
              </Dropdown>
            </span>
            </label>
            <label className="queue-status-field">
            <span>Nhóm rà soát</span>
            <span className="queue-status-select-wrap">
              <Dropdown
                value={reviewLane}
                onChange={(event) => {
                  setReviewLane(event.target.value);
                  setCursor('');
                }}
              >
                {[
                  ['NORMAL', 'Thông thường'],
                  ['RATE_LIMITED_REVIEW', 'Báo lặp cần rà soát'],
                  ['PROXY_QUOTA_REVIEW', 'Báo hộ cần rà soát'],
                ].map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </Dropdown>
            </span>
            </label>
            <label className="check queue-attention-filter">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(event) => {
                setOverdue(event.target.checked);
                setCursor('');
              }}
            />
            Chỉ xem yêu cầu cần chú ý
            </label>
            {canSeeUnassigned && (
              <label className="check queue-attention-filter">
                <input
                  type="checkbox"
                  checked={unassignedOnly}
                  onChange={(event) => {
                    setUnassignedOnly(event.target.checked);
                    setCursor('');
                    setSelected(null);
                  }}
                />
                Hàng chờ chung (chưa gắn chiến dịch)
              </label>
            )}
        </div>
        {loading && <p role="status">Đang cập nhật danh sách…</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {queue && (
          <>
            <p className="muted">Cập nhật: {timeLabel(queue.generated_at)}</p>
            {queue.items.length === 0 && (
              <div className="empty">{queueSearchTerm
                ? 'Không tìm thấy SOS phù hợp với mã hoặc số điện thoại đã nhập.'
                : 'Không có SOS nào khả dụng trên trang này. Những SOS đang do điều phối viên khác tiếp nhận đã được ẩn.'}</div>
            )}
            {queue.items.length > 0 && <div className="sos-table-scroll" role="region" aria-label="Bảng danh sách SOS" tabIndex={0}>
              <table className="sos-table">
                <thead><tr><th scope="col">Mã SOS</th><th scope="col">Tín hiệu cần chú ý</th><th scope="col">Loại sự cố</th><th scope="col">Số người</th><th scope="col">Ưu tiên</th><th scope="col">Trạng thái</th><th scope="col">Tiếp nhận</th></tr></thead>
                <tbody>{queue.items.map((item) => <tr key={item.id} className={selected === item.id ? 'is-selected' : ''}
                  onClick={() => openRequest(item.id)}>
                  <td><button type="button" className="sos-table-open" onClick={(event) => { event.stopPropagation(); openRequest(item.id); }}
                    aria-label={`Mở hồ sơ SOS ${item.tracking_code}`}>{item.tracking_code}</button></td>
                  <td><div className="sos-table-signals">
                    {item.declared_danger && <span className="queue-danger-chip">Nguy hiểm tính mạng</span>}
                    {item.review_lane === 'RATE_LIMITED_REVIEW' && <span className="chip chip--review">Báo lặp cần rà soát</span>}
                    {item.review_lane === 'PROXY_QUOTA_REVIEW' && <span className="chip chip--review">Báo hộ cần rà soát</span>}
                    {item.tracking_code.startsWith('C48HM') && <span className="chip">Mô phỏng</span>}
                    {item.campaign_match_state === 'CONFLICT' && <span className="chip chip--review">Trùng nhiều vùng chiến dịch</span>}
                    {item.campaign_match_state === 'UNMATCHED' && <span className="chip">Ngoài mọi vùng chiến dịch</span>}
                    {item.campaign_match_state === 'AUTO_ATTACHED' && <span className="chip">Tự động gắn theo vị trí</span>}
                    {item.handled_by_name && <span className="chip">Đang do {item.handled_by_name} xử lý</span>}
                    {['SUBMITTED', 'VERIFYING'].includes(item.status) && item.fast_track && <>
                      {item.fast_track.suggestion_confidence === 'LOW'
                        ? <span className="chip chip--review">Chưa đủ dữ kiện chọn P</span>
                        : <span className="chip chip--suggest" data-priority={item.fast_track.suggested_priority}>Gợi ý {item.fast_track.suggested_priority}</span>}
                      {!item.fast_track.eligible && <span className="chip chip--review">Cần rà soát kỹ</span>}
                    </>}
                    {!['SUBMITTED', 'VERIFYING'].includes(item.status) && item.priority_advisory?.level &&
                      <span className="muted">Đánh giá: {advisoryScoreLabel(item.priority_advisory.score, item.priority_advisory.level)}</span>}
                    {!item.declared_danger && item.review_lane === 'NORMAL' && !item.fast_track && !item.priority_advisory?.level && !item.tracking_code.startsWith('C48HM') && <span className="muted">—</span>}
                  </div></td>
                  <td>{label(item.category)}</td><td>{item.people_affected == null ? 'Chưa rõ' : item.people_affected}</td>
                  <td><PriorityBadge priority={item.priority as 'P1' | 'P2' | 'P3' | 'P4' | null | undefined} /></td>
                  <td><StatusBadge status={item.status} context="sos" /></td><td><time dateTime={item.received_at}>{timeLabel(item.received_at)}</time></td>
                </tr>)}</tbody>
              </table>
            </div>}
            <ListNav page={pageIndex} hasNext={Boolean(queue.more && queue.cursor)} loading={loading} onPrev={prevPage} onNext={() => queue.cursor && setCursor(queue.cursor)} count={queue.items.length} noun="SOS" />
          </>
        )}
      </section>}
      {selected && <section className="card coordinator-detail-surface sos-detail-page"><button type="button" className="button secondary sos-back-to-list" onClick={returnToList}>← Danh sách SOS</button><section
        className="queue-detail-card"
        ref={detailPanelRef}
      >
        {!detail && <h2 className="sos-head__fallback">Hồ sơ yêu cầu</h2>}
        {updateMessage && (
          <p className="notice" role="status">
            {updateMessage}
          </p>
        )}
        {detailError && (
          <p className="notice error" role="alert">
            {detailError}{' '}
            <button
              type="button"
              className="button secondary"
              onClick={() => setRevision((value) => value + 1)}
            >
              Tải lại hồ sơ
            </button>
          </p>
        )}
        {!selected && (
          <div className="empty">Chọn một yêu cầu để xem thông tin được cấp quyền.</div>
        )}
        {selected && !detail && !detailError && <p role="status">Đang tải hồ sơ…</p>}
        {detail && (
          <>
            <header className="sos-head" data-danger={detail.declared_danger ? 'true' : undefined}>
              <div className="sos-head__title">
                <h2>{detail.tracking_code}</h2>
                <StatusBadge status={detail.status} context="sos" />
                {detail.priority
                  ? <PriorityBadge priority={detail.priority as 'P1' | 'P2' | 'P3' | 'P4'} />
                  : <span className="sos-head__nopriority">Chưa chọn ưu tiên</span>}
              </div>
              <fieldset className="sos-head__actions" disabled={claimBlockedBy(detail, currentUserId)}>
              {!['RESOLVING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(detail.status) &&
                secondaryCommand({
                  title: 'Ghi nhận chuyển cơ quan chức năng',
                  hideTitle: true,
                  service: 'response',
                  path: `/requests/${detail.id}/authority-referrals`,
                  fields: [
                    { name: 'referred_body', label: 'Cơ quan tiếp nhận', type: 'text', required: true, maxLength: 200 },
                    { name: 'note', label: 'Cách thức và nội dung đã chuyển', type: 'textarea', required: true, maxLength: 1000 },
                  ],
                  build: (values) => ({
                    referred_body: values.referred_body,
                    note: values.note,
                    expected_version: detail.version,
                  }),
                  warning: 'Xác nhận đã chuyển yêu cầu cho cơ quan chức năng được ghi rõ? Hệ thống sẽ thử kết thúc và đóng SOS nếu đủ điều kiện.',
                }, undefined, referralDone)}
              </fieldset>
              <p className="sos-head__sub">{label(detail.category)} · tiếp nhận {timeLabel(detail.received_at)}</p>
              {detail.mission_history?.items.some((mission) => mission.status === 'COMPLETED') &&
                !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(detail.status) && (
                  <p className="notice" role="status">Đội đã hoàn thành nhiệm vụ cứu hộ. SOS chưa kết thúc{detail.needs_relief_supplies ? '; nhu cầu vật tư được theo dõi riêng.' : '.'}</p>
                )}
            </header>
            {detail.campaign_id && <section className="sos-campaign-context" aria-label="Chiến dịch của SOS">
              <div><small>Chiến dịch cứu trợ</small><strong>{campaignOptions.find(campaign => campaign.value === detail.campaign_id)?.label ?? 'Chiến dịch đã gắn'}</strong></div>
              <fieldset disabled={claimBlockedBy(detail, currentUserId)}>              {canSeeUnassigned && detail.campaign_id &&
                secondaryCommand({
                  title: 'Gỡ khỏi chiến dịch',
                  hideTitle: true,
                  service: 'response',
                  path: `/requests/${detail.id}/detach-campaign`,
                  version: detail.version,
                  fields: [],
                  warning: 'Xác nhận gỡ yêu cầu này khỏi chiến dịch?',
                })}
</fieldset>
            </section>}
            <section className="claim-panel" aria-label="Nhận xử lý hồ sơ">
              {detail.handled_by && claimActive(detail) ? (
                <p role="status" className="notice">
                  {detail.handled_by === currentUserId
                    ? 'Bạn đang nhận xử lý hồ sơ này. Nhớ nhả khi không còn xử lý.'
                    : `Hồ sơ đang do ${detail.handled_by_name || 'người khác'} xử lý.`}
                </p>
              ) : (
                <p className="muted">Chưa có người nhận xử lý. Nhận xử lý để các điều phối viên khác biết bạn đang theo dõi hồ sơ này.</p>
              )}
              {claimError && <p role="alert" className="notice warning">{claimError}</p>}
              {detail.handled_by === currentUserId && claimActive(detail) ? (
                <button type="button" className="button secondary" disabled={claimBusy} onClick={() => void runClaim('release')}>Nhả xử lý</button>
              ) : (
                <button type="button" className="button secondary" disabled={claimBusy || claimBlockedBy(detail, currentUserId)} onClick={() => void runClaim('claim')}>Nhận xử lý</button>
              )}
            </section>
            <div className="sos-detail-tabs" role="tablist" aria-label="Thông tin hồ sơ SOS" onKeyDown={(event) => {
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
                : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
              if (next >= 0) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); }
            }}>
              {([['overview', 'Tổng quan & xác minh'], ['dispatch', 'Điều phối'], ['history', 'Lịch sử']] as const).map(([id, name]) =>
                <button key={id} id={`sos-tab-${id}`} type="button" role="tab" aria-selected={activeTab === id}
                  aria-controls="sos-detail-content" tabIndex={activeTab === id ? 0 : -1} onClick={() => changeTab(id)}>{name}</button>)}
            </div>
            <div id="sos-detail-content" role="tabpanel" aria-labelledby={`sos-tab-${activeTab}`} className="sos-detail-content" data-tab={activeTab} tabIndex={0}>
            <div className="sos-tab-group" hidden={activeTab !== 'overview'}>
            {(detail.declared_danger || detail.proxy_activity_flags.length > 0 || detail.tracking_code.startsWith('C48HM')) && (
              <div className="sos-alerts">
                {detail.declared_danger && <p className="sos-alert sos-alert--danger" role="alert">Người báo cho biết có nguy hiểm tính mạng — kiểm tra ngay.</p>}
                {detail.proxy_activity_flags.length > 0 && <p className="sos-alert sos-alert--warning">Có tín hiệu báo hộ cần rà soát (không phải kết luận gian lận).</p>}
                {detail.tracking_code.startsWith('C48HM') && <p className="sos-alert sos-alert--info">SOS mô phỏng để hiển thị bản đồ nhiệt, không phải tín hiệu cứu hộ thực tế.</p>}
              </div>
            )}
            <section className="sos-profile" id="request-full-detail" aria-labelledby="request-profile-heading">
              <div className="sos-profile__head">
                <h3 id="request-profile-heading">Thông tin hồ sơ SOS</h3>
              </div>
              <p className="sos-profile__description">{reliefDescription(detail.description).narrative || 'Chưa có mô tả tình huống.'}</p>
              <RequestEvidencePanel key={detail.id} items={detail.evidence?.items ?? []} />
              <dl className="sos-profile__facts">
                <div><dt>Sự cố</dt><dd>{label(detail.category)}</dd></div>
                <div><dt>Cần hỗ trợ</dt><dd>
                  {detail.subject.people_affected == null ? 'Chưa rõ số người' : `${detail.subject.people_affected} người`}
                  {detail.subject.children_count != null && detail.subject.children_count > 0 ? ` · ${detail.subject.children_count} trẻ em` : ''}
                  {detail.subject.elderly_count != null && detail.subject.elderly_count > 0 ? ` · ${detail.subject.elderly_count} người cao tuổi` : ''}
                </dd></div>
                <div><dt>Cứu hộ</dt><dd>{detail.needs_rescue ? 'Cần cứu hộ' : 'Chưa khai báo'}</dd></div>
                <div><dt>Hình thức</dt><dd>{detail.report_mode === 'PROXY' ? 'Báo hộ người ở nơi khác' : 'Tự báo / báo cho gia đình'}</dd></div>
                <div><dt>Người báo</dt><dd>{detail.reporter.name || 'Chưa có tên'}{detail.reporter.contact_phone ? ` · ${detail.reporter.contact_phone}` : ' · Chưa có số liên hệ'}</dd></div>
                <div><dt>Khu vực</dt><dd><NearbyAddress coordinates={detail.subject.location?.coordinates} /></dd></div>
                {detail.report_mode === 'PROXY' && <div><dt>Báo hộ</dt><dd>{detail.subject.reporter_relationship || 'Chưa rõ quan hệ'}{detail.subject.beneficiary_contact_phone ? ` · ${detail.subject.beneficiary_contact_phone}` : ''}</dd></div>}
                {detail.subject.alternate_contact?.phone && <div><dt>Liên hệ khác</dt><dd>{[detail.subject.alternate_contact.name, detail.subject.alternate_contact.phone].filter(Boolean).join(' · ')}</dd></div>}
                {detail.campaign_id && <div><dt>Chiến dịch</dt><dd>{campaignOptions.find((campaign) => campaign.value === detail.campaign_id)?.label ?? 'Chiến dịch đã gắn'}</dd></div>}
              </dl>
              {detail.status === 'DUPLICATE' && <div className="sos-profile__duplicate">{detail.canonical ? (
                <>
                  <p>Hồ sơ gốc: {detail.canonical.tracking_code} · {requestStatusLabel(detail.canonical.status)}. Theo dõi việc xử lý tại hồ sơ gốc.</p>
                  <button type="button" className="button secondary" onClick={() => {
                    setUpdateMessage('');
                    openRequest(detail.canonical!.id);
                  }}>Mở hồ sơ gốc {detail.canonical.tracking_code}</button>
                </>
              ) : <p>Không có thông tin hồ sơ gốc trong phạm vi truy cập hiện tại.</p>}</div>}
              {detail.subject.household_reference_note && <p className="sos-profile__note"><strong>Ghi chú nhận diện nơi ở:</strong> {detail.subject.household_reference_note}</p>}
            </section>
            {detail.status === 'SUBMITTED' && <div className="sos-start-verification">
              {command({
                title: 'Bắt đầu xác minh',
                hideTitle: true,
                service: 'response',
                path: `/requests/${detail.id}/start-verification`,
                version: detail.version,
                warning: 'Bắt đầu xác minh yêu cầu này?',
              })}
            </div>}
            </div>
            <div className="sos-tab-group" hidden={activeTab !== 'overview'}>
            {detail.fast_track && ['SUBMITTED', 'VERIFYING'].includes(detail.status) && (() => {
              const ft = detail.fast_track;
              const rule = detail.priority_advisory;
              const ai = detail.ai_priority_advisory;
              const aiDone = ai?.status === 'COMPLETED' && ai.review_status !== 'REJECTED';
              const aiStatus = ai?.status;
              const urgentMedicalReview = ft.reason_codes.includes('URGENT_MEDICAL_REVIEW_REQUIRED');
              const hasPrioritySuggestion = ft.suggestion_confidence !== 'LOW' && ft.sources.length > 0;
              return (
              <section className="sos-decision" data-tone={ft.eligible ? 'ready' : 'review'} aria-label="Quyết định xử lý">
                <div className="sos-decision__head">
                  <div>
                    <p className="sos-decision__eyebrow">{hasPrioritySuggestion ? 'Hệ thống gợi ý mức ưu tiên' : 'Chưa đủ căn cứ gợi ý mức ưu tiên'}</p>
                    {hasPrioritySuggestion && <p className="sos-decision__priority"><PriorityBadge priority={ft.suggested_priority} /> <span>{priorityMeaning[ft.suggested_priority].split(' · ')[1]}</span></p>}
                  </div>
                  {ft.sources.length > 0 && <p className="sos-decision__basis">
                    {ft.sources.includes('AI') ? 'Quy tắc nghiệp vụ + AI' : 'Quy tắc nghiệp vụ'}
                  </p>}
                </div>
                {ft.reason_codes.length > 0 && (
                  <ul className="sos-decision__chips">
                    {ft.reason_codes.map((code) => <li key={code}>{advisoryReasonLabels[code] ?? 'Có yếu tố cần chú ý'}</li>)}
                  </ul>
                )}
                {!ft.eligible && ft.blockers.length > 0 && (
                  <ul className="sos-decision__chips sos-decision__chips--warn">
                    {ft.blockers.slice(0, 1).map((code) => <li key={code}>{fastTrackBlockerLabels[code] ?? 'Cần điều phối viên kiểm tra thêm'}</li>)}
                  </ul>
                )}
                {(rule?.score != null || aiDone) && <dl className="sos-decision__scores">
                  <div>
                    <dt title="Điểm từ dấu hiệu trong hồ sơ SOS; không phải độ tin cậy của AI">Điểm quy tắc</dt>
                    <dd>{rule?.score != null ? <><b>{rule.score}</b>/100</> : '—'}</dd>
                  </div>
                  <div>
                    <dt title="Mức chắc chắn do AI tự ước tính, chưa phải xác suất đúng đã kiểm định">Độ tin cậy</dt>
                    <dd>{aiDone && ai.confidence != null ? <><b>{Math.round(ai.confidence * 100)}%</b></> : '—'}</dd>
                  </div>
                  <div className="sos-decision__aistatus">
                    <dt>Trạng thái AI</dt>
                    <dd>{aiDone ? 'Đã đánh giá' : (advisoryStatusLabels[aiStatus ?? ''] ?? 'Chưa có đánh giá')}</dd>
                  </div>
                </dl>}
                {aiDone && detail.ai_advisory?.extracted_json?.summary && (
                  <p className="sos-decision__summary">
                    <strong>
                      {ai?.suggested_priority ? `AI gợi ý ${ai.suggested_priority}` : 'AI chưa xác định mức ưu tiên'}
                      {detail.ai_advisory.extracted_json.ai_source === 'FALLBACK' ? ' (mô hình dự phòng)' : ''}:
                    </strong>{' '}
                    {detail.ai_advisory.extracted_json.summary}
                    {weatherImpactText(detail.ai_advisory.extracted_json.weather_impact) && <> Thời tiết: {weatherImpactText(detail.ai_advisory.extracted_json.weather_impact)}</>}
                  </p>
                )}
                <div className={`sos-decision__actions${ft.eligible ? '' : ' sos-decision__actions--single'}`} key={`${aiStatus ?? 'NONE'}:${detail.ai_advisory?.id ?? ''}`}>
                  {ft.eligible && <>
                    {command({
                      title: `Xác nhận ${ft.suggested_priority} và chọn đội`,
                      service: 'response',
                      path: `/requests/${detail.id}/fast-track`,
                      version: detail.version,
                      hideTitle: true,
                      warning: `Bạn đã xem thông tin SOS và đồng ý xác minh, đặt mức ưu tiên ${ft.suggested_priority}? Bước tiếp theo là chọn đội.`,
                      fields: urgentMedicalReview ? [{
                        name: 'note', label: 'Nội dung đã đối chiếu và căn cứ xác minh',
                        type: 'textarea', required: true, maxLength: 1000,
                      }] : undefined,
                      build: (values) => ({ confirmed: true, ...(urgentMedicalReview ? { note: values.note } : {}) }),
                    })}
                    {secondaryCommand({
                      title: 'Chọn mức ưu tiên khác',
                      service: 'response',
                      path: `/requests/${detail.id}/fast-track`,
                      version: detail.version,
                      warning: 'Xác nhận xác minh SOS và đặt mức ưu tiên do bạn chọn?',
                      fields: [
                        { name: 'priority', label: 'Mức ưu tiên', type: 'select', required: true, options: priorities },
                        { name: 'note', label: 'Lý do chọn khác gợi ý', type: 'textarea', required: true, maxLength: 1000 },
                      ],
                      build: (values) => ({ confirmed: true, priority: values.priority, note: values.note }),
                    })}
                  </>}
                  {(aiStatus === 'QUEUED' || aiStatus === 'PROCESSING') && <p className="sos-decision__hint">AI đang đánh giá, kết quả tự cập nhật sau ít phút.</p>}
                  {!ft.eligible && aiDone && <p className="sos-decision__hint">Hãy đối chiếu thông tin, bắt đầu xác minh rồi chọn mức ưu tiên theo đánh giá của bạn.</p>}
                  {aiResubmitAction(aiStatus)}
                </div>
                {aiDone && aiNeedsMismatch && <p className="sos-alert sos-alert--warning" role="status">AI ghi nhận nhu cầu cứu hộ khác với hồ sơ. Hãy đối chiếu thông tin người báo trước khi quyết định.</p>}
                {aiDone && aiCountMismatches.length > 0 && <div className="sos-alert sos-alert--warning" role="status">
                  <strong>Cần đối chiếu số người:</strong>
                  {aiCountMismatches.map(key => <p key={key}>{advisoryFactLabels[key]} — hồ sơ: {detail.subject[key] ?? 'Chưa rõ'}; AI: {String(aiFacts?.[key])}.</p>)}
                </div>}
              </section>
              );
            })()}
            {!(detail.fast_track && ['SUBMITTED', 'VERIFYING'].includes(detail.status)) && (() => {
              const ai = detail.ai_priority_advisory;
              const extracted = detail.ai_advisory?.extracted_json;
              const done = ai?.status === 'COMPLETED' && ai.review_status !== 'REJECTED';
              const completedAdvisory = detail.ai_advisory?.status === 'COMPLETED' ? detail.ai_advisory : null;
              const status = ai?.status ?? detail.ai_advisory?.status;
              return (
                <section className="sos-ai-card" data-state={completedAdvisory ? 'done' : 'pending'} aria-label="Gợi ý của AI">
                  <div className="sos-ai-card__head">
                    <strong>Gợi ý của AI</strong>
                    <span className="sos-ai-card__status">{done ? 'Đã đánh giá' : (advisoryStatusLabels[status ?? ''] ?? 'Chưa có đánh giá')}</span>
                  </div>
                  {done ? (
                    <>
                      <p className="sos-ai-card__verdict">
                        {ai.suggested_priority ? <PriorityBadge priority={ai.suggested_priority} /> : <span>Chưa xác định mức</span>}
                        {ai.score != null && <span>Điểm nguy cơ <b>{ai.score}</b>/100</span>}
                        {ai.confidence != null && <span title="Mức chắc chắn do AI tự ước tính, chưa phải xác suất đúng đã kiểm định">Độ tin cậy ~{Math.round(ai.confidence * 100)}%</span>}
                      </p>
                      {extracted?.summary && <p>{extracted.summary}</p>}
                      {ai.reasons.length > 0 && <p className="muted">Căn cứ: {ai.reasons.join(' · ')}</p>}
                      {weatherImpactText(extracted?.weather_impact) && <p className="muted">Thời tiết: {weatherImpactText(extracted?.weather_impact)}</p>}
                      {extracted?.ai_source === 'FALLBACK' && (
                        <p className="muted">
                          Kết quả từ mô hình dự phòng chạy nội bộ do mô hình chính không phản hồi. Mô hình nhỏ nên độ chính xác thấp hơn; hãy đối chiếu kỹ với lời kể trước khi quyết định.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="muted">
                      {status === 'QUEUED' || status === 'PROCESSING'
                        ? 'AI đang đánh giá, kết quả tự cập nhật sau ít phút.'
                        : status === 'FAILED' || status === 'SKIPPED'
                          ? `${advisoryFailureLabels[detail.ai_advisory?.error_code ?? ''] ?? 'Lượt đánh giá AI không có kết quả dùng được.'} Hãy xác minh thủ công.`
                          : 'Chưa có đánh giá AI dùng được cho SOS này. Hãy xác minh thủ công.'}
                    </p>
                  )}
                  {done && aiNeedsMismatch && <p className="sos-alert sos-alert--warning" role="status">AI ghi nhận nhu cầu cứu hộ khác với hồ sơ. Hãy đối chiếu thông tin người báo trước khi quyết định.</p>}
                  {done && aiCountMismatches.length > 0 && <div className="sos-alert sos-alert--warning" role="status">
                    <strong>Cần đối chiếu số người:</strong>
                    {aiCountMismatches.map(key => <p key={key}>{advisoryFactLabels[key]} — hồ sơ: {detail.subject[key] ?? 'Chưa rõ'}; AI: {String(aiFacts?.[key])}.</p>)}
                  </div>}
                  <p className="sos-ai-card__note">Chỉ để tham khảo — điều phối viên quyết định mức ưu tiên và giao đội.</p>
                </section>
              );
            })()}
            </div>
            <div className="sos-tab-group" hidden={activeTab !== 'overview'}>
            {pendingSupplements.map((event) => {
              const facts = event.payload?.reported_facts;
              const changes = facts && typeof facts === 'object' && !Array.isArray(facts)
                ? Object.entries(facts).filter(([name]) => name in supplementLabels) : [];
              return (
                <section className="notice warning" key={event.id}>
                  <h3>Thông tin mới cần đối chiếu</h3>
                  <p>Người báo đã bổ sung thông tin lúc {timeLabel(event.occurred_at)}. Hãy so sánh với hồ sơ và xác minh trước khi quyết định.</p>
                  <dl className="fact-list">
                    {changes.map(([name, value]) => <div key={name}><dt>{supplementLabels[name]}</dt><dd>{supplementValue(value)}</dd></div>)}
                  </dl>
                  {(['ACCEPT', 'REJECT'] as const).map((decision) => command({
                    title: decision === 'ACCEPT' ? 'Chấp nhận thông tin bổ sung' : 'Không chấp nhận thông tin bổ sung',
                    service: 'response',
                    path: `/requests/${detail.id}/supplements/${event.id}/review`,
                    version: detail.version,
                    warning: decision === 'ACCEPT'
                      ? 'Xác nhận thông tin mới đã được đối chiếu và có thể cập nhật vào hồ sơ SOS?'
                      : 'Xác nhận không sử dụng thông tin bổ sung này?',
                    fields: [{ name: 'reason', label: 'Lý do quyết định', type: 'textarea', required: true, maxLength: 1000 }],
                    build: (values) => ({ decision, reason: values.reason }),
                  }))}
                </section>
              );
            })}
            </div>
            <div className="sos-tab-group" hidden={activeTab !== 'dispatch'}>
            {detail.status === 'RESOLVING' && (pendingOperationId ? (
              <ResolutionOperationPanel
                key={pendingOperationId}
                operationId={pendingOperationId}
                requestVersion={detail.version}
                onChanged={done}
                onStale={refreshAfterConflict}
              />
            ) : (
              <section className="notice warning">
                <h3>Thao tác kết thúc đang chờ</h3>
                <p>Chưa tìm thấy mã thao tác trong lịch sử tải về. Tải lại hồ sơ để đồng bộ trạng thái mới nhất.</p>
                <button type="button" className="button secondary" onClick={refreshAfterConflict}>Tải lại hồ sơ</button>
              </section>
            ))}
            </div>
            <fieldset className="claim-guard sos-actions-guard" disabled={claimBlockedBy(detail, currentUserId)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="action-grid sos-actions" id="request-actions" tabIndex={-1} hidden={activeTab !== 'overview' && activeTab !== 'dispatch'}>
              <div className="sos-tab-group sos-action-row" hidden={activeTab !== 'dispatch'}>
              {canSeeUnassigned && !detail.campaign_id &&
                secondaryCommand({
                  title: 'Gắn vào chiến dịch cứu trợ',
                  service: 'response',
                  path: `/requests/${detail.id}/attach-campaign`,
                  version: detail.version,
                  fields: [
                    { name: 'campaign_id', label: 'Chiến dịch', type: 'choice-cards', required: true, searchable: true,
                      options: [...campaignOptions].sort((a, b) =>
                        Number(Boolean(detail.campaign_candidate_ids?.includes(b.value))) - Number(Boolean(detail.campaign_candidate_ids?.includes(a.value))) ||
                        campaignDistanceMeters(detail.subject.location?.coordinates ?? [0, 0], a.center) -
                        campaignDistanceMeters(detail.subject.location?.coordinates ?? [0, 0], b.center))
                        .map(({ value, label: name, center }) => {
                          const distance = detail.subject.location && center
                            ? campaignDistanceMeters(detail.subject.location.coordinates, center) : null;
                          return { value, label: `${detail.campaign_candidate_ids?.includes(value) ? 'Trong vùng · ' : ''}${name}${distance === null ? '' : ` · cách khoảng ${Math.round(distance / 1000)} km`}` };
                        }) },
                  ],
                  warning: 'Xác nhận gắn yêu cầu này vào chiến dịch đã chọn?',
                })}
              {detail.timeline.items.some((event) => event.event_type === 'AUTHORITY_REFERRED') && (
                <p className="notice sos-referral-status" role="status">
                  Đã ghi nhận chuyển cơ quan chức năng lúc {timeLabel(detail.timeline.items.find((event) => event.event_type === 'AUTHORITY_REFERRED')!.occurred_at)}. Xem chi tiết trong tab Lịch sử.
                </p>
              )}
              </div>
              <div className="sos-tab-group sos-action-row" hidden={activeTab !== 'overview' || !['VERIFYING', 'VERIFIED'].includes(detail.status)}>
              {detail.status === 'VERIFYING' && (
                <>
                  {detail.report_mode === 'PROXY' && detail.timeline.items.some(event => event.event_type === 'VERIFICATION_STARTED' && event.actor_user_id === currentUserId) &&
                    <p className="notice">{detail.timeline.items.some(event => event.event_type === 'CONCURRENCE' && event.actor_user_id && event.actor_user_id !== currentUserId)
                      ? 'Đã có đồng xác nhận từ điều phối viên khác. Chọn lần đồng xác nhận trong bước Hoàn tất xác minh yêu cầu báo hộ; hệ thống sẽ kiểm tra lại căn cứ trước khi ghi nhận.'
                      : 'Bạn đã mở xác minh hồ sơ này. Cần điều phối viên khác đối chiếu và đồng xác nhận trước khi bạn hoàn tất xác minh.'}</p>}
                  {detail.report_mode === 'PROXY' && detail.timeline.items.some(event => event.event_type === 'CONCURRENCE' && event.actor_user_id === currentUserId) &&
                    <p className="notice">Bạn đã đồng xác nhận hồ sơ này. Điều phối viên khác sẽ thực hiện bước xác minh cuối. Chỉ ghi lại đồng xác nhận khi cần cập nhật nội dung đã đối chiếu.</p>}
                  {detail.report_mode === 'PROXY' &&
                    !detail.timeline.items.some(event => event.event_type === 'VERIFICATION_STARTED' && event.actor_user_id === currentUserId) &&
                    command({
                      title: detail.timeline.items.some(event => event.event_type === 'CONCURRENCE' && event.actor_user_id === currentUserId)
                        ? 'Ghi lại đồng xác nhận' : 'Điều phối viên thứ hai xác nhận',
                      service: 'response',
                      path: `/requests/${detail.id}/concur`,
                      version: detail.version,
                      warning:
                        'Bạn đã kiểm tra độc lập yêu cầu báo hộ này? Một điều phối viên khác sẽ thực hiện bước xác minh cuối.',
                      fields: [
                        {
                          name: 'note',
                          label: 'Thông tin bạn đã đối chiếu',
                          type: 'textarea',
                          required: true,
                          maxLength: 1000,
                        },
                      ],
                    })}
                  {detail.report_mode !== 'PROXY' &&
                    command({
                      title: 'Hoàn tất xác minh SOS',
                      service: 'response',
                      path: `/requests/${detail.id}/verify`,
                      uploadPath: `/requests/${detail.id}/staff-evidence`,
                      version: detail.version,
                      warning:
                        hasReadyEvidence
                          ? 'Bạn đã đối chiếu vị trí, thông tin và tệp minh chứng của SOS? Quyết định này do điều phối viên thực hiện.'
                          : 'Bạn đã đối chiếu vị trí và thông tin của SOS? Hồ sơ này không có tệp minh chứng để kiểm tra. Quyết định này do điều phối viên thực hiện.',
                      fields: [
                        {
                          name: 'reason',
                          label: hasReadyEvidence ? 'Nội dung đã đối chiếu (vị trí, thông tin, tệp minh chứng)' : 'Nội dung đã đối chiếu (vị trí, thông tin)',
                          type: 'textarea',
                          required: true,
                          maxLength: 1000,
                          placeholder: 'Ví dụ: Đã xác nhận vị trí, tình trạng và số người cần hỗ trợ.',
                        },
                      ],
                      build: (values, uploadedIds) => ({
                        basis: 'EVIDENCE_REVIEWED',
                        reason: values.reason,
                        source_refs: {
                          evidence_ids: [...(detail.evidence?.items ?? [])
                            .filter((item) => item.state === 'READY')
                            .map((item) => item.id), ...uploadedIds],
                        },
                      }),
                    })}
                  {detail.report_mode === 'PROXY' &&
                    detail.timeline.items.some((event) => event.event_type === 'CONCURRENCE' && event.actor_user_id !== currentUserId) &&
                    command({
                      title: 'Hoàn tất xác minh yêu cầu báo hộ',
                      service: 'response',
                      path: `/requests/${detail.id}/verify`,
                      version: detail.version,
                      warning:
                        'Bạn phải là điều phối viên khác người đã đồng xác nhận. Xác nhận quyết định xác minh báo hộ?',
                      fields: [
                        {
                          name: 'concurrence_event_id',
                          label: 'Lần đồng xác nhận',
                          type: 'select',
                          required: true,
                          options: detail.timeline.items
                            .filter((event) => event.event_type === 'CONCURRENCE' && event.actor_user_id !== currentUserId)
                            .map((event) => ({
                              value: event.id,
                              label: `${timeLabel(event.occurred_at)} · ${event.id.slice(0, 8)}`,
                            })),
                        },
                        {
                          name: 'reason',
                          label: 'Lý do xác minh',
                          type: 'textarea',
                          required: true,
                          maxLength: 1000,
                        },
                      ],
                      build: (values) => ({
                        basis: 'TWO_COORDINATOR_JUDGMENT',
                        concurrence_event_id: values.concurrence_event_id,
                        reason: values.reason,
                      }),
                    })}
                  {duplicateError && (
                    <p role="alert" className="notice error">
                      Kiểm tra yêu cầu trùng: {duplicateError}
                    </p>
                  )}
                  {duplicates.length > 0 && (
                    <details className="secondary-command">
                      <summary>Kiểm tra {duplicates.length} yêu cầu có thể trùng</summary>
                      <p>
                        Hai yêu cầu ở gần nhau vẫn có thể thuộc hai hộ khác nhau. Hãy đối chiếu
                        trước khi đánh dấu trùng.
                      </p>
                      {duplicates.map((candidate) => (
                        <div className="candidate" key={candidate.id}>
                          <strong>{candidate.tracking_code || candidate.id}</strong>
                          <p>
                            {label(candidate.category)} · {Math.round(candidate.distance_m)} m ·{' '}
                            {timeLabel(candidate.received_at)}
                          </p>
                          <DuplicateComparison id={candidate.id} code={candidate.tracking_code || candidate.id.slice(0, 8)} />
                          {command({
                            title: 'Đánh dấu trùng yêu cầu này',
                            service: 'response',
                            path: `/requests/${detail.id}/duplicate`,
                            version: detail.version,
                            warning: `Xác nhận yêu cầu ${detail.tracking_code} trùng với ${candidate.tracking_code || candidate.id}?`,
                            fields: [
                              {
                                name: 'reason',
                                label: 'Căn cứ xác nhận trùng',
                                type: 'textarea',
                                required: true,
                                maxLength: 1000,
                              },
                            ],
                            build: (values) => ({
                              canonical_request_id: candidate.id,
                              reason: values.reason,
                            }),
                          })}
                        </div>
                      ))}
                    </details>
                  )}
                  {secondaryCommand({
                    title: 'Từ chối yêu cầu',
                    service: 'response',
                    path: `/requests/${detail.id}/reject`,
                    version: detail.version,
                    warning:
                      'Bạn có chắc muốn từ chối yêu cầu này? Lý do sẽ được lưu trong lịch sử.',
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 1000 }],
                  }, 'danger')}
                </>
              )}
              {detail.status === 'VERIFIED' && (detail.fast_track?.suggested_priority || detail.ai_priority_advisory?.suggested_priority) && command({
                title: `Xác nhận ${detail.fast_track?.suggested_priority ?? detail.ai_priority_advisory?.suggested_priority} và chọn đội`,
                hideTitle: true, service: 'response', path: `/requests/${detail.id}/triage`, version: detail.version,
                warning: `Xác nhận mức ưu tiên ${detail.fast_track?.suggested_priority ?? detail.ai_priority_advisory?.suggested_priority} cho SOS đã xác minh?`,
                build: () => ({ priority: detail.fast_track?.suggested_priority ?? detail.ai_priority_advisory?.suggested_priority,
                  priority_basis: detail.fast_track?.suggested_priority_basis ?? 'COMPLETE',
                  reason: 'Điều phối viên đã xem thông tin SOS đã xác minh và xác nhận mức ưu tiên được gợi ý.' }),
              })}
              {detail.status === 'VERIFIED' &&
                command({
                  title: 'Chọn mức ưu tiên khác',
                  service: 'response',
                  path: `/requests/${detail.id}/triage`,
                  version: detail.version,
                  warning: 'Xác nhận quyết định ưu tiên thủ công cho yêu cầu này?',
                  fields: [
                    {
                      name: 'priority',
                      label: 'Mức ưu tiên',
                      type: 'select',
                      required: true,
                      initialValue: detail.fast_track?.suggested_priority ?? detail.ai_priority_advisory?.suggested_priority ?? undefined,
                      options: [...priorities].sort((a, b) => Number(b.value === detail.fast_track?.suggested_priority) - Number(a.value === detail.fast_track?.suggested_priority))
                        .map((item) => ({ value: item.value, label: item.value === detail.fast_track?.suggested_priority ? `${item.value} (hệ thống gợi ý)` : item.label })),
                    },
                    {
                      name: 'priority_basis',
                      label: 'Mức độ đầy đủ thông tin',
                      type: 'select',
                      required: true,
                      initialValue: detail.fast_track?.suggested_priority_basis ?? 'COMPLETE',
                      options: [
                        { value: 'COMPLETE', label: 'Đủ thông tin' },
                        { value: 'INCOMPLETE_INFO', label: 'Còn thiếu thông tin' },
                      ],
                    },
                    { name: 'reason', label: 'Lý do quyết định', type: 'textarea', required: true, maxLength: 1000 },
                  ],
                })}
              </div>
              <div className="sos-tab-group" hidden={activeTab !== 'dispatch'}>
              {detail.status === 'TRIAGED' && (
                <section>
                  {latestCompletedMissionId && !completionCheck && <p role="status">Đang đối chiếu nhiệm vụ đã hoàn thành với chu kỳ xử lý hiện tại…</p>}
                  {completionCheck?.error && <p className="notice warning" role="alert">Chưa đối chiếu được nhiệm vụ đã hoàn thành. Hãy bấm “Làm mới SOS” trước khi giao thêm đội.</p>}
                  {completedInCurrentCycle && <div className="notice">
                    <strong>Đội đã hoàn thành nhiệm vụ trong chu kỳ này.</strong>
                    <p>Kết quả đã được ghi nhận. Điều phối viên cần kiểm tra minh chứng và kết thúc xử lý SOS nếu nhu cầu đã được đáp ứng.</p>
                    <a href="#resolve-request">Đi đến bước kết thúc xử lý ↓</a>
                    <div><button type="button" className="button secondary" onClick={() => setShowAdditionalDispatch((value) => !value)}>
                      {showAdditionalDispatch ? 'Ẩn lựa chọn giao thêm đội' : 'Vẫn cần giao thêm đội'}
                    </button></div>
                  </div>}
                  {showTeamCandidates && <>
                  <h3>Đội có thể giao nhiệm vụ</h3>
                  <p className="muted">Đội đầu tiên là gợi ý cân bằng khoảng cách và khối lượng việc; chỉ chọn đội khác khi có lý do.</p>
                  {candidateError && (
                    <p role="alert" className="notice error">
                      Tải đội phù hợp: {candidateError}
                    </p>
                  )}
                  {!candidates && !candidateError && <p role="status">Đang tải đội phù hợp…</p>}
                  {candidates?.items.length === 0 && (
                    <p role="status" className="notice warning">
                      Chưa có đội đủ điều kiện để giao nhiệm vụ. Hãy cập nhật tình trạng và vị trí đội trong mục Đội cứu hộ, rồi tải lại SOS.
                    </p>
                  )}
                  {[...(candidates?.items ?? [])].sort((a, b) => Number(b.suggested) - Number(a.suggested)).map((candidate, _index, all) => (
                    <OptionalFold key={candidate.team.id} fold={!candidate.suggested && all.some((item) => item.suggested)}
                      summary={`Chọn đội khác: ${candidate.team.name} (cần ghi lý do)`}>
                    <div className="candidate">
                      <strong>{candidate.team.name}</strong>
                      {candidate.team.reporting_mode === 'COORDINATOR' && <p>Đội báo qua điều phối viên{candidate.team.external_contact_note ? ` · Đầu mối: ${candidate.team.external_contact_note}` : ''}</p>}
                      <p>
                        {candidate.suggested
                          ? 'Gợi ý cân bằng tải và khoảng cách · '
                          : candidate.in_band
                            ? 'Trong nhóm khoảng cách gần · '
                            : 'Ngoài nhóm khoảng cách gần · '}
                        Cách {Math.round(candidate.distance_m || 0)} m · vị trí cập nhật{' '}
                        {Math.round((candidate.position_age_s || 0) / 60)} phút trước ·{' '}
                        {candidate.recent_missions_24h} nhiệm vụ/24 giờ ·{' '}
                        {candidate.recent_missions_7d} nhiệm vụ/7 ngày
                      </p>
                      {detail.mission_history?.items.some((mission) => mission.team_id === candidate.team.id && ['DECLINED', 'FAILED'].includes(mission.status)) && <p className="notice warning">Đội này đã từ chối hoặc chưa hoàn thành nhiệm vụ trong hồ sơ này. Xem lý do trong lịch sử nhiệm vụ trước khi giao lại.</p>}
                      {candidate.recent_history.length > 0 && (
                        <details>
                          <summary>Xem lịch sử 5 nhiệm vụ gần nhất</summary>
                          {candidate.recent_history.map((mission) => (
                            <p key={mission.id}>
                              {label(mission.mission_kind)} · {label(mission.status)} ·{' '}
                              {timeLabel(mission.created_at)}
                              {mission.last_progress?.status
                                ? ` · ${label(mission.last_progress.status)}`
                                : ''}
                              {mission.last_progress?.recorded_basis
                                ? ` · ${recordedByLabel(mission.last_progress.recorded_basis, mission.last_progress.reported_by)}`
                                : ''}
                              {mission.override_reason
                                ? ` · Lý do điều phối: ${mission.override_reason}`
                                : ''}
                            </p>
                          ))}
                        </details>
                      )}
                      {command({
                        title: `Giao nhiệm vụ cho ${candidate.team.name}`,
                        service: 'response',
                        path: `/requests/${detail.id}/missions`,
                        version: detail.version,
                        warning: `Xác nhận giao yêu cầu ${detail.tracking_code} cho ${candidate.team.name}?`,
                        fields: candidate.suggested ? undefined : [{
                          name: 'override_reason', label: 'Lý do chọn đội khác gợi ý', type: 'textarea', required: true, maxLength: 2000,
                        }],
                        build: (values) => ({ team_id: candidate.team.id,
                          ...(values.override_reason?.trim() ? { override_reason: values.override_reason.trim() } : {}),
                        }),
                      })}
                    </div>
                    </OptionalFold>
                  ))}
                  {Boolean(candidates?.unknown_position.some((candidate) => candidate.team.reporting_mode === 'COORDINATOR')) &&
                    <details className="sos-fold">
                      <summary>Cập nhật vị trí đội do điều phối viên báo</summary>
                      {candidates?.unknown_position.filter((candidate) => candidate.team.reporting_mode === 'COORDINATOR').map((candidate) =>
                        <CoordinatorTeamPositionForm key={candidate.team.id} teamId={candidate.team.id} teamName={candidate.team.name}
                          onSuccess={() => setDetailRevision((value) => value + 1)} />)}
                    </details>}
                  </>}
                </section>
              )}
              {['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(detail.status) && (
                <div id="resolve-request" className="sos-closeout">
                  <div className="sos-closeout__head">
                    <h3>Kết thúc xử lý yêu cầu</h3>
                    <CancelRequestPopup key={`cancel-${detail.id}-${detail.version}`}
                      requestId={detail.id} version={detail.version} onCompleted={done} onStale={refreshAfterConflict} />
                  </div>
                  <AsyncRequestForm
                  key={`resolve-${detail.id}-${detail.version}`}
                  requestId={detail.id}
                  version={detail.version}
                  kind="resolve"
                  hideTitle
                  onCompleted={done}
                  onStale={refreshAfterConflict}
                /></div>
              )}
              {detail.status === 'RESOLVED' &&
                command({
                  title: 'Đóng yêu cầu',
                  service: 'response',
                  path: `/requests/${detail.id}/close`,
                  version: detail.version,
                  warning: 'Xác nhận đóng yêu cầu đã xử lý?',
                })}
              {['RESOLVED', 'CLOSED'].includes(detail.status) &&
                command({
                  title: 'Mở lại yêu cầu',
                  service: 'response',
                  path: `/requests/${detail.id}/reopen`,
                  version: detail.version,
                  warning: 'Xác nhận mở chu kỳ xử lý mới cho yêu cầu này?',
                  fields: [
                    { name: 'reason', label: 'Lý do mở lại', type: 'textarea', required: true, maxLength: 2000 },
                  ],
                })}
              </div>
            </div>
            </fieldset>
            <div className="sos-tab-group" hidden={activeTab !== 'overview'}>
            {['SUBMITTED', 'VERIFYING'].includes(detail.status) && <>
              <ContactAttemptPanel
                key={`contacts-${detail.id}-${detail.version}`}
                requestId={detail.id}
                status={detail.status}
                version={detail.version}
                currentUserId={currentUserId}
                reporterUserId={detail.reporter.user_id}
                initial={detail.contact_attempts}
                onSuccess={done}
                onStale={refreshAfterConflict}
              />
            </>}
            </div>
            <div className="sos-tab-group" hidden={activeTab !== 'overview'}>
            {page === 'queue' && detail.status !== 'VERIFIED' && detail.subject.location && (
              <details className="sos-fold queue-context-map">
                <summary>Xem vị trí trên bản đồ</summary>
                <HeatmapPanel
                  showLayers={false}
                  compact
                  selected={{
                    id: detail.id,
                    trackingCode: detail.tracking_code,
                    status: detail.status,
                    longitude: detail.subject.location.coordinates[0],
                    latitude: detail.subject.location.coordinates[1],
                  }}
                />
              </details>
            )}
            {(page === 'triage' || (page === 'queue' && detail.status === 'VERIFIED')) && (
              <div className="triage-context">
                <div className="triage-context-map">
                  <h3>Vị trí trên bản đồ nhiệt</h3>
                  <HeatmapPanel
                    showLayers={false}
                    compact
                    selected={detail.subject.location ? {
                      id: detail.id,
                      trackingCode: detail.tracking_code,
                    status: detail.status,
                      longitude: detail.subject.location.coordinates[0],
                      latitude: detail.subject.location.coordinates[1],
                    } : null}
                  />
                </div>
              </div>
            )}

            </div>
            <div className="sos-tab-group" hidden={activeTab !== 'dispatch'}>
            {completedInCurrentCycle && Boolean(detail.active_missions?.items.length) &&
              <p className="notice warning" role="status">
                SOS này đã có nhiệm vụ hoàn thành nhưng vẫn còn nhiệm vụ đang giao. Hãy đối chiếu nhu cầu còn lại và trạng thái đội bên dưới. Nếu lần giao thêm là nhầm, dùng “Hủy giao nhiệm vụ” cho nhiệm vụ đang chờ trước khi kết thúc SOS.
              </p>}
            {detail.active_missions && detail.active_missions.items.length > 0 && (
              <section>
                <h3>Nhiệm vụ đang giao ({detail.active_missions.items.length})</h3>
                <div className="record-list">
                  {detail.active_missions.items.map((m) => (
                    <div className="candidate" key={m.id}>
                      <strong>Mã nhiệm vụ: {m.id.slice(0, 8)}</strong>
                      <p>
                        Trạng thái: {label(m.status)} · Đội: {detail.mission_history?.items.find((mission) => mission.team_id === m.team_id)?.team_name ?? 'Đội cứu hộ'} ·{' '}
                        {timeLabel(m.created_at)}
                      </p>
                      <CoordinatorMissionControl missionId={m.id} teamId={m.team_id}
                        revision={revision} onSuccess={done} onStale={refreshAfterConflict} />
                      <MissionSupplyPanel missionId={m.id} missionStatus={m.status} onBehalf />
                    </div>
                  ))}
                </div>
              </section>
            )}
            {detail.mission_history && detail.mission_history.items.length > 0 && (
              <details className="sos-fold"><summary>Lịch sử nhiệm vụ ({detail.mission_history.items.length})</summary>
              <section>
                <div className="record-list">
                  {detail.mission_history.items.map((mission) => (
                    <div className="candidate" key={mission.id}>
                      <strong>
                        {mission.team_name} · {label(mission.mission_kind)}
                      </strong>
                      <p>
                        {label(mission.status)} · {timeLabel(mission.created_at)}
                        {mission.last_status ? ` · Cập nhật: ${label(mission.last_status)}` : ''}
                        {mission.recorded_basis ? ` · ${recordedByLabel(mission.recorded_basis, mission.reported_by)}` : ''}
                        {mission.last_occurred_at ? ` · lúc ${timeLabel(mission.last_occurred_at)}` : ''}
                      </p>
                      <MissionOutcome key={mission.id + mission.status} id={mission.id} />
                      {mission.override_reason && (
                        <p>Lý do chọn đội khác đề xuất: {mission.override_reason}</p>
                      )}
                      {mission.status === 'FAILED' &&
                        ['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(detail.status) &&
                        !detail.timeline.items.some((event) =>
                          event.event_type === 'MISSION_FAILURE_REVIEW' && event.payload?.mission_id === mission.id
                        ) && command({
                          title: 'Rà soát nhiệm vụ thất bại',
                          service: 'response',
                          path: `/missions/${mission.id}/review-failure`,
                          version: detail.version,
                          fields: [
                            { name: 'disposition', label: 'Kết luận xử lý', type: 'select', required: true,
                              options: [
                                { value: 'REPLACED', label: 'Đã thay bằng nhiệm vụ hoàn thành' },
                                { value: 'NO_FURTHER_ACTION', label: 'Không cần giao thêm đội' },
                                { value: 'REFERRED', label: 'Đã chuyển cơ quan có thẩm quyền' },
                              ] },
                            { name: 'replacement_mission_id', label: 'Nhiệm vụ thay thế đã hoàn thành', type: 'select', required: true,
                              visibleWhen: { field: 'disposition', value: 'REPLACED' },
                              options: detail.mission_history?.items.filter((item) => item.status === 'COMPLETED' && item.id !== mission.id)
                                .map((item) => ({ value: item.id, label: `${item.team_name} · ${item.id.slice(0, 8)}` })) || [] },
                            { name: 'reason', label: 'Căn cứ rà soát', type: 'textarea', required: true, maxLength: 2000 },
                          ],
                        })}
                    </div>
                  ))}
                </div>
              </section></details>
            )}
            </div>
            <div className="sos-tab-group" hidden={activeTab !== 'history'}>
            <h3>Lịch sử xử lý</h3>
            <RequestTimeline
              key={`timeline-${detail.id}-${detail.version}-${detail.timeline.items[0]?.id ?? 'empty'}`}
              requestId={detail.id}
              initial={detail.timeline}
            />
            </div>
            </div>
          </>
        )}
      </section></section>}
    </div>
  );
}

export function CoordinatorMap() {
  return (
    <section className="card">
      <h2>Bản đồ nhiệt SOS</h2>
      <p>
        Bản đồ mở ở tầm nhìn Việt Nam. Chấm tròn cho biết vị trí có SOS; phóng gần bằng chuột hoặc nút + để xem vùng nhiệt.
      </p>
      <HeatmapPanel />
    </section>
  );
}
