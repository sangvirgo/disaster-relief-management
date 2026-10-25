import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, newCommandKey } from './api/client';
import { changePassword, googleLogin, login, logout, me, register, resendEmailOtp, roles, verifyEmail, type Me } from './auth/session';
import {
  allowedPages,
  allowedWorkspaces,
  pages,
  workspaceLabels,
  type Page,
  type Workspace,
} from './app/catalog';
import { label, timeLabel } from './i18n/labels';
import { SosForm } from './features/citizen/SosForm';
import { Donations } from './features/citizen/Donations';
import { TrackingActions } from './features/citizen/TrackingActions';
import { Coordinator, CoordinatorMap } from './features/coordinator/Coordinator';
import { Campaigns } from './features/coordinator/Campaigns';
import { Notices, Volunteer } from './features/volunteer/Volunteer';
import { Admin } from './features/admin/Admin';
import { Operations } from './features/operations/Operations';
import { OperationsDashboard } from './features/operations/Dashboard';
import { AnalyticsRegionField, useAnalyticsRegion } from './components/AnalyticsRegion';
import { CitizenAccount } from './features/citizen/CitizenAccount';
import type { components as ResponseComponents } from './api/generated/response';
import './style.css';

declare global {
  interface Window {
    google?: {
      accounts: { id: {
        initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
        renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
      } };
    };
  }
}
import './sos.css';
import './workflow.css';
import './refinements.css';

type DataPage = {
  items?: Record<string, unknown>[];
  next_cursor?: string;
  cursor?: string;
  more?: boolean;
  generated_at?: string;
  status_counts?: Record<string, number>;
  priority_counts?: Record<string, number>;
  active_missions?: number;
  overdue_missions?: number;
};
type SosReceipt = ResponseComponents['schemas']['CreatedSelfRequest'];
const icon = (name: string) => <img src={`/icons/${name}.svg`} alt="" aria-hidden="true" />;
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

