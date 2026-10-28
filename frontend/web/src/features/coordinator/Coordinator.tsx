import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { label, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { AsyncRequestForm } from './AsyncRequestForm';
import { RecoveryIssue } from '../../components/RecoveryIssue';
import { AnalyticsRegionField, useAnalyticsRegion } from '../../components/AnalyticsRegion';
import { HeatmapPanel } from './HeatmapPanel';

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
  contact_attempts: { items: { id: string; contact_target: string; outcome: string; attempted_at?: string }[] };
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

function CoordinatorMissionControl({ missionId, teamId, revision, onSuccess, onStale }: {
  missionId: string; teamId: string; revision: number; onSuccess: () => void; onStale: () => void;
}) {
  const [mission, setMission] = useState<{ status: string; version: number } | null>(null);
  const [reportingMode, setReportingMode] = useState('');
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ status: string; version: number }>('response', `/missions/${missionId}`),
      api<{ reporting_mode: string }>('response', `/teams/${teamId}`),
    ]).then(([missionValue, teamValue]) => {
      if (live) { setMission(missionValue); setReportingMode(teamValue.reporting_mode); }
    }).catch((cause) => {
      if (live) setLoadError(cause instanceof Error ? cause.message : 'Không thể tải nhiệm vụ.');
    });
    return () => { live = false; };
  }, [missionId, teamId, revision]);
  if (loadError) return <p className="notice error">{loadError}</p>;
  if (!mission || !reportingMode) return <p>Đang tải nhiệm vụ…</p>;
  if (reportingMode !== 'COORDINATOR') return null;
  const next = { OFFERED: 'ACCEPTED', ACCEPTED: 'EN_ROUTE', EN_ROUTE: 'ON_SCENE', ON_SCENE: 'COMPLETED' }[mission.status];
  if (!next) return null;
  const nextLabel = { ACCEPTED: 'Đội đã nhận', EN_ROUTE: 'Đội đang di chuyển', ON_SCENE: 'Đội đã đến nơi', COMPLETED: 'Đội đã hoàn thành' }[next];
  return <CommandForm
    key={`${missionId}-${mission.version}`}
    spec={{
      title: `Ghi nhận qua liên lạc: ${nextLabel}`,
      service: 'response', path: `/missions/${missionId}/record-on-behalf`, version: mission.version,
      fields: [
        { name: 'recorded_basis', label: 'Cách nhận thông tin', type: 'select', required: true,
          options: [{ value: 'RADIO', label: 'Bộ đàm' }, { value: 'PHONE', label: 'Điện thoại' },
            { value: 'IN_PERSON', label: 'Trao đổi trực tiếp' }, { value: 'OTHER', label: 'Cách khác' }] },
        { name: 'reported_by', label: 'Người báo từ đội', required: true },
        { name: 'reason', label: 'Nội dung xác nhận', required: true, type: 'textarea' },
        ...(next === 'COMPLETED' ? [{ name: 'outcome_note', label: 'Kết quả nhiệm vụ', required: true, type: 'textarea' as const }] : []),
      ],
      build: (values) => ({ to: next, recorded_basis: values.recorded_basis, reported_by: values.reported_by,
        reason: values.reason, occurred_at: new Date().toISOString(),
        ...(next === 'COMPLETED' ? { result: { outcome_note: values.outcome_note } } : {}) }),
    }}
    onSuccess={onSuccess} onStale={onStale}
  />;
}
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
  const [campaignOptions, setCampaignOptions] = useState<{
    value: string; label: string; regionCode: string | null
  }[]>([]);
  useEffect(() => {
    let live = true;
    void api<{ items: { id: string; name: string; status: string; region_code: string | null }[] }>('response', '/campaigns')
      .then((value) => {
        if (live) setCampaignOptions(value.items
          .filter((campaign) => campaign.status === 'ACTIVE')
          .map((campaign) => ({ value: campaign.id, label: campaign.name,
            regionCode: campaign.region_code })));
      })
      .catch(() => { /* Vẫn có thể nhập mã khi không tải được danh sách. */ });
    return () => { live = false; };
  }, [revision]);
  const refreshReasonRef = useRef<'success' | 'stale' | null>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);
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
  function secondaryCommand(spec: CommandSpec) {
    return (
      <details className="secondary-command">
        <summary>{spec.title}</summary>
        {command(spec)}
      </details>
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
        <p>Yêu cầu mới nhất ở trên cùng. Chọn một yêu cầu để xem và xử lý.</p>
        <div className="queue-filter-panel">
          <div className="queue-filter-heading">
            <div>
              <span className="queue-filter-eyebrow">BỘ LỌC HÀNG ĐỢI</span>
              <strong>Lọc danh sách</strong>
            </div>
            <button
              type="button"
              className="button secondary queue-refresh-button"
              onClick={() => setRevision((value) => value + 1)}
            >
              <span aria-hidden="true">↻</span> Cập nhật
            </button>
          </div>
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
                    setSelected(item.id);
                    setDetail(null);
                    setDetailError('');
                    setUpdateMessage('');
                    detailPanelRef.current?.scrollTo(0, 0);
                    if (window.matchMedia('(max-width: 1050px)').matches) {
                      detailPanelRef.current?.scrollIntoView({ block: 'start' });
                    }
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
      <section
        className={`card queue-detail-card${detail && ['SUBMITTED', 'VERIFYING'].includes(detail.status) ? ' verification-detail-card' : ''}`}
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
                <p>{detail.description || 'Chưa có mô tả tình huống.'}</p>
                <div className="verification-facts">
                  <span>{detail.subject.people_affected ?? 'Chưa rõ số'} người cần hỗ trợ</span>
                  <span>{detail.needs_rescue ? 'Cần cứu hộ' : 'Không yêu cầu cứu hộ'}</span>
                  <span>{detail.reporter.name || 'Người báo chưa ghi tên'} · {detail.reporter.contact_phone || 'Chưa có số liên hệ'}</span>
                  <span>Vị trí: {detail.subject.location?.coordinates?.join(', ') || 'Chưa có tọa độ'}</span>
                </div>
                {detail.status === 'VERIFYING' && (
                  <p className="verification-progress">
                    Đối chiếu vị trí, tình trạng và minh chứng nếu có. Ghi rõ điều đã kiểm tra trước khi xác nhận SOS.
                  </p>
                )}
                <a href="#request-full-detail">Xem toàn bộ hồ sơ và lịch sử ↓</a>
              </div>
            )}
            {page === 'triage' && (
              <div className="triage-context">
                <div className="triage-context-summary">
                  <h3>Thông tin để quyết định ưu tiên</h3>
                  <strong>{detail.tracking_code}</strong>
                  <p>{detail.description || 'Người báo chưa cung cấp mô tả tình huống.'}</p>
                  <p><b>{label(detail.category)}</b> · {detail.subject.people_affected ?? 'Chưa rõ số'} người cần hỗ trợ</p>
                  <p>{detail.declared_danger ? 'Có khai báo nguy hiểm tính mạng' : 'Chưa khai báo nguy hiểm tính mạng'}</p>
                  <p>{detail.needs_rescue ? 'Cần cứu hộ' : 'Không khai báo cần cứu hộ'}
                    {detail.needs_relief_supplies ? ' · Cần hàng cứu trợ' : ''}</p>
                  <small>Ghim đỏ là SOS đang chọn; vùng nhiệt cho biết mật độ SOS gần đó.</small>
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
            {detail.ai_priority_advisory && (
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
                    : 'AI chỉ nhận các thông tin đã chọn trong biểu mẫu. Nội dung mô tả, liên hệ, vị trí chính xác và tệp đính kèm không được gửi. Hãy đối chiếu với hồ sơ SOS trước khi sử dụng.'}
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
                secondaryCommand({
                  title: 'Gắn vào chiến dịch cứu trợ',
                  service: 'response',
                  path: `/requests/${detail.id}/attach-campaign`,
                  version: detail.version,
                  fields: [
                    { name: 'campaign_id', label: 'Chiến dịch', type: 'reference', required: true,
                      options: campaignOptions
                        .filter((campaign) => campaign.regionCode === null || campaign.regionCode === detail.region_code)
                        .map(({ value, label: name }) => ({ value, label: name })),
                      placeholder: 'Dán mã chiến dịch' },
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
                    </details>
                  )}
                  {secondaryCommand({
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
                      Chưa có đội phù hợp. Hãy kiểm tra đơn vị quản lý, khu vực hoạt động, kỹ năng,
                      trạng thái và vị trí gần đây của các đội.
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
                <details className="secondary-command">
                  <summary>Hủy yêu cầu</summary>
                  <AsyncRequestForm
                    key={`cancel-${detail.id}-${detail.version}`}
                    requestId={detail.id}
                    version={detail.version}
                    kind="cancel"
                    onCompleted={done}
                  />
                </details>
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
                <details className="secondary-command">
                  <summary>Cấp mã khôi phục</summary>
                  <RecoveryIssue
                    key={`recovery-${detail.id}-${detail.version}`}
                    service="response"
                    path={`/requests/${detail.id}/recovery`}
                    version={detail.version}
                    kind="sos"
                    contacts={detail.contact_attempts.items}
                  />
                </details>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function CoordinatorMap() {
  const [national, setNational] = useState(true);
  const {
    region,
    setRegion,
    regions,
    loading: regionLoading,
    error: regionError,
  } = useAnalyticsRegion();
  return (
    <section className="card">
      <h2>Bản đồ nhiệt SOS</h2>
      <p>
        Bản đồ mở ở tầm nhìn Việt Nam. Chấm tròn cho biết khu vực có SOS; phóng gần bằng chuột hoặc nút + để xem vùng nhiệt.
      </p>
      <div className="tabs map-scope-switch" role="group" aria-label="Phạm vi bản đồ">
        <button type="button" className={national ? 'active' : ''} onClick={() => setNational(true)}>
          Các khu vực của tôi
        </button>
        <button type="button" className={!national ? 'active' : ''} onClick={() => setNational(false)}>
          Một khu vực
        </button>
      </div>
      {!national && <AnalyticsRegionField region={region} onChange={setRegion} regions={regions} />}
      {national && <p className="muted">Tổng hợp các khu vực có chiến dịch mà tài khoản được cấp quyền xem.</p>}
      {regionError && (
        <p role="alert" className="notice error">
          {regionError}
        </p>
      )}
      {national && !regions.length && !regionLoading && <p>Chưa có khu vực nào để tổng hợp. Hãy chọn “Một khu vực” và nhập mã.</p>}
      {!national && !region && !regionLoading && <p>Chọn hoặc nhập mã khu vực để tải bản đồ.</p>}
      <HeatmapPanel region={national ? '' : region} overviewRegions={national ? regions : undefined} />
    </section>
  );
}
