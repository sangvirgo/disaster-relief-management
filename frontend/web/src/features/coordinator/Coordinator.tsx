import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { appendPage } from '../../api/pagination';
import { DetailSurface } from '../../components/DetailSurface';
import { PriorityBadge } from '../../components/PriorityBadge';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { label, regionName, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { AsyncRequestForm } from './AsyncRequestForm';
import { HeatmapPanel } from './HeatmapPanel';
import { ContactAttemptPanel } from './ContactAttemptPanel';
import { CoordinatorTeamPositionForm } from './CoordinatorTeamPositionForm';
import { operationIdFromTimeline, ResolutionOperationPanel } from './ResolutionOperationPanel';
import { RequestTimeline } from './RequestTimeline';
import { RequestEvidencePanel } from './RequestEvidencePanel';
import { TeamReadinessQueue } from './TeamReadinessQueue';

type QueueItem = {
  id: string;
  tracking_code: string;
  status: string;
  priority?: string | null;
  category: string;
  received_at: string;
  review_lane: string;
  declared_danger: boolean;
  people_affected?: number | null;
  region_code?: string | null;
  priority_advisory?: {
    score: number | null;
    level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'STANDARD' | null;
    outcome: 'SUGGESTION' | 'INSUFFICIENT_DATA';
    reason_codes: string[];
    source: 'BACKEND_RULES';
    rules_version: string;
  };
  ai_priority_advisory?: AiPriorityAdvisory | null;
};
type AiPriorityAdvisory = {
  status: string;
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
    location?: { coordinates: [number, number]; source: string };
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
      indicators?: string[];
      facts?: Record<string, unknown>;
      confidence?: number;
      priority_score?: number;
      priority_reasons?: string[];
    } | null;
    review_status?: string | null;
    review_note?: string | null;
    error_code?: string | null;
    human_review_required: boolean;
  } | null;
  evidence?: { items: { id: string; state: string; size_bytes: number; detected_mime?: string; created_at: string }[] };
};
type Candidate = {
  team: { id: string; name: string; reporting_mode: 'APP' | 'COORDINATOR' };
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

type ScopedTeam = {
  id: string;
  name: string;
  status: string;
  availability: string;
  readiness_required: boolean;
  skills: string[];
  position: { age_s: number } | null;
};

// Versioned demo prerequisites: docs/backend/seed/seed-response.sql.
const requiredDemoSkills: Record<string, string[]> = {
  FLOOD: ['BOAT'], TRAPPED: ['BOAT'], MEDICAL: ['FIRST_AID'], LANDSLIDE: ['CLIMBING'],
};

function TeamEligibilityDetails({ regionCode, category, revision }: {
  regionCode: string; category: string; revision: number;
}) {
  const [teams, setTeams] = useState<ScopedTeam[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setTeams(null);
    setError('');
    async function load() {
      try {
        const found: ScopedTeam[] = [];
        let cursor = '';
        do {
          const query = new URLSearchParams({ region_code: regionCode, limit: '100' });
          if (cursor) query.set('cursor', cursor);
          const page = await api<{ items: ScopedTeam[]; more: boolean; cursor?: string }>('response', `/teams?${query}`);
          found.push(...page.items);
          cursor = page.more ? page.cursor || '' : '';
        } while (cursor);
        if (live) setTeams(found);
      } catch {
        if (live) setError('Chưa tải được tình trạng từng đội. Hãy kiểm tra danh sách đội và thử cập nhật SOS.');
      }
    }
    void load();
    return () => { live = false; };
  }, [regionCode, revision]);
  const requiredSkills = requiredDemoSkills[category] || [];
  return <div className="team-eligibility-details">
    {requiredSkills.length > 0 && <p><strong>{label(category)}</strong> cần kỹ năng {requiredSkills.map(label).join(', ')}.</p>}
    {error && <p role="alert">{error}</p>}
    {!teams && !error && <p role="status">Đang kiểm tra tình trạng các đội trong khu vực…</p>}
    {teams?.length === 0 && <p>Chưa có đội nào trong khu vực mà tài khoản này được phép xem.</p>}
    {teams?.map((team) => {
      const reasons = [
        ...(team.status !== 'ACTIVE' ? ['Đội ngừng hoạt động'] : []),
        ...(team.availability !== 'AVAILABLE' ? ['Đội chưa sẵn sàng'] : []),
        ...(team.readiness_required ? ['Cần xác nhận sẵn sàng lại'] : []),
        ...requiredSkills.filter((skill) => !team.skills.includes(skill)).map((skill) => `Thiếu kỹ năng ${label(skill)}`),
        ...(!team.position ? ['Chưa có vị trí đội'] : team.position.age_s > 1800 ? ['Vị trí đã quá 30 phút'] : []),
      ];
      return <p key={team.id}><strong>{team.name}:</strong> {reasons.join(' · ') || 'Kỹ năng và thời gian vị trí phù hợp; hãy kiểm tra khoảng cách tối đa 10 km hoặc nhiệm vụ đội đang nhận.'}</p>;
    })}
    <p className="muted">Kỹ năng chỉ nên cập nhật sau khi xác nhận năng lực thực tế của đội. Vị trí phải được gửi lại trong 30 phút gần nhất.</p>
  </div>;
}