function AuthModal({
  isOpen,
  onClose,
  onReady,
}: {
  isOpen: boolean;
  onClose: () => void;
  onReady: (user: Me) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify' | 'help'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const googleButton = useRef<HTMLDivElement>(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setMode('login');
      setPassword('');
      setShowPassword(false);
      setMessage('');
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || mode !== 'login' || !googleClientId || !googleButton.current) return;
    let cancelled = false;
    const renderButton = () => {
      if (cancelled || !window.google || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (credential) => {
          if (!credential.credential) return;
          setBusy(true);
          setMessage('');
          void googleLogin(credential.credential).then((loggedUser) => { onReady(loggedUser); onClose(); })
            .catch((error) => setMessage(error instanceof Error ? error.message : 'Không thể đăng nhập bằng Google.'))
            .finally(() => setBusy(false));
        },
      });
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'vi', width: 320 });
    };
    if (window.google) renderButton();
    else {
      let script = document.querySelector<HTMLScriptElement>('script[data-c48-google="true"]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.c48Google = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderButton, { once: true });
    }
    return () => { cancelled = true; };
  }, [googleClientId, isOpen, mode, onClose, onReady]);

  if (!isOpen) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'register') {
        const result = await register(username.trim(), password, displayName.trim(), email.trim());
        setChallengeId(result.verification.challenge_id);
        setMode('verify');
        setMessage(result.email_sent ? 'Mã xác thực đã được gửi đến email. Mã có hiệu lực 5 phút.' : 'Tài khoản đang chờ xác thực. Chưa gửi được email; hãy kiểm tra cấu hình email rồi chọn gửi lại mã.');
      } else if (mode === 'verify') {
        await verifyEmail(challengeId, otp.trim());
        setMode('login');
        setOtp('');
        setMessage('Email đã được xác thực. Bạn có thể đăng nhập.');
      } else {
        const loggedUser = await login(username.trim(), password);
        onReady(loggedUser);
        onClose();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể hoàn tất yêu cầu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-button" onClick={onClose} aria-label="Đóng cửa sổ">
          ✕
        </button>
        <div className="auth-brand" aria-hidden="true">
          <span className="auth-logo-frame"><img src="/reliva-logo.png" alt="" /></span>
          <span className="auth-brand-name">reliva</span>
        </div>
        <h2 id="auth-modal-title">
          {mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : mode === 'verify' ? 'Xác thực email' : 'Hỗ trợ mật khẩu'}
        </h2>
        {mode === 'help' && <p className="modal-desc">
          Nếu quên mật khẩu, hãy liên hệ quản trị viên của hệ thống để xác minh tài khoản và cấp mật khẩu tạm. Sau khi đăng nhập, bạn phải đổi mật khẩu tạm.
        </p>}
        {mode !== 'help' && <form onSubmit={submit} className="form-stack">
          {mode === 'register' && (
            <label className="auth-field">
              Email nhận mã xác thực
              <input required type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="ten@example.com" />
            </label>
          )}
          {mode === 'verify' && (
            <label className="auth-field">
              Mã xác thực 6 chữ số
              <input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" />
            </label>
          )}
          {mode !== 'verify' && <>
          {mode === 'register' && (
            <label className="auth-field">
              Họ và tên
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="Nguyễn Văn A"
              />
            </label>
          )}
          <label className="auth-field">
            Tên đăng nhập
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Nhập tên đăng nhập"
            />
          </label>
          </>}
          {mode !== 'verify' && <label className="auth-field">
            Mật khẩu
            <span className="auth-password-field">
              <input
                required
                type={showPassword ? 'text' : 'password'}
                minLength={mode === 'register' ? 10 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={mode === 'register' ? 'Tối thiểu 10 ký tự' : 'Nhập mật khẩu'}
              />
              <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </span>
          </label>}
          {message && (
            <p
              role="status"
              className={`notice ${/thành công|đã được xác thực|đã gửi/i.test(message) ? 'success' : 'error'}`}
            >
              {message}
            </p>
          )}
          <button disabled={busy} className="button" type="submit">
            {busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : mode === 'verify' ? 'Xác thực email' : 'Tạo tài khoản'}
          </button>
          {mode === 'verify' && <button type="button" className="text-button" disabled={busy} onClick={() => void resendEmailOtp(challengeId).then((result) => { if (result.challenge_id) setChallengeId(result.challenge_id); setMessage(result.email_sent ? 'Mã mới đã được gửi.' : 'Nếu tài khoản đang chờ xác thực, hệ thống sẽ gửi mã khi email được cấu hình.'); }).catch((error) => setMessage(error instanceof Error ? error.message : 'Chưa gửi lại được mã.'))}>Gửi lại mã xác thực</button>}
        </form>}
        {mode === 'login' && googleClientId && <div className="google-auth-button" ref={googleButton} aria-label="Đăng nhập bằng Google" />}
        <div className="modal-footer">
          {mode === 'login' && (
            <button type="button" className="text-button" onClick={() => { setMode('help'); setShowPassword(false); setMessage(''); }}>
              Quên mật khẩu?
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setShowPassword(false);
              setMessage('');
            }}
          >
            {mode === 'login'
              ? 'Chưa có tài khoản? Đăng ký ngay'
              : 'Quay lại đăng nhập'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthRequiredNotice({ onOpenAuth }: { onOpenAuth: () => void }) {
  return (
    <div className="card auth-required-card">
      <div className="eyebrow">Yêu cầu xác thực</div>
      <h2>Vui lòng đăng nhập</h2>
      <p>
        Khu vực này yêu cầu đăng nhập tài khoản để bảo mật dữ liệu và liên kết đúng phân quyền của
        bạn.
      </p>
      <button className="button" onClick={onOpenAuth}>
        Đăng nhập / Đăng ký ngay
      </button>
    </div>
  );
}

function PasswordChange({ onChanged, forced = false }: { onChanged: (user: Me) => void; forced?: boolean }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updatedUser = await changePassword(oldPassword, newPassword);
      onChanged(updatedUser);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đổi mật khẩu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      <div className="eyebrow">Bảo mật tài khoản</div>
      <h2>Đổi mật khẩu tài khoản</h2>
      <p>{forced
        ? 'Tài khoản vừa đăng nhập bằng mật khẩu tạm. Vui lòng cập nhật mật khẩu mới để tiếp tục.'
        : 'Nhập mật khẩu hiện tại và mật khẩu mới để bảo vệ tài khoản của bạn.'}</p>

      <div className="notice" style={{ fontSize: 13, marginBottom: 14 }}>
        💡 <strong>Quy chuẩn mật khẩu mới:</strong> Tối thiểu 10 ký tự, khác tên đăng nhập và khác
        mật khẩu hiện tại (Ví dụ: <code>MatKhauRieng!2026</code>).
      </div>

      <form className="form-stack" onSubmit={submit}>
        <label>
          Mật khẩu hiện tại{forced ? ' (mật khẩu tạm)' : ''}
          <input
            type="password"
            required
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Nhập mật khẩu bạn vừa dùng để đăng nhập"
          />
        </label>
        <label>
          Mật khẩu mới
          <input
            type="password"
            required
            minLength={10}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Tối thiểu 10 ký tự (Ví dụ: MatKhauRieng!2026)"
          />
        </label>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <button className="button" disabled={busy} type="submit" style={{ flex: 1 }}>
            {busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Tracking({ user, initialCode = '' }: { user: Me | null; initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [secret, setSecret] = useState('');
  const [data, setData] = useState<ResponseComponents['schemas']['ReporterTracking'] | null>(null);
  const [verified, setVerified] = useState<{ code: string; secret: string } | null>(null);
  const lookupVersion = useRef(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const recoveryKey = useRef<string | null>(null);
  async function refreshTracking(credentials = verified) {
    if (!credentials) return;
    const version = lookupVersion.current;
    const result = await api<ResponseComponents['schemas']['ReporterTracking']>('response', '/requests/track', {
        headers: {
          'X-Tracking-Code': credentials.code,
          ...(credentials.secret ? { 'X-Tracking-Secret': credentials.secret } : {}),
        },
      });
    if (version === lookupVersion.current) {
      setVerified(credentials);
      setData(result);
    }
  }
  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    const version = ++lookupVersion.current;
    const credentials = { code: code.trim(), secret: secret.trim() };
    setBusy(true);
    setError('');
    setData(null);
    setVerified(null);
    try {
      await refreshTracking(credentials);
    } catch (cause) {
      if (version === lookupVersion.current)
        setError(cause instanceof Error ? cause.message : 'Không thể tra cứu.');
    } finally {
      if (version === lookupVersion.current) setBusy(false);
    }
  }
  function invalidateLookup() {
    lookupVersion.current += 1;
    setBusy(false);
    setData(null);
    setVerified(null);
    setError('');
  }
  async function recover(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setRecoveryMessage('');
    try {
      recoveryKey.current ||= newCommandKey();
      await api('response', '/requests/recover', {
        method: 'POST',
        body: { tracking_code: code.trim() },
        headers: { 'X-Recovery-Code': recoveryCode.trim() },
        idempotencyKey: recoveryKey.current,
      });
      recoveryKey.current = null;
      setRecoveryCode('');
      setSecret('');
      invalidateLookup();
      setRecoveryMessage('Yêu cầu đã được gắn với tài khoản. Hãy tra cứu lại bằng mã theo dõi.');
    } catch (cause) {
      setRecoveryMessage(cause instanceof Error ? cause.message : 'Chưa khôi phục được yêu cầu.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid-two">
      <section className="card">
        <h2>Tra cứu riêng tư</h2>
        <p>Mã theo dõi được máy chủ cấp sau khi nhận SOS. Nếu gửi khi chưa đăng nhập, bạn còn nhận một mã bảo mật chỉ hiện một lần; hãy giữ riêng mã này để tra cứu. Nếu đã đăng nhập khi gửi, hãy dùng tài khoản của mình và mã theo dõi.</p>
        <form onSubmit={lookup} className="form-stack">
          <label>
            Mã theo dõi
            <input
              required
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                recoveryKey.current = null;
                invalidateLookup();
              }}
              autoComplete="off"
            />
          </label>
          <label>
            Mã bảo mật {user ? '(nếu chưa gắn với tài khoản)' : ''}
            <input
              required={!user}
              type="password"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                invalidateLookup();
              }}
              autoComplete="off"
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? 'Đang tra cứu…' : 'Xem tiến độ'}
          </button>
        </form>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {user && (
          <form className="form-stack command-form" onSubmit={recover}>
            <h3>Khôi phục quyền theo dõi</h3>
            <p>
              Nhập mã một lần do điều phối viên cấp sau khi xác minh liên hệ. Mã theo dõi ở biểu mẫu
              phía trên cũng được dùng tại đây.
            </p>
            <label>
              Mã khôi phục một lần
              <input
                required
                value={recoveryCode}
                onChange={(event) => {
                  setRecoveryCode(event.target.value);
                  recoveryKey.current = null;
                }}
                autoComplete="off"
              />
            </label>
            <button className="button secondary" disabled={busy || !code.trim()}>
              Gắn yêu cầu với tài khoản
            </button>
            {recoveryMessage && (
              <p className="notice" role="status">
                {recoveryMessage}
              </p>
            )}
          </form>
        )}
      </section>
      {data && (
        <section className="card">
          <h2>Tiến độ yêu cầu {text(data.tracking_code)}</h2>
          <span className="chip">{label(data.status)}</span>
          <p>Máy chủ tiếp nhận: {timeLabel(data.received_at)}</p>
          <div className="timeline">
            {data.timeline.map((entry, index) => {
              return (
                <div className="timeline-item" key={index}>
                  <strong>{label(entry.public_text_code || entry.event_type)}</strong>
                  <small>{timeLabel(entry.occurred_at)}</small>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {data && verified && (
        <TrackingActions
          key={data.id}
          tracking={data}
          code={verified.code}
          secret={verified.secret}
          canClaim={Boolean(user)}
          onUpdated={refreshTracking}
        />
      )}
    </div>
  );
}

function RecordCard({ item, onOpen }: { item: Record<string, unknown>; onOpen?: () => void }) {
  const nestedItem =
    item.item && typeof item.item === 'object' ? (item.item as Record<string, unknown>) : null;
  const title =
    text(item.title) ||
    text(item.name) ||
    text(item.display_name) ||
    text(item.tracking_code) ||
    text(item.public_code) ||
    text(item.code) ||
    text(nestedItem?.name) ||
    'Bản ghi';
  const subtitle =
    text(item.objective) ||
    text(item.description) ||
    text(item.region_name) ||
    text(item.username) ||
    text(item.address_note);
  const status = text(item.status) || text(item.review_lane);
  const time = item.received_at || item.created_at || item.starts_at || item.generated_at;
  return (
    <article className="record">
      <div>
        <strong>{title}</strong>
        {subtitle && <p>{subtitle}</p>}
        {Boolean(item.team) && typeof item.team === 'object' && (
          <p>Đội: {text((item.team as Record<string, unknown>).name)}</p>
        )}
        {Boolean(item.category) && <p>Loại sự cố: {label(item.category)}</p>}
        {item.people_affected != null && <p>Số người cần hỗ trợ: {String(item.people_affected)}</p>}
        {item.on_hand != null && (
          <p>
            Tồn thực tế: {String(item.on_hand)} · Khả dụng: {String(item.available ?? '—')} · Tạm
            giữ: {String(item.held ?? '—')}
          </p>
        )}
        {item.intake_accepted != null && (
          <p>
            Đã tiếp nhận: {String(item.intake_accepted)} · Đã giao: {String(item.delivered ?? '—')}{' '}
            · Đã trả: {String(item.returned ?? '—')}
          </p>
        )}
        {Boolean(time) && <small>{timeLabel(time)}</small>}
      </div>
      <div className="record-actions">
        {status && <span className="chip">{label(status)}</span>}
        {onOpen && (
          <button className="button secondary" onClick={onOpen}>
            Xem chi tiết
          </button>
        )}
      </div>
    </article>
  );
}

function DetailPanel({
  service,
  path,
  onClose,
}: {
  service: 'response' | 'identity';
  path: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api<Record<string, unknown>>(service, path)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể mở chi tiết.');
      });
    return () => {
      live = false;
    };
  }, [service, path]);

  const reporter = detail?.reporter as Record<string, unknown> | undefined;
  const subject = detail?.subject as Record<string, unknown> | undefined;
  const location = subject?.location as Record<string, unknown> | undefined;
  const team = detail?.team as Record<string, unknown> | undefined;

  return (
    <section className="card detail-panel" aria-label="Chi tiết bản ghi">
      <div className="section-header">
        <h2>Chi tiết bản ghi</h2>
        <button className="button secondary" onClick={onClose}>
          Đóng
        </button>
      </div>
      {!detail && !error && <p role="status">Đang tải chi tiết…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {detail && (
        <div className="detail-grid">
          <p>
            <strong>Trạng thái</strong>
            <br />
            {label(detail.status)}
          </p>
          {Boolean(detail.tracking_code) && (
            <p>
              <strong>Mã theo dõi</strong>
              <br />
              {text(detail.tracking_code)}
            </p>
          )}
          {Boolean(detail.category) && (
            <p>
              <strong>Loại sự cố</strong>
              <br />
              {label(detail.category)}
            </p>
          )}
          {Boolean(detail.priority) && (
            <p>
              <strong>Mức ưu tiên đã quyết định</strong>
              <br />
              {text(detail.priority)}
            </p>
          )}
          {Boolean(team?.name) && (
            <p>
              <strong>Đội thực hiện</strong>
              <br />
              {text(team?.name)}
            </p>
          )}
          {Boolean(detail.description) && (
            <p>
              <strong>Mô tả</strong>
              <br />
              {text(detail.description)}
            </p>
          )}
          {Boolean(reporter?.name) && (
            <p>
              <strong>Người báo</strong>
              <br />
              {text(reporter?.name)}
            </p>
          )}
          {Boolean(reporter?.contact_phone) && (
            <p>
              <strong>Liên hệ người báo</strong>
              <br />
              {text(reporter?.contact_phone)}
            </p>
          )}
          {subject?.people_affected != null && (
            <p>
              <strong>Số người cần hỗ trợ</strong>
              <br />
              {String(subject.people_affected)}
            </p>
          )}
          {Array.isArray(location?.coordinates) && (
            <p>
              <strong>Vị trí được cấp quyền xem</strong>
              <br />
              {location.coordinates.join(', ')}
            </p>
          )}
          {Boolean(detail.received_at) && (
            <p>
              <strong>Thời điểm tiếp nhận</strong>
              <br />
              {timeLabel(detail.received_at)}
            </p>
          )}
          {Boolean(detail.display_name) && (
            <p>
              <strong>Tên hiển thị</strong>
              <br />
              {text(detail.display_name)}
            </p>
          )}
          {Boolean(detail.username) && (
            <p>
              <strong>Tên đăng nhập</strong>
              <br />
              {text(detail.username)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function LivePage({ page, user }: { page: Page; user: Me | null }) {
  const { region, setRegion, regions, loading: regionLoading, error: regionError } = useAnalyticsRegion(page.path === '/reports/summary');
  const [data, setData] = useState<DataPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detailPath, setDetailPath] = useState<string | null>(null);
  function openDetail(item: Record<string, unknown>): void {
    const id = text(item.id);
    if (!id) return;
    if (page.service === 'response' && page.path?.startsWith('/requests'))
      setDetailPath(`/requests/${encodeURIComponent(id)}`);
    else if (page.service === 'response' && page.path === '/missions/mine')
      setDetailPath(`/missions/${encodeURIComponent(id)}`);
    else if (page.service === 'identity' && page.path === '/users')
      setDetailPath(`/users/${encodeURIComponent(id)}`);
  }
  const canOpen =
    (page.service === 'response' &&
      (page.path?.startsWith('/requests') || page.path === '/missions/mine')) ||
    (page.service === 'identity' && page.path === '/users');
  useEffect(() => {
    if (!page.service || !page.path) return;
    if (page.path === '/reports/summary' && !region) return;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    const reportPath =
      page.service === 'response' && page.path === '/reports/summary'
        ? `/reports/summary?from=${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}&region_code=${encodeURIComponent(region)}`
        : page.path;
    const path =
      reportPath +
      (cursor ? `${reportPath.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : '');
    api<DataPage>(page.service, path)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, cursor, user, region]);
  if (!page.service || !page.path)
    return (
      <div className="card">
        <h2>{page.title}</h2>
        <p>{page.note || 'Chưa có dữ liệu để hiển thị.'}</p>
      </div>
    );
  return (
    <section className={`card ${page.path === '/reports/summary' ? 'report-card' : ''}`}>
      <div className="section-header">
        <div><span className="eyebrow">Số liệu trực tiếp</span><h2>{page.path === '/reports/summary' ? 'Tổng quan ứng cứu' : page.title}</h2></div>
        <span className="report-period">{page.path === '/reports/summary' ? '7 ngày gần đây' : 'Dữ liệu từ hệ thống'}</span>
      </div>
      {page.note && page.path !== '/reports/summary' && <p>{page.note}</p>}
      {page.path === '/reports/summary' && (
        <>
          <AnalyticsRegionField region={region} onChange={(value) => { setCursor(null); setRegion(value); }} regions={regions} />
          {regionError && <p role="alert" className="notice error">{regionError}</p>}
          {!region && !regionLoading && <p>Chọn hoặc nhập mã khu vực để xem báo cáo.</p>}
        </>
      )}
      {loading && <p role="status">Đang tải dữ liệu…</p>}
      {error && (
        <div role="alert" className="notice error">
          {error}
          {error.includes('quyền') && (
            <p>Dữ liệu trong phạm vi này hiện không được cấp cho tài khoản của bạn.</p>
          )}
        </div>
      )}
      {!loading && !error && data && (
        <>
          {Array.isArray(data.items) ? (
            data.items.length ? (
              <div className="record-list">
                {data.items.map((item, index) => (
                  <RecordCard
                    key={text(item.id) || index}
                    item={item}
                    onOpen={canOpen && item.id ? () => openDetail(item) : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">Chưa có bản ghi nào trong phạm vi của bạn.</div>
            )
          ) : 'status_counts' in data ? (
            <div className="report-content">
              <div className="report-metrics">
                <div className="metric-tile"><span>Nhiệm vụ đang hoạt động</span><strong>{data.active_missions ?? 0}</strong><small>Đội đang thực hiện</small></div>
                <div className="metric-tile metric-tile-warning"><span>Nhiệm vụ quá hạn</span><strong>{data.overdue_missions ?? 0}</strong><small>Cần theo dõi</small></div>
                <div className="metric-tile metric-tile-green"><span>Tổng yêu cầu</span><strong>{Object.values(data.status_counts || {}).reduce((sum, count) => sum + count, 0)}</strong><small>Trong khu vực đã chọn</small></div>
              </div>
              <div className="report-breakdown">
                <h3>Yêu cầu theo trạng thái</h3>
                <p>Mỗi trạng thái là một nhóm riêng trong báo cáo.</p>
                <div className="report-status-grid">
                  {Object.entries(data.status_counts || {}).map(([key, value]) => (
                    <div className="report-status" key={key}><span>{label(key)}</span><strong>{value}</strong></div>
                  ))}
                </div>
                {!Object.keys(data.status_counts || {}).length && <div className="empty">Chưa có yêu cầu trong khoảng thời gian này.</div>}
              </div>
              {Boolean(data.priority_counts && Object.keys(data.priority_counts).length) && (
                <div className="report-breakdown"><h3>Mức ưu tiên đã quyết định</h3><div className="report-status-grid">{Object.entries(data.priority_counts || {}).map(([key, value]) => <div className="report-status" key={key}><span>{label(key)}</span><strong>{value}</strong></div>)}</div></div>
              )}
            </div>
          ) : (
            <div className="summary">
              <p>Dịch vụ đã trả kết quả báo cáo. Chưa có chỉ số tóm tắt cho loại báo cáo này.</p>
            </div>
          )}
          {data.generated_at && (
            <p className="muted">Dữ liệu tạo lúc {timeLabel(data.generated_at)}</p>
          )}
          {(data.next_cursor || (data.more && data.cursor)) && (
            <button
              className="button secondary"
              onClick={() => setCursor(data.next_cursor || data.cursor || null)}
            >
              Xem thêm
            </button>
          )}
        </>
      )}
      {detailPath && page.service && (
        <DetailPanel
          service={page.service === 'identity' ? 'identity' : 'response'}
          path={detailPath}
          onClose={() => setDetailPath(null)}
        />
      )}
    </section>
  );
}

function defaultWorkspaceForUser(user: Me | null): Workspace {
  if (!user) return 'citizen';
  const r = roles(user);
  if (r.has('ADMIN')) return 'admin';
  if (r.has('COORDINATOR')) return 'coordinator';
  if (r.has('VOLUNTEER')) return 'volunteer';
  if (
    [
      'OPERATIONS_MANAGER',
      'CAMPAIGN_MANAGER',
      'INTAKE_STAFF',
      'REVIEWER',
      'DISTRIBUTION_STAFF',
    ].some((role) => r.has(role))
  ) {
    return 'operations';
  }
  return 'citizen';
}

function App() {
  const [user, setUser] = useState<Me | null>(null);
  const [sessionState, setSessionState] = useState<'loading' | 'guest' | 'ready' | 'error'>(
    'loading'
  );
  const [sessionError, setSessionError] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>('citizen');
  const [pageId, setPageId] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [latestReceipt, setLatestReceipt] = useState<SosReceipt | null>(null);
  const [selectedTrackingCode, setSelectedTrackingCode] = useState('');

  useEffect(() => {
    me()
      .then((value) => {
        setUser(value);
        setSessionState('ready');
        const defaultWs = defaultWorkspaceForUser(value);
        setWorkspace(defaultWs);
        setPageId(allowedPages(defaultWs, value)[0]?.id || 'home');
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          setSessionState('guest');
        } else {
          setSessionError(cause instanceof Error ? cause.message : 'Không thể kiểm tra phiên.');
          setSessionState('error');
        }
      });
  }, []);

  const workspaces = allowedWorkspaces(user);
  const navigation = allowedPages(workspace, user);
  const selected =
    navigation.find((page) => page.id === pageId) || navigation[0] || pages.citizen[0];

  function changeWorkspace(next: Workspace) {
    setWorkspace(next);
    setPageId(allowedPages(next, user)[0]?.id || 'home');
    setMenuOpen(false);
  }

  function changePage(id: string) {
    setPageId(id);
    setMenuOpen(false);
  }

  async function signOut() {
    setLogoutError('');
    try {
      await logout();
      setUser(null);
      setLatestReceipt(null);
      setSessionState('guest');
      changeWorkspace('citizen');
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : 'Không thể đăng xuất.');
    }
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Điều hướng chính">
        <div className="brand">
          <span className="brand-mark"><img src="/reliva-logo.png" alt="" aria-hidden="true" /></span>
          <div>
            <strong>Reliva</strong>
            <small>CHUNG TAY CỨU TRỢ</small>
          </div>
        </div>

        <p className="nav-label">Không gian làm việc</p>
        <div className="workspace-switch" role="group" aria-label="Chọn không gian làm việc">
          {workspaces.map((item) => (
            <button
              key={item}
              className={workspace === item ? 'active' : ''}
              onClick={() => changeWorkspace(item)}
            >
              {workspaceLabels[item]}
            </button>
          ))}
        </div>

        <p className="nav-label">Điều hướng</p>
        <nav>
          {navigation.map((page) => (
            <button
              key={page.id}
              className={`nav-item ${page.id === selected.id ? 'active' : ''}`}
              onClick={() => changePage(page.id)}
              aria-current={page.id === selected.id ? 'page' : undefined}
            >
              {icon(page.icon)}
              <span>{page.title}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <strong>🚨 Hỗ trợ khẩn cấp 24/7</strong>
          <span>Nguy hiểm tính mạng, gọi ngay:</span>
          <span>
            <strong className="hotlines">113 (Công an) · 114 (Cứu hỏa) · 115 (Cấp cứu)</strong>
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Đóng trình đơn' : 'Mở trình đơn'}
            >
              ☰
            </button>
            <div className="topbar-breadcrumb">
              <span className="breadcrumb-workspace">{workspaceLabels[workspace]}</span>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-page">{selected.title}</span>
            </div>
          </div>

          <div className="top-actions">
            {user ? (
              <button
                type="button"
                className="user-profile profile-trigger"
                onClick={() => { changeWorkspace('citizen'); setPageId('account'); }}
                aria-label="Mở tài khoản của tôi"
              >
                <span className="user-avatar" aria-hidden="true">
                  {user.display_name ? user.display_name.trim().charAt(0).toUpperCase() : 'U'}
                </span>
                <span className="user-info">
                  <span className="user-name">{user.display_name}</span>
                  <span className="user-role-badge">{label(user.grants[0]?.role_code || 'CITIZEN')}</span>
                </span>
              </button>
            ) : (
              <div className="guest-actions">
                <span className="guest-badge">Khách vãng lai</span>
                <button className="button" onClick={() => setShowAuthModal(true)}>
                  Đăng nhập
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content">
          <div className="heading">
            <div>
              <span className="eyebrow">HỆ THỐNG RELIVA</span>
              <h1>{selected.title}</h1>
              <p>
                {selected.note ||
                  'Thông tin được cập nhật từ dịch vụ theo quyền và phạm vi của tài khoản.'}
              </p>
            </div>
          </div>

          {sessionState === 'loading' && (
            <div className="card" role="status">
              Đang kiểm tra phiên đăng nhập…
            </div>
          )}
          {sessionState === 'error' && (
            <div className="card notice error" role="alert">
              {sessionError}
              <button
                className="button secondary"
                style={{ marginLeft: 12 }}
                onClick={() => location.reload()}
              >
                Thử lại
              </button>
            </div>
          )}
          {logoutError && (
            <div className="notice error" role="alert">
              {logoutError}
            </div>
          )}

          {user?.must_change_password ? (
            <PasswordChange forced onChanged={setUser} />
          ) : (
            sessionState !== 'loading' &&
            sessionState !== 'error' && (
              <>
                {workspace === 'citizen' && selected.id === 'home' ? (
                  <section className="card">
                    <h2>Bạn cần hỗ trợ?</h2>
                    <p>Gửi yêu cầu SOS khi cần cứu hộ, giữ mã theo dõi sau khi máy chủ xác nhận và tra cứu tiến độ tại đây.</p>
                    <div className="action-grid">
                      <button className="button" onClick={() => changePage('sos')}>Gửi yêu cầu SOS</button>
                      <button className="button secondary" onClick={() => changePage('track')}>Theo dõi SOS</button>
                      <button className="button secondary" onClick={() => changePage('drives')}>Xem đợt quyên góp</button>
                    </div>
                  </section>
                ) : workspace === 'citizen' && selected.id === 'receipt' ? (
                  <section className="card" role="status">
                    <h2>Xác nhận tiếp nhận SOS</h2>
                    {latestReceipt ? (
                      <>
                        <p>Mã theo dõi: <strong>{latestReceipt.tracking_code}</strong></p>
                        <p>Trạng thái: {label(latestReceipt.status)} · Thời điểm: {timeLabel(latestReceipt.received_at)}</p>
                        <p>Mã bảo mật chỉ hiện một lần trên màn hình gửi SOS. Nếu đã rời màn hình đó, hãy dùng mã đã lưu để tra cứu.</p>
                        <button className="button secondary" onClick={() => changePage('track')}>Theo dõi tiến độ</button>
                      </>
                    ) : (
                      <p>Chưa có yêu cầu SOS nào được xác nhận trong phiên mở trang này. Hãy gửi yêu cầu hoặc tra cứu bằng mã theo dõi đã lưu.</p>
                    )}
                  </section>
                ) : selected.id === 'account' && !user ? (
                  <AuthRequiredNotice onOpenAuth={() => setShowAuthModal(true)} />
                ) : workspace === 'citizen' && selected.id === 'account' && user ? (
                  <CitizenAccount
                    user={user}
                    onTrack={(code) => { setSelectedTrackingCode(code); changePage('track'); }}
                    onChangePassword={() => setShowPasswordModal(true)}
                    onLogout={signOut}
                  />
                ) : workspace === 'citizen' && selected.id === 'sos' ? (
                  <SosForm user={user} onConfirmed={setLatestReceipt} />
                ) : selected.id === 'track' ? (
                  <Tracking key={selectedTrackingCode} user={user} initialCode={selectedTrackingCode} />
                ) : workspace === 'citizen' &&
                  ['drives', 'declare', 'donation'].includes(selected.id) ? (
                  <Donations page={selected.id as 'drives' | 'declare' | 'donation'} user={user} />
                ) : workspace === 'coordinator' &&
                  ['queue', 'verify', 'triage', 'assign'].includes(selected.id) ? (
                  <Coordinator key={selected.id} page={selected.id} />
                ) : workspace === 'coordinator' && selected.id === 'map' ? (
                  <CoordinatorMap />
                ) : workspace === 'coordinator' && selected.id === 'needs' && user ? (
                  <Operations page="needs" user={user} />
                ) : ['volunteer', 'coordinator'].includes(workspace) &&
                  selected.id === 'notices' ? (
                  <Notices />
                ) : ['coordinator', 'operations'].includes(workspace) &&
                  selected.id === 'campaigns' ? (
                  <Campaigns key={workspace} />
                ) : workspace === 'volunteer' ? (
                  <Volunteer key={selected.id} page={selected.id} />
                ) : workspace === 'operations' && selected.id === 'overview' ? (
                  <OperationsDashboard />
                ) : workspace === 'operations' && user ? (
                  <Operations key={selected.id} page={selected.id} user={user} />
                ) : workspace === 'admin' ? (
                  <Admin key={selected.id} page={selected.id} />
                ) : (
                  <LivePage key={`${workspace}:${selected.id}`} page={selected} user={user} />
                )}
              </>
            )
          )}
        </main>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onReady={(loggedInUser) => {
          setUser(loggedInUser);
          setLatestReceipt(null);
          setSessionState('ready');
          const defaultWs = defaultWorkspaceForUser(loggedInUser);
          setWorkspace(defaultWs);
          setPageId(allowedPages(defaultWs, loggedInUser)[0]?.id || 'home');
          setShowAuthModal(false);
        }}
      />
      {showPasswordModal && user && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Đổi mật khẩu" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close-button" aria-label="Đóng cửa sổ" onClick={() => setShowPasswordModal(false)}>✕</button>
            <PasswordChange onChanged={(updatedUser) => { setUser(updatedUser); setShowPasswordModal(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
