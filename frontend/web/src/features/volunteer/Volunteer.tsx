import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, upload } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { label, timeLabel } from '../../i18n/labels';
import { evidenceFileError as missionEvidenceError } from '../../i18n/evidence';
import type { components as ResponseComponents } from '../../api/generated/response';
import { googleMapsDirectionsUrl } from '../../maps/googleMaps';
import { LocationPicker, type Point } from '../../maps/LocationPicker';
import { confirmAction } from '../../components/confirmAction';
import { Tabs } from '../../components/ui/Tabs';
import { useUrlView } from '../../app/useUrlView';
import { missionViews, noticeViews } from '../../app/routeViews';
import { TeamMembers } from './TeamMembers';
import { TeamReadinessForm } from './TeamReadinessForm';
import './volunteer-missions.css';
import './volunteer-team.css';

type Mission = ResponseComponents['schemas']['MissionView'];
type MissionDetail = ResponseComponents['schemas']['MissionDetail'];
type EvidenceItem = { id: string; state: string; size_bytes: number; created_at: string };
type Team = {
  id: string;
  name: string;
  version: number;
  kind: string;
  reporting_mode: string;
  availability: string;
  readiness_required?: boolean;
  status: string;
  skills: string[];
  position: null | {
    age_s: number;
    accuracy_m: number | null;
    source: string;
    coordinates?: [number, number];
  };
};
type TeamDetailTab = 'overview' | 'members' | 'readiness' | 'location';
const teamDetailTabs: { id: TeamDetailTab; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'members', label: 'Thành viên' },
  { id: 'readiness', label: 'Sẵn sàng' },
  { id: 'location', label: 'Vị trí' },
];
type MissionDetailTab = 'overview' | 'progress' | 'history';
const missionDetailTabs: { id: MissionDetailTab; label: string }[] = [
  { id: 'overview', label: 'Tình huống' },
  { id: 'progress', label: 'Tiến độ & thao tác' },
  { id: 'history', label: 'Minh chứng & lịch sử' },
];
type Notice = ResponseComponents['schemas']['Notice'];

const noticeNames: Record<string, string> = {
  MISSION_OFFERED: 'Có nhiệm vụ mới',
  MISSION_OFFER_PENDING: 'Nhiệm vụ đang chờ đội tiếp nhận',
  MISSION_OFFER_OVERDUE: 'Nhiệm vụ chờ nhận quá lâu',
  MISSION_OVERDUE: 'Nhiệm vụ cần chú ý',
  MISSION_ACCEPTED: 'Nhiệm vụ đã được nhận',
  REQUEST_UPDATED: 'Yêu cầu đã cập nhật',
  REQUEST_STATUS_CHANGED: 'Trạng thái SOS đã thay đổi',
  REQUEST_OVERDUE: 'SOS cần được xử lý sớm',
  DONATION_COUNTED: 'Vật phẩm đã kiểm đếm',
  DONATION_REVIEWED: 'Đóng góp đã được duyệt',
};

function positionAge(ageSeconds: number): string {
  if (ageSeconds < 3600) return `${Math.max(1, Math.round(ageSeconds / 60))} phút`;
  if (ageSeconds < 86400) return `${Math.round(ageSeconds / 3600)} giờ`;
  return `${Math.round(ageSeconds / 86400)} ngày`;
}

