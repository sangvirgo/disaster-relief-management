import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey, upload } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';
import type { components as ResponseComponents } from '../../api/generated/response';
import { googleMapsDirectionsUrl } from '../../maps/googleMaps';
import { LocationPicker, type Point } from '../../maps/LocationPicker';

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
  status: string;
  skills: string[];
  position: null | {
    age_s: number;
    accuracy_m: number | null;
    source: string;
    coordinates?: [number, number];
  };
};
type Notice = ResponseComponents['schemas']['Notice'];

const noticeNames: Record<string, string> = {
  MISSION_OFFERED: 'Có nhiệm vụ mới',
  MISSION_OVERDUE: 'Nhiệm vụ cần chú ý',
  MISSION_ACCEPTED: 'Nhiệm vụ đã được nhận',
  REQUEST_UPDATED: 'Yêu cầu đã cập nhật',
  DONATION_COUNTED: 'Vật phẩm đã kiểm đếm',
  DONATION_REVIEWED: 'Đóng góp đã được duyệt',
};

function positionAge(ageSeconds: number): string {
  if (ageSeconds < 3600) return `${Math.max(1, Math.round(ageSeconds / 60))} phút`;
  if (ageSeconds < 86400) return `${Math.round(ageSeconds / 3600)} giờ`;
  return `${Math.round(ageSeconds / 86400)} ngày`;
}

export function Notices() {
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setItems([]);
    const params = new URLSearchParams();
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
    setError('');
    try {
      await api('response', `/notices/${id}/read`, {
        method: 'POST',
        idempotencyKey: newCommandKey(),
      });
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đánh dấu đã đọc.');
    }
  }

  return (
    <section className="card">
      <div className="section-header">
        <h2>Thông báo của tôi</h2>
        <div className="tabs">
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => {
              setFilter('all');
              setCursor('');
            }}
          >
            Tất cả
          </button>
          <button
            className={filter === 'unread' ? 'active' : ''}
            onClick={() => {
              setFilter('unread');
              setCursor('');
            }}
          >
            Chưa đọc
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải thông báo…</p>}
      {!loading && !items.length && !error && (
        <div className="empty">Chưa có thông báo trong mục này.</div>
      )}
      <div className="record-list">
        {items.map((item) => (
          <article className="record" key={item.id}>
            <div>
              <strong>{noticeNames[item.notice_type] || 'Có cập nhật mới'}</strong>
              <p>{timeLabel(item.created_at)}</p>
              <small>{item.read_at ? `Đã đọc lúc ${timeLabel(item.read_at)}` : 'Chưa đọc'}</small>
            </div>
            {!item.read_at && (
              <button className="button secondary" onClick={() => markRead(item.id)}>
                Đánh dấu đã đọc
              </button>
            )}
          </article>
        ))}
      </div>
      {next && (
        <button className="button secondary" onClick={() => setCursor(next)}>
          Xem thêm
        </button>
      )}
    </section>
  );
}

