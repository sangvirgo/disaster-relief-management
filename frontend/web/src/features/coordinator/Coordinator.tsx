import { useCallback, useEffect, useRef, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
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
};
type Queue = { items: QueueItem[]; cursor?: string; more: boolean; generated_at: string };
type Event = { id: string; event_type: string; occurred_at: string; payload?: Record<string, unknown> };
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
      id: string; status: string; mission_kind: string; created_at: string; team_id: string; team_name: string;
      suggested_team_id?: string | null; override_reason?: string | null; last_status?: string | null;
      last_occurred_at?: string | null; recorded_basis?: string | null; reported_by?: string | null;
    }[];
  };
  ai_advisory?: {
    id: string; model: string; status: string; risk_score: number; reason_codes: string[];
    extracted_json?: { summary?: string; indicators?: string[]; facts?: Record<string, unknown>; confidence?: number } | null;
    review_status?: string | null; review_note?: string | null; error_code?: string | null;
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
    id: string; status: string; mission_kind: string; created_at: string; override_reason?: string | null;
    last_progress?: { status?: string; occurred_at?: string; recorded_basis?: string; reported_by?: string } | null;
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
  INJURY_OR_MEDICAL: 'Có dấu hiệu chấn thương hoặc cần cấp cứu',
  RESCUE_REQUESTED: 'Có yêu cầu cứu hộ',
  RELIEF_SUPPLIES_ONLY: 'Chỉ yêu cầu hàng cứu trợ',
};
const advisoryReviewLabels: Record<string, string> = {
  ACCEPTED: 'Ghi nhận',
  ADJUSTED: 'Điều chỉnh',
  REJECTED: 'Không sử dụng',
};

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
            setUpdateMessage(reason === 'success'
              ? `Đã cập nhật. Trạng thái hiện tại: ${label(value.status)}.`
              : `Đã tải lại hồ sơ. Trạng thái hiện tại: ${label(value.status)}.`);
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
        if (live) setCandidateError(cause instanceof Error ? cause.message : 'Không thể tải đội phù hợp.');
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
        if (live) setDuplicateError(cause instanceof Error ? cause.message : 'Không thể kiểm tra yêu cầu có thể trùng.');
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
    return <CommandForm key={spec.path + detail?.version} spec={spec} onSuccess={done} onStale={refreshAfterConflict} />;
  }
  async function reviewAiAdvisory(decision: 'ACCEPTED' | 'ADJUSTED' | 'REJECTED') {
    if (!detail?.ai_advisory) return;
    if (decision === 'ADJUSTED' && !aiReviewNote.trim()) {
      setError('Vui lòng ghi nội dung điều chỉnh trước khi lưu quyết định.');
      return;
    }
    setAiReviewBusy(true);
    setError('');
    try {
      await api('response', `/requests/${detail.id}/ai-advisories/${detail.ai_advisory.id}/review`, {
        method: 'POST',
        body: { decision, ...(aiReviewNote.trim() ? { note: aiReviewNote.trim() } : {}) },
        idempotencyKey: newCommandKey(),
      });
      setAiReviewNote('');
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu quyết định rà soát AI.');
    } finally {
      setAiReviewBusy(false);
    }
  }
  return (
    <div className="coordinator-layout">
      <section className="card">
        <h2>{title[page] || title.queue}</h2>
        <p>
          Yêu cầu được sắp theo thời điểm tiếp nhận. Chọn một yêu cầu để xem và xử lý.
        </p>
        <button type="button" className="button secondary" onClick={() => setRevision((value) => value + 1)}>Cập nhật danh sách</button>
        <label>
          Trạng thái trong danh sách
          <select value={queueStatus} onChange={(event) => {
            setQueueStatus(event.target.value);
            setCursor('');
          }}>
            {queueStatuses.map(([status, name]) => <option key={status} value={status}>{name}</option>)}
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
                  onClick={() => { setSelected(item.id); setDetail(null); setDetailError(''); setUpdateMessage(''); }}
                  key={item.id}
                >
                  <span>
                    <strong>{item.tracking_code}</strong>
                    <small>
                      {label(item.category)} · {timeLabel(item.received_at)}
                    </small>
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
        {updateMessage && <p className="notice" role="status">{updateMessage}</p>}
        {detailError && <p className="notice error" role="alert">{detailError} <button type="button" className="button secondary" onClick={() => setRevision((value) => value + 1)}>Tải lại hồ sơ</button></p>}
        {!selected && (
          <div className="empty">Chọn một yêu cầu để xem thông tin được cấp quyền.</div>
        )}
        {selected && !detail && !detailError && <p role="status">Đang tải hồ sơ…</p>}
        {detail && (
          <>
            <div className="detail-grid">
              <p>
                <strong>Mã</strong>
                <br />
                {detail.tracking_code}
              </p>
              <p>
                <strong>Trạng thái</strong>
                <br />
                {label(detail.status)}
              </p>
              <p>
                <strong>Loại sự cố</strong>
                <br />
                {label(detail.category)}
              </p>
              <p>
                <strong>Ưu tiên</strong>
                <br />
                {detail.priority || 'Chưa quyết định'}
              </p>
              <p>
                <strong>Hình thức gửi</strong>
                <br />
                {detail.report_mode === 'PROXY' ? 'Báo hộ người ở nơi khác' : 'Báo cho bản thân hoặc gia đình'}
              </p>
              <p>
                <strong>Người cần hỗ trợ</strong>
                <br />
                {detail.subject.people_affected ?? 'Chưa rõ'} người
              </p>
              <p>
                <strong>Trẻ em / người cao tuổi</strong>
                <br />
                {detail.subject.children_count ?? 0} trẻ em · {detail.subject.elderly_count ?? 0} người cao tuổi
              </p>
              <p>
                <strong>Nhu cầu</strong>
                <br />
                {[
                  ...(detail.needs_rescue ? ['Cứu hộ'] : []),
                  ...(detail.needs_relief_supplies ? ['Hàng cứu trợ'] : []),
                ].join(' · ') || 'Chưa khai báo'}
              </p>
              <p>
                <strong>Người báo</strong>
                <br />
                {detail.reporter.name || 'Chưa có tên'}
              </p>
              <p>
                <strong>Liên hệ</strong>
                <br />
                {detail.reporter.contact_phone || 'Chưa có số liên hệ'}
              </p>
              <p>
                <strong>Vị trí</strong>
                <br />
                {detail.subject.location?.coordinates?.join(', ') || 'Chưa có tọa độ'}
              </p>
              <p>
                <strong>Quan hệ với người cần hỗ trợ</strong>
                <br />
                {detail.subject.reporter_relationship || 'Tự báo / chưa ghi rõ'}
              </p>
              <p>
                <strong>Số liên hệ người cần hỗ trợ</strong>
                <br />
                {detail.subject.beneficiary_contact_phone || 'Chưa có'}
              </p>
              <p>
                <strong>Liên hệ thay thế</strong>
                <br />
                {[detail.subject.alternate_contact?.name, detail.subject.alternate_contact?.phone].filter(Boolean).join(' · ') || 'Chưa có'}
              </p>
              <p>
                <strong>Nguồn thông tin / khả năng liên lạc</strong>
                <br />
                {[detail.subject.information_source, detail.subject.contactability].filter(Boolean).join(' · ') || 'Chưa ghi rõ'}
              </p>
              {detail.subject.last_known_situation_at && (
                <p>
                  <strong>Thời điểm biết tình hình gần nhất</strong>
                  <br />
                  {timeLabel(detail.subject.last_known_situation_at)}
                </p>
              )}
              <p>
                <strong>Phiên bản</strong>
                <br />
                {detail.version}
              </p>
              <p>
                <strong>Chiến dịch</strong>
                <br />
                {detail.campaign_id ? detail.campaign_id.slice(0, 8) : 'Chưa gắn'}
              </p>
            </div>
            {detail.description && <p>{detail.description}</p>}
            {detail.subject.household_reference_note && (
              <p><strong>Ghi chú nhận diện nơi ở:</strong> {detail.subject.household_reference_note}</p>
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
            {detail.ai_advisory && (
              <section className="notice">
                <h3>Gợi ý trích xuất và rủi ro từ AI</h3>
                <p>AI chỉ hỗ trợ tổng hợp thông tin. Điều phối viên phải tự xác minh; điểm này không thay thế mức ưu tiên P1–P4 và không tự giao đội.</p>
                <p><strong>Trạng thái:</strong> {label(detail.ai_advisory.status)}</p>
                {detail.ai_advisory.status === 'COMPLETED' && (
                  <>
                    <p><strong>Điểm rủi ro tham khảo:</strong> {detail.ai_advisory.risk_score}/100</p>
                    <p><strong>Dấu hiệu theo quy tắc:</strong> {detail.ai_advisory.reason_codes.map((code) => advisoryReasonLabels[code] || 'Có dấu hiệu cần rà soát').join(' · ') || 'Không có'}</p>
                    {detail.ai_advisory.extracted_json?.summary && <p><strong>Tóm tắt:</strong> {detail.ai_advisory.extracted_json.summary}</p>}
                    {detail.ai_advisory.extracted_json?.indicators && detail.ai_advisory.extracted_json.indicators.length > 0 && (
                      <p><strong>Dấu hiệu AI trích xuất:</strong> {detail.ai_advisory.extracted_json.indicators.join(' · ')}</p>
                    )}
                    {detail.ai_advisory.extracted_json?.facts && (
                      <div>
                        <strong>Dữ kiện trích xuất cần đối chiếu</strong>
                        {Object.entries(detail.ai_advisory.extracted_json.facts)
                          .filter(([key]) => advisoryFactLabels[key])
                          .map(([key, value]) => (
                            <p key={key}>{advisoryFactLabels[key]}: {typeof value === 'boolean' ? (value ? 'Có' : 'Không') : String(value)}</p>
                          ))}
                      </div>
                    )}
                    <p><strong>Độ tin cậy mô hình tự báo cáo:</strong> {Math.round((detail.ai_advisory.extracted_json?.confidence ?? 0) * 100)}% (chỉ tham khảo)</p>
                    {detail.ai_advisory.review_status ? (
                      <p><strong>Quyết định của điều phối viên:</strong> {advisoryReviewLabels[detail.ai_advisory.review_status] || 'Đã rà soát'}{detail.ai_advisory.review_note ? ` · ${detail.ai_advisory.review_note}` : ''}</p>
                    ) : (
                      <div>
                        <label className="field">
                          <span>Ghi chú khi điều chỉnh hoặc bác bỏ</span>
                          <textarea value={aiReviewNote} onChange={(event) => setAiReviewNote(event.target.value)} maxLength={1000} />
                        </label>
                        <div className="action-grid">
                          <button className="button" disabled={aiReviewBusy} onClick={() => void reviewAiAdvisory('ACCEPTED')}>Ghi nhận gợi ý</button>
                          <button className="button secondary" disabled={aiReviewBusy} onClick={() => void reviewAiAdvisory('ADJUSTED')}>Điều chỉnh và ghi nhận</button>
                          <button className="button secondary" disabled={aiReviewBusy} onClick={() => void reviewAiAdvisory('REJECTED')}>Không sử dụng gợi ý</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {['FAILED', 'SKIPPED'].includes(detail.ai_advisory.status) && <p>Không có kết quả AI cho mô tả này. Hãy tiếp tục quy trình xác minh thủ công.</p>}
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
                      <strong>{mission.team_name} · {label(mission.mission_kind)}</strong>
                      <p>{label(mission.status)} · {timeLabel(mission.created_at)}{mission.last_status ? ` · Cập nhật: ${label(mission.last_status)}` : ''}</p>
                      {mission.override_reason && <p>Lý do chọn đội khác đề xuất: {mission.override_reason}</p>}
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
                  {duplicateError && <p role="alert" className="notice error">Kiểm tra yêu cầu trùng: {duplicateError}</p>}
                  {duplicates.length > 0 && (
                    <section>
                      <h3>Yêu cầu có thể trùng</h3>
                      <p>Hai yêu cầu ở gần nhau vẫn có thể thuộc hai hộ khác nhau. Hãy đối chiếu trước khi đánh dấu trùng.</p>
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
                  <p>Gợi ý cân bằng dựa trên nhiệm vụ 24 giờ và 7 ngày của các đội gần nhất. Đội đang bận không xuất hiện trong danh sách đủ điều kiện.</p>
                  {candidateError && <p role="alert" className="notice error">Tải đội phù hợp: {candidateError}</p>}
                  {!candidates && !candidateError && <p role="status">Đang tải đội phù hợp…</p>}
                  {candidates?.items.map((candidate) => (
                    <div className="candidate" key={candidate.team.id}>
                      <strong>{candidate.team.name}</strong>
                      <p>
                        {candidate.suggested ? 'Gợi ý cân bằng tải và khoảng cách · ' : candidate.in_band ? 'Trong nhóm khoảng cách gần · ' : 'Ngoài nhóm khoảng cách gần · '}
                        Cách {Math.round(candidate.distance_m || 0)} m · vị trí cập nhật{' '}
                        {Math.round((candidate.position_age_s || 0) / 60)} phút trước ·{' '}
                        {candidate.recent_missions_24h} nhiệm vụ/24 giờ · {candidate.recent_missions_7d} nhiệm vụ/7 ngày
                      </p>
                      {candidate.recent_history.length > 0 && (
                        <details>
                          <summary>Xem lịch sử 5 nhiệm vụ gần nhất</summary>
                          {candidate.recent_history.map((mission) => (
                            <p key={mission.id}>
                              {label(mission.mission_kind)} · {label(mission.status)} · {timeLabel(mission.created_at)}
                              {mission.last_progress?.status ? ` · ${label(mission.last_progress.status)}` : ''}
                              {mission.override_reason ? ` · Lý do điều phối: ${mission.override_reason}` : ''}
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
  const { region, setRegion, regions, loading: regionLoading, error: regionError } = useAnalyticsRegion();
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
      .then((value) => { if (active) setData(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải bản đồ.'); });
    return () => { active = false; };
  }, [layer, region]);
  return (
    <section className="card">
      <h2>Bản đồ tổng hợp theo ô</h2>
      <p>
        Chỉ hiển thị số lượng theo ô, không hiển thị vị trí hoặc liên hệ chính xác của người báo.
      </p>
      <AnalyticsRegionField region={region} onChange={setRegion} regions={regions} />
      {regionError && <p role="alert" className="notice error">{regionError}</p>}
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