export function Notices({ onOpenMission, onOpenRequest }: {
  onOpenMission?: (missionId: string) => void;
  onOpenRequest?: (requestId: string) => void;
}) {
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useUrlView('view', noticeViews, 'all');
  const activeFilter = useRef(filter);
  activeFilter.current = filter;
  const [revision, setRevision] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllMessage, setMarkAllMessage] = useState('');
  const pendingReads = useRef(new Set<string>());
  const [readingIds, setReadingIds] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    if (!cursor) setItems([]);
    const params = new URLSearchParams({ limit: String(LIST_PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    if (filter === 'unread') params.set('unread', 'true');
    const path = `/notices${params.size ? `?${params}` : ''}`;

    api<{ items: Notice[]; cursor?: string }>('response', path)
      .then((value) => {
        if (live) {
          setItems(value.items);
          setNext(value.cursor || '');
        }
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải thông báo.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [cursor, filter, revision]);

  async function markRead(id: string) {
    if (pendingReads.current.has(id)) return;
    pendingReads.current.add(id);
    setReadingIds(current => [...current, id]);
    setError('');
    try {
      const result = await api<{ id: string; read_at: string }>('response', `/notices/${id}/read`, {
        method: 'POST',
        idempotencyKey: newCommandKey(),
      });
      setItems(current => activeFilter.current === 'unread'
        ? current.filter(item => item.id !== result.id)
        : current.map(item => item.id === result.id ? { ...item, read_at: result.read_at } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đánh dấu đã đọc.');
    } finally {
      pendingReads.current.delete(id);
      setReadingIds(current => current.filter(value => value !== id));
    }
  }

  async function markAllRead() {
    setError('');
    setMarkAllMessage('');
    setMarkingAll(true);
    let completed = 0;
    try {
      const unread = await fetchAll<Notice>('response', '/notices?unread=true');
      for (const notice of unread) {
        await api('response', `/notices/${notice.id}/read`, {
          method: 'POST',
          idempotencyKey: newCommandKey(),
        });
        completed += 1;
      }
      setMarkAllMessage(unread.length ? `Đã đánh dấu đã đọc ${unread.length} thông báo.` : 'Không còn thông báo chưa đọc.');
    } catch (cause) {
      setError(`${completed ? `Đã xử lý ${completed} thông báo. ` : ''}${cause instanceof Error ? cause.message : 'Chưa thể đánh dấu tất cả đã đọc.'}`);
    } finally {
      setMarkingAll(false);
      setCursor('');
      setRevision((value) => value + 1);
    }
  }

  return (
    <section className="card volunteer-notices">
      <div className="section-header notice-page-header">
        <h2>Thông báo của tôi</h2>
        <div className="notice-header-actions">
          <button type="button" className="button secondary notice-mark-all" onClick={markAllRead} disabled={loading || markingAll || readingIds.length > 0}>
            {markingAll ? 'Đang đánh dấu…' : 'Đánh dấu tất cả đã đọc'}
          </button>
          <div className="tabs notice-filter-tabs" role="group" aria-label="Lọc thông báo">
            <button
              type="button"
              className={filter === 'all' ? 'active' : ''}
              aria-pressed={filter === 'all'}
              disabled={markingAll || readingIds.length > 0}
              onClick={() => { setFilter('all'); setCursor(''); }}
            >Tất cả</button>
            <button
              type="button"
              className={filter === 'unread' ? 'active' : ''}
              aria-pressed={filter === 'unread'}
              disabled={markingAll || readingIds.length > 0}
              onClick={() => { setFilter('unread'); setCursor(''); }}
            >Chưa đọc</button>
          </div>
        </div>
      </div>
      {markAllMessage && <p className="notice success" role="status">{markAllMessage}</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải thông báo…</p>}
      {!loading && !items.length && !error && (
        <div className="empty">Chưa có thông báo trong mục này.</div>
      )}
      <div className="record-list notice-record-list">
        {items.map((item) => (
          <article className={`record notice-record ${item.read_at ? '' : 'is-unread'}`} key={item.id}>
            <div className="notice-record-main">
              <span className="notice-record-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15.5 7.5a5.5 5.5 0 0 0-11 0c0 6-2 6-2 7.5h15c0-1.5-2-1.5-2-7.5ZM8 17h4" />
                </svg>
              </span>
              <div className="notice-record-copy">
                <div className="notice-record-title-row">
                  <strong>{noticeNames[item.notice_type] || 'Có cập nhật mới'}</strong>
                  {!item.read_at && <span className="notice-unread-badge">Chưa đọc</span>}
                </div>
                <div className="notice-record-references">
                  {typeof item.payload.request_id === 'string' && <span>Hồ sơ SOS · <code>{item.payload.request_id.slice(0, 8)}</code></span>}
                  {typeof item.payload.mission_id === 'string' && <span>Nhiệm vụ · <code>{item.payload.mission_id.slice(0, 8)}</code></span>}
                </div>
                <div className="notice-record-meta">
                  <time dateTime={item.created_at}>{timeLabel(item.created_at)}</time>
                  {item.read_at && <span>Đã đọc lúc {timeLabel(item.read_at)}</span>}
                </div>
              </div>
            </div>
            <div className="record-actions notice-record-actions">
              {onOpenRequest && typeof item.payload.request_id === 'string' &&
                <button className="button secondary" type="button" onClick={() => onOpenRequest(item.payload.request_id as string)}>Mở hồ sơ SOS</button>}
              {onOpenMission && typeof item.payload.mission_id === 'string' &&
                <button className="button secondary" type="button"
                  onClick={() => onOpenMission(item.payload.mission_id as string)}>Xem nhiệm vụ</button>}
              {!item.read_at && (
                <button className="button secondary" type="button" onClick={() => markRead(item.id)} disabled={loading || markingAll || readingIds.includes(item.id)}>
                  Đánh dấu đã đọc
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading || markingAll || readingIds.length > 0} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} noun="thông báo" />
    </section>
  );
}

export function Volunteer({ page, currentUserId, initialMissionId, sharingTeamId = '', sharingMessage = '', onToggleSharing, onClearInitialMission }: {
  page: string; currentUserId: string; initialMissionId?: string; sharingTeamId?: string; sharingMessage?: string;
  onToggleSharing?: (teamId: string) => void; onClearInitialMission?: () => void;
}) {
  const isTeam = page === 'team';
  const [items, setItems] = useState<Mission[] | Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  // Selected mission and detailed state
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [missionDetailTab, setMissionDetailTab] = useState<MissionDetailTab>('overview');
  const selectionKey = `reliva:mission-selection:${currentUserId}`;
  const [missionSelectionRevision, setMissionSelectionRevision] = useState(0);
  const [missionDetail, setMissionDetail] = useState<MissionDetail | null>(null);
  const missionCardRef = useRef<HTMLElement | null>(null);
  const missionListRef = useRef<HTMLElement | null>(null);
  const missionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const teamHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [missionLoading, setMissionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Form states for mission actions
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [progressNote, setProgressNote] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [missionFormTouched, setMissionFormTouched] = useState<Record<string, boolean>>({});
  const [missionFormAttempted, setMissionFormAttempted] = useState<Record<string, boolean>>({});
  const declineReasonError = !declineReason.trim() ? 'Lý do từ chối nhiệm vụ là bắt buộc.'
    : declineReason.length > 2000 ? 'Lý do từ chối không được vượt quá 2.000 ký tự.' : '';
  const outcomeNoteError = !outcomeNote.trim() ? 'Ghi chú kết quả nhiệm vụ là bắt buộc.'
    : outcomeNote.length > 2000 ? 'Ghi chú kết quả không được vượt quá 2.000 ký tự.' : '';
  const progressNoteError = !progressNote.trim() ? 'Lý do không thể tiếp cận hoặc thất bại là bắt buộc.'
    : progressNote.length > 2000 ? 'Lý do không được vượt quá 2.000 ký tự.' : '';
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [showFailForm, setShowFailForm] = useState(false);
  useEffect(() => {
    setDeclineReason('');
    setMissionFormTouched({});
    setMissionFormAttempted({});
  }, [selectedMission?.id, missionSelectionRevision]);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [completionFile, setCompletionFile] = useState<File | null>(null);
  const [completionPreviewUrl, setCompletionPreviewUrl] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({});

  const [teamActivityLoaded, setTeamActivityLoaded] = useState(false);
  const [teamActivityError, setTeamActivityError] = useState('');
  const [busyTeamIds, setBusyTeamIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!isTeam) return;
    setTeamActivityLoaded(false);
    setTeamActivityError('');
    let live = true;
    fetchAll<Mission>('response', '/missions/mine').then((missions) => {
      if (live) { setTeamActivityLoaded(true); setBusyTeamIds(new Set(missions.filter((mission) => ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(mission.status)).map((mission) => mission.team.id))); }
    }).catch(() => { if (live) {
      setBusyTeamIds(new Set());
      setTeamActivityError('Chưa kiểm tra được nhiệm vụ của đội. Bấm Cập nhật để thử lại trước khi xác nhận sẵn sàng.');
    } });
    return () => { live = false; };
  }, [isTeam, revision]);
  // Team management state
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamSelectionRevision, setTeamSelectionRevision] = useState(0);
  const [teamLoading, setTeamLoading] = useState(false);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [manageableTeamIds, setManageableTeamIds] = useState<Set<string>>(new Set());
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [teamPoint, setTeamPoint] = useState<Point | null>(null);
  const [teamAccuracy, setTeamAccuracy] = useState<number | null>(null);
  const [teamMessage, setTeamMessage] = useState('');
  const [teamDetailTab, setTeamDetailTab] = useState<TeamDetailTab>('overview');

  useEffect(() => {
    if (!isTeam || !selectedTeam?.id) return;
    const teamId = selectedTeam.id;
    let live = true;
    setTeamLoading(true);
    api<Team>('response', `/teams/${teamId}`).then((team) => {
      if (live) setSelectedTeam(current => current?.id === teamId ? { ...current, ...team } : current);
    }).catch((cause) => {
      if (live) {
        setCanManageTeam(false);
        setTeamMessage(cause instanceof Error ? cause.message : 'Không thể tải trạng thái mới nhất của đội.');
      }
    }).finally(() => { if (live) setTeamLoading(false); });
    return () => { live = false; };
  }, [isTeam, selectedTeam?.id, revision, teamSelectionRevision]);

  const commandKeyRef = useRef<string | null>(null);
  const completionUploadKeyRef = useRef<{ file: File; key: string } | null>(null);
  const completionFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isTeam) return;
    let missionId = initialMissionId;
    try { missionId ||= window.sessionStorage.getItem(selectionKey) || undefined; } catch { /* Storage may be unavailable. */ }
    if (!missionId) return;
    let live = true;
    api<MissionDetail>('response', `/missions/${encodeURIComponent(missionId)}`)
      .then((mission) => { if (live) setSelectedMission(mission); })
      .catch((cause) => {
        if (live) {
          try { window.sessionStorage.removeItem(selectionKey); } catch { /* Storage may be unavailable. */ }
          setError(cause instanceof Error ? cause.message : 'Không thể mở nhiệm vụ đã chọn.');
        }
      });
    return () => { live = false; };
  }, [initialMissionId, isTeam, selectionKey]);

  useEffect(() => {
    if (!selectedMission) return;
    try { window.sessionStorage.setItem(selectionKey, selectedMission.id); } catch { /* Selection still works without storage. */ }
  }, [selectedMission?.id, selectionKey]);

  useEffect(() => {
    if (!completionFile || !completionFile.type.startsWith('image/')) return;
    const url = URL.createObjectURL(completionFile);
    setCompletionPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [completionFile]);

  // Load list of missions or teams
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    if (!cursor) setItems([]);
    const path = isTeam ? '/teams' : '/missions/mine';
    api<{ items: Mission[] | Team[]; cursor?: string }>(
      'response',
      `${path}?limit=${LIST_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    )
      .then((value) => {
        if (live) {
          if (isTeam) setItems(value.items as Team[]);
          else setItems((value.items as Mission[]).sort((a, b) =>
            Date.parse(b.created_at) - Date.parse(a.created_at)
          ));
          setNext(value.cursor || '');
        }
      })
      .catch((cause) => {
        if (live) {
          const message = cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.';
          setError(!isTeam && cause instanceof ApiError && cause.code === 'FORBIDDEN'
            ? `${message} Để xem nhiệm vụ, tài khoản cần được thêm vào đội cứu hộ. Nếu bạn vừa được cấp vai trò Tình nguyện viên, hãy nhờ người quản lý đội kiểm tra tư cách thành viên, sau đó bấm Cập nhật.`
            : message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [isTeam, cursor, revision]);

  useEffect(() => {
    if (!isTeam) return;
    let live = true;
    const teams = items as Team[];
    Promise.all(teams.map(async (team) => {
      try {
        const page = await api<{ can_manage_members: boolean }>('response', `/teams/${team.id}/members?limit=1`);
        return page.can_manage_members ? team.id : null;
      } catch { return null; }
    })).then((ids) => { if (live) setManageableTeamIds(new Set(ids.filter((id): id is string => Boolean(id)))); });
    return () => { live = false; };
  }, [isTeam, items]);

  // Load mission details on selection
  useEffect(() => {
    if (!selectedMission?.id) {
      setMissionDetail(null);
      return;
    }
    let live = true;
    setMissionLoading(true);
    setActionMessage('');
    api<MissionDetail>('response', `/missions/${encodeURIComponent(selectedMission.id)}`)
      .then((detail) => {
        if (live) setMissionDetail(detail);
      })
      .catch((cause) => {
        if (live)
          setActionMessage(
            cause instanceof Error ? cause.message : 'Không thể tải chi tiết nhiệm vụ.'
          );
      })
      .finally(() => {
        if (live) setMissionLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedMission?.id, revision, missionSelectionRevision]);

  useEffect(() => {
    if (isTeam || !selectedMission?.id) return;
    missionCardRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
    missionHeadingRef.current?.focus({ preventScroll: true });
  }, [isTeam, selectedMission?.id, initialMissionId, missionSelectionRevision]);

  function refreshAll() {
    setRevision((val) => val + 1);
    commandKeyRef.current = null;
    setShowDeclineForm(false);
    setShowCompleteForm(false);
    setShowFailForm(false);
    setDeclineReason('');
    setMissionFormTouched({});
    setMissionFormAttempted({});
    setProgressNote('');
    setOutcomeNote('');
    setEvidenceFile(null);
    setCompletionFile(null);
    setCompletionPreviewUrl('');
    completionUploadKeyRef.current = null;
    if (completionFileInputRef.current) completionFileInputRef.current.value = '';
  }

  function selectMission(mission: Mission) {
    setMissionDetailTab('overview');
    if (selectedMission?.id === mission.id) {
      window.requestAnimationFrame(() => {
        if (window.matchMedia('(max-width: 1180px)').matches) {
          missionCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        document.getElementById('volunteer-mission-tab-overview')?.focus();
      });
      return;
    }
    setSelectedMission(mission);
    setMissionSelectionRevision(value => value + 1);
    setMissionDetail(null);
    setActionMessage('');
    setShowDeclineForm(false);
    setShowCompleteForm(false);
    setShowFailForm(false);
    setProgressNote('');
    setOutcomeNote('');
    setEvidenceFile(null);
    setCompletionFile(null);
    setCompletionPreviewUrl('');
    completionUploadKeyRef.current = null;
    if (completionFileInputRef.current) completionFileInputRef.current.value = '';
    commandKeyRef.current = null;
  }

  function returnToMissionList() {
    try { window.sessionStorage.removeItem(selectionKey); } catch { /* Storage may be unavailable. */ }
    onClearInitialMission?.();
    setSelectedMission(null);
    setMissionDetail(null);
    setMissionDetailTab('overview');
    setActionMessage('');
    setShowDeclineForm(false);
    setShowCompleteForm(false);
    setShowFailForm(false);
    setDeclineReason('');
    setProgressNote('');
    setOutcomeNote('');
    setMissionFormTouched({});
    setMissionFormAttempted({});
    setEvidenceFile(null);
    setCompletionFile(null);
    setCompletionPreviewUrl('');
    completionUploadKeyRef.current = null;
    commandKeyRef.current = null;
    window.requestAnimationFrame(() => {
      const firstMission = missionListRef.current?.querySelector<HTMLElement>('.mission-table-open');
      if (firstMission) firstMission.focus();
      else missionListRef.current?.querySelector<HTMLElement>('.section-header button')?.focus();
    });
  }

  // --- Mission Actions ---
  async function acceptMission(mission: Mission | MissionDetail) {
    if (!(await confirmAction('Xác nhận tiếp nhận nhiệm vụ này?'))) return;
    setBusy(true);
    setActionMessage('');
    try {
      commandKeyRef.current ||= newCommandKey();
      await api('response', `/missions/${mission.id}/accept`, {
        method: 'POST',
        body: { expected_version: mission.version },
        idempotencyKey: commandKeyRef.current,
      });
      setActionMessage('Đã tiếp nhận nhiệm vụ thành công.');
      refreshAll();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : 'Không thể tiếp nhận nhiệm vụ.');
    } finally {
      setBusy(false);
    }
  }

  async function declineMission(event: FormEvent, mission: Mission | MissionDetail) {
    event.preventDefault();
    setMissionFormAttempted((current) => ({ ...current, decline: true }));
    if (declineReasonError) return;
    setBusy(true);
    setActionMessage('');
    try {
      commandKeyRef.current ||= newCommandKey();
      await api('response', `/missions/${mission.id}/decline`, {
        method: 'POST',
        body: { expected_version: mission.version, reason: declineReason.trim() },
        idempotencyKey: commandKeyRef.current,
      });
      setActionMessage('Đã từ chối nhiệm vụ.');
      setDeclineReason('');
      refreshAll();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : 'Không thể từ chối nhiệm vụ.');
    } finally {
      setBusy(false);
    }
  }

  async function transitionMission(
    mission: Mission | MissionDetail,
    to: 'EN_ROUTE' | 'ON_SCENE' | 'COMPLETED' | 'FAILED',
    extra?: { note?: string; outcome_note?: string }
  ) {
    setBusy(true);
    setActionMessage('');
    try {
      if (to === 'COMPLETED' && completionFile) {
        const validationError = missionEvidenceError(completionFile);
        if (validationError) {
          setActionMessage(validationError);
          return;
        }
        if (completionUploadKeyRef.current?.file !== completionFile)
          completionUploadKeyRef.current = { file: completionFile, key: newCommandKey() };
        await upload('response', `/missions/${mission.id}/evidence`, completionFile, {
          idempotencyKey: completionUploadKeyRef.current.key,
        });
      }
      commandKeyRef.current ||= newCommandKey();
      const body: Record<string, unknown> = {
        expected_version: mission.version,
        to,
      };
      if (extra?.note?.trim()) body.note = extra.note.trim();
      if (to === 'COMPLETED' && extra?.outcome_note?.trim()) {
        body.result = { outcome_note: extra.outcome_note.trim() };
      }
      await api('response', `/missions/${mission.id}/transition`, {
        method: 'POST',
        body,
        idempotencyKey: commandKeyRef.current,
      });
      setActionMessage(`Đã cập nhật tiến độ: ${label(to)}.`);
      refreshAll();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'STORAGE_UNAVAILABLE')
        completionUploadKeyRef.current = null;
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') {
        commandKeyRef.current = null;
        setRevision((value) => value + 1);
      }
      setActionMessage(
        cause instanceof Error
          ? `${cause.message}${to === 'COMPLETED' && completionFile ? ' Tệp đã chọn vẫn được giữ; hãy thử lại hoặc bỏ tệp để báo cáo không kèm ảnh.' : ''}`
          : 'Không thể cập nhật tiến độ nhiệm vụ.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadMissionEvidence(event: FormEvent, missionId: string) {
    event.preventDefault();
    if (!evidenceFile) return;
    const validationError = missionEvidenceError(evidenceFile);
    if (validationError) {
      setActionMessage(validationError);
      return;
    }
    setBusy(true);
    setActionMessage('');
    try {
      commandKeyRef.current ||= newCommandKey();
      await upload('response', `/missions/${missionId}/evidence`, evidenceFile, {
        idempotencyKey: commandKeyRef.current,
      });
      setActionMessage('Đã tải minh chứng nhiệm vụ lên hệ thống thành công.');
      setEvidenceFile(null);
      refreshAll();
    } catch (cause) {
      setActionMessage(
        cause instanceof Error ? cause.message : 'Chưa tải được tệp minh chứng lên hệ thống.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadEvidence(evidenceId: string) {
    try {
      const result = await api<{ url: string }>('response', `/evidence/${evidenceId}/download`);
      setEvidenceUrls((prev) => ({ ...prev, [evidenceId]: result.url }));
    } catch (cause) {
      setActionMessage(
        cause instanceof Error ? cause.message : 'Không thể mở liên kết minh chứng.'
      );
    }
  }

  // --- Team Actions ---
  async function toggleTeamAvailability(team: Team) {
    const nextAvailability = team.availability === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    const confirmText =
      nextAvailability === 'AVAILABLE'
        ? `Chuyển ${team.name} sang trạng thái sẵn sàng hoạt động?`
        : `Tạm ngưng hoạt động ${team.name}?`;
    if (!(await confirmAction(confirmText))) return;
    setBusy(true);
    setTeamMessage('');
    try {
      await api('response', `/teams/${team.id}`, {
        method: 'PATCH',
        body: { expected_version: team.version, availability: nextAvailability },
        idempotencyKey: newCommandKey(),
      });
      setTeamMessage(`${team.name} đã chuyển sang ${label(nextAvailability)}.`);
      refreshAll();
    } catch (cause) {
      setTeamMessage(cause instanceof ApiError && cause.code === 'TEAM_NOT_ELIGIBLE' && nextAvailability === 'AVAILABLE'
        ? 'Đội chưa thể chuyển sang sẵn sàng. Hãy kiểm tra nhiệm vụ đang hoạt động hoặc yêu cầu xác nhận lại sau khi nhiệm vụ bị hủy. Nếu không còn nhiệm vụ mà vẫn bị chặn, cần người phụ trách hệ thống kiểm tra trạng thái đội; tải lại trang không tự gỡ được khóa này.'
        : cause instanceof Error ? cause.message : 'Không thể cập nhật trạng thái đội.');
      refreshAll();
    } finally {
      setBusy(false);
    }
  }

  function getTeamDeviceLocation() {
    if (!navigator.geolocation) {
      setTeamMessage('Trình duyệt không hỗ trợ xác định vị trí GPS.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setTeamPoint({ longitude: coords.longitude, latitude: coords.latitude });
        setTeamAccuracy(coords.accuracy);
        setTeamMessage('Đã lấy vị trí hiện tại của thiết bị. Bấm "Cập nhật vị trí" để lưu.');
      },
      () => setTeamMessage('Không thể lấy vị trí hiện tại. Hãy chọn trực tiếp trên bản đồ.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function updateTeamPosition(team: Team) {
    if (!teamPoint) {
      setTeamMessage('Vui lòng chọn vị trí hoặc lấy GPS trước khi cập nhật.');
      return;
    }
    setBusy(true);
    setTeamMessage('');
    try {
      await api('response', `/teams/${team.id}/position`, {
        method: 'PUT',
        body: {
          location: {
            type: 'Point',
            coordinates: [teamPoint.longitude, teamPoint.latitude],
            source: teamAccuracy ? 'GPS' : 'MANUAL_PIN',
          },
          captured_at: new Date().toISOString(),
          accuracy_m: teamAccuracy,
        },
      });
      setTeamMessage(`Đã cập nhật vị trí mới cho ${team.name}.`);
      setTeamPoint(null);
      setTeamAccuracy(null);
      refreshAll();
    } catch (cause) {
      setTeamMessage(cause instanceof Error ? cause.message : 'Không thể cập nhật vị trí của đội.');
    } finally {
      setBusy(false);
    }
  }

  const [missionFilter, setMissionFilter] = useUrlView('view', missionViews, 'all');
  const matchesMissionFilter = (mission: Pick<Mission, 'status'>, filter: string) => filter === 'all' || (filter === 'new'
    ? mission.status === 'OFFERED' : filter === 'active'
      ? ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(mission.status)
      : ['COMPLETED', 'FAILED', 'DECLINED', 'CANCELLED'].includes(mission.status));
  const visibleMissions = (items as Mission[]).filter(mission => matchesMissionFilter(mission, missionFilter));
  const previousMissionFilter = useRef(missionFilter);
  useEffect(() => {
    if (previousMissionFilter.current === missionFilter) return;
    previousMissionFilter.current = missionFilter;
    const current = missionDetail || selectedMission;
    if (current && !matchesMissionFilter(current, missionFilter)) {
      try { window.sessionStorage.removeItem(selectionKey); } catch { /* Storage may be unavailable. */ }
      setSelectedMission(null);
      setMissionDetail(null);
      setActionMessage('');
      setCompletionFile(null);
      setEvidenceFile(null);
    }
  }, [missionFilter, missionDetail, selectedMission]);
  function changeMissionFilter(value: typeof missionViews[number]) {
    setMissionFilter(value);
  }
  const activeMission = missionDetail || selectedMission;
  const canManageMission = activeMission?.can_manage_mission === true;
  const directionsUrl = activeMission && googleMapsDirectionsUrl(activeMission.location);
  const selectedTeamCanBeManaged = Boolean(selectedTeam &&
    (canManageTeam || manageableTeamIds.has(selectedTeam.id)));

  function selectTeam(team: Team, tab: TeamDetailTab = 'overview', openAdd = false) {
    setCanManageTeam(false);
    setSelectedTeam(team);
    setTeamSelectionRevision(value => value + 1);
    setTeamDetailTab(tab);
    setAddMemberOpen(openAdd);
    setTeamPoint(null);
    setTeamMessage('');
    window.requestAnimationFrame(() => {
      missionCardRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
      teamHeadingRef.current?.focus({ preventScroll: true });
    });
  }

  function returnToTeamList() {
    setSelectedTeam(null);
    setCanManageTeam(false);
    setAddMemberOpen(false);
    setTeamPoint(null);
    setTeamAccuracy(null);
    setTeamMessage('');
    setTeamDetailTab('overview');
    window.requestAnimationFrame(() => {
      const firstTeam = missionListRef.current?.querySelector<HTMLElement>('.volunteer-team-table-open');
      if (firstTeam) firstTeam.focus();
      else missionListRef.current?.querySelector<HTMLElement>('.section-header button')?.focus();
    });
  }

  return (
    <div className={`grid-two ${isTeam ? 'volunteer-teams-layout volunteer-team-workspace' : 'volunteer-missions-layout'}`}>
      {/* Danh sách nhiệm vụ hoặc đội */}
      {(isTeam ? !selectedTeam : !activeMission) && <section className={`card ${isTeam ? 'volunteer-team-list-card' : 'mission-list-panel'}`} ref={missionListRef}>
        <div className="section-header"><h2>{isTeam ? 'Đội của tôi' : 'Nhiệm vụ và tiến độ'}</h2><button type="button" className="button secondary" disabled={loading || busy} onClick={() => { setCursor(''); refreshAll(); }}>Cập nhật</button></div>
        <p className="mission-list-intro">{isTeam ? 'Chọn một đội để xem hồ sơ và các thao tác quản lý.' : 'Chọn một nhiệm vụ trong bảng để xem tình huống, tiến độ và minh chứng.'}</p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {loading && <p role="status">Đang tải dữ liệu…</p>}
        {!loading && !items.length && !error && (
          <div className="empty">Chưa có dữ liệu trong phạm vi của bạn.</div>
        )}

        {!isTeam && <div className="mission-filters" role="group" aria-label="Lọc nhiệm vụ">
          {([['all', 'Tất cả'], ['new', 'Mới nhận'], ['active', 'Đang thực hiện'], ['history', 'Lịch sử']] as const).map(([value, text]) =>
            <button type="button" className="button secondary" aria-pressed={missionFilter === value} disabled={busy} key={value} onClick={() => changeMissionFilter(value)}>{text}</button>)}
        </div>}
        {!isTeam && !loading && !error && items.length > 0 && !visibleMissions.length && <p>Chưa có nhiệm vụ trong nhóm này trên các trang đã tải. Hãy tải thêm nếu còn dữ liệu.</p>}
        {isTeam ? (
          (items as Team[]).length > 0 &&
          <div className="mission-table-scroll">
            <table className="mission-table volunteer-team-table">
              <thead>
                <tr>
                  <th scope="col">Mã đội</th>
                  <th scope="col">Đội cứu hộ</th>
                  <th scope="col">Tình trạng đội</th>
                  <th scope="col">Vị trí gần nhất</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {(items as Team[]).map((team) => (
                  <tr
                    className={selectedTeam?.id === team.id ? 'is-selected' : ''}
                    key={team.id}
                    onClick={() => selectTeam(team)}
                  >
                    <td><code className="mission-table-code" title={team.id}>{team.id}</code></td>
                    <td>
                      <button type="button" className="mission-table-open volunteer-team-table-open" aria-pressed={selectedTeam?.id === team.id} onClick={(event) => { event.stopPropagation(); selectTeam(team); }}>
                        <strong>{team.name}</strong>
                        <small>{label(team.kind)} · {team.skills.length ? `${team.skills.length} kỹ năng` : 'Chưa khai báo kỹ năng'}</small>
                      </button>
                    </td>
                    <td>
                      <span className={`chip team-availability-status ${team.availability === 'AVAILABLE' && team.status === 'ACTIVE' && teamActivityLoaded && !busyTeamIds.has(team.id) ? 'is-ready' : ''}`}>
                        <span className="team-availability-dot" aria-hidden="true" />
                        {team.status !== 'ACTIVE' ? label(team.status) : !teamActivityLoaded ? teamActivityError ? 'Chưa cập nhật được nhiệm vụ' : 'Đang kiểm tra' : busyTeamIds.has(team.id) ? 'Đang có nhiệm vụ' : label(team.availability)}
                      </span>
                    </td>
                    <td><span className="team-table-position">{team.position ? `Cập nhật ${positionAge(team.position.age_s)} trước · ${label(team.position.source)}` : 'Chưa có dữ liệu tọa độ'}</span></td>
                    <td>
                      {manageableTeamIds.has(team.id)
                        ? <button type="button" className="button secondary team-table-add" aria-label={`Thêm thành viên vào đội ${team.name}`} onClick={(event) => { event.stopPropagation(); selectTeam(team, 'members', true); }}>Thêm thành viên</button>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          visibleMissions.length > 0 &&
          <div className="mission-table-scroll">
            <table className="mission-table">
              <thead>
                <tr>
                  <th scope="col">Mã nhiệm vụ</th>
                  <th scope="col">Nhiệm vụ</th>
                  <th scope="col">Đội cứu hộ</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Thời điểm giao</th>
                </tr>
              </thead>
              <tbody>
                {visibleMissions.map((mission) => (
                  <tr
                    className={selectedMission?.id === mission.id ? 'is-selected' : ''}
                    key={mission.id}
                    onClick={() => selectMission(mission)}
                  >
                    <td><code className="mission-table-code" title={mission.id}>{mission.id}</code></td>
                    <td>
                      <button type="button" className="mission-table-open" aria-pressed={selectedMission?.id === mission.id} onClick={(event) => { event.stopPropagation(); selectMission(mission); }}>
                        <strong>{label(mission.category)}</strong>
                      </button>
                      {mission.declared_danger && <span className="mission-table-danger">Cần hỗ trợ khẩn cấp</span>}
                    </td>
                    <td><span className="mission-table-team">{mission.team.name}</span></td>
                    <td><span className={`chip mission-status mission-status-${mission.status.toLowerCase()}`}>{label(mission.status)}</span></td>
                    <td><time className="mission-table-time" dateTime={mission.created_at}>{timeLabel(mission.created_at)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} noun={isTeam ? 'đội' : 'nhiệm vụ'} />
      </section>}

      {/* Hồ sơ chi tiết */}
      {(isTeam ? Boolean(selectedTeam) : Boolean(activeMission)) && <section className={`card mission-detail-card ${isTeam ? 'volunteer-team-detail-card' : ''}`} id={isTeam ? 'volunteer-team-detail' : undefined} ref={missionCardRef}>
        {isTeam ? (
          <>
            <div className="volunteer-team-detail-heading">
              <h2 ref={teamHeadingRef} tabIndex={-1}>Chi tiết đội cứu hộ</h2>
              {selectedTeam && <div className="mission-detail-heading__actions">
                <button type="button" className="button secondary" disabled={loading || teamLoading || busy} onClick={() => { setCursor(''); setRevision(value => value + 1); }}>Cập nhật</button>
                <button type="button" className="button secondary" onClick={returnToTeamList}>← Danh sách đội</button>
              </div>}
            </div>
            {!selectedTeam && (
              <div className="empty">
                Chọn một đội cứu hộ để xem thông tin và thành viên.
              </div>
            )}
            {selectedTeam && (
              <div className="volunteer-team-detail">
                <div className="volunteer-team-profile">
                  <div>
                    <span className="volunteer-team-kind">{label(selectedTeam.kind)}</span>
                    <h3>{selectedTeam.name}</h3>
                  </div>
                  {selectedTeamCanBeManaged && <span className="chip team-leader-badge">Bạn đang quản lý đội này</span>}
                </div>
                {teamMessage && <p className="notice" role="status">{teamMessage}</p>}
                <Tabs
                  items={teamDetailTabs}
                  value={teamDetailTab}
                  onChange={(value) => setTeamDetailTab(value as TeamDetailTab)}
                  ariaLabel="Thông tin đội cứu hộ"
                  idBase="volunteer-team"
                  className="volunteer-team-tabs"
                />
                <section
                  className="volunteer-team-panel"
                  id="volunteer-team-tabpanel"
                  role="tabpanel"
                  aria-labelledby={`volunteer-team-tab-${teamDetailTab}`}
                  tabIndex={0}
                >
                  {teamDetailTab === 'overview' && (
                    <div className="volunteer-team-overview">
                      <dl className="volunteer-team-facts">
                        <div><dt>Khả năng nhận nhiệm vụ</dt><dd>{label(selectedTeam.availability)}</dd></div>
                        <div><dt>Tình trạng nhiệm vụ</dt><dd>{!teamActivityLoaded ? 'Chưa cập nhật được nhiệm vụ' : busyTeamIds.has(selectedTeam.id) ? 'Đang có nhiệm vụ' : 'Không có nhiệm vụ đang hoạt động'}</dd></div>
                        <div><dt>Chế độ báo cáo</dt><dd>{label(selectedTeam.reporting_mode)}</dd></div>
                        <div><dt>Trạng thái hồ sơ</dt><dd>{selectedTeam.status === 'ACTIVE' ? 'Đang hoạt động' : label(selectedTeam.status)}</dd></div>
                        <div><dt>Vị trí gần nhất</dt><dd>{selectedTeam.position ? `${positionAge(selectedTeam.position.age_s)} trước · ${label(selectedTeam.position.source)}` : 'Chưa có dữ liệu tọa độ'}</dd></div>
                        <div><dt>Phiên bản hồ sơ</dt><dd>{selectedTeam.version}</dd></div>
                      </dl>
                      <div className="volunteer-team-skills">
                        <h4>Kỹ năng chuyên môn</h4>
                        {selectedTeam.skills.length ? (
                          <div className="volunteer-team-skill-list">
                            {selectedTeam.skills.map(skill => <span className="chip" key={skill}>{label(skill)}</span>)}
                          </div>
                        ) : <p className="muted">Đội chưa khai báo kỹ năng.</p>}
                      </div>
                      <p className="muted team-availability-help">Để nhận nhiệm vụ, đội cần đang sẵn sàng, không có nhiệm vụ đang hoạt động và có vị trí đủ mới. Điều phối viên còn kiểm tra khu vực và kỹ năng phù hợp.</p>
                    </div>
                  )}
                  {teamDetailTab === 'members' && (
                    <TeamMembers
                      key={`${selectedTeam.id}-${teamSelectionRevision}`}
                      teamId={selectedTeam.id}
                      onManageChange={setCanManageTeam}
                      addOpen={addMemberOpen}
                      onCloseAdd={() => setAddMemberOpen(false)}
                    />
                  )}
                  {teamDetailTab === 'readiness' && (
                    <div className="volunteer-team-panel-content">
                      <div className="volunteer-team-section-heading">
                        <div><h4>Trạng thái sẵn sàng</h4><p>Kiểm soát việc đội có thể tiếp nhận nhiệm vụ mới.</p></div>
                        <span className={`chip team-availability-status ${selectedTeam.availability === 'AVAILABLE' && selectedTeam.status === 'ACTIVE' && teamActivityLoaded && !busyTeamIds.has(selectedTeam.id) ? 'is-ready' : ''}`}>
                          <span className="team-availability-dot" aria-hidden="true" />
                          {!teamActivityLoaded ? 'Đang kiểm tra' : busyTeamIds.has(selectedTeam.id) ? 'Đang có nhiệm vụ' : label(selectedTeam.availability)}
                        </span>
                      </div>
                      {selectedTeam.readiness_required && <p className="notice warning" role="status">Đội cần xác nhận sẵn sàng trở lại sau khi nhiệm vụ đang hoạt động bị hủy.</p>}
                      {selectedTeamCanBeManaged && selectedTeam.status === 'ACTIVE' && selectedTeam.availability === 'AVAILABLE' && (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy || teamLoading}
                          onClick={() => toggleTeamAvailability(selectedTeam)}
                        >
                          Chuyển sang Tạm ngưng
                        </button>
                      )}
                      {selectedTeamCanBeManaged && selectedTeam.status === 'ACTIVE' && selectedTeam.availability !== 'AVAILABLE' && (
                        teamActivityError ? <p className="notice error" role="alert">{teamActivityError}</p>
                          : !teamActivityLoaded ? <p role="status">Đang kiểm tra nhiệm vụ của đội trước khi xác nhận sẵn sàng…</p>
                            : busyTeamIds.has(selectedTeam.id) ? <p className="notice warning">Đội còn nhiệm vụ đang hoạt động hoặc chờ nhận. Hãy xử lý nhiệm vụ đó trước khi xác nhận sẵn sàng.</p>
                              : !teamLoading && <TeamReadinessForm key={`${selectedTeam.id}-${selectedTeam.version}`}
                                teamId={selectedTeam.id} teamName={selectedTeam.name} version={selectedTeam.version}
                                recorded={selectedTeam.reporting_mode === 'COORDINATOR'}
                                onSuccess={() => { setTeamMessage('Đã xác nhận đội sẵn sàng.'); refreshAll(); }}
                                onStale={refreshAll} />
                      )}
                      {!selectedTeamCanBeManaged && <p className="muted">Chỉ trưởng đội mới có thể thay đổi trạng thái sẵn sàng.</p>}
                    </div>
                  )}
                  {teamDetailTab === 'location' && (
                    <div className="volunteer-team-panel-content volunteer-team-location">
                      <div className="volunteer-team-section-heading">
                        <div><h4>Vị trí đội cứu hộ</h4><p>Điều phối viên dùng vị trí mới để so sánh đội phù hợp.</p></div>
                      </div>
                      <p className="volunteer-team-location-status">{selectedTeam.position ? `Cập nhật ${positionAge(selectedTeam.position.age_s)} trước · ${label(selectedTeam.position.source)}` : 'Đội chưa gửi vị trí.'}</p>
                      {selectedTeamCanBeManaged && selectedTeam.reporting_mode === 'APP' && selectedTeam.status === 'ACTIVE' ? <>
                        <p>Chia sẻ GPS chỉ hoạt động khi bạn bật và tab trình duyệt đang mở.</p>
                        {onToggleSharing && <div className="team-sharing-control">
                          <button type="button" className={`button ${sharingTeamId === selectedTeam.id ? 'secondary' : ''}`}
                            onClick={() => onToggleSharing(selectedTeam.id)}>
                            {sharingTeamId === selectedTeam.id ? 'Dừng chia sẻ vị trí' : 'Bắt đầu chia sẻ vị trí'}
                          </button>
                          <small>Tự động gửi GPS mỗi 2 phút. Bạn có thể dừng bất kỳ lúc nào.</small>
                          {sharingTeamId === selectedTeam.id && sharingMessage && <p role="status" className="notice">{sharingMessage}</p>}
                        </div>}
                        <div className="volunteer-team-manual-location">
                          <div className="volunteer-team-section-heading">
                            <div><h4>Cập nhật thủ công</h4><p>Dùng GPS thiết bị hoặc ghim vị trí trên bản đồ.</p></div>
                            <button type="button" className="button secondary" onClick={getTeamDeviceLocation} disabled={busy}>
                              Lấy vị trí GPS
                            </button>
                          </div>
                          <LocationPicker
                            value={teamPoint}
                            onSelect={(point) => { setTeamPoint(point); setTeamAccuracy(null); }}
                          />
                          {teamPoint && (
                            <p role="status">
                              Tọa độ đã chọn: <strong>{teamPoint.latitude.toFixed(6)}, {teamPoint.longitude.toFixed(6)}</strong>
                              {teamAccuracy ? ` (độ chính xác ~${Math.round(teamAccuracy)}m)` : ''}
                            </p>
                          )}
                          {teamPoint && <button type="button" className="button" disabled={busy} onClick={() => updateTeamPosition(selectedTeam)}>Lưu vị trí mới</button>}
                        </div>
                      </> : <p className="muted">Vị trí chỉ có thể cập nhật bởi trưởng đội dùng ứng dụng.</p>}
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mission-detail-heading"><h2 ref={missionHeadingRef} tabIndex={-1}>Chi tiết nhiệm vụ</h2>
              {activeMission && <div className="mission-detail-heading__actions">
                <button type="button" className="button secondary" disabled={loading || missionLoading || busy} onClick={() => { setCursor(''); refreshAll(); }}>Cập nhật</button>
                <button type="button" className="button secondary mission-back-to-list" onClick={returnToMissionList}>← Danh sách nhiệm vụ</button>
              </div>}
            </div>
            {!activeMission && (
              <div className="empty">
                Chọn một nhiệm vụ để xem thông tin và tiến độ.
              </div>
            )}
            {missionLoading && <p role="status">Đang tải hồ sơ nhiệm vụ…</p>}
            {activeMission && (
              <div className="volunteer-mission-detail">
                <div className="volunteer-mission-summary">
                  <div className="volunteer-mission-summary__identity">
                    <small>Mã nhiệm vụ · …{activeMission.id.slice(-12)}</small>
                    <h3>{label(activeMission.category)}</h3>
                    <p>{activeMission.team.name}</p>
                  </div>
                  <span className={`chip mission-status mission-status-${activeMission.status.toLowerCase()}`}>{label(activeMission.status)}</span>
                </div>
                {actionMessage && <p className="notice" role="status">{actionMessage}</p>}
                <Tabs
                  items={missionDetailTabs}
                  value={missionDetailTab}
                  onChange={(value) => setMissionDetailTab(value as MissionDetailTab)}
                  ariaLabel="Chi tiết nhiệm vụ"
                  idBase="volunteer-mission"
                  className="volunteer-mission-tabs"
                />
                <section
                  className="volunteer-mission-panel"
                  id="volunteer-mission-tabpanel"
                  role="tabpanel"
                  aria-labelledby={`volunteer-mission-tab-${missionDetailTab}`}
                  tabIndex={0}
                >
                {missionDetailTab === 'overview' && <div className="volunteer-mission-tab-content">
                <div className="volunteer-mission-facts">
                  <div><small>Số người cần hỗ trợ</small><strong>{activeMission.people_affected ?? 'Chưa rõ'}</strong></div>
                  <div><small>Thời điểm giao</small><strong>{timeLabel(activeMission.created_at)}</strong></div>
                  <div><small>Đội thực hiện</small><strong>{activeMission.team.name}</strong></div>
                </div>

                <div className="volunteer-mission-context">
                  <h3>Mô tả tình huống</h3>
                  <p>{activeMission.description || 'Chưa có mô tả tình huống được cung cấp.'}</p>
                </div>

                {activeMission.declared_danger && (
                  <p className="notice warning volunteer-mission-danger">
                    Người báo cho biết có nguy hiểm tính mạng cần hỗ trợ khẩn cấp.
                  </p>
                )}

                {/* Thông tin liên hệ chỉ hiển thị với Đội trưởng */}
                {(activeMission.reporter_contact_phone ||
                  activeMission.beneficiary_contact_phone) && (
                  <div className="volunteer-mission-contacts">
                    <div><h3>Liên hệ hiện trường</h3><p>Thông tin dành cho đội trưởng.</p></div>
                    <div className="volunteer-mission-contact-list">
                    {activeMission.reporter_contact_phone && (
                      <p>
                        Người báo:{' '}
                        <a href={`tel:${activeMission.reporter_contact_phone}`}>
                          {activeMission.reporter_contact_phone}
                        </a>
                      </p>
                    )}
                    {activeMission.beneficiary_contact_phone && (
                      <p>
                        Người cần hỗ trợ:{' '}
                        <a href={`tel:${activeMission.beneficiary_contact_phone}`}>
                          {activeMission.beneficiary_contact_phone}
                        </a>
                      </p>
                    )}
                    </div>
                  </div>
                )}

                {/* Chỉ đường Google Maps */}
                {directionsUrl ? (
                  <div className="mission-location volunteer-mission-location">
                    <h3>Vị trí hiện trường</h3>
                    <div className="mission-route-summary">
                      <div><small>Điểm xuất phát</small><strong>Chọn trên Google Maps</strong></div>
                      <span aria-hidden="true">→</span>
                      <div><small>Điểm đến</small><strong>Tọa độ hiện trường</strong></div>
                    </div>
                    <p className="mission-route-coordinates">
                      Vĩ độ {(activeMission.location as { coordinates: [number, number] }).coordinates[1]}
                      {' · '}Kinh độ {(activeMission.location as { coordinates: [number, number] }).coordinates[0]}
                    </p>
                    <a
                      className="button mission-directions"
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở chỉ đường trên Google Maps ↗
                    </a>
                    <p className="mission-route-note">Google Maps mở trong tab mới. Kiểm tra lối tiếp cận an toàn trước khi di chuyển.</p>
                  </div>
                ) : (
                  <p className="notice">
                    Chưa nhận được tọa độ hiện trường từ hệ thống. Hãy bấm Cập nhật để thử lại; nếu vẫn thiếu, báo điều phối viên bổ sung vị trí trước khi di chuyển.
                  </p>
                )}
                </div>}

                {missionDetailTab === 'progress' && <div className="volunteer-mission-tab-content volunteer-mission-progress">
                {['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(activeMission.status) ? (
                  <h3>{canManageMission ? 'Thao tác điều hành nhiệm vụ' : 'Theo dõi nhiệm vụ'}</h3>
                ) : (
                  <p className="notice">Nhiệm vụ đã kết thúc. Bạn có thể xem lại kết quả và lịch sử bên dưới.</p>
                )}
                {!canManageMission && ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(activeMission.status) && (
                  <p className="notice">
                    Bạn có thể xem nhiệm vụ và minh chứng. Đội trưởng phụ trách tiếp nhận, cập nhật tiến độ và báo cáo kết quả.
                  </p>
                )}

                {/* 1. Trạng thái OFFERED: Tiếp nhận hoặc Từ chối */}
                {canManageMission && activeMission.status === 'OFFERED' && (
                  <div className="action-grid">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => acceptMission(activeMission)}
                    >
                      Tiếp nhận nhiệm vụ
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setShowDeclineForm(!showDeclineForm)}
                    >
                      Từ chối nhiệm vụ
                    </button>
                  </div>
                )}

                {canManageMission && showDeclineForm && activeMission.status === 'OFFERED' && (
                  <form
                    className="form-stack command-form"
                    noValidate
                    onSubmit={(e) => declineMission(e, activeMission)}
                  >
                    <label>
                      <span>Lý do từ chối nhiệm vụ: <span className="required-mark" aria-hidden="true">*</span></span>
                      <textarea
                        required
                        maxLength={2001}
                        aria-invalid={Boolean((missionFormAttempted.decline || missionFormTouched.decline) && declineReasonError)}
                        aria-label="Lý do từ chối nhiệm vụ"
                        aria-describedby={(missionFormAttempted.decline || missionFormTouched.decline) && declineReasonError ? 'mission-decline-reason-error' : undefined}
                        value={declineReason}
                        onChange={(e) => {
                          setDeclineReason(e.target.value);
                          setMissionFormTouched((current) => ({ ...current, decline: true }));
                        }}
                        onBlur={() => setMissionFormTouched((current) => ({ ...current, decline: true }))}
                        placeholder="Nhập lý do (ví dụ: đang bận cứu nạn ca khác, thiếu phương tiện chuyên dụng...)"
                      />
                      {(missionFormAttempted.decline || missionFormTouched.decline) && declineReasonError && <small id="mission-decline-reason-error" className="field-error" role="alert">{declineReasonError}</small>}
                    </label>
                    <button className="button" disabled={busy || Boolean(declineReasonError)}>
                      Xác nhận từ chối
                    </button>
                  </form>
                )}

                {/* 2. Trạng thái ACCEPTED: Bắt đầu di chuyển */}
                {canManageMission && activeMission.status === 'ACCEPTED' && (
                  <div className="action-grid">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => transitionMission(activeMission, 'EN_ROUTE')}
                    >
                      Bắt đầu di chuyển tới hiện trường
                    </button>
                  </div>
                )}

                {/* 3. Trạng thái EN_ROUTE: Đã tới hiện trường */}
                {canManageMission && activeMission.status === 'EN_ROUTE' && (
                  <div className="action-grid">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => transitionMission(activeMission, 'ON_SCENE')}
                    >
                      Đã tới hiện trường
                    </button>
                  </div>
                )}

                {/* 4. Hoàn thành chỉ sau khi tới hiện trường; thất bại có thể báo khi đang di chuyển. */}
                {canManageMission && ['EN_ROUTE', 'ON_SCENE'].includes(activeMission.status) && (
                  <div className="action-grid">
                    {activeMission.status === 'ON_SCENE' && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          setShowCompleteForm(true);
                          setShowFailForm(false);
                        }}
                      >
                        Báo cáo hoàn thành nhiệm vụ
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        setShowFailForm(true);
                        setShowCompleteForm(false);
                      }}
                    >
                      Báo cáo gặp trở ngại / Thất bại
                    </button>
                  </div>
                )}

                {canManageMission && showCompleteForm && activeMission.status === 'ON_SCENE' && (
                  <form
                    className="form-stack command-form"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      setMissionFormAttempted((current) => ({ ...current, outcome: true }));
                      if (outcomeNoteError) return;
                      transitionMission(activeMission, 'COMPLETED', { outcome_note: outcomeNote });
                    }}
                  >
                    <label>
                      <span>Ghi chú kết quả nhiệm vụ (bắt buộc): <span className="required-mark" aria-hidden="true">*</span></span>
                      <textarea
                        required
                        maxLength={2001}
                        aria-invalid={Boolean((missionFormAttempted.outcome || missionFormTouched.outcome) && outcomeNoteError)}
                        aria-label="Ghi chú kết quả nhiệm vụ"
                        aria-describedby={(missionFormAttempted.outcome || missionFormTouched.outcome) && outcomeNoteError ? 'mission-outcome-note-error' : undefined}
                        value={outcomeNote}
                        onChange={(e) => {
                          setOutcomeNote(e.target.value);
                          setMissionFormTouched((current) => ({ ...current, outcome: true }));
                        }}
                        onBlur={() => setMissionFormTouched((current) => ({ ...current, outcome: true }))}
                        placeholder="Mô tả kết quả hỗ trợ, số người hoặc vật tư đã bàn giao, và tình hình sau xử lý..."
                      />
                      {(missionFormAttempted.outcome || missionFormTouched.outcome) && outcomeNoteError && <small id="mission-outcome-note-error" className="field-error" role="alert">{outcomeNoteError}</small>}
                    </label>
                    <label className="tracking-file-picker">
                      <input
                        ref={completionFileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,video/mp4"
                        aria-invalid={Boolean(completionFile && missionEvidenceError(completionFile))}
                        aria-describedby={completionFile && missionEvidenceError(completionFile) ? 'mission-completion-file-error' : undefined}
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setCompletionFile(file);
                          setCompletionPreviewUrl('');
                          completionUploadKeyRef.current = null;
                          setActionMessage(file ? missionEvidenceError(file) || '' : '');
                          event.currentTarget.blur();
                        }}
                      />
                      <span className="tracking-file-icon" aria-hidden="true">↑</span>
                      <span>
                        <strong>{completionFile ? completionFile.name : 'Thêm ảnh hoặc video khi hoàn thành'}</strong>
                        <small>Không bắt buộc · JPEG, PNG hoặc MP4</small>
                      </span>
                    </label>
                    {completionFile && (
                      <div className="mission-evidence-preview">
                        {completionPreviewUrl && <img src={completionPreviewUrl} alt="Ảnh hiện trường đã chọn" />}
                        <span>{completionFile.name} · {(completionFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                        <button className="button secondary" type="button" onClick={() => {
                          setCompletionFile(null);
                          setCompletionPreviewUrl('');
                          completionUploadKeyRef.current = null;
                          if (completionFileInputRef.current) completionFileInputRef.current.value = '';
                          setActionMessage('');
                        }}>Bỏ tệp</button>
                      </div>
                    )}
                    {completionFile && missionEvidenceError(completionFile) && <small className="field-error" id="mission-completion-file-error" role="alert">{missionEvidenceError(completionFile)}</small>}
                    <p className="account-hint">Nếu chọn tệp, Web sẽ tải minh chứng trước rồi mới ghi nhận hoàn thành. Ảnh tối đa 10 MB; video MP4 tối đa 50 MB.</p>
                    <button className="button" disabled={busy || Boolean(outcomeNoteError) || Boolean(completionFile && missionEvidenceError(completionFile))}>
                      Xác nhận hoàn thành nhiệm vụ
                    </button>
                  </form>
                )}

                {canManageMission && showFailForm && ['EN_ROUTE', 'ON_SCENE'].includes(activeMission.status) && (
                  <form
                    className="form-stack command-form"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      setMissionFormAttempted((current) => ({ ...current, failed: true }));
                      if (progressNoteError) return;
                      transitionMission(activeMission, 'FAILED', { note: progressNote });
                    }}
                  >
                    <label>
                      <span>Lý do không thể tiếp cận / Thất bại (bắt buộc): <span className="required-mark" aria-hidden="true">*</span></span>
                      <textarea
                        required
                        maxLength={2001}
                        aria-invalid={Boolean((missionFormAttempted.failed || missionFormTouched.failed) && progressNoteError)}
                        aria-label="Lý do không thể tiếp cận hoặc thất bại"
                        aria-describedby={(missionFormAttempted.failed || missionFormTouched.failed) && progressNoteError ? 'mission-failure-reason-error' : undefined}
                        value={progressNote}
                        onChange={(e) => {
                          setProgressNote(e.target.value);
                          setMissionFormTouched((current) => ({ ...current, failed: true }));
                        }}
                        onBlur={() => setMissionFormTouched((current) => ({ ...current, failed: true }))}
                        placeholder="Mô tả trở ngại (nước lũ chảy quá xiết, sạt lở chia cắt đường bộ, không tìm thấy người...)"
                      />
                      {(missionFormAttempted.failed || missionFormTouched.failed) && progressNoteError && <small id="mission-failure-reason-error" className="field-error" role="alert">{progressNoteError}</small>}
                    </label>
                    <button className="button" disabled={busy || Boolean(progressNoteError)}>
                      Xác nhận báo cáo thất bại
                    </button>
                  </form>
                )}

                {/* 5. Tải ảnh minh chứng hiện trường giải cứu lên MinIO */}
                {canManageMission && ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(
                  activeMission.status
                ) && (
                  <form
                    className="form-stack command-form"
                    onSubmit={(e) => uploadMissionEvidence(e, activeMission.id)}
                  >
                    <h4>Tải minh chứng hiện trường</h4>
                    <p>
                      Ảnh hoặc video về tiến độ, bàn giao vật tư hay hiện trường (JPEG, PNG,
                      MP4).
                    </p>
                    <label className="tracking-file-picker">
                      <input
                        type="file"
                        required
                        accept="image/jpeg,image/png,video/mp4"
                        aria-invalid={Boolean(evidenceFile && missionEvidenceError(evidenceFile))}
                        aria-describedby={evidenceFile && missionEvidenceError(evidenceFile) ? 'mission-evidence-file-error' : undefined}
                        onChange={(e) => { setEvidenceFile(e.target.files?.[0] || null); setActionMessage(''); }}
                      />
                      <span className="tracking-file-icon" aria-hidden="true">↑</span>
                      <span>
                        <strong>{evidenceFile ? evidenceFile.name : 'Chọn ảnh hoặc video hiện trường'} <span className="required-mark" aria-hidden="true">*</span></strong>
                        <small>JPEG, PNG hoặc MP4</small>
                      </span>
                    </label>
                    {evidenceFile && missionEvidenceError(evidenceFile) && <small className="field-error" id="mission-evidence-file-error" role="alert">{missionEvidenceError(evidenceFile)}</small>}
                    <button className="button secondary" disabled={busy || !evidenceFile || Boolean(missionEvidenceError(evidenceFile))}>
                      {busy ? 'Đang xử lý…' : 'Tải minh chứng lên'}
                    </button>
                  </form>
                )}

                </div>}

                {missionDetailTab === 'history' && <div className="volunteer-mission-tab-content volunteer-mission-history">
                {/* Hiển thị danh sách minh chứng đã có */}
                <div className="volunteer-mission-history-section">
                    <div className="volunteer-mission-history-heading"><h3>Minh chứng đã lưu</h3><span>{missionDetail?.evidence?.items.length || 0}</span></div>
                    {missionDetail?.evidence?.items && missionDetail.evidence.items.length > 0 ? (
                    <div className="record-list">
                      {(missionDetail.evidence.items as EvidenceItem[]).map((ev) => (
                        <div className="record" key={ev.id}>
                          <span>
                            {label(ev.state)} · {timeLabel(ev.created_at)} ·{' '}
                            {Math.ceil(ev.size_bytes / 1024)} KB
                          </span>
                          <span>
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => downloadEvidence(ev.id)}
                            >
                              Lấy liên kết xem
                            </button>
                            {evidenceUrls[ev.id] && (
                              <a
                                className="button secondary"
                                href={evidenceUrls[ev.id]}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Mở tệp
                              </a>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                    ) : <p className="empty">Chưa có minh chứng được lưu cho nhiệm vụ này.</p>}
                </div>

                {/* Timeline nhiệm vụ */}
                <div className="volunteer-mission-history-section">
                    <div className="volunteer-mission-history-heading"><h3>Lịch sử tiến trình</h3><span>{missionDetail?.timeline?.items.length || 0}</span></div>
                    {missionDetail?.timeline?.items && missionDetail.timeline.items.length > 0 ? (
                    <div className="timeline">
                      {(
                        missionDetail.timeline.items as Array<{
                          id?: string;
                          to_status: string;
                          outcome_note?: string | null;
                          reason?: string | null;
                          occurred_at: string;
                        }>
                      ).map((entry, idx) => (
                        <p className="timeline-item" key={entry.id || idx}>
                          <strong>{label(entry.to_status)}</strong> ·{' '}
                          {timeLabel(entry.occurred_at)}
                          {(entry.outcome_note || entry.reason) && (
                            <> · {entry.outcome_note || entry.reason}</>
                          )}
                        </p>
                      ))}
                    </div>
                    ) : <p className="empty">Chưa có cập nhật tiến trình.</p>}
                </div>
                </div>}
                </section>
              </div>
            )}
          </>
        )}
      </section>}
    </div>
  );
}