export function Volunteer({ page }: { page: string }) {
  const isTeam = page === 'team';
  const [items, setItems] = useState<Mission[] | Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  // Selected mission and detailed state
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [missionDetail, setMissionDetail] = useState<MissionDetail | null>(null);
  const [missionLoading, setMissionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Form states for mission actions
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [progressNote, setProgressNote] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [showFailForm, setShowFailForm] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({});

  // Team management state
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamPoint, setTeamPoint] = useState<Point | null>(null);
  const [teamAccuracy, setTeamAccuracy] = useState<number | null>(null);
  const [teamMessage, setTeamMessage] = useState('');

  const commandKeyRef = useRef<string | null>(null);

  // Load list of missions or teams
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setItems([]);
    const path = isTeam ? '/teams' : '/missions/mine';
    api<{ items: Mission[] | Team[]; cursor?: string }>(
      'response',
      `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    )
      .then((value) => {
        if (live) {
          setItems(value.items);
          setNext(value.cursor || '');
        }
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [isTeam, cursor, revision]);

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
  }, [selectedMission?.id, revision]);

  function refreshAll() {
    setRevision((val) => val + 1);
    commandKeyRef.current = null;
    setShowDeclineForm(false);
    setShowCompleteForm(false);
    setShowFailForm(false);
    setProgressNote('');
    setOutcomeNote('');
    setEvidenceFile(null);
  }

  // --- Mission Actions ---
  async function acceptMission(mission: Mission | MissionDetail) {
    if (!window.confirm('Xác nhận tiếp nhận nhiệm vụ cứu hộ này?')) return;
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
    if (!declineReason.trim()) return;
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
      setActionMessage(
        cause instanceof Error ? cause.message : 'Không thể cập nhật tiến độ nhiệm vụ.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadMissionEvidence(event: FormEvent, missionId: string) {
    event.preventDefault();
    if (!evidenceFile) return;
    setBusy(true);
    setActionMessage('');
    try {
      commandKeyRef.current ||= newCommandKey();
      await upload('response', `/missions/${missionId}/evidence`, evidenceFile, {
        idempotencyKey: commandKeyRef.current,
      });
      setActionMessage('Đã tải minh chứng hiện trường giải cứu lên hệ thống thành công.');
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
        ? `Chuyển trạng thái đội ${team.name} sang SẴN SÀNG HOẠT ĐỘNG?`
        : `Tạm ngưng hoạt động đội ${team.name}?`;
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setTeamMessage('');
    try {
      await api('response', `/teams/${team.id}`, {
        method: 'PATCH',
        body: { expected_version: team.version, availability: nextAvailability },
        idempotencyKey: newCommandKey(),
      });
      setTeamMessage(`Đội ${team.name} đã chuyển sang ${label(nextAvailability)}.`);
      refreshAll();
    } catch (cause) {
      setTeamMessage(cause instanceof Error ? cause.message : 'Không thể cập nhật trạng thái đội.');
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
      setTeamMessage(`Đã cập nhật vị trí mới cho đội ${team.name}.`);
      setTeamPoint(null);
      setTeamAccuracy(null);
      refreshAll();
    } catch (cause) {
      setTeamMessage(cause instanceof Error ? cause.message : 'Không thể cập nhật vị trí của đội.');
    } finally {
      setBusy(false);
    }
  }

  const activeMission = missionDetail || selectedMission;
  const directionsUrl = activeMission && googleMapsDirectionsUrl(activeMission.location);

  return (
    <div className="grid-two">
      {/* Cột trái: Danh sách Nhiệm vụ hoặc Đội */}
      <section className="card">
        <h2>
          {isTeam ? 'Đội của tôi' : page === 'progress' ? 'Tiến độ nhiệm vụ' : 'Nhiệm vụ của tôi'}
        </h2>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {loading && <p role="status">Đang tải dữ liệu…</p>}
        {!loading && !items.length && !error && (
          <div className="empty">Chưa có dữ liệu trong phạm vi của bạn.</div>
        )}

        <div className="record-list">
          {isTeam
            ? (items as Team[]).map((team) => (
                <article
                  className={`record ${selectedTeam?.id === team.id ? 'selected' : ''}`}
                  key={team.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedTeam(team);
                    setTeamPoint(null);
                    setTeamMessage('');
                  }}
                >
                  <div>
                    <strong>{team.name}</strong>
                    <p>
                      {label(team.kind)} · <span className="chip">{label(team.availability)}</span>
                    </p>
                    <p>
                      Kỹ năng: {team.skills.length ? team.skills.map(label).join(', ') : 'Chưa có'}
                    </p>
                    <small>
                      {team.position
                        ? `Vị trí cập nhật ${positionAge(team.position.age_s)} trước (${label(team.position.source)})`
                        : 'Chưa có dữ liệu tọa độ'}
                    </small>
                  </div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setSelectedTeam(team)}
                  >
                    Quản lý đội
                  </button>
                </article>
              ))
            : (items as Mission[]).map((mission) => (
                <article
                  className={`record ${selectedMission?.id === mission.id ? 'selected' : ''}`}
                  key={mission.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedMission(mission)}
                >
                  <div>
                    <strong>{mission.team.name}</strong>
                    <p>
                      {label(mission.category)} ·{' '}
                      <span className="chip">{label(mission.status)}</span>
                    </p>
                    {mission.declared_danger && (
                      <p className="notice warning">Có nguy hiểm tính mạng</p>
                    )}
                    <small>{timeLabel(mission.created_at)}</small>
                  </div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setSelectedMission(mission)}
                  >
                    Xem nhiệm vụ
                  </button>
                </article>
              ))}
        </div>
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Xem thêm
          </button>
        )}
      </section>

      {/* Cột phải: Bảng điều hành chi tiết */}
      <section className="card">
        {isTeam ? (
          <>
            <h2>Chi tiết & Vị trí Đội cứu hộ</h2>
            {!selectedTeam && (
              <div className="empty">
                Chọn một đội cứu hộ từ danh sách để xem và cập nhật vị trí.
              </div>
            )}
            {selectedTeam && (
              <div className="form-stack">
                <div className="detail-grid mission-facts">
                  <p>
                    <strong>Tên đội</strong>
                    <span className="detail-value">
                      {selectedTeam.name}
                    </span>
                  </p>
                  <p>
                    <strong>Loại đội</strong>
                    <span className="detail-value">
                      {label(selectedTeam.kind)}
                    </span>
                  </p>
                  <p>
                    <strong>Tính khả dụng</strong>
                    <span className="detail-value">
                      {label(selectedTeam.availability)}
                    </span>
                  </p>
                  <p>
                    <strong>Chế độ báo cáo</strong>
                    <span className="detail-value">
                      {label(selectedTeam.reporting_mode)}
                    </span>
                  </p>
                  <p>
                    <strong>Trạng thái</strong>
                    <span className="detail-value">
                      {label(selectedTeam.status)}
                    </span>
                  </p>
                  <p>
                    <strong>Phiên bản</strong>
                    <span className="detail-value">
                      {selectedTeam.version}
                    </span>
                  </p>
                </div>

                <div className="action-grid">
                  <button
                    className={`button ${selectedTeam.availability === 'AVAILABLE' ? 'secondary' : ''}`}
                    disabled={busy}
                    onClick={() => toggleTeamAvailability(selectedTeam)}
                  >
                    {selectedTeam.availability === 'AVAILABLE'
                      ? 'Chuyển sang Tạm ngưng'
                      : 'Chuyển sang Sẵn sàng hoạt động'}
                  </button>
                </div>

                <hr />
                <h3>Cập nhật vị trí GPS của đội</h3>
                <p>Vị trí mới nhất giúp điều phối viên tìm đội gần nơi cần hỗ trợ.</p>
                <div className="action-grid">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={getTeamDeviceLocation}
                    disabled={busy}
                  >
                    Lấy vị trí GPS từ thiết bị
                  </button>
                </div>
                <LocationPicker
                  value={teamPoint}
                  onSelect={(point) => {
                    setTeamPoint(point);
                    setTeamAccuracy(null);
                  }}
                />
                {teamPoint && (
                  <p role="status">
                    Tọa độ đã chọn:{' '}
                    <strong>
                      {teamPoint.latitude.toFixed(6)}, {teamPoint.longitude.toFixed(6)}
                    </strong>
                    {teamAccuracy ? ` (độ chính xác ~${Math.round(teamAccuracy)}m)` : ''}
                  </p>
                )}
                {teamPoint && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => updateTeamPosition(selectedTeam)}
                  >
                    Lưu vị trí mới lên hệ thống
                  </button>
                )}
                {teamMessage && (
                  <p className="notice" role="status">
                    {teamMessage}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <h2>Điều hành nhiệm vụ cứu nạn</h2>
            {!activeMission && (
              <div className="empty">
                Chọn một nhiệm vụ để xem thông tin và thực hiện điều hành.
              </div>
            )}
            {missionLoading && <p role="status">Đang tải hồ sơ nhiệm vụ…</p>}
            {activeMission && (
              <div className="form-stack">
                <div className="detail-grid mission-facts">
                  <p>
                    <strong>Đội thực hiện</strong>
                    <span className="detail-value">
                      {activeMission.team.name}
                    </span>
                  </p>
                  <p>
                    <strong>Trạng thái</strong>
                    <span className="detail-value">
                      <span className="chip">{label(activeMission.status)}</span>
                    </span>
                  </p>
                  <p>
                    <strong>Loại sự cố</strong>
                    <span className="detail-value">
                      {label(activeMission.category)}
                    </span>
                  </p>
                  <p>
                    <strong>Số người cần cứu</strong>
                    <span className="detail-value">
                      {activeMission.people_affected ?? 'Chưa rõ'}
                    </span>
                  </p>
                  <p>
                    <strong>Thời điểm giao</strong>
                    <span className="detail-value">
                      {timeLabel(activeMission.created_at)}
                    </span>
                  </p>
                  <p>
                    <strong>Phiên bản</strong>
                    <span className="detail-value">
                      {activeMission.version}
                    </span>
                  </p>
                </div>

                {activeMission.description && (
                  <div>
                    <strong>Mô tả tình huống:</strong>
                    <p>{activeMission.description}</p>
                  </div>
                )}

                {activeMission.declared_danger && (
                  <p className="notice warning">
                    Người báo cho biết có nguy hiểm tính mạng cần hỗ trợ khẩn cấp.
                  </p>
                )}

                {/* Thông tin liên hệ chỉ hiển thị với Đội trưởng */}
                {(activeMission.reporter_contact_phone ||
                  activeMission.beneficiary_contact_phone) && (
                  <div className="candidate">
                    <strong>Thông tin liên lạc tại hiện trường (dành cho đội trưởng):</strong>
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
                )}

                {/* Chỉ đường Google Maps */}
                {directionsUrl ? (
                  <div className="mission-location">
                    <h3>Vị trí hiện trường</h3>
                    <p>
                      Tọa độ:{' '}
                      {(activeMission.location as { coordinates: [number, number] }).coordinates[1]}
                      ,{' '}
                      {(activeMission.location as { coordinates: [number, number] }).coordinates[0]}
                    </p>
                    <a
                      className="button mission-directions"
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở Google Maps chỉ đường
                    </a>
                  </div>
                ) : (
                  <p className="notice">
                    Nhiệm vụ này chưa có tọa độ được cấp quyền để mở chỉ đường.
                  </p>
                )}

                <hr />
                <h3>Thao tác điều hành nhiệm vụ</h3>

                {/* 1. Trạng thái OFFERED: Tiếp nhận hoặc Từ chối */}
                {activeMission.status === 'OFFERED' && (
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

                {showDeclineForm && activeMission.status === 'OFFERED' && (
                  <form
                    className="form-stack command-form"
                    onSubmit={(e) => declineMission(e, activeMission)}
                  >
                    <label>
                      Lý do từ chối nhiệm vụ:
                      <textarea
                        required
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="Nhập lý do (ví dụ: đang bận cứu nạn ca khác, thiếu phương tiện chuyên dụng...)"
                      />
                    </label>
                    <button className="button" disabled={busy || !declineReason.trim()}>
                      Xác nhận từ chối
                    </button>
                  </form>
                )}

                {/* 2. Trạng thái ACCEPTED: Bắt đầu di chuyển */}
                {activeMission.status === 'ACCEPTED' && (
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
                {activeMission.status === 'EN_ROUTE' && (
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

                {/* 4. Trạng thái EN_ROUTE hoặc ON_SCENE: Hoàn thành hoặc Thất bại */}
                {['EN_ROUTE', 'ON_SCENE'].includes(activeMission.status) && (
                  <div className="action-grid">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        setShowCompleteForm(true);
                        setShowFailForm(false);
                      }}
                    >
                      Báo cáo hoàn thành giải cứu
                    </button>
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

                {showCompleteForm && ['EN_ROUTE', 'ON_SCENE'].includes(activeMission.status) && (
                  <form
                    className="form-stack command-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      transitionMission(activeMission, 'COMPLETED', { outcome_note: outcomeNote });
                    }}
                  >
                    <label>
                      Ghi chú kết quả cứu nạn (bắt buộc):
                      <textarea
                        required
                        value={outcomeNote}
                        onChange={(e) => setOutcomeNote(e.target.value)}
                        placeholder="Mô tả kết quả (số người đã giải cứu an toàn, tình trạng sức khỏe, nơi chuyển đến...)"
                      />
                    </label>
                    <button className="button" disabled={busy || !outcomeNote.trim()}>
                      Xác nhận hoàn thành giải cứu
                    </button>
                  </form>
                )}

                {showFailForm && ['EN_ROUTE', 'ON_SCENE'].includes(activeMission.status) && (
                  <form
                    className="form-stack command-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      transitionMission(activeMission, 'FAILED', { note: progressNote });
                    }}
                  >
                    <label>
                      Lý do không thể tiếp cận / Thất bại (bắt buộc):
                      <textarea
                        required
                        value={progressNote}
                        onChange={(e) => setProgressNote(e.target.value)}
                        placeholder="Mô tả trở ngại (nước lũ chảy quá xiết, sạt lở chia cắt đường bộ, không tìm thấy người...)"
                      />
                    </label>
                    <button className="button" disabled={busy || !progressNote.trim()}>
                      Xác nhận báo cáo thất bại
                    </button>
                  </form>
                )}

                {/* 5. Tải ảnh minh chứng hiện trường giải cứu lên MinIO */}
                {['ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED'].includes(
                  activeMission.status
                ) && (
                  <form
                    className="form-stack command-form"
                    onSubmit={(e) => uploadMissionEvidence(e, activeMission.id)}
                  >
                    <h4>Tải minh chứng hiện trường</h4>
                    <p>
                      Hình ảnh giải cứu, tình hình nước ngập hoặc tài liệu hiện trường (JPEG, PNG,
                      MP4).
                    </p>
                    <label>
                      Chọn tệp hình ảnh/video:
                      <input
                        type="file"
                        required
                        accept="image/jpeg,image/png,video/mp4"
                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <button className="button secondary" disabled={busy || !evidenceFile}>
                      {busy ? 'Đang tải minh chứng…' : 'Tải minh chứng lên'}
                    </button>
                  </form>
                )}

                {/* Hiển thị danh sách minh chứng đã có */}
                {missionDetail?.evidence?.items && missionDetail.evidence.items.length > 0 && (
                  <div>
                    <h4>Minh chứng đã lưu ({missionDetail.evidence.items.length})</h4>
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
                  </div>
                )}

                {/* Timeline nhiệm vụ */}
                {missionDetail?.timeline?.items && missionDetail.timeline.items.length > 0 && (
                  <div>
                    <h4>Lịch sử tiến trình nhiệm vụ</h4>
                    <div className="timeline">
                      {(
                        missionDetail.timeline.items as Array<{
                          id?: string;
                          event_type: string;
                          occurred_at: string;
                        }>
                      ).map((entry, idx) => (
                        <p className="timeline-item" key={entry.id || idx}>
                          <strong>{label(entry.event_type)}</strong> ·{' '}
                          {timeLabel(entry.occurred_at)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {actionMessage && (
                  <p className="notice" role="status">
                    {actionMessage}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
