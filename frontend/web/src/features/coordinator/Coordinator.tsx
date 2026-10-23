import { useEffect, useState } from 'react';
import { api } from '../../api/client';
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
type Event = { id: string; event_type: string; occurred_at: string };
type Detail = QueueItem & {
  version: number;
  description?: string | null;
  report_mode: string;
  campaign_id?: string | null;
  reporter: { name?: string | null; contact_phone?: string | null };
  subject: {
    people_affected?: number | null;
    location?: { coordinates: [number, number]; source: string };
  };
  contact_attempts: { items: { id: string; contact_target: string; outcome: string }[] };
  timeline: { items: Event[] };
  proxy_activity_flags: unknown[];
  active_missions?: {
    items: { id: string; status: string; created_at: string; team_id: string }[];
  };
  evidence?: { items: { id: string; state: string; size_bytes: number; created_at: string }[] };
};
type Candidate = {
  team: { id: string; name: string };
  distance_m: number | null;
  position_age_s: number | null;
  recent_missions_24h: number;
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
const title: Record<string, string> = {
  queue: 'Hàng đợi SOS',
  verify: 'Xác minh yêu cầu',
  triage: 'Quyết định ưu tiên',
  assign: 'Chọn đội cứu hộ',
};

export function Coordinator({ page }: { page: string }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [reviewLane, setReviewLane] = useState('NORMAL');
  const [overdue, setOverdue] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (stateFilter[page]) params.set('status', stateFilter[page]);
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
  }, [page, cursor, revision, reviewLane, overdue]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDetail(null);
    setCandidates(null);
    api<Detail>('response', `/requests/${selected}`)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể mở yêu cầu.');
      });
    return () => {
      live = false;
    };
  }, [selected, revision]);
  useEffect(() => {
    if (!selected || !detail || detail.status !== 'TRIAGED') return;
    let live = true;
    api<Candidates>('response', `/requests/${selected}/team-candidates`)
      .then((value) => {
        if (live) setCandidates(value);
      })
      .catch(() => {
        if (live) setCandidates({ items: [], unknown_position: [] });
      });
    return () => {
      live = false;
    };
  }, [selected, detail]);
  useEffect(() => {
    if (!selected || detail?.status !== 'VERIFYING') {
      setDuplicates([]);
      return;
    }
    let live = true;
    api<{ items: DuplicateCandidate[] }>('response', `/requests/${selected}/duplicate-candidates`)
      .then((value) => {
        if (live) setDuplicates(value.items);
      })
      .catch(() => {
        if (live) setDuplicates([]);
      });
    return () => {
      live = false;
    };
  }, [selected, detail?.status, revision]);
  const done = () => {
    setRevision((value) => value + 1);
  };
  function command(spec: CommandSpec) {
    return <CommandForm key={spec.path + detail?.version} spec={spec} onSuccess={done} />;
  }
  return (
    <div className="coordinator-layout">
      <section className="card">
        <h2>{title[page] || title.queue}</h2>
        <p>
          Danh sách giữ nguyên thứ tự tiếp nhận. Gợi ý chỉ hỗ trợ người điều phối ra quyết định.
        </p>
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
        {loading && <p role="status">Đang tải hàng đợi…</p>}
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
                  onClick={() => setSelected(item.id)}
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
        {!selected && (
          <div className="empty">Chọn một yêu cầu để xem thông tin được cấp quyền.</div>
        )}
        {selected && !detail && <p role="status">Đang tải hồ sơ…</p>}
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
                <strong>Chế độ báo</strong>
                <br />
                {detail.report_mode === 'PROXY' ? 'Báo hộ, cần xác minh' : 'Tự báo'}
              </p>
              <p>
                <strong>Người cần hỗ trợ</strong>
                <br />
                {detail.subject.people_affected ?? 'Chưa rõ'} người
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
                      title: 'Đồng xác nhận báo hộ',
                      service: 'response',
                      path: `/requests/${detail.id}/concur`,
                      version: detail.version,
                      warning:
                        'Bạn đã tự xem hồ sơ và có thể đồng xác nhận thông tin báo hộ? Người xác minh cuối cùng phải là điều phối viên khác.',
                      fields: [
                        {
                          name: 'note',
                          label: 'Căn cứ đồng xác nhận',
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
                      title: 'Xác minh báo hộ sau đồng xác nhận',
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
                  {duplicates.length > 0 && (
                    <section>
                      <h3>Yêu cầu có thể trùng</h3>
                      <p>Khoảng cách là gợi ý để rà soát, không tự đánh dấu trùng.</p>
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
                  <p>
                    Khoảng cách, vị trí và tải gần đây chỉ hỗ trợ so sánh; quyết định giao đội do
                    điều phối viên xác nhận.
                  </p>
                  {!candidates && <p role="status">Đang tải đội phù hợp…</p>}
                  {candidates?.items.map((candidate) => (
                    <div className="candidate" key={candidate.team.id}>
                      <strong>{candidate.team.name}</strong>
                      <p>
                        Cách {Math.round(candidate.distance_m || 0)} m · vị trí cập nhật{' '}
                        {Math.round((candidate.position_age_s || 0) / 60)} phút trước ·{' '}
                        {candidate.recent_missions_24h} nhiệm vụ/24 giờ
                      </p>
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