function NearbyAddress({ coordinates }: { coordinates?: [number, number] }) {
  const longitude = coordinates?.[0];
  const latitude = coordinates?.[1];
  if (longitude === undefined || latitude === undefined) return <>Chưa có tọa độ</>;
  return <>Tọa độ SOS: {latitude.toFixed(6)}, {longitude.toFixed(6)}. Xem ghim trên bản đồ để đối chiếu vị trí.</>;
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
  if (!spec.fields?.length) return <CommandForm spec={spec} onSuccess={onSuccess} onStale={onStale} />;
  return <div className="sos-action-entry">
    <button type="button" className="button" onClick={() => setOpen(true)}>{spec.title}</button>
    <DetailSurface modal open={open} label={spec.title} onClose={() => setOpen(false)}>
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

function CoordinatorMissionControl({ missionId, teamId, revision, onSuccess, onStale }: {
  missionId: string; teamId: string; revision: number; onSuccess: () => void; onStale: () => void;
}) {
  const [mission, setMission] = useState<{ status: string; version: number } | null>(null);
  const [reportingMode, setReportingMode] = useState('');
  const [loadError, setLoadError] = useState('');
  const [teamError, setTeamError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  useEffect(() => {
    let live = true;
    // Keep the mounted form during polling; its version key resets stale drafts.
    Promise.allSettled([
      api<{ status: string; version: number }>('response', `/missions/${missionId}`),
      api<{ reporting_mode: string }>('response', `/teams/${teamId}`),
    ]).then(([missionResult, teamResult]) => {
      if (!live) return;
      setMission(missionResult.status === 'fulfilled' ? missionResult.value : null);
      setLoadError(missionResult.status === 'rejected'
        ? missionResult.reason instanceof Error ? missionResult.reason.message : 'Không thể tải nhiệm vụ.' : '');
      setReportingMode(teamResult.status === 'fulfilled' ? teamResult.value.reporting_mode : '');
      setTeamError(teamResult.status === 'rejected'
        ? teamResult.reason instanceof Error ? teamResult.reason.message : 'Không thể tải đội cứu hộ.' : '');
    });
    return () => { live = false; };
  }, [missionId, teamId, revision, loadRevision]);
  const retry = <button type="button" className="button secondary" onClick={() => setLoadRevision(value => value + 1)}>Thử tải lại điều khiển nhiệm vụ</button>;
  if (loadError) return <><p role="alert" className="notice error">Không tải được trạng thái nhiệm vụ: {loadError}</p>{retry}</>;
  if (!mission) return <p role="status">Đang tải nhiệm vụ…</p>;
  if (!['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(mission.status)) return <p className="notice">Nhiệm vụ đã chuyển sang {label(mission.status)}. Bấm Cập nhật danh sách SOS để tải lại hồ sơ.</p>;
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
  return <><CommandForm
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
        { name: 'reason', label: 'Nội dung xác nhận', required: true, type: 'textarea', maxLength: 2000 },
        { name: 'outcome_note', label: 'Kết quả nhiệm vụ', required: true, type: 'textarea', maxLength: 2000,
          visibleWhen: { field: 'to', value: 'COMPLETED' } },
      ],
      build: (values) => ({ to: values.to, recorded_basis: values.recorded_basis, reported_by: values.reported_by,
        reason: values.reason, occurred_at: new Date().toISOString(),
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
type QueueView = { status: string; selected: string | null; reviewLane: string; overdue: boolean };

function queueViewKey(userId: string, page: string): string {
  return `c48:coordinator-queue:${userId}:${page}`;
}

function readQueueView(userId: string, page: string): QueueView {
  const fallback: QueueView = { status: stateFilter[page] || '', selected: null, reviewLane: 'NORMAL', overdue: false };
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(queueViewKey(userId, page)) || 'null') as Partial<QueueView> | null;
    if (!stored || typeof stored !== 'object') return fallback;
    return {
      status: queueStatuses.some(([value]) => value === stored.status) ? stored.status! : fallback.status,
      selected: typeof stored.selected === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(stored.selected)
        ? stored.selected : null,
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
const advisoryReviewLabels: Record<string, string> = {
  ACCEPTED: 'Ghi nhận',
  ADJUSTED: 'Điều chỉnh',
  REJECTED: 'Không sử dụng',
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

function advisoryScoreLabel(score: number | null, level: string | null): string {
  if (score === null || !level || !advisoryLevelLabels[level]) return 'Chưa đủ thông tin để đánh giá';
  return `${advisoryLevelLabels[level]} · ${score}/100`;
}

export function Coordinator({ page, initialRequestId, currentUserId }: { page: string; initialRequestId?: string; currentUserId: string }) {
  const restoredView = useRef<QueueView | null>(null);
  if (!restoredView.current) restoredView.current = readQueueView(currentUserId, page);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueStatus, setQueueStatus] = useState(restoredView.current.status);
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState<string | null>(initialRequestId || restoredView.current.selected);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [candidateError, setCandidateError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateError, setDuplicateError] = useState('');
  const [reviewLane, setReviewLane] = useState(restoredView.current.reviewLane);
  const [overdue, setOverdue] = useState(restoredView.current.overdue);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [aiReviewNote, setAiReviewNote] = useState('');
  const [aiReviewBusy, setAiReviewBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [completedMissionCycle, setCompletedMissionCycle] = useState<{
    requestId: string; missionId: string; cycle: number | null; error: boolean
  } | null>(null);
  const [showAdditionalDispatch, setShowAdditionalDispatch] = useState(false);
  const [campaignOptions, setCampaignOptions] = useState<{
    value: string; label: string; regionCode: string | null
  }[]>([]);
  useEffect(() => {
    let live = true;
    async function loadCampaigns() {
      try {
        const campaigns: { id: string; name: string; status: string; region_code: string | null }[] = [];
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
          .map((campaign) => ({ value: campaign.id,
            label: `${campaign.name} · ${campaign.region_code ? regionName(campaign.region_code) : 'Nhiều khu vực'}`,
            regionCode: campaign.region_code })));
      } catch {
        if (live) setCampaignOptions([]);
      }
    }
    void loadCampaigns();
    return () => { live = false; };
  }, [revision]);
  const refreshReasonRef = useRef<'success' | 'stale' | null>(null);
  const [compactDetail, setCompactDetail] = useState(() => window.matchMedia('(max-width: 1050px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 1050px)'); const update = () => setCompactDetail(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const restored = readQueueView(currentUserId, page);
    setQueueStatus(restored.status);
    setCursor('');
    setSelected(initialRequestId || restored.selected);
    setReviewLane(restored.reviewLane);
    setOverdue(restored.overdue);
    setDetail(null);
    setUpdateMessage('');
    refreshReasonRef.current = null;
  }, [page, initialRequestId, currentUserId]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(queueViewKey(currentUserId, page), JSON.stringify({
        status: queueStatus, selected, reviewLane, overdue,
      } satisfies QueueView));
    } catch {
      // The queue remains usable when session storage is unavailable.
    }
  }, [currentUserId, page, queueStatus, selected, reviewLane, overdue]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRevision((value) => value + 1);
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);
  const hasActiveMissions = Boolean(detail?.active_missions?.items.length);
  useEffect(() => {
    if (!selected) return;
    const refreshActiveMissionDetail = () => {
      if (document.visibilityState === 'visible') setDetailRevision((value) => value + 1);
    };
    const timer = hasActiveMissions ? window.setInterval(refreshActiveMissionDetail, 5000) : null;
    window.addEventListener('focus', refreshActiveMissionDetail);
    document.addEventListener('visibilitychange', refreshActiveMissionDetail);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('focus', refreshActiveMissionDetail);
      document.removeEventListener('visibilitychange', refreshActiveMissionDetail);
    };
  }, [selected, hasActiveMissions]);
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
    const params = new URLSearchParams();
    if (queueStatus) params.set('status', queueStatus);
    if (cursor) params.set('cursor', cursor);
    if (reviewLane) params.set('review_lane', reviewLane);
    if (overdue) params.set('overdue', 'true');
    api<Queue>('response', `/requests${params.size ? '?' + params : ''}`)
      .then((value) => {
        if (live) setQueue((current) => ({
          ...value,
          items: cursor && current ? appendPage(current.items, value.items, (item) => item.id) : value.items,
        }));
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
  }, [page, queueStatus, cursor, revision, reviewLane, overdue]);
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
            setQueueStatus(value.status);
            setCursor('');
            setUpdateMessage(
              reason === 'success'
                ? `Đã cập nhật. Trạng thái hiện tại: ${requestStatusLabel(value.status)}.`
                : `Đã tải lại hồ sơ. Trạng thái hiện tại: ${requestStatusLabel(value.status)}.`
            );
          }
        }
      })
      .catch((cause) => {
        if (live) {
          refreshReasonRef.current = null;
          setUpdateMessage('');
          setDetail(null);
          if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
            setSelected(null);
            setDetailError('Hồ sơ đã chọn không còn trong phạm vi được phép xem. Hãy chọn hồ sơ khác.');
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
  const refreshAfterConflict = useCallback(() => {
    refreshReasonRef.current = 'stale';
    setUpdateMessage('Đang tải lại hồ sơ để kiểm tra trạng thái.');
    setRevision((value) => value + 1);
  }, []);
  function command(spec: CommandSpec) {
    return (
      <SosCommandPopup
        key={spec.path + spec.title + detail?.version}
        spec={spec}
        onSuccess={done}
        onStale={refreshAfterConflict}
      />
    );
  }
  function secondaryCommand(spec: CommandSpec) {
    return (
      <div className="secondary-command">
        {command(spec)}
      </div>
    );
  }
  async function reviewAiAdvisory(decision: 'ACCEPTED' | 'ADJUSTED' | 'REJECTED') {
    if (!detail?.ai_advisory || detail.ai_priority_advisory?.status !== 'COMPLETED') return;
    if (decision === 'ADJUSTED' && !aiReviewNote.trim()) {
      setError('Vui lòng ghi nội dung điều chỉnh trước khi lưu quyết định.');
      return;
    }
    setAiReviewBusy(true);
    setError('');
    try {
      await api(
        'response',
        `/requests/${detail.id}/ai-advisories/${detail.ai_advisory.id}/review`,
        {
          method: 'POST',
          body: {
            decision,
            expected_version: detail.version,
            ...(aiReviewNote.trim() ? { note: aiReviewNote.trim() } : {}),
          },
          idempotencyKey: newCommandKey(),
        }
      );
      setAiReviewNote('');
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu quyết định rà soát AI.');
      if (cause instanceof ApiError && cause.status === 409) refreshAfterConflict();
    } finally {
      setAiReviewBusy(false);
    }
  }
  const aiFacts = detail?.ai_advisory?.extracted_json?.facts;
  const aiCountMismatches = detail
    ? (['people_affected', 'children_count', 'elderly_count'] as const).filter(key =>
      typeof aiFacts?.[key] === 'number' && aiFacts[key] !== detail.subject[key])
    : [];
  const aiNeedsMismatch = Boolean(
    detail &&
      ((typeof aiFacts?.needs_rescue === 'boolean' &&
        aiFacts.needs_rescue !== detail.needs_rescue) ||
        (typeof aiFacts?.needs_relief_supplies === 'boolean' &&
          aiFacts.needs_relief_supplies !== detail.needs_relief_supplies))
  );
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
  return (
    <div className="coordinator-layout">
      <section className="card">
        <h2>{title[page] || title.queue}</h2>
        <p>Yêu cầu mới nhất ở trên cùng. Chọn một yêu cầu để xem và xử lý.</p>
        <div className="queue-filter-toolbar">
          <button
            type="button"
            className="button secondary queue-refresh-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            <span aria-hidden="true">↻</span> Cập nhật SOS
          </button>
          <TeamReadinessQueue refreshRevision={revision} onChanged={() => { setRevision(value => value + 1); setDetailRevision(value => value + 1); }} />
        </div>
        <div className="queue-filter-fields queue-filter-quick">
            <label className="queue-status-field">
            <span>Trạng thái yêu cầu</span>
            <span className="queue-status-select-wrap">
              <select
                value={queueStatus}
                onChange={(event) => {
                  setQueueStatus(event.target.value);
                  setCursor('');
                  setSelected(null);
                }}
              >
                {queueStatuses.map(([status, name]) => (
                  <option key={status} value={status}>
                    {name}
                  </option>
                ))}
              </select>
            </span>
            </label>
            <div className="tabs queue-review-tabs" aria-label="Loại hàng đợi">
            {[
              ['NORMAL', 'Thông thường'],
              ['RATE_LIMITED_REVIEW', 'Rà soát tần suất'],
              ['PROXY_QUOTA_REVIEW', 'Rà soát báo hộ'],
            ].map(([value, title]) => (
              <button
                key={value}
                type="button"
                className={reviewLane === value ? 'active' : ''}
                onClick={() => {
                  setReviewLane(value);
                  setCursor('');
                  setSelected(null);
                }}
              >
                {title}
              </button>
            ))}
            </div>
            <label className="check queue-attention-filter">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(event) => {
                setOverdue(event.target.checked);
                setCursor('');
                setSelected(null);
              }}
            />
            Chỉ xem yêu cầu cần chú ý
            </label>
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
              <div className="empty">Không có yêu cầu trong hàng đợi này.</div>
            )}
            <div className="record-list">
              {queue.items.map((item) => (
                <button
                  type="button"
                  className={`queue-row ${selected === item.id ? 'selected' : ''}`}
                  onClick={() => {
                    detailPanelRef.current?.closest('.coordinator-detail-surface')?.scrollTo(0, 0);
                    if (selected === item.id) {
                      if (detailError) setDetailRevision(value => value + 1);
                      return;
                    }
                    setSelected(item.id);
                    setDetail(null);
                    setDetailError('');
                    setUpdateMessage('');
                  }}
                  key={item.id}
                >
                  <span>
                    <strong>{item.tracking_code}</strong>
                    {item.tracking_code.startsWith('C48HM') && <small className="chip">SOS mô phỏng · bản đồ nhiệt</small>}
                    <small>
                      {label(item.category)} · {timeLabel(item.received_at)}
                    </small>
                    {item.priority_advisory && (
                      <small>
                        Đánh giá ban đầu:{' '}
                        {advisoryScoreLabel(
                          item.priority_advisory.score,
                          item.priority_advisory.level
                        )}
                      </small>
                    )}
                    {item.ai_priority_advisory && (
                      <small>
                        {item.ai_priority_advisory.source === 'DEMO_FIXTURE'
                          ? 'AI minh họa'
                          : 'Kết quả AI'}
                        {' · '}
                        {item.ai_priority_advisory.review_status === 'REJECTED'
                          ? 'Đã bác bỏ, không sử dụng gợi ý'
                          : item.ai_priority_advisory.status !== 'COMPLETED'
                            ? advisoryStatusLabels[item.ai_priority_advisory.status] ||
                              'Chưa rõ trạng thái đánh giá AI'
                            : advisoryScoreLabel(
                                item.ai_priority_advisory.score,
                                item.ai_priority_advisory.level
                              )}
                      </small>
                    )}
                    {item.declared_danger && <small>Có khai báo nguy hiểm tính mạng</small>}
                  </span>
                  <span className="chip queue-status-chip" data-status={item.status}>
                    {requestStatusLabel(item.status)}
                    {item.priority && <PriorityBadge priority={item.priority as 'P1' | 'P2' | 'P3' | 'P4'} />}
                  </span>
                </button>
              ))}
            </div>
            {queue.more && queue.cursor && (
              <button className="button secondary" onClick={() => setCursor(queue.cursor!)}>
                Xem thêm
              </button>
            )}
          </>
        )}
      </section>
      <DetailSurface className="coordinator-detail-surface" modal={compactDetail} open={Boolean(selected)} label="Hồ sơ yêu cầu" onClose={() => setSelected(null)}><section
        className={`queue-detail-card${detail && ['SUBMITTED', 'VERIFYING'].includes(detail.status) ? ' verification-detail-card' : ''}`}
        ref={detailPanelRef}
      >
        <h2>Hồ sơ yêu cầu</h2>
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
            {['SUBMITTED', 'VERIFYING'].includes(detail.status) && (
              <div className="verification-summary">
                <span className="eyebrow">{detail.status === 'SUBMITTED' ? 'BƯỚC 1 · MỞ XÁC MINH' : 'BƯỚC 2 · KIỂM TRA THÔNG TIN'}</span>
                <h3>{detail.tracking_code} · {label(detail.category)}</h3>
                {detail.tracking_code.startsWith('C48HM') && <p className="notice warning">Đây là SOS mô phỏng để hiển thị bản đồ nhiệt, không phải tín hiệu cứu hộ thực tế.</p>}
                <p>{detail.description || 'Chưa có mô tả tình huống.'}</p>
                <div className="verification-facts">
                  <span>{detail.subject.people_affected ?? 'Chưa rõ số'} người cần hỗ trợ</span>
                  <span>{detail.needs_rescue ? 'Cần cứu hộ' : 'Không yêu cầu cứu hộ'}</span>
                  <span>{detail.reporter.name || 'Người báo chưa ghi tên'} · {detail.reporter.contact_phone || 'Chưa có số liên hệ'}</span>
                  <span>Vị trí: <NearbyAddress coordinates={detail.subject.location?.coordinates} /></span>
                </div>
                {detail.status === 'VERIFYING' && (
                  <p className="verification-progress">
                    Đối chiếu vị trí, tình trạng và minh chứng nếu có. Ghi rõ điều đã kiểm tra trước khi xác nhận SOS.
                  </p>
                )}
                <a href="#request-actions">Đi đến thao tác xử lý ↓</a>
                <a href="#request-full-detail">Xem toàn bộ hồ sơ và lịch sử ↓</a>
              </div>
            )}
            {!['SUBMITTED', 'VERIFYING'].includes(detail.status) && (
              <section className="verification-summary">
                <h3>{detail.tracking_code} · {requestStatusLabel(detail.status)}</h3>
                {detail.status === 'DUPLICATE' && (detail.canonical ? (
                  <>
                    <p>Hồ sơ gốc: {detail.canonical.tracking_code} · {requestStatusLabel(detail.canonical.status)}. Theo dõi việc xử lý tại hồ sơ gốc.</p>
                    <button type="button" className="button secondary" onClick={() => {
                      setUpdateMessage('');
                      setSelected(detail.canonical!.id);
                    }}>Mở hồ sơ gốc {detail.canonical.tracking_code}</button>
                  </>
                ) : <p>Không có thông tin hồ sơ gốc trong phạm vi truy cập hiện tại.</p>)}
                {!['DUPLICATE', 'REJECTED', 'CANCELLED'].includes(detail.status) && <a href="#request-actions">Đi đến thao tác xử lý ↓</a>}
                <a href="#request-full-detail">Xem toàn bộ hồ sơ và lịch sử ↓</a>
              </section>
            )}
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
            {page === 'queue' && detail.status !== 'VERIFIED' && detail.subject.location && (
              <div className="queue-context-map">
                <h3>Vị trí SOS đang chọn</h3>
                <HeatmapPanel
                  region={detail.region_code || ''}
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
              </div>
            )}
            {(page === 'triage' || (page === 'queue' && detail.status === 'VERIFIED')) && (
              <div className="triage-context">
                <div className="triage-context-summary">
                  <h3>Thông tin để quyết định ưu tiên</h3>
                  <strong>{detail.tracking_code}</strong>
                  <p>{detail.description || 'Người báo chưa cung cấp mô tả tình huống.'}</p>
                  <p><b>{label(detail.category)}</b> · {detail.subject.people_affected ?? 'Chưa rõ số'} người cần hỗ trợ</p>
                  <p>{detail.declared_danger ? 'Có khai báo nguy hiểm tính mạng' : 'Chưa khai báo nguy hiểm tính mạng'}</p>
                  <p>{detail.needs_rescue ? 'Cần cứu hộ' : 'Không khai báo cần cứu hộ'}
                    {detail.needs_relief_supplies ? ' · Cần hàng cứu trợ' : ''}</p>
                  <small>Ghim đỏ nhấp nháy là SOS đang chọn; vùng nhiệt cho biết mật độ SOS gần đó.</small>
                </div>
                <div className="triage-context-map">
                  <h3>Vị trí trên bản đồ nhiệt</h3>
                  <HeatmapPanel
                    region={detail.region_code || ''}
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
            <div className="detail-grid" id="request-full-detail">
              <p>
                <strong>Mã</strong>
                <span className="detail-value">
                  {detail.tracking_code}
                </span>
              </p>
              <p>
                <strong>Trạng thái</strong>
                <span className="detail-value queue-detail-status" data-status={detail.status}>
                  {requestStatusLabel(detail.status)}
                </span>
              </p>
              <p>
                <strong>Loại sự cố</strong>
                <span className="detail-value">
                  {label(detail.category)}
                </span>
              </p>
              <p>
                <strong>Ưu tiên</strong>
                <span className="detail-value">
                  {detail.priority ? <PriorityBadge priority={detail.priority as 'P1' | 'P2' | 'P3' | 'P4'} /> : 'Chưa quyết định'}
                </span>
              </p>
              <p>
                <strong>Hình thức gửi</strong>
                <span className="detail-value">
                  {detail.report_mode === 'PROXY'
                    ? 'Báo hộ người ở nơi khác'
                    : 'Báo cho bản thân hoặc gia đình'}
                </span>
              </p>
              <p>
                <strong>Người cần hỗ trợ</strong>
                <span className="detail-value">
                  {detail.subject.people_affected == null ? 'Chưa rõ số người' : `${detail.subject.people_affected} người`}
                </span>
              </p>
              <p>
                <strong>Trẻ em / người cao tuổi</strong>
                <span className="detail-value">
                  {detail.subject.children_count == null ? 'Chưa rõ số trẻ em' : `${detail.subject.children_count} trẻ em`} ·{' '}
                  {detail.subject.elderly_count == null ? 'Chưa rõ số người cao tuổi' : `${detail.subject.elderly_count} người cao tuổi`}
                </span>
              </p>
              <p>
                <strong>Nhu cầu</strong>
                <span className="detail-value">
                  {[
                    ...(detail.needs_rescue ? ['Cứu hộ'] : []),
                    ...(detail.needs_relief_supplies ? ['Hàng cứu trợ'] : []),
                  ].join(' · ') || 'Chưa khai báo'}
                </span>
              </p>
              <p>
                <strong>Người báo</strong>
                <span className="detail-value">
                  {detail.reporter.name || 'Chưa có tên'}
                </span>
              </p>
              <p>
                <strong>Liên hệ</strong>
                <span className="detail-value">
                  {detail.reporter.contact_phone || 'Chưa có số liên hệ'}
                </span>
              </p>
              <p>
                <strong>Vị trí</strong>
                <span className="detail-value">
                  <NearbyAddress coordinates={detail.subject.location?.coordinates} />
                </span>
              </p>
              <p>
                <strong>Quan hệ với người cần hỗ trợ</strong>
                <span className="detail-value">
                  {detail.subject.reporter_relationship || 'Tự báo / chưa ghi rõ'}
                </span>
              </p>
              <p>
                <strong>Số liên hệ người cần hỗ trợ</strong>
                <span className="detail-value">
                  {detail.subject.beneficiary_contact_phone || 'Chưa có'}
                </span>
              </p>
              <p>
                <strong>Liên hệ thay thế</strong>
                <span className="detail-value">
                  {[detail.subject.alternate_contact?.name, detail.subject.alternate_contact?.phone]
                    .filter(Boolean)
                    .join(' · ') || 'Chưa có'}
                </span>
              </p>
              <p>
                <strong>Nguồn thông tin / khả năng liên lạc</strong>
                <span className="detail-value">
                  {[detail.subject.information_source, detail.subject.contactability ? label(detail.subject.contactability) : null]
                    .filter(Boolean)
                    .join(' · ') || 'Chưa ghi rõ'}
                </span>
              </p>
              {detail.subject.last_known_situation_at && (
                <p>
                  <strong>Thời điểm biết tình hình gần nhất</strong>
                  <span className="detail-value">
                    {timeLabel(detail.subject.last_known_situation_at)}
                  </span>
                </p>
              )}
              {detail.work_cycle != null && <p>
                <strong>Chu kỳ xử lý hiện tại</strong>
                <span className="detail-value">{detail.work_cycle}</span>
              </p>}
              <p>
                <strong>Phiên bản</strong>
                <span className="detail-value">
                  {detail.version}
                </span>
              </p>
              <p>
                <strong>Chiến dịch</strong>
                <span className="detail-value">
                  {detail.campaign_id
                    ? campaignOptions.find((campaign) => campaign.value === detail.campaign_id)?.label ?? 'Chiến dịch đã gắn'
                    : 'Chưa gắn'}
                </span>
              </p>
            </div>
            {detail.description && <p>{detail.description}</p>}
            {detail.subject.household_reference_note && (
              <p>
                <strong>Ghi chú nhận diện nơi ở:</strong> {detail.subject.household_reference_note}
              </p>
            )}
            {detail.declared_danger && (
              <p className="notice warning">
                Người báo cho biết có nguy hiểm tính mạng; cần kiểm tra ngay.
              </p>
            )}
            {detail.proxy_activity_flags.length > 0 && (
              <p className="notice warning">
                Có tín hiệu hoạt động báo hộ cần rà soát. Đây không phải kết luận gian lận.
              </p>
            )}
            {detail.priority_advisory && (
              <section className="notice warning">
                <h3>Đánh giá ban đầu từ thông tin SOS</h3>
                <p>
                  <strong>
                    {advisoryScoreLabel(
                      detail.priority_advisory.score,
                      detail.priority_advisory.level
                    )}
                  </strong>
                </p>
                <p>
                  <strong>Dấu hiệu:</strong>{' '}
                  {detail.priority_advisory.reason_codes
                    .map((code) => advisoryReasonLabels[code] || 'Có thông tin cần kiểm tra')
                    .join(' · ') || 'Chưa ghi nhận dấu hiệu cần chú ý.'}
                </p>
                <p>
                  Hệ thống tự nhận diện các dấu hiệu cần chú ý từ thông tin đã khai. Điều phối viên
                  vẫn phải xác minh, chọn mức ưu tiên P1–P4 và quyết định giao đội.
                </p>
                {detail.priority_advisory.outcome === 'INSUFFICIENT_DATA' && (
                  <p>
                    Chưa đủ thông tin để kết luận mức nguy cơ. Thiếu thông tin không có nghĩa là tình
                    huống ít khẩn cấp; cần tiếp tục xác minh.
                  </p>
                )}
                {detail.declared_danger && (
                  <p>
                    <strong>Cần kiểm tra ngay:</strong> người báo cho biết có nguy hiểm tính mạng.
                    Thông tin này không tự làm tăng điểm đánh giá.
                  </p>
                )}
              </section>
            )}
            {detail.ai_priority_advisory && detail.ai_advisory?.status !== 'COMPLETED' && (
              <section className="notice">
                <h3>
                  {detail.ai_priority_advisory.source === 'DEMO_FIXTURE'
                    ? 'Đánh giá AI minh họa'
                    : 'Đánh giá hỗ trợ từ AI (Gemini)'}
                </h3>
                <p>
                  <strong>Trạng thái:</strong>{' '}
                  {advisoryStatusLabels[detail.ai_priority_advisory.status] || 'Chưa rõ trạng thái'}
                </p>
                {detail.ai_priority_advisory.review_status === 'REJECTED' && (
                  <p>
                    <strong>Điều phối viên đã bác bỏ gợi ý này.</strong> Nội dung chỉ được giữ trong
                    lịch sử để đối chiếu, không phải gợi ý đang sử dụng.
                  </p>
                )}
                {detail.ai_priority_advisory.status === 'COMPLETED' &&
                  detail.ai_priority_advisory.review_status !== 'REJECTED' &&
                  detail.ai_priority_advisory.score !== null && (
                    <>
                      <p>
                        <strong>
                          {advisoryScoreLabel(
                            detail.ai_priority_advisory.score,
                            detail.ai_priority_advisory.level
                          )}
                        </strong>
                      </p>
                      <p>
                        <strong>Lý do AI đưa ra:</strong>{' '}
                        {detail.ai_priority_advisory.reasons.join(' · ') ||
                          'Không có lý do kèm theo.'}
                      </p>
                      {detail.ai_priority_advisory.confidence !== null && (
                        <p>
                        <strong>Độ tin cậy do AI ước tính:</strong>{' '}
                          {Math.round(detail.ai_priority_advisory.confidence * 100)}% (chỉ tham
                          khảo)
                        </p>
                      )}
                    </>
                  )}
                {detail.ai_priority_advisory.status === 'STALE' && (
                  <p>
                    Thông tin SOS đã thay đổi sau lần đánh giá. Kết quả cũ không còn phù hợp;
                    hãy kiểm tra thông tin mới và tiếp tục xác minh.
                  </p>
                )}
                {['FAILED', 'SKIPPED'].includes(detail.ai_priority_advisory.status) && (
                  <p>AI chưa đánh giá được yêu cầu này. Hãy kiểm tra thông tin SOS và xử lý theo quy trình thủ công.</p>
                )}
                {detail.ai_priority_advisory.status === 'COMPLETED' &&
                  detail.ai_priority_advisory.review_status !== 'REJECTED' &&
                  detail.ai_priority_advisory.score === null && (
                    <p>
                      AI chưa đề xuất điểm nguy cơ; không coi đây là mức nguy cơ thấp.{' '}
                      {detail.ai_priority_advisory.reasons.join(' · ')} Hãy tiếp tục xác minh thủ công.
                    </p>
                  )}
                <p>
                  {detail.ai_priority_advisory.source === 'DEMO_FIXTURE'
                    ? 'Đây là dữ liệu minh họa giao diện; không phải kết quả Gemini chạy thật.'
                    : 'AI chỉ hỗ trợ xem xét. Điều phối viên vẫn quyết định mức ưu tiên và giao đội.'}
                </p>
              </section>
            )}
            {detail.ai_advisory?.status === 'FAILED' && !detail.ai_advisory.review_status &&
              detail.ai_priority_advisory?.source === 'GEMINI' && command({
                title: 'Thử đánh giá AI lại',
                service: 'response',
                path: `/requests/${detail.id}/ai-advisories/${detail.ai_advisory.id}/retry`,
                version: detail.version,
                warning: 'Gửi lại yêu cầu đánh giá AI? Kết quả vẫn chỉ để tham khảo; bạn tiếp tục xử lý SOS theo thông tin đã xác minh.',
              })}
            {detail.ai_advisory && detail.ai_advisory.status === 'COMPLETED' && (
              <section className="notice">
                <h3>
                  {detail.ai_priority_advisory?.source === 'DEMO_FIXTURE'
                    ? 'Thông tin AI minh họa'
                    : 'Thông tin AI ghi nhận'}
                </h3>
                <p>
                  {detail.ai_priority_advisory?.source === 'DEMO_FIXTURE'
                    ? 'Dữ liệu này dùng để minh họa và không phải phản hồi từ Gemini.'
                    : 'AI có thể nhận bản mô tả đã được rút gọn cùng các thông tin tình huống. Số điện thoại, tọa độ chính xác và tệp đính kèm không được đưa vào phần đánh giá. Hãy đối chiếu với hồ sơ SOS trước khi sử dụng.'}
                </p>
                <p>
                  <strong>Trạng thái:</strong>{' '}
                  {advisoryStatusLabels[
                    detail.ai_priority_advisory?.status || detail.ai_advisory.status
                  ] || 'Chưa rõ trạng thái đánh giá AI'}
                </p>
                {detail.ai_priority_advisory?.status === 'COMPLETED' && (
                  <>
                    {detail.ai_advisory.risk_score !== null && (
                      <p>
                        <strong>Điểm rủi ro tham khảo:</strong> {detail.ai_advisory.risk_score}/100
                      </p>
                    )}
                    {detail.ai_advisory.reason_codes.length > 0 && (
                      <p>
                        <strong>Dấu hiệu cần chú ý:</strong>{' '}
                        {detail.ai_advisory.reason_codes
                          .map((code) => advisoryReasonLabels[code] || 'Có dấu hiệu cần rà soát')
                          .join(' · ')}
                      </p>
                    )}
                    {detail.ai_advisory.extracted_json?.summary && (
                      <p>
                        <strong>Tóm tắt:</strong> {detail.ai_advisory.extracted_json.summary}
                      </p>
                    )}
                    {detail.ai_advisory.extracted_json?.indicators &&
                      detail.ai_advisory.extracted_json.indicators.length > 0 && (
                        <p>
                          <strong>Dấu hiệu AI ghi nhận:</strong>{' '}
                          {detail.ai_advisory.extracted_json.indicators.join(' · ')}
                        </p>
                      )}
                    {detail.ai_advisory.extracted_json?.facts && (
                      <div>
                        <strong>Dữ kiện trích xuất cần đối chiếu</strong>
                        {Object.entries(detail.ai_advisory.extracted_json.facts)
                          .filter(([key]) => advisoryFactLabels[key])
                          .map(([key, value]) => (
                            <p key={key}>
                              {advisoryFactLabels[key]}:{' '}
                              {typeof value === 'boolean'
                                ? value
                                  ? 'Có'
                                  : 'Không'
                                : String(value)}
                            </p>
                          ))}
                      </div>
                    )}
                    {aiNeedsMismatch && (
                      <p role="status">
                        <strong>Cần đối chiếu:</strong> AI ghi nhận nhu cầu cứu hộ hoặc hàng cứu trợ
                        khác với phần người báo đã chọn. Giữ dữ liệu gốc và xác minh trước khi quyết định.
                      </p>
                    )}
                    {aiCountMismatches.length > 0 && (
                      <div className="notice warning" role="status">
                        <strong>Cần đối chiếu số người:</strong>
                        {aiCountMismatches.map(key => <p key={key}>
                          {advisoryFactLabels[key]} — hồ sơ: {detail.subject[key] ?? 'Chưa rõ'}; AI: {String(aiFacts?.[key])}.
                        </p>)}
                        <p>Số chưa rõ không có nghĩa là 0. Giữ dữ liệu gốc và xác minh trước khi sử dụng số AI ghi nhận.</p>
                      </div>
                    )}
                    <p>
                      <strong>Độ tin cậy do AI ước tính:</strong>{' '}
                      {Math.round((detail.ai_advisory.extracted_json?.confidence ?? 0) * 100)}% (chỉ
                      tham khảo)
                    </p>
                    {detail.ai_advisory.review_status ? (
                      <p>
                        <strong>Quyết định của điều phối viên:</strong>{' '}
                        {advisoryReviewLabels[detail.ai_advisory.review_status] || 'Đã rà soát'}
                        {detail.ai_advisory.review_status === 'REJECTED'
                          ? ' · Chỉ lưu lịch sử, không sử dụng.'
                          : ''}
                        {detail.ai_advisory.review_note
                          ? ` · ${detail.ai_advisory.review_note}`
                          : ''}
                      </p>
                    ) : (
                      <div>
                        <label className="ai-review-note">
                          <span>Ghi chú khi điều chỉnh hoặc bác bỏ</span>
                          <textarea
                            rows={4}
                            value={aiReviewNote}
                            onChange={(event) => setAiReviewNote(event.target.value)}
                            maxLength={1000}
                          />
                        </label>
                        <div className="action-grid">
                          <button
                            className="button"
                            disabled={aiReviewBusy}
                            onClick={() => void reviewAiAdvisory('ACCEPTED')}
                          >
                            Ghi nhận gợi ý
                          </button>
                          <button
                            className="button secondary"
                            disabled={aiReviewBusy}
                            onClick={() => void reviewAiAdvisory('ADJUSTED')}
                          >
                            Điều chỉnh và ghi nhận
                          </button>
                          <button
                            className="button secondary"
                            disabled={aiReviewBusy}
                            onClick={() => void reviewAiAdvisory('REJECTED')}
                          >
                            Không sử dụng gợi ý
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
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
                    </div>
                  ))}
                </div>
              </section>
            )}
            {detail.mission_history && detail.mission_history.items.length > 0 && (
              <section>
                <h3>Lịch sử nhiệm vụ ({detail.mission_history.items.length})</h3>
                <div className="record-list">
                  {detail.mission_history.items.map((mission) => (
                    <div className="candidate" key={mission.id}>
                      <strong>
                        {mission.team_name} · {label(mission.mission_kind)}
                      </strong>
                      <p>
                        {label(mission.status)} · {timeLabel(mission.created_at)}
                        {mission.last_status ? ` · Cập nhật: ${label(mission.last_status)}` : ''}
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
              </section>
            )}
            <RequestEvidencePanel items={detail.evidence?.items ?? []} />
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
            <RequestTimeline
              key={`timeline-${detail.id}-${detail.version}-${detail.timeline.items[0]?.id ?? 'empty'}`}
              requestId={detail.id}
              initial={detail.timeline}
            />
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
            <div className="action-grid" id="request-actions" tabIndex={-1}>
              {!['RESOLVING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(detail.status) &&
                secondaryCommand({
                  title: 'Ghi nhận chuyển cơ quan chức năng',
                  service: 'response',
                  path: `/requests/${detail.id}/authority-referrals`,
                  fields: [
                    { name: 'referred_body', label: 'Cơ quan tiếp nhận', required: true, maxLength: 200 },
                    { name: 'note', label: 'Nội dung và căn cứ chuyển', type: 'textarea', required: true, maxLength: 1000 },
                  ],
                  warning: 'Xác nhận đã liên hệ và chuyển thông tin yêu cầu này cho cơ quan chức năng?',
                })}
              {!detail.campaign_id &&
                secondaryCommand({
                  title: 'Gắn vào chiến dịch cứu trợ',
                  service: 'response',
                  path: `/requests/${detail.id}/attach-campaign`,
                  version: detail.version,
                  fields: [
                    { name: 'campaign_id', label: 'Chiến dịch', type: 'choice-cards', required: true,
                      options: campaignOptions
                        .filter((campaign) => campaign.regionCode === null || campaign.regionCode === detail.region_code)
                        .map(({ value, label: name }) => ({ value, label: name })) },
                  ],
                  warning: 'Xác nhận gắn yêu cầu này vào chiến dịch đã chọn?',
                })}
              {detail.campaign_id &&
                secondaryCommand({
                  title: 'Gỡ khỏi chiến dịch',
                  service: 'response',
                  path: `/requests/${detail.id}/detach-campaign`,
                  version: detail.version,
                  warning: 'Xác nhận gỡ yêu cầu này khỏi chiến dịch?',
                })}
              {detail.status === 'SUBMITTED' &&
                command({
                  title: 'Bắt đầu xác minh',
                  service: 'response',
                  path: `/requests/${detail.id}/start-verification`,
                  version: detail.version,
                  warning: 'Bắt đầu xác minh yêu cầu này?',
                })}
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
                      version: detail.version,
                      warning:
                        'Bạn đã đối chiếu vị trí, thông tin và hình ảnh được gắn cờ và thấy phù hợp? Quyết định này do điều phối viên thực hiện.',
                      fields: [
                        {
                          name: 'reason',
                          label: 'Nội dung đã đối chiếu (vị trí, thông tin, hình ảnh)',
                          type: 'textarea',
                          required: true,
                          maxLength: 1000,
                          placeholder: 'Ví dụ: Đã xác nhận vị trí, tình trạng và số người cần hỗ trợ.',
                        },
                      ],
                      build: (values) => ({
                        basis: 'EVIDENCE_REVIEWED',
                        reason: values.reason,
                        source_refs: {
                          evidence_ids: (detail.evidence?.items ?? [])
                            .filter((item) => item.state === 'READY')
                            .map((item) => item.id),
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
                  })}
                </>
              )}
              {detail.status === 'VERIFIED' &&
                command({
                  title: 'Xác nhận mức ưu tiên',
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
                      options: priorities,
                    },
                    {
                      name: 'priority_basis',
                      label: 'Mức độ đầy đủ thông tin',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'COMPLETE', label: 'Đủ thông tin' },
                        { value: 'INCOMPLETE_INFO', label: 'Còn thiếu thông tin' },
                      ],
                    },
                    { name: 'reason', label: 'Lý do quyết định', type: 'textarea', required: true, maxLength: 1000 },
                  ],
                })}
              {detail.status === 'TRIAGED' && (
                <section>
                  {latestCompletedMissionId && !completionCheck && <p role="status">Đang đối chiếu nhiệm vụ đã hoàn thành với chu kỳ xử lý hiện tại…</p>}
                  {completionCheck?.error && <p className="notice warning" role="alert">Chưa đối chiếu được nhiệm vụ đã hoàn thành. Hãy bấm “Cập nhật SOS” trước khi giao thêm đội.</p>}
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
                  <p>Xem khoảng cách, vị trí cập nhật và số nhiệm vụ gần đây trước khi chọn đội.</p>
                  <p>
                    Gợi ý cân bằng dựa trên nhiệm vụ 24 giờ và 7 ngày của các đội gần nhất. Đội đang
                    bận không xuất hiện trong danh sách đủ điều kiện.
                  </p>
                  {candidateError && (
                    <p role="alert" className="notice error">
                      Tải đội phù hợp: {candidateError}
                    </p>
                  )}
                  {!candidates && !candidateError && <p role="status">Đang tải đội phù hợp…</p>}
                  {candidates?.items.length === 0 && !detail.region_code && (
                    <p role="status" className="notice warning">
                      SOS chưa được xác định khu vực phụ trách nên hệ thống chưa thể tìm đội phù hợp.
                      Hãy kiểm tra vị trí SOS và nhờ quản trị viên kiểm tra phạm vi khu vực trên hệ thống.
                      Chỉ cập nhật vị trí đội sẽ không giải quyết được trường hợp này.
                    </p>
                  )}
                  {candidates?.items.length === 0 && detail.region_code && (
                    <p role="status" className="notice warning">
                      Chưa có đội đủ điều kiện. Xem tình trạng từng đội trong khu vực bên dưới để biết điều kiện cần bổ sung.
                    </p>
                  )}
                  {candidates?.items.length === 0 && detail.region_code &&
                    <TeamEligibilityDetails regionCode={detail.region_code} category={detail.category} revision={revision} />}
                  {candidates?.items.map((candidate) => (
                    <div className="candidate" key={candidate.team.id}>
                      <strong>{candidate.team.name}</strong>
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
                  ))}
                  {candidates?.unknown_position.map((candidate) => (
                    <div className="candidate" key={candidate.team.id}>
                      <p className="notice warning">
                        {candidate.team.name}: vị trí đã cũ hoặc chưa có.
                        {candidate.team.reporting_mode === 'APP'
                          ? ' Đội trưởng cần cập nhật vị trí trước khi được xét giao nhiệm vụ.'
                          : ' Điều phối viên có thể báo vị trí đã xác nhận.'}
                      </p>
                      {candidate.team.reporting_mode === 'COORDINATOR' &&
                        <CoordinatorTeamPositionForm
                          teamId={candidate.team.id}
                          teamName={candidate.team.name}
                          onSuccess={() => setDetailRevision((value) => value + 1)}
                        />}
                    </div>
                  ))}
                  </>}
                </section>
              )}
              {['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(detail.status) && (
                <div id="resolve-request"><AsyncRequestForm
                  key={`resolve-${detail.id}-${detail.version}`}
                  requestId={detail.id}
                  version={detail.version}
                  kind="resolve"
                  onCompleted={done}
                  onStale={refreshAfterConflict}
                /></div>
              )}
              {[
                'TRIAGED',
                'DISPATCHED',
                'IN_PROGRESS',
              ].includes(detail.status) && (
                <CancelRequestPopup key={`cancel-${detail.id}-${detail.version}`}
                  requestId={detail.id} version={detail.version} onCompleted={done} onStale={refreshAfterConflict} />
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
          </>
        )}
      </section></DetailSurface>
    </div>
  );
}

export function CoordinatorMap({ region, regions }: { region: string; regions: string[] }) {
  return (
    <section className="card">
      <h2>Bản đồ nhiệt SOS</h2>
      <p>
        Bản đồ mở ở tầm nhìn Việt Nam. Chấm tròn cho biết khu vực có SOS; phóng gần bằng chuột hoặc nút + để xem vùng nhiệt.
      </p>
      <HeatmapPanel region={region} overviewRegions={region ? undefined : regions} />
    </section>
  );
}
