import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { label, timeLabel } from '../../i18n/labels';
import { AsyncRequestForm } from './AsyncRequestForm';
import { RecoveryIssue } from '../../components/RecoveryIssue';
import { AnalyticsRegionField, useAnalyticsRegion } from '../../components/AnalyticsRegion';

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
  event_type: string;
  occurred_at: string;
  payload?: Record<string, unknown>;
};
type Detail = QueueItem & {
  version: number;
  description?: string | null;
  report_mode: string;
  campaign_id?: string | null;
  needs_rescue: boolean;
  needs_relief_supplies: boolean;
  reporter: { name?: string | null; contact_phone?: string | null };
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
  contact_attempts: { items: { id: string; contact_target: string; outcome: string }[] };
  timeline: { items: Event[] };
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
  evidence?: { items: { id: string; state: string; size_bytes: number; created_at: string }[] };
};
type Candidate = {
  team: { id: string; name: string };
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
type DuplicateCandidate = {
  id: string;
  tracking_code?: string;
  category: string;
  status: string;
  received_at: string;
  distance_m: number;
};
const priorities = ['P1', 'P2', 'P3', 'P4'].map((value) => ({ value, label: value }));
const stateFilter: Record<string, string> = {
  verify: 'SUBMITTED',
  triage: 'VERIFIED',
  assign: 'TRIAGED',
};
const queueStatuses = [
  ['', 'Tất cả trạng thái'],
  ['SUBMITTED', 'Chờ xác minh'],
  ['VERIFYING', 'Đang xác minh'],
  ['VERIFIED', 'Đã xác minh'],
  ['TRIAGED', 'Đã quyết định ưu tiên'],
  ['ASSIGNED', 'Đã giao đội'],
  ['IN_PROGRESS', 'Đang thực hiện'],
  ['RESOLVING', 'Đang kết thúc'],
  ['RESOLVED', 'Đã giải quyết'],
  ['CLOSED', 'Đã đóng'],
  ['REJECTED', 'Đã từ chối'],
  ['DUPLICATE', 'Trùng yêu cầu'],
  ['CANCELLED', 'Đã hủy'],
] as const;
const title: Record<string, string> = {
  queue: 'Hàng đợi SOS',
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
  QUEUED: 'Đang chờ Gemini đánh giá',
  PROCESSING: 'Gemini đang đánh giá',
  COMPLETED: 'Đã có gợi ý',
  STALE: 'Gợi ý đã cũ do dữ kiện thay đổi',
  SKIPPED: 'AI không khả dụng hoặc đã bỏ qua đánh giá',
  FAILED: 'Gemini chưa trả được kết quả',
  UNKNOWN: 'Chưa rõ trạng thái đánh giá AI',
};

function advisoryScoreLabel(score: number | null, level: string | null): string {
  if (score === null || !level || !advisoryLevelLabels[level]) return 'Chưa đủ dữ kiện để đánh giá';
  return `${advisoryLevelLabels[level]} · ${score}/100`;
}

export function Coordinator({ page }: { page: string }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueStatus, setQueueStatus] = useState(stateFilter[page] || '');
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [candidateError, setCandidateError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateError, setDuplicateError] = useState('');
  const [reviewLane, setReviewLane] = useState('NORMAL');
  const [overdue, setOverdue] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [aiReviewNote, setAiReviewNote] = useState('');
  const [aiReviewBusy, setAiReviewBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refreshReasonRef = useRef<'success' | 'stale' | null>(null);
  useEffect(() => {
    setQueueStatus(stateFilter[page] || '');
    setCursor('');
    setSelected(null);
    setDetail(null);
    setUpdateMessage('');
    refreshReasonRef.current = null;
  }, [page]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRevision((value) => value + 1);
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);
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
        if (live) setQueue(value);
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
    setCandidates(null);
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
                ? `Đã cập nhật. Trạng thái hiện tại: ${label(value.status)}.`
                : `Đã tải lại hồ sơ. Trạng thái hiện tại: ${label(value.status)}.`
            );
          }
        }
      })
      .catch((cause) => {
        if (live) {
          refreshReasonRef.current = null;
          setUpdateMessage('');
          setDetail(null);
          setDetailError(cause instanceof Error ? cause.message : 'Không thể tải lại hồ sơ.');
        }
      });
    return () => {
      live = false;
    };
  }, [selected, revision]);
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
      <CommandForm
        key={spec.path + detail?.version}
        spec={spec}
        onSuccess={done}
        onStale={refreshAfterConflict}
      />
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
  const aiNeedsMismatch = Boolean(
    detail &&
      ((typeof aiFacts?.needs_rescue === 'boolean' &&
        aiFacts.needs_rescue !== detail.needs_rescue) ||
        (typeof aiFacts?.needs_relief_supplies === 'boolean' &&
          aiFacts.needs_relief_supplies !== detail.needs_relief_supplies))
  );
  return (
    <div className="coordinator-layout">
      <section className="card">
        <h2>{title[page] || title.queue}</h2>
        <p>Yêu cầu được sắp theo thời điểm tiếp nhận. Chọn một yêu cầu để xem và xử lý.</p>
        <button
          type="button"
          className="button secondary"
          onClick={() => setRevision((value) => value + 1)}
        >
          Cập nhật danh sách
        </button>
        <label>
          Trạng thái trong danh sách
          <select
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
          </select>
        </label>
        <div className="tabs">
          {[
            ['NORMAL', 'Thông thường'],
            ['RATE_LIMITED_REVIEW', 'Rà soát tần suất'],
            ['PROXY_QUOTA_REVIEW', 'Rà soát báo hộ'],
          ].map(([value, title]) => (
            <button
              key={value}
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
        <label className="check">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(event) => {
              setOverdue(event.target.checked);
              setCursor('');
              setSelected(null);
            }}
          />{' '}
          Chỉ xem yêu cầu cần chú ý
        </label>
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
                    setSelected(item.id);
                    setDetail(null);
                    setDetailError('');
                    setUpdateMessage('');
                  }}
                  key={item.id}
                >
                  <span>
                    <strong>{item.tracking_code}</strong>
                    <small>
                      {label(item.category)} · {timeLabel(item.received_at)}
                    </small>
                    {item.priority_advisory && (
                      <small>
                        Gợi ý theo quy tắc:{' '}
                        {advisoryScoreLabel(
                          item.priority_advisory.score,
                          item.priority_advisory.level
                        )}
                      </small>
                    )}
                    {item.ai_priority_advisory && (
                      <small>
                        {item.ai_priority_advisory.source === 'DEMO_FIXTURE'
                          ? 'Gợi ý AI minh họa'
                          : 'Gợi ý Gemini'}
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
                  <span className="chip">
                    {label(item.status)}
                    {item.priority ? ` · ${item.priority}` : ''}
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
      <section className="card">
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
            <div className="detail-grid">
              <p>
                <strong>Mã</strong>
                <span className="detail-value">
                  {detail.tracking_code}
                </span>
              </p>
              <p>
                <strong>Trạng thái</strong>
                <span className="detail-value">
                  {label(detail.status)}
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
                  {detail.priority || 'Chưa quyết định'}
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
                  {detail.subject.people_affected ?? 'Chưa rõ'} người
                </span>
              </p>
              <p>
                <strong>Trẻ em / người cao tuổi</strong>
                <span className="detail-value">
                  {detail.subject.children_count ?? 0} trẻ em · {detail.subject.elderly_count ?? 0}{' '}
                  người cao tuổi
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
                  {detail.subject.location?.coordinates?.join(', ') || 'Chưa có tọa độ'}
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
                  {[detail.subject.information_source, detail.subject.contactability]
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
              <p>
                <strong>Phiên bản</strong>
                <span className="detail-value">
                  {detail.version}
                </span>
              </p>
              <p>
                <strong>Chiến dịch</strong>
                <span className="detail-value">
                  {detail.campaign_id ? detail.campaign_id.slice(0, 8) : 'Chưa gắn'}
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
                <h3>Gợi ý ưu tiên theo quy tắc backend</h3>
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
                    .map((code) => advisoryReasonLabels[code] || 'Có dữ kiện cần rà soát')
                    .join(' · ') || 'Chưa ghi nhận dấu hiệu theo bộ quy tắc.'}
                </p>
                <p>
                  Đây là gợi ý từ dữ liệu SOS đã cung cấp, cần điều phối viên xác minh. Gợi ý không
                  thay đổi mức ưu tiên P1–P4 và không tự giao đội. Nếu Gemini quá tải hoặc hết hạn
                  mức, gợi ý quy tắc này vẫn hoạt động.
                </p>
                {detail.priority_advisory.outcome === 'INSUFFICIENT_DATA' && (
                  <p>
                    Chưa đủ dữ kiện để kết luận mức nguy cơ. Thiếu thông tin không có nghĩa là tình
                    huống ít khẩn cấp; cần tiếp tục xác minh.
                  </p>
                )}
                {detail.declared_danger && (
                  <p>
                    <strong>Cảnh báo riêng:</strong> người báo tin khai có nguy hiểm tính mạng; cần
                    kiểm tra ngay. Cờ này không tự cộng điểm.
                  </p>
                )}
              </section>
            )}
            {detail.ai_priority_advisory && (
              <section className="notice">
                <h3>
                  {detail.ai_priority_advisory.source === 'DEMO_FIXTURE'
                    ? 'Gợi ý AI minh họa'
                    : 'Gợi ý đánh giá rủi ro từ Gemini'}
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
                        <strong>Lý do Gemini đưa ra:</strong>{' '}
                        {detail.ai_priority_advisory.reasons.join(' · ') ||
                          'Không có lý do kèm theo.'}
                      </p>
                      {detail.ai_priority_advisory.confidence !== null && (
                        <p>
                          <strong>Độ tin cậy tự báo cáo:</strong>{' '}
                          {Math.round(detail.ai_priority_advisory.confidence * 100)}% (chỉ tham
                          khảo)
                        </p>
                      )}
                    </>
                  )}
                {detail.ai_priority_advisory.status === 'STALE' && (
                  <p>
                    Dữ kiện SOS đã thay đổi sau lần đánh giá. Gợi ý cũ không còn được dùng để rà
                    soát; hãy đối chiếu dữ kiện hiện tại và tiếp tục xác minh thủ công.
                  </p>
                )}
                {detail.ai_priority_advisory.status === 'COMPLETED' &&
                  detail.ai_priority_advisory.review_status !== 'REJECTED' &&
                  detail.ai_priority_advisory.score === null && (
                    <p>
                      Gemini chưa đề xuất điểm nguy cơ; không coi đây là mức nguy cơ thấp.{' '}
                      {detail.ai_priority_advisory.reasons.join(' · ')} Hãy tiếp tục xác minh thủ công.
                    </p>
                  )}
                <p>
                  {detail.ai_priority_advisory.source === 'DEMO_FIXTURE'
                    ? 'Đây là dữ liệu minh họa giao diện; không phải kết quả Gemini chạy thật.'
                    : 'Đây là gợi ý để điều phối viên rà soát, không thay đổi mức P1–P4, thứ tự hàng đợi hoặc quyết định giao đội.'}
                </p>
              </section>
            )}
            {detail.ai_advisory && (
              <section className="notice">
                <h3>
                  {detail.ai_priority_advisory?.source === 'DEMO_FIXTURE'
                    ? 'Thông tin AI minh họa'
                    : 'Trích xuất thông tin bằng Gemini'}
                </h3>
                <p>
                  {detail.ai_priority_advisory?.source === 'DEMO_FIXTURE'
                    ? 'Dữ liệu này dùng để minh họa và không phải phản hồi từ Gemini.'
                    : 'Mặc định, Gemini chỉ nhận dữ kiện SOS có cấu trúc; mô tả tự do, thông tin liên hệ, vị trí chính xác và tệp bằng chứng không được gửi. Chỉ bật gửi mô tả đã khử một số định danh cho dữ liệu minh họa tổng hợp; biện pháp này có thể bỏ sót thông tin nhận dạng và không được dùng với SOS thật. Điều phối viên cần đối chiếu với người báo tin.'}
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
                        <strong>Dấu hiệu theo quy tắc:</strong>{' '}
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
                          <strong>Dấu hiệu AI trích xuất:</strong>{' '}
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
                    <p>
                      <strong>Độ tin cậy mô hình tự báo cáo:</strong>{' '}
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
                {['FAILED', 'SKIPPED'].includes(detail.ai_advisory.status) && (
                  <p>
                    Gemini chưa trả kết quả cho dữ kiện SOS này. Gợi ý theo quy tắc backend vẫn hiển
                    thị ở mục trên; hãy tiếp tục xác minh thủ công.
                  </p>
                )}
              </section>
            )}
            {detail.active_missions && detail.active_missions.items.length > 0 && (
              <section>
                <h3>Nhiệm vụ đang giao ({detail.active_missions.items.length})</h3>
                <div className="record-list">
                  {detail.active_missions.items.map((m) => (
                    <div className="candidate" key={m.id}>
                      <strong>Mã nhiệm vụ: {m.id.slice(0, 8)}</strong>
                      <p>
                        Trạng thái: {label(m.status)} · Đội: {m.team_id.slice(0, 8)} ·{' '}
                        {timeLabel(m.created_at)}
                      </p>
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
                      {mission.override_reason && (
                        <p>Lý do chọn đội khác đề xuất: {mission.override_reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {detail.evidence && detail.evidence.items.length > 0 && (
              <section>
                <h3>Minh chứng hiện trường ({detail.evidence.items.length})</h3>
                <div className="record-list">
                  {detail.evidence.items.map((ev) => (
                    <div className="candidate" key={ev.id}>
                      <strong>Tệp {ev.id.slice(0, 8)}</strong>
                      <p>
                        {label(ev.state)} · {timeLabel(ev.created_at)} ·{' '}
                        {Math.ceil(ev.size_bytes / 1024)} KB
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <h3>Lịch sử</h3>
            <div className="timeline">
              {detail.timeline.items.map((event) => (
                <p className="timeline-item" key={event.id}>
                  {label(event.event_type)} · {timeLabel(event.occurred_at)}
                </p>
              ))}
            </div>
            <div className="action-grid">
              {!detail.campaign_id &&
                command({
                  title: 'Gắn vào chiến dịch cứu trợ',
                  service: 'response',
                  path: `/requests/${detail.id}/attach-campaign`,
                  version: detail.version,
                  fields: [
                    { name: 'campaign_id', label: 'Mã định danh chiến dịch', required: true },
                  ],
                  warning: 'Xác nhận gắn yêu cầu này vào chiến dịch đã chọn?',
                })}
              {detail.campaign_id &&
                command({
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
                  {command({
                    title: 'Ghi nhận lần liên hệ',
                    service: 'response',
                    path: `/requests/${detail.id}/contact-attempts`,
                    fields: [
                      {
                        name: 'contact_target',
                        label: 'Đối tượng liên hệ',
                        type: 'select',
                        required: true,
                        options: [
                          ['REPORTER', 'Người báo'],
                          ['BENEFICIARY', 'Người cần hỗ trợ'],
                          ['ALTERNATE', 'Liên hệ thay thế'],
                          ['AUTHORITY', 'Cơ quan chức năng'],
                        ].map(([value, label]) => ({ value, label })),
                      },
                      {
                        name: 'outcome',
                        label: 'Kết quả',
                        type: 'select',
                        required: true,
                        options: [
                          ['REACHED', 'Đã liên hệ'],
                          ['NO_ANSWER', 'Không trả lời'],
                          ['WRONG_NUMBER', 'Sai số'],
                          ['OTHER', 'Khác'],
                        ].map(([value, label]) => ({ value, label })),
                      },
                      { name: 'note', label: 'Ghi chú', type: 'textarea' },
                    ],
                  })}
                  {detail.report_mode === 'PROXY' &&
                    command({
                      title: 'Điều phối viên thứ hai xác nhận',
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
                        },
                      ],
                    })}
                  {detail.report_mode !== 'PROXY' &&
                    command({
                      title: 'Xác nhận đã xác minh',
                      service: 'response',
                      path: `/requests/${detail.id}/verify`,
                      version: detail.version,
                      warning:
                        'Xác nhận kết quả xác minh dựa trên bằng chứng đã chọn? Quyết định này do điều phối viên thực hiện.',
                      fields: [
                        {
                          name: 'contact_attempt_id',
                          label: 'Mã lần liên hệ xác nhận',
                          type: 'select',
                          required: true,
                          options: detail.contact_attempts.items
                            .filter((item) => item.outcome === 'REACHED')
                            .map((item) => ({
                              value: item.id,
                              label: `${label(item.contact_target)} · ${item.id.slice(0, 8)}`,
                            })),
                        },
                        {
                          name: 'reason',
                          label: 'Lý do xác minh',
                          type: 'textarea',
                          required: true,
                        },
                      ],
                      build: (values) => ({
                        basis: 'CONTACT_CONFIRMED',
                        reason: values.reason,
                        source_refs: { contact_attempt_ids: [values.contact_attempt_id] },
                      }),
                    })}
                  {detail.report_mode === 'PROXY' &&
                    detail.timeline.items.some((event) => event.event_type === 'CONCURRENCE') &&
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
                            .filter((event) => event.event_type === 'CONCURRENCE')
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
                    <section>
                      <h3>Yêu cầu có thể trùng</h3>
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
                              },
                            ],
                            build: (values) => ({
                              canonical_request_id: candidate.id,
                              reason: values.reason,
                            }),
                          })}
                        </div>
                      ))}
                    </section>
                  )}
                  {command({
                    title: 'Từ chối yêu cầu',
                    service: 'response',
                    path: `/requests/${detail.id}/reject`,
                    version: detail.version,
                    warning:
                      'Bạn có chắc muốn từ chối yêu cầu này? Lý do sẽ được lưu trong lịch sử.',
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }],
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
                    { name: 'reason', label: 'Lý do quyết định', type: 'textarea', required: true },
                  ],
                })}
              {detail.status === 'TRIAGED' && (
                <section>
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
                  {candidates?.items.length === 0 && (
                    <p role="status">
                      Hiện chưa có đội đủ điều kiện để giao yêu cầu này. Kiểm tra trạng thái và thời
                      điểm cập nhật vị trí của đội.
                    </p>
                  )}
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
                        title: `Giao đội ${candidate.team.name}`,
                        service: 'response',
                        path: `/requests/${detail.id}/missions`,
                        version: detail.version,
                        warning: `Xác nhận giao yêu cầu ${detail.tracking_code} cho đội ${candidate.team.name}?`,
                        build: () => ({ team_id: candidate.team.id }),
                      })}
                    </div>
                  ))}
                  {candidates?.unknown_position.map((candidate) => (
                    <p className="notice warning" key={candidate.team.id}>
                      {candidate.team.name}: chưa có vị trí đủ mới; cần kiểm tra trước khi giao.
                    </p>
                  ))}
                </section>
              )}
              {['VERIFIED', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS'].includes(detail.status) && (
                <AsyncRequestForm
                  key={`resolve-${detail.id}-${detail.version}`}
                  requestId={detail.id}
                  version={detail.version}
                  kind="resolve"
                  onCompleted={done}
                />
              )}
              {[
                'SUBMITTED',
                'VERIFYING',
                'VERIFIED',
                'TRIAGED',
                'ASSIGNED',
                'IN_PROGRESS',
              ].includes(detail.status) && (
                <AsyncRequestForm
                  key={`cancel-${detail.id}-${detail.version}`}
                  requestId={detail.id}
                  version={detail.version}
                  kind="cancel"
                  onCompleted={done}
                />
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
                    { name: 'reason', label: 'Lý do mở lại', type: 'textarea', required: true },
                  ],
                })}
              {detail.contact_attempts.items.some(
                (item) =>
                  item.outcome === 'REACHED' &&
                  ['REPORTER', 'ALTERNATE'].includes(item.contact_target)
              ) && (
                <RecoveryIssue
                  key={`recovery-${detail.id}-${detail.version}`}
                  service="response"
                  path={`/requests/${detail.id}/recovery`}
                  version={detail.version}
                  kind="sos"
                  contacts={detail.contact_attempts.items}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function CoordinatorMap() {
  const {
    region,
    setRegion,
    regions,
    loading: regionLoading,
    error: regionError,
  } = useAnalyticsRegion();
  const [layer, setLayer] = useState<'confirmed' | 'unverified'>('confirmed');
  const [data, setData] = useState<{
    items: { center: { coordinates: [number, number] }; count: number }[];
    generated_at: string;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!region) return;
    let active = true;
    setData(null);
    setError('');
    const now = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    api<typeof data>(
      'response',
      `/map/heatmap?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now)}&status_layer=${layer}&region_code=${encodeURIComponent(region)}`
    )
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải bản đồ.');
      });
    return () => {
      active = false;
    };
  }, [layer, region]);
  return (
    <section className="card">
      <h2>Bản đồ tổng hợp theo ô</h2>
      <p>
        Chỉ hiển thị số lượng theo ô, không hiển thị vị trí hoặc liên hệ chính xác của người báo.
      </p>
      <AnalyticsRegionField region={region} onChange={setRegion} regions={regions} />
      {regionError && (
        <p role="alert" className="notice error">
          {regionError}
        </p>
      )}
      {!region && !regionLoading && <p>Chọn hoặc nhập mã khu vực để tải bản đồ.</p>}
      <div className="tabs">
        <button
          className={layer === 'confirmed' ? 'active' : ''}
          onClick={() => setLayer('confirmed')}
        >
          Đã xác minh
        </button>
        <button
          className={layer === 'unverified' ? 'active' : ''}
          onClick={() => setLayer('unverified')}
        >
          Chưa xác minh
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải dữ liệu bản đồ…</p>}
      {data && (
        <>
          <p className="muted">Tạo lúc {timeLabel(data.generated_at)}</p>
          {data.items.length ? (
            <div className="map-cells">
              {data.items.map((cell, index) => (
                <div className="map-cell" key={index}>
                  <strong>{cell.count} yêu cầu</strong>
                  <small>Ô gần {cell.center.coordinates.map((v) => v.toFixed(3)).join(', ')}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">Chưa có yêu cầu trong lớp dữ liệu này.</div>
          )}
        </>
      )}
    </section>
  );
}
