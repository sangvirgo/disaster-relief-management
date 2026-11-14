import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, newCommandKey } from './api/client';
import { useCursorNav, LIST_PAGE_SIZE } from './api/useCursorNav';
import { ListNav } from './components/ui/Pager';
import {
  changePassword,
  googleLogin,
  login,
  logout,
  me,
  register,
  resendEmailOtp,
  roles,
  verifyEmail,
  type Me,
} from './auth/session';
import {
  allowedPages,
  allowedWorkspaces,
  pages,
  workspaceLabels,
  workspaceRoleCodes,
  type Page,
  type Workspace,
} from './app/catalog';
import { useUrlView } from './app/useUrlView';
import { assetViews, donationViews, intakeSteps, missionViews, noticeViews, reportViews, reviewViews } from './app/routeViews';
import { label, requestStatusLabel, timeLabel } from './i18n/labels';
import { CitizenAccount, CitizenRequests, requestStatusTone } from './features/citizen/CitizenAccount';
import { clearAllSosDrafts } from './features/citizen/sosDraft';
import type { components as ResponseComponents } from './api/generated/response';
import './style.css';
import { StatusBadge } from './components/StatusBadge';
import { DetailSurface } from './components/DetailSurface';
import { PageHeader } from './components/ui/PageHeader';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}
import './sos.css';
import './workflow.css';
import './refinements.css';
import './styles/tokens.css';
import './components/ui/Badge.css';
import './components/ui/PageHeader.css';
import './styles/layout.css';
import './features/citizen/sos-page.css';

const commonPasswords = new Set([
  'password123', 'password1', '1234567890', 'qwerty1234', 'qwertyuiop', 'letmein123', 'iloveyou', 'welcome123',
  'admin12345', 'abc1234567', '1111111111', '0000000000', 'changeme123', 'monkey12345', 'dragon12345',
  'football1', 'sunshine123', 'princess123', 'trustno123', 'password!', 'passw0rd123', 'p@ssword123',
]);

const SosForm = React.lazy(() => import('./features/citizen/SosForm').then((module) => ({ default: module.SosForm })));
const Donations = React.lazy(() => import('./features/citizen/Donations').then((module) => ({ default: module.Donations })));
const TrackingActions = React.lazy(() => import('./features/citizen/TrackingActions').then((module) => ({ default: module.TrackingActions })));
const Coordinator = React.lazy(() => import('./features/coordinator/Coordinator').then((module) => ({ default: module.Coordinator })));
const CoordinatorMap = React.lazy(() => import('./features/coordinator/Coordinator').then((module) => ({ default: module.CoordinatorMap })));
const Campaigns = React.lazy(() => import('./features/coordinator/Campaigns').then((module) => ({ default: module.Campaigns })));
const Notices = React.lazy(() => import('./features/volunteer/Volunteer').then((module) => ({ default: module.Notices })));
const Volunteer = React.lazy(() => import('./features/volunteer/Volunteer').then((module) => ({ default: module.Volunteer })));
const Admin = React.lazy(() => import('./features/admin/Admin').then((module) => ({ default: module.Admin })));
const CoordinatorTeams = React.lazy(() => import('./features/coordinator/CoordinatorTeams').then((module) => ({ default: module.CoordinatorTeams })));
const Operations = React.lazy(() => import('./features/operations/Operations').then((module) => ({ default: module.Operations })));
const RoleDashboard = React.lazy(() => import('./features/dashboard/RoleDashboard').then((module) => ({ default: module.RoleDashboard })));

function IntakeReview({ user }: { user: Me }) {
  const canReview = roles(user).has('REVIEWER');
  const [step, setStep] = useUrlView('step', intakeSteps, canReview && !roles(user).has('INTAKE_STAFF') ? 'review' : 'intake');
  function changeStep(next: 'intake' | 'review') {
    if (next === step) return;
    setStep(next);
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }
  return (
    <div>
      {canReview && (
        <div className="tabs" role="group" aria-label="Bước xử lý đóng góp">
          <button type="button" className={step === 'intake' ? 'active' : ''}
            aria-pressed={step === 'intake'} onClick={() => changeStep('intake')}>Tiếp nhận</button>
          <button type="button" className={step === 'review' ? 'active' : ''}
            aria-pressed={step === 'review'} onClick={() => changeStep('review')}>Duyệt và khiếu nại</button>
        </div>
      )}
      <Operations key={step} page={canReview ? step : 'intake'} user={user} />
    </div>
  );
}

class ContentErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) return (
      <div className="card notice warning" role="alert">
        <h2>Chưa tải được nội dung</h2>
        <p>Trang có thể vừa được cập nhật. Hãy tải lại để dùng phiên bản mới nhất.</p>
        <button type="button" className="button" onClick={() => window.location.reload()}>Tải lại trang</button>
      </div>
    );
    return this.props.children;
  }
}

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
  const authCard = useRef<HTMLDivElement>(null);
  const authCallbacks = useRef({ onReady, onClose });
  authCallbacks.current = { onReady, onClose };
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [googleReady, setGoogleReady] = useState(false);
  const [googleLoadError, setGoogleLoadError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [authErrors, setAuthErrors] = useState<Record<string, string>>({});
  const [authTouched, setAuthTouched] = useState<Record<string, boolean>>({});
  const [authAttempted, setAuthAttempted] = useState(false);
  function getAuthValidationErrors(): Record<string, string> {
    const invalid: Record<string, string> = {};
    if (mode === 'verify') {
      if (!otp.trim()) invalid.otp = 'Mã xác thực là bắt buộc.';
      else if (otp.length > 6 || !/^[0-9]{6}$/.test(otp.trim()))
        invalid.otp = 'Vui lòng nhập đúng mã xác thực gồm 6 chữ số.';
      return invalid;
    }
    if (mode === 'register') {
      if (!email.trim()) invalid.email = 'Email là bắt buộc.';
      else if (email.length > 254) invalid.email = 'Email không được vượt quá 254 ký tự.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
        invalid.email = 'Vui lòng nhập địa chỉ email hợp lệ để nhận mã xác thực.';
      if (!displayName.trim()) invalid.display_name = 'Họ và tên là bắt buộc.';
      else if (displayName.length > 200) invalid.display_name = 'Họ và tên không được vượt quá 200 ký tự.';
    }
    if (!username.trim()) invalid.username = 'Tên đăng nhập là bắt buộc.';
    else if (username.length > 64) invalid.username = 'Tên đăng nhập không được vượt quá 64 ký tự.';
    else if (mode === 'register' && !/^[A-Za-z0-9._-]{3,64}$/.test(username.trim()))
      invalid.username = 'Tên đăng nhập cần 3–64 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.';
    if (!password) invalid.password = 'Mật khẩu là bắt buộc.';
    else if (password.length > 256) invalid.password = 'Mật khẩu không được vượt quá 256 ký tự.';
    else if (mode === 'register' && password.length < 10)
      invalid.password = 'Mật khẩu đăng ký cần ít nhất 10 ký tự.';
    else if (mode === 'register' && password.toLocaleLowerCase('vi-VN') === username.trim().toLocaleLowerCase('vi-VN'))
      invalid.password = 'Mật khẩu phải khác tên đăng nhập.';
    else if (mode === 'register' && commonPasswords.has(password.toLowerCase()))
      invalid.password = 'Mật khẩu quá phổ biến. Hãy chọn mật khẩu riêng khó đoán.';
    return invalid;
  }
  const authValidationErrors = getAuthValidationErrors();
  const activeAuthFields = mode === 'verify' ? ['otp']
    : mode === 'register' ? ['email', 'display_name', 'username', 'password']
      : ['username', 'password'];
  const hasAuthErrors = activeAuthFields.some((field) => Boolean(authErrors[field] || authValidationErrors[field]));
  function authErrorFor(field: string, value: string) {
    return authErrors[field] || ((authAttempted || authTouched[field] || Boolean(value)) ? authValidationErrors[field] : '');
  }

  useEffect(() => {
    if (!isOpen) {
      setMode('login');
      setPassword('');
      setShowPassword(false);
      setMessage('');
      setAuthErrors({});
      setAuthTouched({});
      setAuthAttempted(false);
    }
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = authCard.current;
    card?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        authCallbacks.current.onClose();
        return;
      }
      if (event.key !== 'Tab' || !card) return;
      const controls = Array.from(card.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],iframe,[tabindex]:not([tabindex="-1"])'
      )).filter(control => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      const outside = !card.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || mode !== 'login' || !googleClientId || !googleButton.current) return;
    let cancelled = false;
    setGoogleReady(false);
    setGoogleLoadError('');
    const loadFailed = () => {
      if (!cancelled) setGoogleLoadError('Chưa tải được Google. Kiểm tra kết nối rồi tải lại trang, hoặc dùng tài khoản Reliva để đăng nhập.');
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-c48-google="true"]');
    const renderButton = () => {
      if (cancelled || !window.google || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (credential) => {
          if (cancelled || !credential.credential) return;
          setBusy(true);
          setMessage('');
          void googleLogin(credential.credential)
            .then((loggedUser) => {
              authCallbacks.current.onReady(loggedUser);
              authCallbacks.current.onClose();
            })
            .catch((error) =>
              setMessage(
                error instanceof Error ? error.message : 'Không thể đăng nhập bằng Google.'
              )
            )
            .finally(() => setBusy(false));
        },
      });
      window.google.accounts.id.renderButton(googleButton.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'vi',
        width: Math.min(400, Math.floor(googleButton.current.getBoundingClientRect().width)),
      });
      setGoogleReady(true);
      setGoogleLoadError('');
    };
    if (window.google) renderButton();
    else {
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.c48Google = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderButton, { once: true });
      script.addEventListener('error', loadFailed, { once: true });
    }
    const timeout = window.setTimeout(() => { if (!window.google) loadFailed(); }, 15000);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      script?.removeEventListener('load', renderButton);
      script?.removeEventListener('error', loadFailed);
    };
  }, [googleClientId, isOpen, mode]);

  if (!isOpen) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setAuthAttempted(true);
    const invalid = getAuthValidationErrors();
    setAuthErrors(invalid);
    if (Object.keys(invalid).length) {
      setMessage('Hãy sửa các trường được đánh dấu.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'register') {
        const result = await register(username.trim(), password, displayName.trim(), email.trim());
        setChallengeId(result.verification.challenge_id);
        setMode('verify');
        setAuthTouched({});
        setAuthAttempted(false);
        setMessage(
          result.email_sent
            ? 'Mã xác thực đã được gửi đến email. Mã có hiệu lực 5 phút.'
            : 'Tài khoản đang chờ xác thực. Chưa gửi được email; hãy kiểm tra cấu hình email rồi chọn gửi lại mã.'
        );
      } else if (mode === 'verify') {
        await verifyEmail(challengeId, otp.trim());
        setMode('login');
        setOtp('');
        setAuthTouched({});
        setAuthAttempted(false);
        setMessage('Email đã được xác thực. Bạn có thể đăng nhập.');
      } else {
        const loggedUser = await login(username.trim(), password);
        onReady(loggedUser);
        onClose();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể hoàn tất yêu cầu.');
      if (mode === 'register' && error instanceof ApiError && error.code === 'PASSWORD_WEAK') {
        setAuthErrors({ password: 'Mật khẩu cần từ 10 ký tự, khác tên đăng nhập và không phổ biến.' });
      } else if (mode === 'register' && error instanceof ApiError && error.code === 'USERNAME_TAKEN') {
        setAuthErrors({ username: 'Tên đăng nhập đã được sử dụng.' });
      } else if (mode === 'register' && error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setAuthErrors({ email: 'Địa chỉ email đã được sử dụng.' });
      } else if (error instanceof ApiError && Object.keys(error.fieldErrors).length) {
        setAuthErrors(
          Object.fromEntries(
            Object.keys(error.fieldErrors).map((name) => [name, 'Thông tin này chưa hợp lệ.'])
          )
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div ref={authCard} className="modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-button" onClick={onClose} aria-label="Đóng cửa sổ">
          ✕
        </button>
        <div className="auth-brand" aria-hidden="true">
          <span className="auth-logo-frame">
            <img src="/reliva-logo.png" alt="" />
          </span>
          <span className="auth-brand-name">reliva</span>
        </div>
        <h2 id="auth-modal-title">
          {mode === 'login'
            ? 'Đăng nhập'
            : mode === 'register'
              ? 'Tạo tài khoản'
              : mode === 'verify'
                ? 'Xác thực email'
                : 'Hỗ trợ mật khẩu'}
        </h2>
        {mode === 'help' && (
          <p className="modal-desc">
            Nếu quên mật khẩu, hãy liên hệ quản trị viên của hệ thống để xác minh tài khoản và cấp
            mật khẩu tạm. Sau khi đăng nhập, bạn phải đổi mật khẩu tạm.
          </p>
        )}
        {mode !== 'help' && (
          <form onSubmit={submit} noValidate className="form-stack">
            {mode === 'register' && (
              <label className="auth-field">
                <span>Email nhận mã xác thực <span className="required-mark" aria-hidden="true">*</span></span>
                <input
                  required
                  type="email"
                  maxLength={255}
                  aria-invalid={Boolean(authErrorFor('email', email))}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setAuthErrors((current) => ({ ...current, email: '' }));
                    setAuthTouched((current) => ({ ...current, email: true }));
                  }}
                  onBlur={() => setAuthTouched((current) => ({ ...current, email: true }))}
                  autoComplete="email"
                  placeholder="ten@example.com"
                />
                {authErrorFor('email', email) && <small className="field-error" role="alert">{authErrorFor('email', email)}</small>}
              </label>
            )}
            {mode === 'verify' && (
              <label className="auth-field">
                <span>Mã xác thực 6 chữ số <span className="required-mark" aria-hidden="true">*</span></span>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={7}
                  aria-invalid={Boolean(authErrorFor('otp', otp))}
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 7));
                    setAuthErrors((current) => ({ ...current, otp: '' }));
                    setAuthTouched((current) => ({ ...current, otp: true }));
                  }}
                  onBlur={() => setAuthTouched((current) => ({ ...current, otp: true }))}
                  autoComplete="one-time-code"
                />
                {authErrorFor('otp', otp) && <small className="field-error" role="alert">{authErrorFor('otp', otp)}</small>}
              </label>
            )}
            {mode !== 'verify' && (
              <>
                {mode === 'register' && (
                  <label className="auth-field">
                    <span>Họ và tên <span className="required-mark" aria-hidden="true">*</span></span>
                    <input
                      required
                      maxLength={201}
                      aria-invalid={Boolean(authErrorFor('display_name', displayName))}
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        setAuthErrors((current) => ({ ...current, display_name: '' }));
                        setAuthTouched((current) => ({ ...current, display_name: true }));
                      }}
                      onBlur={() => setAuthTouched((current) => ({ ...current, display_name: true }))}
                      autoComplete="name"
                      placeholder="Nguyễn Văn A"
                    />
                    {authErrorFor('display_name', displayName) && (
                      <small className="field-error" role="alert">{authErrorFor('display_name', displayName)}</small>
                    )}
                  </label>
                )}
                <label className="auth-field">
                  <span>Tên đăng nhập <span className="required-mark" aria-hidden="true">*</span></span>
                  <input
                    required
                    maxLength={65}
                    aria-invalid={Boolean(authErrorFor('username', username))}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setAuthErrors((current) => ({ ...current, username: '' }));
                      setAuthTouched((current) => ({ ...current, username: true }));
                    }}
                    onBlur={() => setAuthTouched((current) => ({ ...current, username: true }))}
                    autoComplete="username"
                    placeholder="Nhập tên đăng nhập"
                  />
                  {authErrorFor('username', username) && (
                    <small className="field-error" role="alert">{authErrorFor('username', username)}</small>
                  )}
                </label>
              </>
            )}
            {mode !== 'verify' && (
              <label className="auth-field">
                <span>Mật khẩu <span className="required-mark" aria-hidden="true">*</span></span>
                <span className="auth-password-field">
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    minLength={mode === 'register' ? 10 : undefined}
                    maxLength={257}
                    aria-invalid={Boolean(authErrorFor('password', password))}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setAuthErrors((current) => ({ ...current, password: '' }));
                      setAuthTouched((current) => ({ ...current, password: true }));
                    }}
                    onBlur={() => setAuthTouched((current) => ({ ...current, password: true }))}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'register' ? 'Tối thiểu 10 ký tự' : 'Nhập mật khẩu'}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-pressed={showPassword}
                  >
                    <svg className="password-peek-icon" viewBox="0 0 44 36" fill="none" aria-hidden="true">
                      <path d="M10 7Q22 1 34 7L37 25Q22 34 7 25Z" fill="#DBEDFF" stroke="#3263A8" strokeWidth="1.5" />
                      <path d="M15 11L18 9M27 9L30 11" stroke="#3263A8" strokeWidth="1.5" strokeLinecap="round" />
                      {showPassword ? <>
                        <ellipse cx="16" cy="18" rx="4" ry="5" fill="white" stroke="#3263A8" strokeWidth="1.2" />
                        <ellipse cx="28" cy="18" rx="4" ry="5" fill="white" stroke="#3263A8" strokeWidth="1.2" />
                        <circle cx={16 + (password.length % 5 - 2) * 0.7} cy="19" r="1.7" fill="#173A70" />
                        <circle cx={28 + (password.length % 5 - 2) * 0.7} cy="19" r="1.7" fill="#173A70" />
                        <path d="M19 26Q22 28 25 26" stroke="#3263A8" strokeWidth="1.3" strokeLinecap="round" />
                      </> : <>
                        <path d="M11 18L18 21M26 21L33 18" stroke="#3263A8" strokeWidth="2" strokeLinecap="round" />
                        <path d="M3 20Q7 14 13 18L18 21L15 29Q8 30 3 25Z" fill="#F7C8A9" stroke="#B87966" strokeWidth="1.2" />
                        <path d="M41 20Q37 14 31 18L26 21L29 29Q36 30 41 25Z" fill="#F7C8A9" stroke="#B87966" strokeWidth="1.2" />
                      </>}
                    </svg>
                  </button>
                </span>
                {authErrorFor('password', password) && (
                  <small className="field-error" role="alert">{authErrorFor('password', password)}</small>
                )}
              </label>
            )}
            {message && (
              <p
                role={/thành công|đã được xác thực|đã gửi/i.test(message) ? 'status' : 'alert'}
                className={`notice ${/thành công|đã được xác thực|đã gửi/i.test(message) ? 'success' : 'error'}`}
              >
                {message}
              </p>
            )}
            <button disabled={busy || hasAuthErrors} className="button" type="submit">
              {busy
                ? 'Đang xử lý…'
                : mode === 'login'
                  ? 'Đăng nhập'
                  : mode === 'verify'
                    ? 'Xác thực email'
                    : 'Tạo tài khoản'}
            </button>
            {mode === 'verify' && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void resendEmailOtp(challengeId)
                    .then((result) => {
                      if (result.challenge_id) setChallengeId(result.challenge_id);
                      setMessage(
                        result.email_sent
                          ? 'Mã mới đã được gửi.'
                          : 'Nếu tài khoản đang chờ xác thực, hệ thống sẽ gửi mã khi email được cấu hình.'
                      );
                    })
                    .catch((error) =>
                      setMessage(error instanceof Error ? error.message : 'Chưa gửi lại được mã.')
                    )
                }
              >
                Gửi lại mã xác thực
              </button>
            )}
          </form>
        )}
        {mode === 'login' && googleClientId && (
          <div className="google-auth-wrap">
            <span className="auth-divider">hoặc tiếp tục với</span>
            {!googleReady && !googleLoadError && <p role="status">Đang tải nút đăng nhập Google…</p>}
            {googleLoadError && <p className="notice warning" role="alert">{googleLoadError}</p>}
            <div
              className="google-auth-button"
              ref={googleButton}
              aria-label="Đăng nhập bằng Google"
            />
          </div>
        )}
        <div className="modal-footer">
          {mode === 'login' && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode('help');
                setShowPassword(false);
                setMessage('');
              }}
            >
              Quên mật khẩu?
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setUsername('');
              setPassword('');
              setShowPassword(false);
              setMessage('');
              setAuthErrors({});
              setAuthTouched({});
              setAuthAttempted(false);
            }}
          >
            {mode === 'login' ? 'Chưa có tài khoản? Đăng ký ngay' : 'Quay lại đăng nhập'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordChange({
  onChanged,
  forced = false,
}: {
  onChanged: (user: Me) => void;
  forced?: boolean;
}) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const oldPasswordError = !oldPassword ? 'Mật khẩu hiện tại là bắt buộc.'
    : oldPassword.length > 256 ? 'Mật khẩu hiện tại không được vượt quá 256 ký tự.' : '';
  const newPasswordError = !newPassword ? 'Mật khẩu mới là bắt buộc.'
    : newPassword.length < 10 ? 'Mật khẩu mới cần ít nhất 10 ký tự.'
      : newPassword.length > 256 ? 'Mật khẩu mới không được vượt quá 256 ký tự.' : '';
  const hasInvalidFields = Boolean(oldPasswordError || newPasswordError);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched({ oldPassword: true, newPassword: true });
    if (hasInvalidFields) return;
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
      <p>
        {forced
          ? 'Tài khoản vừa đăng nhập bằng mật khẩu tạm. Vui lòng cập nhật mật khẩu mới để tiếp tục.'
          : 'Nhập mật khẩu hiện tại và mật khẩu mới để bảo vệ tài khoản của bạn.'}
      </p>

      {!forced && (
        <p className="notice">
          Biểu mẫu này chỉ đổi mật khẩu Reliva. Không nhập mật khẩu Google tại đây.
          Nếu bạn chỉ đăng nhập bằng Google và chưa có mật khẩu Reliva, hãy tiếp tục dùng
          nút Đăng nhập bằng Google; biểu mẫu này không tạo mật khẩu Reliva mới cho bạn.
        </p>
      )}

      <div className="notice" style={{ fontSize: 13, marginBottom: 14 }}>
        💡 <strong>Quy chuẩn mật khẩu mới:</strong> Tối thiểu 10 ký tự, khác tên đăng nhập và khác
        mật khẩu hiện tại (Ví dụ: <code>MatKhauRieng!2026</code>).
      </div>

      <form className="form-stack" onSubmit={submit} noValidate>
        <label>
          <span>Mật khẩu hiện tại{forced ? ' (mật khẩu tạm)' : ''} <span className="required-mark" aria-hidden="true">*</span></span>
          <input
            type="password"
            required
            maxLength={257}
            aria-invalid={Boolean(touched.oldPassword && oldPasswordError)}
            value={oldPassword}
            onChange={(e) => {
              setOldPassword(e.target.value);
              setTouched((current) => ({ ...current, oldPassword: true }));
            }}
            onBlur={() => setTouched((current) => ({ ...current, oldPassword: true }))}
            autoComplete="current-password"
            placeholder="Nhập mật khẩu Reliva hiện tại"
          />
          {touched.oldPassword && oldPasswordError && <small className="field-error" role="alert">{oldPasswordError}</small>}
        </label>
        <label>
          <span>Mật khẩu mới <span className="required-mark" aria-hidden="true">*</span></span>
          <input
            type="password"
            required
            minLength={10}
            maxLength={257}
            aria-invalid={Boolean(touched.newPassword && newPasswordError)}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setTouched((current) => ({ ...current, newPassword: true }));
            }}
            onBlur={() => setTouched((current) => ({ ...current, newPassword: true }))}
            autoComplete="new-password"
            placeholder="Tối thiểu 10 ký tự (Ví dụ: MatKhauRieng!2026)"
          />
          {touched.newPassword && newPasswordError && <small className="field-error" role="alert">{newPasswordError}</small>}
        </label>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <button className="button" disabled={busy || hasInvalidFields} type="submit" style={{ flex: 1 }}>
            {busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Tracking({
  user,
  initialCode = '',
  onSelectOwned,
  onBack,
  onNewSos,
}: {
  user: Me | null;
  initialCode?: string;
  onSelectOwned: (code: string) => void;
  onBack: () => void;
  onNewSos: () => void;
}) {
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
  const [manualMode, setManualMode] = useState(false);
  const [lookupTouched, setLookupTouched] = useState<Record<string, boolean>>({});
  const [lookupAttempted, setLookupAttempted] = useState(false);
  const [recoveryTouched, setRecoveryTouched] = useState(false);
  const codeError = !code.trim() ? 'Mã theo dõi là bắt buộc.'
    : code.trim().length > 10 ? 'Mã theo dõi không được vượt quá 10 ký tự.'
      : !/^[0-9A-HJKMNP-TV-Z]{10}$/i.test(code.trim()) ? 'Mã theo dõi cần gồm 10 ký tự hợp lệ.' : '';
  const secretError = !user && !secret.trim() ? 'Mã bảo mật là bắt buộc.'
    : secret.length > 43 ? 'Mã bảo mật không được vượt quá 43 ký tự.'
      : secret.trim() && !/^[A-Za-z0-9_-]{43}$/.test(secret.trim()) ? 'Mã bảo mật cần gồm 43 ký tự hợp lệ.' : '';
  const recoveryError = !recoveryCode.trim() ? 'Mã khôi phục một lần là bắt buộc.'
    : recoveryCode.length > 43 ? 'Mã khôi phục không được vượt quá 43 ký tự.'
      : !/^[A-Za-z0-9_-]{43}$/.test(recoveryCode.trim()) ? 'Mã khôi phục không đúng định dạng.' : '';
  const lookupInvalid = Boolean(codeError || secretError);
  useEffect(() => {
    if (!user || !initialCode.trim()) return;
    let active = true;
    const version = ++lookupVersion.current;
    const credentials = { code: initialCode.trim(), secret: '' };
    setBusy(true);
    api<ResponseComponents['schemas']['ReporterTracking']>('response', '/requests/track', {
      headers: { 'X-Tracking-Code': credentials.code },
    })
      .then((result) => {
        if (!active || version !== lookupVersion.current) return;
        setVerified(credentials);
        setData(result);
      })
      .catch((cause) => {
        if (!active || version !== lookupVersion.current) return;
        setError(cause instanceof Error ? cause.message : 'Không thể tải tiến độ yêu cầu.');
      })
      .finally(() => {
        if (active && version === lookupVersion.current) setBusy(false);
      });
    return () => { active = false; };
  }, [initialCode, user?.id]);
  async function refreshTracking(credentials = verified) {
    if (!credentials) return;
    const version = lookupVersion.current;
    const result = await api<ResponseComponents['schemas']['ReporterTracking']>(
      'response',
      '/requests/track',
      {
        headers: {
          'X-Tracking-Code': credentials.code,
          ...(credentials.secret ? { 'X-Tracking-Secret': credentials.secret } : {}),
        },
      }
    );
    if (version === lookupVersion.current) {
      setVerified(credentials);
      setData(result);
    }
  }
  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    setLookupAttempted(true);
    if (lookupInvalid) return;
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
    setRecoveryTouched(true);
    if (codeError || recoveryError) return;
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
      setRecoveryTouched(false);
      setSecret('');
      invalidateLookup();
      setRecoveryMessage('Yêu cầu đã được gắn với tài khoản. Hãy tra cứu lại bằng mã theo dõi.');
    } catch (cause) {
      setRecoveryMessage(cause instanceof Error ? cause.message : 'Chưa khôi phục được yêu cầu.');
    } finally {
      setBusy(false);
    }
  }
  if (user && !initialCode && !manualMode)
    return (
      <CitizenRequests
        user={user}
        onTrack={onSelectOwned}
        onNewSos={onNewSos}
        onManualLookup={() => setManualMode(true)}
      />
    );

  return (
    <div className="tracking-layout">
      {(!user || manualMode) && (
        <section className="card tracking-lookup-card">
          {user && (
            <button className="tracking-back" type="button" onClick={() => setManualMode(false)}>
              <span aria-hidden="true">←</span> Quay lại danh sách
            </button>
          )}
          <h2>Tra cứu SOS bằng mã</h2>
          <p>
            Nhập mã theo dõi đã nhận khi gửi SOS. Nếu gửi khi chưa đăng nhập, nhập thêm mã bảo mật.
          </p>
          <form onSubmit={lookup} className="form-stack" noValidate>
          <label>
            <span>Mã theo dõi <span className="required-mark" aria-hidden="true">*</span></span>
            <input
              required
              name="tracking_code"
              maxLength={11}
              aria-invalid={Boolean((lookupAttempted || lookupTouched.code) && codeError)}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setLookupTouched((current) => ({ ...current, code: true }));
                recoveryKey.current = null;
                invalidateLookup();
              }}
              onBlur={() => setLookupTouched((current) => ({ ...current, code: true }))}
              autoComplete="off"
            />
            {(lookupAttempted || lookupTouched.code) && codeError && <small className="field-error" role="alert">{codeError}</small>}
          </label>
          <label>
            <span>Mã bảo mật {user ? '(nếu chưa gắn với tài khoản)' : ''}{!user && <> <span className="required-mark" aria-hidden="true">*</span></>}</span>
            <input
              required={!user}
              type="password"
              name="tracking_secret"
              maxLength={44}
              aria-invalid={Boolean((lookupAttempted || lookupTouched.secret) && secretError)}
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setLookupTouched((current) => ({ ...current, secret: true }));
                invalidateLookup();
              }}
              onBlur={() => setLookupTouched((current) => ({ ...current, secret: true }))}
              autoComplete="new-password"
            />
            {(lookupAttempted || lookupTouched.secret) && secretError && <small className="field-error" role="alert">{secretError}</small>}
          </label>
          <button className="button" disabled={busy || lookupInvalid}>
            {busy ? 'Đang tra cứu…' : 'Xem tiến độ'}
          </button>
          </form>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {user && (
          <details className="tracking-recovery">
            <summary>Khôi phục SOS cũ vào tài khoản</summary>
          <form className="form-stack command-form" onSubmit={recover} noValidate>
            <h3>Khôi phục quyền theo dõi</h3>
            <p>
              Nhập mã một lần do điều phối viên cấp sau khi xác minh liên hệ. Mã theo dõi ở biểu mẫu
              phía trên cũng được dùng tại đây.
            </p>
            <label>
              <span>Mã khôi phục một lần <span className="required-mark" aria-hidden="true">*</span></span>
              <input
                required
                maxLength={44}
                aria-invalid={Boolean(recoveryTouched && recoveryError)}
                value={recoveryCode}
                onChange={(event) => {
                  setRecoveryCode(event.target.value);
                  setRecoveryTouched(true);
                  recoveryKey.current = null;
                }}
                onBlur={() => setRecoveryTouched(true)}
                autoComplete="off"
              />
              {recoveryTouched && recoveryError && <small className="field-error" role="alert">{recoveryError}</small>}
            </label>
            <button className="button secondary" disabled={busy || lookupInvalid || Boolean(recoveryError)}>
              Gắn yêu cầu với tài khoản
            </button>
            {recoveryMessage && (
              <p className="notice" role="status">
                {recoveryMessage}
              </p>
            )}
          </form>
          </details>
        )}
      </section>
      )}
      {user && initialCode && !data && (
        <section className="card tracking-progress-card">
          <button className="tracking-back" type="button" onClick={onBack}>
            <span aria-hidden="true">←</span> Quay lại danh sách
          </button>
          {error ? <p role="alert" className="notice error">{error}</p> : <p role="status">Đang tải tiến độ SOS…</p>}
        </section>
      )}
      {data && (
        <section className="card tracking-progress-card">
          {user && initialCode && (
            <button className="tracking-back" type="button" onClick={onBack}>
              <span aria-hidden="true">←</span> Quay lại danh sách
            </button>
          )}
          <h2>Tiến độ SOS {text(data.tracking_code)}</h2>
          <span className={`chip request-status request-status--${requestStatusTone(data.status)}`}>
            {requestStatusLabel(data.status)}
          </span>
          <p>Tiếp nhận lúc: {timeLabel(data.received_at)}</p>
          {data.status === 'DUPLICATE' && data.duplicate_of_code && (
            <p className="notice">Yêu cầu này trùng với hồ sơ {data.duplicate_of_code}. Nếu hồ sơ gốc thuộc tài khoản của bạn, hãy quay lại danh sách để xem tiến độ hồ sơ đó.</p>
          )}
          {data.status === 'REJECTED' && data.rejection_reason && (
            <p className="notice">Lý do từ chối: {data.rejection_reason}</p>
          )}
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

function RecordCard({ item, onOpen, clickable = false }: { item: Record<string, unknown>; onOpen?: () => void; clickable?: boolean }) {
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
    text(item.username) ||
    text(item.address_note);
  const status = text(item.status) || text(item.review_lane);
  const time = item.received_at || item.created_at || item.starts_at || item.generated_at;
  const content = <>
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
        {status && <StatusBadge status={status} />}
        {onOpen && !clickable && (
          <button className="button secondary" onClick={onOpen}>
            Xem chi tiết
          </button>
        )}
      </div>
    </>;
  return clickable && onOpen ? (
    <article className="record record-clickable" role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}
      aria-label={`Xem chiến dịch ${title.trim()}`} aria-haspopup="dialog">
      {content}
    </article>
  ) : <article className="record">{content}</article>;
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

function PublicCampaignDialog({ campaign, onClose }: { campaign: Record<string, unknown>; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [closing, setClosing] = useState(false);
  function closeDialog() { setClosing(true); window.setTimeout(() => dialogRef.current?.close(), 180); }
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={dialogRef} className={`campaign-public-dialog ${closing ? 'is-closing' : ''}`} aria-label="Chi tiết chiến dịch" onClose={onClose} onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <div className="campaign-dialog-header">
        <div><span className="eyebrow">CHIẾN DỊCH CỨU TRỢ</span><h2>{text(campaign.title) || 'Chiến dịch cứu trợ'}</h2></div>
        <button type="button" className="modal-close-button" aria-label="Đóng chi tiết chiến dịch" onClick={closeDialog}>×</button>
      </div>
      <p className="campaign-dialog-objective">{text(campaign.objective) || 'Chưa có mô tả mục tiêu.'}</p>
      <dl className="fact-list">
        <div><dt>Trạng thái</dt><dd><StatusBadge status={text(campaign.status) || ''} /></dd></div>
        <div><dt>Bắt đầu</dt><dd>{campaign.starts_at ? timeLabel(campaign.starts_at) : 'Chưa ấn định'}</dd></div>
        <div><dt>Kết thúc</dt><dd>{campaign.ends_at ? timeLabel(campaign.ends_at) : 'Chưa ấn định'}</dd></div>
      </dl>
    </dialog>
  );
}

function LivePage({ page, user }: { page: Page; user: Me | null }) {
  const [data, setData] = useState<DataPage | null>(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string | null>(null);
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [selectedPublicCampaign, setSelectedPublicCampaign] = useState<Record<string, unknown> | null>(null);
  function openDetail(item: Record<string, unknown>): void {
    const id = text(item.id);
    if (!id) return;
    if (page.path === '/public/campaigns') setSelectedPublicCampaign(item);
    else if (page.service === 'response' && page.path?.startsWith('/requests'))
      setDetailPath(`/requests/${encodeURIComponent(id)}`);
    else if (page.service === 'response' && page.path === '/missions/mine')
      setDetailPath(`/missions/${encodeURIComponent(id)}`);
    else if (page.service === 'identity' && page.path === '/users')
      setDetailPath(`/users/${encodeURIComponent(id)}`);
  }
  const canOpen =
    page.path === '/public/campaigns' ||
    (page.service === 'response' &&
      (page.path?.startsWith('/requests') || page.path === '/missions/mine')) ||
    (page.service === 'identity' && page.path === '/users');
  const isResponseSummary = page.service === 'response' && page.path === '/reports/summary';
  useEffect(() => {
    if (!page.service || !page.path) return;
    let active = true;
    setLoading(true);
    setError('');
    setForbidden(false);
    const now = new Date();
    const summaryWindow = new URLSearchParams({
      from: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      to: now.toISOString(),
    });
    const load = async (): Promise<DataPage> => {
      if (isResponseSummary) return api<DataPage>('response', `/reports/summary?${summaryWindow}`);
      const path = page.path! + `${page.path!.includes('?') ? '&' : '?'}limit=${LIST_PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      return api<DataPage>(page.service!, path);
    };
    load()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.');
          setForbidden(cause instanceof ApiError && cause.status === 403);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, cursor, user, isResponseSummary]);
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
        <div>
          <span className="eyebrow">Số liệu trực tiếp</span>
          <h2>{page.path === '/reports/summary' ? 'Tổng quan ứng cứu' : page.id === 'campaigns' ? 'Danh sách chiến dịch' : page.title}</h2>
        </div>
        {page.path === '/reports/summary' && <span className="report-period">7 ngày gần đây</span>}
      </div>
      {page.note && page.path !== '/reports/summary' && <p>{page.note}</p>}
      {page.path === '/reports/summary' && (
        <>
          <p className="muted">Xem SOS trên bản đồ và số liệu trong phạm vi được cấp quyền của tài khoản.</p>
          <div className="report-heatmap"><CoordinatorMap /></div>
        </>
      )}
      {loading && <p role="status">Đang tải dữ liệu…</p>}
      {error && (
        <div role="alert" className="notice error">
          {error}
          {forbidden && (
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
                    clickable={page.path === '/public/campaigns'}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">Chưa có bản ghi nào trong phạm vi của bạn.</div>
            )
          ) : 'status_counts' in data ? (
            <div className="report-content">
              <div className="report-metrics">
                <div className="metric-tile">
                  <span>Nhiệm vụ đang hoạt động</span>
                  <strong>{data.active_missions ?? 0}</strong>
                  <small>Đội đang thực hiện</small>
                </div>
                <div className="metric-tile metric-tile-warning">
                  <span>Nhiệm vụ quá hạn</span>
                  <strong>{data.overdue_missions ?? 0}</strong>
                  <small>Cần theo dõi</small>
                </div>
                <div className="metric-tile metric-tile-green">
                  <span>Tổng yêu cầu</span>
                  <strong>
                    {Object.values(data.status_counts || {}).reduce((sum, count) => sum + count, 0)}
                  </strong>
                  <small>Trong phạm vi được cấp quyền</small>
                </div>
              </div>
              <div className="report-breakdown">
                <h3>Yêu cầu theo trạng thái</h3>
                <p>Mỗi trạng thái là một nhóm riêng trong báo cáo.</p>
                <div className="report-status-grid">
                  {Object.entries(data.status_counts || {}).map(([key, value]) => (
                    <div className="report-status" key={key}>
                      <span>{label(key)}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                {!Object.keys(data.status_counts || {}).length && (
                  <div className="empty">Chưa có yêu cầu trong khoảng thời gian này.</div>
                )}
              </div>
              {Boolean(data.priority_counts && Object.keys(data.priority_counts).length) && (
                <div className="report-breakdown">
                  <h3>Mức ưu tiên đã quyết định</h3>
                  <div className="report-status-grid">
                    {Object.entries(data.priority_counts || {}).map(([key, value]) => (
                      <div className="report-status" key={key}>
                        <span>{label(key)}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
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
          {page.path === '/public/campaigns' && selectedPublicCampaign && (
            <PublicCampaignDialog campaign={selectedPublicCampaign} onClose={() => setSelectedPublicCampaign(null)} />
          )}
          <ListNav page={pageIndex} hasNext={Boolean(data.next_cursor || (data.more && data.cursor))} loading={loading} onPrev={prevPage} onNext={() => setCursor(data.next_cursor || data.cursor || null)} count={data.items?.length || 0} />
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

function routeFromUrl(url = new URL(window.location.href)): { workspace: Workspace; page: string } | null {
  const params = url.searchParams;
  const workspace = params.get('workspace');
  const page = params.get('page');
  if (!workspace || !Object.prototype.hasOwnProperty.call(pages, workspace)) return null;
  return { workspace: workspace as Workspace, page: page || '' };
}

function permittedRoute(user: Me | null, requested: ReturnType<typeof routeFromUrl>) {
  const fallbackWorkspace = defaultWorkspaceForUser(user);
  const fallbackPage = allowedPages(fallbackWorkspace, user)[0]?.id || 'sos';
  if (!requested || !allowedWorkspaces(user).includes(requested.workspace)) {
    return { workspace: fallbackWorkspace, page: fallbackPage };
  }
  if (requested.page === 'account' && user) return requested;
  if (allowedPages(requested.workspace, user).some((page) => page.id === requested.page)) return requested;
  return { workspace: requested.workspace, page: allowedPages(requested.workspace, user)[0]?.id || fallbackPage };
}

function normalizeSubview(url: URL, workspace: Workspace, page: string, user: Me | null) {
  const allowedViews: readonly string[] = workspace === 'citizen' && page === 'drives' ? donationViews
    : (workspace === 'volunteer' || workspace === 'coordinator') && page === 'notices' ? noticeViews
    : workspace === 'volunteer' && page === 'missions' ? missionViews
    : workspace === 'operations' && page === 'assets' ? assetViews
    : workspace === 'operations' && page === 'reports' ? reportViews
    : workspace === 'operations' && page === 'intake' && roles(user).has('REVIEWER')
      && (url.searchParams.get('step') === 'review' || (!url.searchParams.has('step') && !roles(user).has('INTAKE_STAFF'))) ? reviewViews : [];
  if (!allowedViews.includes(url.searchParams.get('view') || '')) url.searchParams.delete('view');
  if (!(workspace === 'operations' && page === 'intake' && roles(user).has('REVIEWER')
    && (intakeSteps as readonly string[]).includes(url.searchParams.get('step') || ''))) url.searchParams.delete('step');
}

function writeRoute(workspace: Workspace, page: string, user: Me | null, mode: 'push' | 'replace' = 'push') {
  const url = new URL(window.location.href);
  const changed = url.searchParams.get('workspace') !== workspace || url.searchParams.get('page') !== page;
  url.searchParams.set('workspace', workspace);
  url.searchParams.set('page', page);
  if (changed) {
    url.hash = '';
    url.searchParams.delete('view');
    url.searchParams.delete('step');
  } else {
    normalizeSubview(url, workspace, page, user);
  }
  if (url.href === window.location.href) return;
  window.history[changed && mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
}

function App() {
  const [user, setUser] = useState<Me | null>(null);
  const [sessionState, setSessionState] = useState<'loading' | 'guest' | 'ready' | 'error'>(
    'loading'
  );
  const [sessionError, setSessionError] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>('citizen');
  const [pageId, setPageId] = useState('sos');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const wsMenuRef = useRef<HTMLDivElement>(null);
  const [prevWorkspace, setPrevWorkspace] = useState<Workspace | null>(() => {
    try { return sessionStorage.getItem('c48:prev-workspace') as Workspace | null; } catch { return null; }
  });
  useEffect(() => {
    if (!wsMenuOpen) return;
    const close = (event: MouseEvent) => { if (!wsMenuRef.current?.contains(event.target as Node)) setWsMenuOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setWsMenuOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [wsMenuOpen]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedTrackingCode, setSelectedTrackingCode] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [sharingTeamId, setSharingTeamId] = useState('');
  const [sharingMessage, setSharingMessage] = useState('');
  const sessionChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionGenerationRef = useRef(0);
  const pendingRouteRef = useRef<string | null>(null);

  function notifyOtherTabs(change: 'signed-in' | 'signed-out' | 'expired') {
    sessionChannelRef.current?.postMessage(change);
  }

  function resetSession(openLogin = false) {
    clearAllSosDrafts();
    try {
      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith('c48:coordinator-queue:') || key?.startsWith('c48:citizen-tracking:')) window.sessionStorage.removeItem(key);
      }
    } catch {
      // Session cleanup still completes if browser storage is unavailable.
    }
    sessionGenerationRef.current += 1;
    pendingRouteRef.current = null;
    setUser(null);
    setSessionState('guest');
    setWorkspace('citizen');
    setPageId('sos');
    writeRoute('citizen', 'sos', null, 'replace');
    setSelectedTrackingCode('');
    setSelectedMissionId('');
    setSelectedRequestId('');
    setSharingTeamId('');
    setSharingMessage('');
    setShowPasswordModal(false);
    setProfileMenuOpen(false);
    setMenuOpen(false);
    setShowAuthModal(openLogin);
  }

  function routeAfterLogin(value: Me, preferRoleDefault = false) {
    const pendingUrl = pendingRouteRef.current && !preferRoleDefault ? new URL(pendingRouteRef.current) : null;
    const requested = pendingUrl ? routeFromUrl(pendingUrl) : preferRoleDefault ? null : routeFromUrl();
    const route = permittedRoute(value, requested);
    setWorkspace(route.workspace);
    setPageId(route.page);
    writeRoute(route.workspace, route.page, value, 'replace');
    try {
      const saved = !preferRoleDefault && route.workspace === 'citizen' && route.page === 'track'
        ? sessionStorage.getItem(`c48:citizen-tracking:${value.id}`) || '' : '';
      setSelectedTrackingCode(/^[A-Z0-9]{10}$/.test(saved) ? saved : '');
    } catch { setSelectedTrackingCode(''); }
    if (pendingUrl && requested?.workspace === route.workspace && requested.page === route.page) {
      const url = new URL(window.location.href);
      for (const key of ['step', 'view']) {
        const parameter = pendingUrl.searchParams.get(key);
        if (parameter) url.searchParams.set(key, parameter);
      }
      normalizeSubview(url, route.workspace, route.page, value);
      window.history.replaceState(null, '', url);
    }
    pendingRouteRef.current = null;
  }

  useEffect(() => {
    const onExpired = () => {
      if (!user) return;
      resetSession(true);
      setSessionError('Phiên đã hết hạn. Vui lòng đăng nhập lại.');
      notifyOtherTabs('expired');
    };
    window.addEventListener('c48:session-expired', onExpired);
    return () => window.removeEventListener('c48:session-expired', onExpired);
  }, [user]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('c48-web-session');
    sessionChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'signed-out' || event.data === 'expired') {
        resetSession(event.data === 'expired');
        return;
      }
      if (event.data !== 'signed-in') return;
      const generation = ++sessionGenerationRef.current;
      setSessionState('loading');
      void me()
        .then((value) => {
          if (generation !== sessionGenerationRef.current) return;
          setUser(value);
          setSessionState('ready');
          setSessionError('');
          setShowAuthModal(false);
          setShowPasswordModal(false);
          setProfileMenuOpen(false);
          setMenuOpen(false);
          routeAfterLogin(value);
          setSelectedTrackingCode('');
          setSelectedMissionId('');
          setSelectedRequestId('');
          setSharingTeamId('');
        })
        .catch((cause) => {
          if (generation !== sessionGenerationRef.current) return;
          if (cause instanceof ApiError && cause.status === 401) {
            resetSession();
          } else {
            resetSession();
            setSessionError(cause instanceof Error ? cause.message : 'Không thể kiểm tra phiên.');
            setSessionState('error');
          }
        });
    };
    return () => { channel.close(); sessionChannelRef.current = null; };
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.profile-menu-wrap')) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setProfileMenuOpen(false); };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeMenu); document.removeEventListener('keydown', closeOnEscape); };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!sharingTeamId || !user) return;
    let active = true;
    let sending = false;
    const sendPosition = () => {
      if (!active || sending || document.visibilityState !== 'visible') return;
      if (!navigator.geolocation) { setSharingMessage('Trình duyệt không hỗ trợ chia sẻ vị trí.'); setSharingTeamId(''); return; }
      sending = true;
      navigator.geolocation.getCurrentPosition(async ({ coords, timestamp }) => {
        if (!active) { sending = false; return; }
        try {
          await api('response', `/teams/${encodeURIComponent(sharingTeamId)}/position`, {
            method: 'PUT',
            body: { location: { type: 'Point', coordinates: [coords.longitude, coords.latitude], source: 'GPS' },
              captured_at: new Date(timestamp).toISOString(), accuracy_m: coords.accuracy },
          });
          if (active) setSharingMessage('Đã gửi vị trí đội cứu hộ. Sẽ tự cập nhật sau 2 phút.');
        } catch (cause) {
          if (active) setSharingMessage(cause instanceof Error ? cause.message : 'Không gửi được vị trí. Sẽ thử lại sau 2 phút.');
        } finally { sending = false; }
      }, () => { if (active) setSharingMessage('Không lấy được GPS. Kiểm tra quyền vị trí; ứng dụng sẽ thử lại sau 2 phút.'); sending = false; },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    };
    sendPosition();
    const timer = window.setInterval(sendPosition, 120000);
    document.addEventListener('visibilitychange', sendPosition);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', sendPosition); };
  }, [sharingTeamId, user]);

  useEffect(() => {
    const generation = ++sessionGenerationRef.current;
    me()
      .then((value) => {
        if (generation !== sessionGenerationRef.current) return;
        setUser(value);
        setSessionState('ready');
        routeAfterLogin(value);
      })
      .catch((cause) => {
        if (generation !== sessionGenerationRef.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setSessionState('guest');
          const requested = routeFromUrl();
          if (requested && (requested.workspace !== 'citizen' || requested.page === 'account')) {
            pendingRouteRef.current = window.location.href;
            setShowAuthModal(true);
          }
          const route = permittedRoute(null, requested);
          setWorkspace(route.workspace);
          setPageId(route.page);
          writeRoute(route.workspace, route.page, null, 'replace');
        } else {
          setSessionError(cause instanceof Error ? cause.message : 'Không thể kiểm tra phiên.');
          setSessionState('error');
        }
      });
  }, []);

  useEffect(() => {
    const restoreRoute = () => {
      const route = permittedRoute(user, routeFromUrl());
      setWorkspace(route.workspace);
      setPageId(route.page);
      setSelectedTrackingCode('');
      setSelectedMissionId('');
      setSelectedRequestId('');
      setMenuOpen(false);
      setProfileMenuOpen(false);
      writeRoute(route.workspace, route.page, user, 'replace');
    };
    window.addEventListener('popstate', restoreRoute);
    return () => window.removeEventListener('popstate', restoreRoute);
  }, [user]);

  const workspaces = allowedWorkspaces(user);
  const navigation = allowedPages(workspace, user);
  const selected = pageId === 'account' && user
    ? { id: 'account', title: 'Tài khoản', icon: 'account' }
    : navigation.find((page) => page.id === pageId) || navigation[0] || pages.citizen[0];

  useEffect(() => {
    document.title = sessionState === 'loading' ? 'Reliva · Chung tay cứu trợ thiên tai' : `${selected.title} · Reliva`;
  }, [sessionState, selected.title]);

  function changeWorkspace(next: Workspace) {
    pendingRouteRef.current = null;
    if (next !== workspace) { setPrevWorkspace(workspace); try { sessionStorage.setItem('c48:prev-workspace', workspace); } catch {} }
    setWsMenuOpen(false);
    setWorkspace(next);
    const nextPage = allowedPages(next, user)[0]?.id || 'sos';
    setPageId(nextPage);
    writeRoute(next, nextPage, user);
    setMenuOpen(false);
    setProfileMenuOpen(false);
  }

  function changePage(id: string) {
    pendingRouteRef.current = null;
    if (id === 'track') {
      setSelectedTrackingCode('');
      if (user) { try { sessionStorage.removeItem(`c48:citizen-tracking:${user.id}`); } catch {} }
    }
    setSelectedMissionId('');
    setSelectedRequestId('');
    setPageId(id);
    writeRoute(workspace, id, user);
    setMenuOpen(false);
    setProfileMenuOpen(false);
  }

  function trackOwnedRequest(code: string) {
    pendingRouteRef.current = null;
    setSelectedTrackingCode(code);
    if (user) { try { sessionStorage.setItem(`c48:citizen-tracking:${user.id}`, code); } catch {} }
    setPageId('track');
    writeRoute('citizen', 'track', user);
    setMenuOpen(false);
  }

  async function signOut() {
    setLogoutError('');
    try {
      await logout();
    } catch {
      // A failed server revocation must not keep this device in the signed-in UI.
    } finally {
      resetSession();
      setSessionError('');
      notifyOtherTabs('signed-out');
    }
  }

  if (sessionState === 'loading') {
    return <div className="session-loading" role="status" aria-label="Đang mở Reliva">
      <div className="session-loading-card">
        <img src="/reliva-logo.png" alt="" aria-hidden="true" />
        <strong>Reliva</strong>
        <span>Chung tay cứu trợ thiên tai</span>
        <div className="session-loading-progress" aria-hidden="true"><span /></div>
      </div>
    </div>;
  }

  return (
    <div className="shell">
      <aside id="primary-navigation" className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Điều hướng chính">
        <div className="sidebar-content">
          <div className="brand">
            <span className="brand-mark">
              <img src="/reliva-logo.png" alt="" aria-hidden="true" />
            </span>
            <div>
              <strong>Reliva</strong>
              <small>CHUNG TAY CỨU TRỢ</small>
            </div>
          </div>

          <p className="nav-label">Xem theo vai trò</p>
          <div className="ws-picker" ref={wsMenuRef}>
            <button type="button" className="ws-picker__current" aria-haspopup="listbox" aria-expanded={wsMenuOpen}
              onClick={() => setWsMenuOpen(!wsMenuOpen)}>
              <span className="ws-picker__text">
                <strong>{workspaceLabels[workspace]}</strong>
                <small>{workspaceRoleCodes(workspace, user).map((code) => label(code)).join(' · ')}</small>
              </span>
              {workspaces.length > 1 && <span className="ws-picker__chevron" aria-hidden="true">▾</span>}
            </button>
            {workspaces.length > 1 && prevWorkspace && prevWorkspace !== workspace && workspaces.includes(prevWorkspace) &&
              <button type="button" className="ws-picker__quick" onClick={() => changeWorkspace(prevWorkspace)}
                title={`Chuyển nhanh về ${workspaceLabels[prevWorkspace]}`} aria-label={`Chuyển nhanh về ${workspaceLabels[prevWorkspace]}`}>⇄</button>}
            {wsMenuOpen && workspaces.length > 1 && <div className="ws-picker__menu" role="listbox" aria-label="Chọn vai trò">
              {workspaces.map((item) => (
                <button key={item} type="button" role="option" aria-selected={workspace === item}
                  className={workspace === item ? 'active' : ''} onClick={() => changeWorkspace(item)}>
                  <strong>{workspaceLabels[item]}</strong>
                  <small>{workspaceRoleCodes(item, user).map((code) => label(code)).join(' · ')}</small>
                </button>
              ))}
            </div>}
          </div>

          <p className="nav-label">Chức năng</p>
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
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Đóng trình đơn' : 'Mở trình đơn'}
              aria-expanded={menuOpen}
              aria-controls="primary-navigation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="topbar-breadcrumb">
              <span className="breadcrumb-workspace">{workspaceLabels[workspace]}</span>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-page">{selected.title}</span>
            </div>
          </div>

          <div className="top-actions">
            {sharingTeamId && <button type="button" className="sharing-indicator" onClick={() => setSharingTeamId('')} title={sharingMessage || 'Dừng tự cập nhật vị trí đội cứu hộ'}>Tự cập nhật GPS đang bật · Dừng</button>}
            {user ? (
              <div className="profile-menu-wrap">
              <button type="button" className="user-profile profile-trigger"
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                aria-label="Mở trình đơn tài khoản" aria-expanded={profileMenuOpen}>
                <span className="user-avatar" aria-hidden="true">
                  {user.display_name ? user.display_name.trim().charAt(0).toUpperCase() : 'U'}
                </span>
                <span className="user-info">
                  <span className="user-name">{user.display_name}</span>
                  <span className="user-role-badge" title={[...new Set(user.grants.map((grant) => label(grant.role_code)))].join(', ')}>
                    {(() => {
                      const codes = [...new Set(user.grants.map((grant) => grant.role_code))];
                      if (!codes.length) return label('CITIZEN');
                      return codes.length > 1 ? `${label(codes[0])} +${codes.length - 1} vai trò` : label(codes[0]);
                    })()}
                  </span>
                </span>
              </button>
              {profileMenuOpen && <div className="profile-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => changePage('account')}>Xem hồ sơ</button>
                <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); void signOut(); }}>Đăng xuất</button>
              </div>}
              </div>
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
        {workspace === 'citizen' && <div className="emergency-bar" role="note">
          <span className="emergency-icon" aria-hidden="true">!</span>
          <strong>Khẩn cấp? Gọi ngay</strong>
          <div className="emergency-links">
            <a href="tel:113">113 <span>Công an</span></a>
            <a href="tel:114">114 <span>Cứu hỏa</span></a>
            <a href="tel:115">115 <span>Cấp cứu</span></a>
          </div>
        </div>}

        <main className={`content ${workspace === 'citizen' && selected.id === 'sos' ? 'content--sos' : ''} ${selected.id === 'track' ? 'content--tracking' : ''}`}>
          <ContentErrorBoundary key={`${user?.id || 'guest'}:${workspace}:${selected.id}`}>
          <React.Suspense fallback={<div className="card" role="status">Đang tải nội dung…</div>}>
          <PageHeader title={selected.title}
            eyebrow={selected.id === 'sos' ? 'Khẩn cấp' : undefined}
            description={selected.id === 'track'
              ? (user ? 'Xem danh sách SOS đã gắn với tài khoản và tiến độ xử lý.' : 'Nhập mã theo dõi để xem tiến độ SOS đã gửi.')
              : selected.note} />

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
            sessionState !== 'error' && (
              <>
                {selected.id === 'account' && user ? (
                  <CitizenAccount
                    user={user}
                    onChangePassword={() => setShowPasswordModal(true)}
                  />
                ) : workspace === 'citizen' && selected.id === 'sos' ? (
                  <SosForm key={user?.id || 'guest'} user={user} onTrack={trackOwnedRequest} />
                ) : selected.id === 'track' ? (
                  <Tracking
                    key={selectedTrackingCode}
                    user={user}
                    initialCode={selectedTrackingCode}
                    onSelectOwned={trackOwnedRequest}
                    onBack={() => changePage('track')}
                    onNewSos={() => changePage('sos')}
                  />
                ) : workspace === 'citizen' && selected.id === 'drives' ? (
                  <Donations user={user} />
                ) : workspace === 'coordinator' &&
                  ['queue', 'verify', 'triage', 'assign'].includes(selected.id) ? (
                  <Coordinator key={`${selected.id}:${selectedRequestId}`} page={selected.id} currentUserId={user!.id}
                    initialRequestId={selectedRequestId} />
                ) : workspace === 'coordinator' && selected.id === 'needs' && user ? (
                  <Operations page="needs" user={user} />
                ) : ['volunteer', 'coordinator'].includes(workspace) &&
                  selected.id === 'notices' ? (
                  <Notices key={workspace} onOpenRequest={workspace === 'coordinator' ? (requestId) => {
                    setSelectedRequestId(requestId);
                    setPageId('queue');
                    writeRoute('coordinator', 'queue', user);
                  } : undefined} onOpenMission={workspace === 'volunteer' ? (missionId) => {
                    setSelectedMissionId(missionId);
                    setPageId('missions');
                    writeRoute('volunteer', 'missions', user);
                  } : undefined} />
                ) : ['coordinator', 'operations'].includes(workspace) &&
                  selected.id === 'campaigns' ? (
                  <Campaigns key={workspace} />
                ) : workspace === 'volunteer' ? (
                  <Volunteer key={`${selected.id}:${selectedMissionId}`} page={selected.id} currentUserId={user!.id} initialMissionId={selectedMissionId}
                    sharingTeamId={sharingTeamId} sharingMessage={sharingMessage}
                    onToggleSharing={(teamId) => { setSharingTeamId((current) => current === teamId ? '' : teamId); setSharingMessage(''); }} />
                ) : (workspace === 'coordinator' || workspace === 'admin') && selected.id === 'dashboard' ? (
                  <RoleDashboard role={workspace} onOpenRequest={workspace === 'coordinator' ? (requestId) => {
                    setSelectedRequestId(requestId);
                    setPageId('queue');
                    writeRoute('coordinator', 'queue', user);
                  } : undefined} />
                ) : workspace === 'operations' && selected.id === 'overview' ? (
                  <RoleDashboard role="operations" showReports={roles(user).has('OPERATIONS_MANAGER') || roles(user).has('CAMPAIGN_MANAGER')} />
                ) : workspace === 'operations' && selected.id === 'intake' && user ? (
                  <IntakeReview user={user} />
                ) : workspace === 'operations' && user ? (
                  <Operations key={selected.id} page={selected.id} user={user} />
                ) : workspace === 'coordinator' && selected.id === 'teams' ? (
                  <CoordinatorTeams user={user!} />
                ) : workspace === 'admin' && selected.id === 'teams' ? (
                  <CoordinatorTeams user={user!} />
                ) : workspace === 'admin' ? (
                  <Admin key={selected.id} page={selected.id} />
                ) : (
                  <LivePage key={`${workspace}:${selected.id}`} page={selected} user={user} />
                )}
              </>
            )
          )}
          </React.Suspense>
          </ContentErrorBoundary>
        </main>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onReady={(loggedInUser) => {
          sessionGenerationRef.current += 1;
          setUser(loggedInUser);
          setSessionState('ready');
          setSessionError('');
          routeAfterLogin(loggedInUser, true);
          setShowAuthModal(false);
          notifyOtherTabs('signed-in');
        }}
      />
      {showPasswordModal && user && (
        <DetailSurface modal open label="Đổi mật khẩu" className="password-change-dialog"
          onClose={() => setShowPasswordModal(false)}>
            <PasswordChange
              onChanged={(updatedUser) => {
                setUser(updatedUser);
                setShowPasswordModal(false);
              }}
            />
        </DetailSurface>
      )}
    </div>
  );
}

// Secure session cookies work on localhost in the local HTTP demo. Some browsers
// reject those cookies on the numeric loopback host, which breaks login/registration.
if (window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1') {
  const demoUrl = new URL(window.location.href);
  demoUrl.hostname = 'localhost';
  window.location.replace(demoUrl.href);
} else {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
