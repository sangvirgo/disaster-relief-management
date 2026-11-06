import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, upload } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { label } from '../../i18n/labels';
import { formatQuantity } from '../../i18n/quantity';
import type { Me } from '../../auth/session';
import { confirmAction } from '../../components/confirmAction';
import { useUrlView } from '../../app/useUrlView';
import { donationViews } from '../../app/routeViews';

type DriveItem = {
  item_id: string;
  item_name: string;
  unit_name: string;
  scale: number;
  target_quantity: string;
  accepted_total: string;
  acceptance_note?: string | null;
};
type Drive = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  campaign_status?: string | null;
  items: DriveItem[];
  intake_location?: { warehouse_name?: string; address_note?: string | null };
  generated_at?: string;
};
type Declaration = { id: string; public_code: string; status: string };
type Tracking = {
  id: string;
  public_code: string;
  status: string;
  declaration?: { lines: { item_id: string; item_name: string; unit_name: string; declared_quantity: string }[] };
  receipt?: {
    lines: {
      item_id: string;
      declared_quantity: string | null;
      counted_quantity: string;
      accepted_quantity: string;
      held_quantity: string;
      rejected_quantity: string;
    }[];
  } | null;
  disputes?: { id: string; status: string; reason: string; resolution_note?: string | null }[];
};
type Pending = { key: string; secret: string; body: Record<string, unknown>; driveId: string };
function secret32(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function Donations({ user }: { user: Me | null }) {
  const [view, setView] = useUrlView('view', donationViews, 'drives');
  const [showDeclaration, setShowDeclaration] = useState(false);
  const [closingDeclaration, setClosingDeclaration] = useState(false);
  function closeDeclaration() {
    setClosingDeclaration(true);
    window.setTimeout(() => { setShowDeclaration(false); setClosingDeclaration(false); }, 180);
  }
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [selected, setSelected] = useState<Drive | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [donorName, setDonorName] = useState('');
  const [donorPhone, setDonorPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<Declaration | null>(null);
  const [createdSecret, setCreatedSecret] = useState('');
  const [trackId, setTrackId] = useState('');
  const [trackSecret, setTrackSecret] = useState('');
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const selectedCardRef = useRef<HTMLDivElement | null>(null);
  const trackingCardRef = useRef<HTMLElement | null>(null);
  const [verifiedSecret, setVerifiedSecret] = useState('');
  const lookupVersion = useRef(0);
  const [disputeReason, setDisputeReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const disputeKey = useRef<string | null>(null);
  const uploadKey = useRef<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPublicCode, setRecoveryPublicCode] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const recoveryKey = useRef<string | null>(null);
  const [createdFile, setCreatedFile] = useState<File | null>(null);
  const [createdUploadMessage, setCreatedUploadMessage] = useState('');
  const pending = useRef<Pending | null>(null);
  const [declarationTouched, setDeclarationTouched] = useState<Record<string, boolean>>({});
  const [declarationAttempted, setDeclarationAttempted] = useState(false);
  const [trackingTouched, setTrackingTouched] = useState<Record<string, boolean>>({});
  const [trackingAttempted, setTrackingAttempted] = useState(false);
  const [recoveryTouched, setRecoveryTouched] = useState<Record<string, boolean>>({});
  const [recoveryAttempted, setRecoveryAttempted] = useState(false);
  const [disputeTouched, setDisputeTouched] = useState(false);
  const [disputeAttempted, setDisputeAttempted] = useState(false);
  const declarationErrors: Record<string, string> = {};
  if (!donorName.trim()) declarationErrors.donorName = 'Họ tên người đóng góp là bắt buộc.';
  else if (donorName.length > 200) declarationErrors.donorName = 'Họ tên không được vượt quá 200 ký tự.';
  const normalizedDonorPhone = donorPhone.trim().replace(/[ ()-]/g, '');
  if (!normalizedDonorPhone) declarationErrors.donorPhone = 'Số điện thoại người đóng góp là bắt buộc.';
  else if (donorPhone.length > 32) declarationErrors.donorPhone = 'Số điện thoại không được vượt quá 32 ký tự.';
  else if (!/^\+?[0-9]{8,15}$/.test(normalizedDonorPhone))
    declarationErrors.donorPhone = 'Số điện thoại cần có 8–15 chữ số; có thể bắt đầu bằng dấu +.';
  const hasPositiveQuantity = Boolean(selected?.items.some((item) => Number(quantities[item.item_id]) > 0));
  for (const item of selected?.items || []) {
    const value = (quantities[item.item_id] || '').trim();
    if (!value) continue;
    if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) < 0)
      declarationErrors[`quantity:${item.item_id}`] = 'Số lượng phải là số không âm.';
    else if ((value.split('.')[1]?.length || 0) > item.scale)
      declarationErrors[`quantity:${item.item_id}`] = `Số lượng chỉ được có tối đa ${item.scale} chữ số thập phân.`;
  }
  const declarationInvalid = Boolean(Object.keys(declarationErrors).length || !hasPositiveQuantity);
  const donationTrackIdError = !trackId.trim() ? 'Định danh bản khai là bắt buộc.'
    : trackId.trim().length > 36 ? 'Định danh bản khai không được vượt quá 36 ký tự.'
      : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trackId.trim())
        ? 'Định danh bản khai không đúng định dạng.' : '';
  const donationTrackSecretError = !user && !trackSecret.trim() ? 'Mã bảo mật bản khai là bắt buộc.'
    : trackSecret.length > 43 ? 'Mã bảo mật không được vượt quá 43 ký tự.'
      : trackSecret.trim() && !/^[A-Za-z0-9_-]{43}$/.test(trackSecret.trim()) ? 'Mã bảo mật không đúng định dạng.' : '';
  const donationRecoveryPublicError = !recoveryPublicCode.trim() ? 'Mã bản khai công khai là bắt buộc.'
    : recoveryPublicCode.length > 16 ? 'Mã bản khai công khai không được vượt quá 16 ký tự.'
      : !/^[0-9A-HJKMNP-TV-Z]{8,16}$/i.test(recoveryPublicCode.trim()) ? 'Mã bản khai công khai không đúng định dạng.' : '';
  const donationRecoveryCodeError = !recoveryCode.trim() ? 'Mã khôi phục một lần là bắt buộc.'
    : recoveryCode.length > 43 ? 'Mã khôi phục không được vượt quá 43 ký tự.'
      : !/^[A-Za-z0-9_-]{43}$/.test(recoveryCode.trim()) ? 'Mã khôi phục không đúng định dạng.' : '';
  const donationDisputeError = !disputeReason.trim() ? 'Nội dung cần rà soát là bắt buộc.'
    : disputeReason.length > 2000 ? 'Nội dung cần rà soát không được vượt quá 2.000 ký tự.' : '';
  const guestCredentials = user ? ('include' as const) : ('omit' as const);
  const [showCreatedTracking, setShowCreatedTracking] = useState(false);
  const accountKey = user?.id ?? 'guest';
  const previousAccountKey = useRef(accountKey);
  useEffect(() => {
    if (previousAccountKey.current === accountKey) return;
    previousAccountKey.current = accountKey;
    lookupVersion.current += 1;
    setTrackId('');
    setTrackSecret('');
    setVerifiedSecret('');
    setTracking(null);
    setCreated(null);
    setCreatedSecret('');
    setShowCreatedTracking(false);
    setTrackingAttempted(false);
    setTrackingTouched({});
    setError('');
  }, [accountKey]);
  const nav = <div className="donation-nav" role="group" aria-label="Mục đóng góp">
    <button type="button" className={`button ${view === 'drives' ? '' : 'secondary'}`} onClick={() => { setView('drives'); setShowCreatedTracking(false); setError(''); }}>Đợt quyên góp</button>
    <button type="button" className={`button ${view === 'donation' ? '' : 'secondary'}`} onClick={() => { setView('donation'); setError(''); }}>Theo dõi đóng góp</button>
  </div>;
  useEffect(() => {
    if (!showDeclaration) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDeclaration(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showDeclaration]);
  useEffect(() => {
    if (selected && !showDeclaration) selectedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected, showDeclaration]);
  useEffect(() => {
    if (tracking) trackingCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [tracking]);
  async function attachCreated(event: FormEvent) {
    event.preventDefault();
    if (!created || !createdFile) return;
    setLoading(true);
    setCreatedUploadMessage('');
    try {
      await upload(
        'logistics',
        `/public/donations/${encodeURIComponent(created.id)}/evidence`,
        createdFile,
        {
          idempotencyKey: newCommandKey(),
          credentials: guestCredentials,
          headers: createdSecret ? { 'X-Donation-Secret': createdSecret } : {},
        }
      );
      setCreatedFile(null);
      setCreatedUploadMessage('Đã tải ảnh kiện hàng lên thành công.');
    } catch (cause) {
      setCreatedUploadMessage(
        cause instanceof Error ? cause.message : 'Chưa tải được tệp minh chứng.'
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    fetchAll<Drive>('logistics', '/public/donation-drives')
      .then((items) => {
        if (live) setDrives(items);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải đợt quyên góp.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  async function choose(id: string, openDeclaration = false) {
    if (selected?.id === id) {
      if (openDeclaration) { setShowDeclaration(true); setDialogOffset({ x: 0, y: 0 }); }
      return;
    }
    setError('');
    setSelected(null);
    setShowDeclaration(false);
    setLoading(true);
    try {
      setSelected(await api('logistics', `/public/donation-drives/${encodeURIComponent(id)}`));
      setShowDeclaration(openDeclaration);
      setDialogOffset({ x: 0, y: 0 });
      pending.current = null;
      setQuantities({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể mở đợt quyên góp.');
    } finally {
      setLoading(false);
    }
  }
  async function declare(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setDeclarationAttempted(true);
    setError('');
    if (declarationInvalid) return;
    setLoading(true);
    try {
      let command = pending.current;
      if (!command) {
        const lines = selected.items
          .filter((item) => quantities[item.item_id] && Number(quantities[item.item_id]) > 0)
          .map((item) => ({ item_id: item.item_id, declared_quantity: quantities[item.item_id] }));
        command = {
          key: newCommandKey(),
          secret: user ? '' : secret32(),
          driveId: selected.id,
          body: { donor_name: donorName.trim(), donor_phone: normalizedDonorPhone, lines },
        };
        pending.current = command;
      }
      const result = await api<Declaration>(
        'logistics',
        `/public/donation-drives/${encodeURIComponent(command.driveId)}/deliveries`,
        {
          method: 'POST',
          body: command.body,
          idempotencyKey: command.key,
          headers: command.secret ? { 'X-Donation-Secret': command.secret } : {},
          credentials: guestCredentials,
        }
      );
      setCreated(result);
      setCreatedSecret(command.secret);
      pending.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa gửi được bản khai.');
    } finally {
      setLoading(false);
    }
  }
  async function lookupDonation(idValue: string, secretValue: string) {
    const version = ++lookupVersion.current;
    const id = idValue.trim();
    const secret = secretValue.trim();
    setLoading(true);
    setError('');
    setTracking(null);
    try {
      const result = await api<Tracking>(
        'logistics',
        `/public/donations/${encodeURIComponent(id)}`,
        { headers: secret ? { 'X-Donation-Secret': secret } : {}, credentials: guestCredentials }
      );
      if (version === lookupVersion.current) {
        setVerifiedSecret(secret);
        setTracking(result);
      }
    } catch (cause) {
      if (version === lookupVersion.current)
        setError(cause instanceof Error ? cause.message : 'Không thể tra cứu đóng góp.');
    } finally {
      if (version === lookupVersion.current) setLoading(false);
    }
  }
  function track(event: FormEvent) {
    event.preventDefault();
    setTrackingAttempted(true);
    if (donationTrackIdError || donationTrackSecretError) return;
    void lookupDonation(trackId, trackSecret);
  }
  function invalidateTracking() {
    lookupVersion.current += 1;
    setLoading(false);
    setTracking(null);
    setVerifiedSecret('');
    setError('');
    setActionMessage('');
    disputeKey.current = null;
    uploadKey.current = null;
  }
  async function dispute(event: FormEvent) {
    event.preventDefault();
    if (!tracking) return;
    setDisputeAttempted(true);
    if (donationDisputeError) return;
    setLoading(true);
    setActionMessage('');
    try {
      disputeKey.current ||= newCommandKey();
      await api('logistics', `/public/donations/${encodeURIComponent(tracking.id)}/disputes`, {
        method: 'POST',
        body: { reason: disputeReason.trim() },
        idempotencyKey: disputeKey.current,
        headers: verifiedSecret ? { 'X-Donation-Secret': verifiedSecret } : {},
        credentials: guestCredentials,
      });
      disputeKey.current = null;
      setDisputeReason('');
      setDisputeTouched(false);
      setDisputeAttempted(false);
      setActionMessage('Máy chủ đã tiếp nhận khiếu nại của bạn.');
      try {
        setTracking(
          await api('logistics', `/public/donations/${encodeURIComponent(tracking.id)}`, {
            headers: verifiedSecret ? { 'X-Donation-Secret': verifiedSecret } : {},
            credentials: guestCredentials,
          })
        );
      } catch {
        setActionMessage('Máy chủ đã tiếp nhận khiếu nại. Hãy tra cứu lại để xem trạng thái mới.');
      }
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : 'Chưa xác nhận được khiếu nại.');
    } finally {
      setLoading(false);
    }
  }
  async function attach(event: FormEvent) {
    event.preventDefault();
    if (!tracking || !file) return;
    setLoading(true);
    setActionMessage('');
    try {
      uploadKey.current ||= newCommandKey();
      await upload(
        'logistics',
        `/public/donations/${encodeURIComponent(tracking.id)}/evidence`,
        file,
        {
          idempotencyKey: uploadKey.current,
          headers: verifiedSecret ? { 'X-Donation-Secret': verifiedSecret } : {},
          credentials: guestCredentials,
        }
      );
      uploadKey.current = null;
      setFile(null);
      setActionMessage('Máy chủ đã tiếp nhận tệp minh chứng.');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'STORAGE_UNAVAILABLE')
        uploadKey.current = null;
      setActionMessage(
        cause instanceof Error ? cause.message : 'Chưa xác nhận được tệp minh chứng.'
      );
    } finally {
      setLoading(false);
    }
  }
  async function claim() {
    if (
      !tracking ||
      !user ||
      !verifiedSecret ||
      !(await confirmAction(
        'Gắn bản khai này với tài khoản đang đăng nhập? Mã bảo mật cũ sẽ hết hiệu lực.'
      ))
    )
      return;
    setLoading(true);
    setActionMessage('');
    try {
      await api('logistics', `/public/donations/${encodeURIComponent(tracking.id)}/claim`, {
        method: 'POST',
        idempotencyKey: newCommandKey(),
        headers: { 'X-Donation-Secret': verifiedSecret },
      });
      setTrackSecret('');
      setVerifiedSecret('');
      setActionMessage('Bản khai đã được gắn với tài khoản của bạn.');
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : 'Chưa gắn được bản khai.');
    } finally {
      setLoading(false);
    }
  }
  async function recover(event: FormEvent) {
    event.preventDefault();
    setRecoveryAttempted(true);
    if (donationRecoveryPublicError || donationRecoveryCodeError) return;
    setLoading(true);
    setRecoveryMessage('');
    try {
      recoveryKey.current ||= newCommandKey();
      await api('logistics', '/public/donations/recover', {
        method: 'POST',
        body: { public_code: recoveryPublicCode.trim().toUpperCase() },
        headers: { 'X-Recovery-Code': recoveryCode.trim() },
        idempotencyKey: recoveryKey.current,
      });
      recoveryKey.current = null;
      setRecoveryCode('');
      setRecoveryTouched({});
      setRecoveryAttempted(false);
      setRecoveryMessage(
        'Bản khai đã được gắn với tài khoản. Hãy tra cứu bằng định danh bản khai.'
      );
    } catch (cause) {
      setRecoveryMessage(cause instanceof Error ? cause.message : 'Chưa khôi phục được bản khai.');
    } finally {
      setLoading(false);
    }
  }
  if (view === 'donation' || showCreatedTracking)
    return (
      <>{nav}
      <div className="grid-two donation-layout">
        <section className="card">
          <h2>Tra cứu đóng góp</h2>
          <p>Nhập định danh bản khai và mã bảo mật riêng tư. Mã bảo mật không nằm trong URL.</p>
          <form className="form-stack" onSubmit={track} noValidate>
            <label>
              <span>Định danh bản khai <span className="required-mark" aria-hidden="true">*</span></span>
              <input
                required
                disabled={loading}
                maxLength={37}
                aria-invalid={Boolean((trackingAttempted || trackingTouched.trackId) && donationTrackIdError)}
                value={trackId}
                onChange={(e) => {
                  setTrackId(e.target.value);
                  setTrackingTouched((current) => ({ ...current, trackId: true }));
                  invalidateTracking();
                }}
                onBlur={() => setTrackingTouched((current) => ({ ...current, trackId: true }))}
                autoComplete="off"
              />
              {(trackingAttempted || trackingTouched.trackId) && donationTrackIdError && <small className="field-error" role="alert">{donationTrackIdError}</small>}
            </label>
            <label>
              <span>Mã bảo mật (nếu khai với tư cách khách){!user && <> <span className="required-mark" aria-hidden="true">*</span></>}</span>
              <input
                type="password"
                disabled={loading}
                required={!user}
                maxLength={44}
                aria-invalid={Boolean((trackingAttempted || trackingTouched.trackSecret) && donationTrackSecretError)}
                value={trackSecret}
                onChange={(e) => {
                  setTrackSecret(e.target.value);
                  setTrackingTouched((current) => ({ ...current, trackSecret: true }));
                  invalidateTracking();
                }}
                onBlur={() => setTrackingTouched((current) => ({ ...current, trackSecret: true }))}
                autoComplete="off"
              />
              {(trackingAttempted || trackingTouched.trackSecret) && donationTrackSecretError && <small className="field-error" role="alert">{donationTrackSecretError}</small>}
            </label>
            <button className="button" disabled={loading}>
              Xem tiến độ
            </button>
          </form>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {user && (
            <details className="donation-recovery">
              <summary>Khôi phục bản khai</summary>
            <form className="form-stack command-form" onSubmit={recover} noValidate>
              <h3>Khôi phục bản khai</h3>
              <p>Nhập mã một lần do nhân viên tiếp nhận cấp sau khi xác minh liên hệ.</p>
              <label>
                <span>Mã bản khai công khai <span className="required-mark" aria-hidden="true">*</span></span>
                <input
                  required
                  maxLength={17}
                  aria-invalid={Boolean((recoveryAttempted || recoveryTouched.publicCode) && donationRecoveryPublicError)}
                  value={recoveryPublicCode}
                  onChange={(event) => {
                    setRecoveryPublicCode(event.target.value);
                    setRecoveryTouched((current) => ({ ...current, publicCode: true }));
                    recoveryKey.current = null;
                  }}
                  onBlur={() => setRecoveryTouched((current) => ({ ...current, publicCode: true }))}
                  autoComplete="off"
                />
                {(recoveryAttempted || recoveryTouched.publicCode) && donationRecoveryPublicError && <small className="field-error" role="alert">{donationRecoveryPublicError}</small>}
              </label>
              <label>
                <span>Mã khôi phục một lần <span className="required-mark" aria-hidden="true">*</span></span>
                <input
                  required
                  maxLength={44}
                  aria-invalid={Boolean((recoveryAttempted || recoveryTouched.code) && donationRecoveryCodeError)}
                  value={recoveryCode}
                  onChange={(event) => {
                    setRecoveryCode(event.target.value);
                    setRecoveryTouched((current) => ({ ...current, code: true }));
                    recoveryKey.current = null;
                  }}
                  onBlur={() => setRecoveryTouched((current) => ({ ...current, code: true }))}
                  autoComplete="off"
                />
                {(recoveryAttempted || recoveryTouched.code) && donationRecoveryCodeError && <small className="field-error" role="alert">{donationRecoveryCodeError}</small>}
              </label>
              <button className="button secondary" disabled={loading}>
                Gắn bản khai với tài khoản
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
        {tracking && (
          <section className="card" ref={trackingCardRef}>
            <h2>Đóng góp {tracking.public_code}</h2>
            <span className="chip">{label(tracking.status)}</span>
            <h3>Đã khai báo</h3>
            {tracking.declaration?.lines.map((line, i) => (
              <p key={i}>
                {line.item_name}: {formatQuantity(line.declared_quantity)} {line.unit_name}
              </p>
            ))}
            {tracking.receipt ? (
              <>
                <h3>Kết quả kiểm đếm và duyệt</h3>
                {tracking.receipt.lines.map((line, i) => {
                  const item = tracking.declaration?.lines.find((declared) => declared.item_id === line.item_id);
                  return (
                    <p key={`${line.item_id}-${i}`}>
                      {item?.item_name || `Vật phẩm ${i + 1}`}: đã đếm {formatQuantity(line.counted_quantity)}, tiếp nhận{' '}
                      {formatQuantity(line.accepted_quantity)}, tạm giữ{' '}
                      {formatQuantity(line.held_quantity)}, từ chối{' '}
                      {formatQuantity(line.rejected_quantity)}
                    </p>
                  );
                })}
              </>
            ) : (
              <p>Chưa có biên nhận kiểm đếm. Bản khai chưa làm tăng tồn kho.</p>
            )}
            <h3>Khiếu nại</h3>
            {tracking.disputes?.length ? (
              tracking.disputes.map((item) => (
                <p key={item.id}>
                  {label(item.status)}: {item.reason}
                  {item.resolution_note ? ` · Kết quả: ${item.resolution_note}` : ''}
                </p>
              ))
            ) : (
              <p>Chưa có khiếu nại.</p>
            )}
          <form className="form-stack donation-dispute-form" onSubmit={dispute} noValidate>
              <label>
                <span>Nội dung cần rà soát <span className="required-mark" aria-hidden="true">*</span></span>
                <textarea
                  required
                  maxLength={2001}
                  aria-invalid={Boolean((disputeAttempted || disputeTouched) && donationDisputeError)}
                  value={disputeReason}
                  onChange={(event) => {
                    setDisputeReason(event.target.value);
                    setDisputeTouched(true);
                    disputeKey.current = null;
                  }}
                  onBlur={() => setDisputeTouched(true)}
                />
                {(disputeAttempted || disputeTouched) && donationDisputeError && <small className="field-error" role="alert">{donationDisputeError}</small>}
              </label>
              <button className="button donation-action" disabled={loading}>
                Gửi khiếu nại
              </button>
            </form>
            <form className="form-stack donation-evidence-form" onSubmit={attach}>
              <label>
                <span>Minh chứng riêng tư (JPEG, PNG hoặc MP4) <span className="required-mark" aria-hidden="true">*</span></span>
                <input
                  className="donation-file-input"
                  type="file"
                  required
                  accept="image/jpeg,image/png,video/mp4"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    uploadKey.current = null;
                  }}
                />
              </label>
              <button className="button donation-action" disabled={loading || !file}>
                Tải minh chứng lên
              </button>
            </form>
            {user && verifiedSecret && (
              <button className="button secondary" onClick={claim} disabled={loading}>
                Gắn bản khai với tài khoản
              </button>
            )}
            {actionMessage && (
              <p className="notice" role="status">
                {actionMessage}
              </p>
            )}
          </section>
        )}
      </div>
      </>
    );
  if (created)
    return (
      <>{nav}
      <section className="card confirmation" role="status">
        <h2>Đã nhận bản khai vật phẩm</h2>
        <p>
          Mã bản khai: <strong>{created.public_code}</strong>
        </p>
        <p>
          Định danh để tra cứu: <strong className="secret">{created.id}</strong>
        </p>
        <p>
          Trạng thái: {label(created.status)}. Vật phẩm chưa được ghi vào tồn kho cho đến khi kiểm
          đếm và duyệt.
        </p>
        {createdSecret && (
          <div className="notice warning">
            <strong>Hãy lưu mã bảo mật ngay:</strong>
            <div className="secret">{createdSecret}</div>
            <p>Mã này chỉ hiển thị một lần; ứng dụng không lưu trên trình duyệt.</p>
          </div>
        )}
        <form
          className="form-stack command-form"
          onSubmit={attachCreated}
          style={{ marginTop: '1rem' }}
        >
          <h3>Đính kèm ảnh kiện hàng / biên nhận bàn giao</h3>
          <label>
            <span>Chọn tệp ảnh (JPEG, PNG hoặc MP4) <span className="required-mark" aria-hidden="true">*</span></span>
            <input
              className="donation-file-input"
              type="file"
              required
              accept="image/jpeg,image/png,video/mp4"
              onChange={(e) => setCreatedFile(e.target.files?.[0] || null)}
            />
          </label>
          <button className="button donation-action" disabled={loading || !createdFile}>
            Tải ảnh kiện hàng lên
          </button>
          {createdUploadMessage && (
            <p className="notice" role="status">
              {createdUploadMessage}
            </p>
          )}
        </form>
        <div style={{ marginTop: '1rem' }}>
          <button
            className="button"
            onClick={() => {
              setView('donation');
              setTrackId(created.id);
              setTrackSecret(createdSecret);
              setCreated(null);
              setCreatedSecret('');
              setShowCreatedTracking(true);
              void lookupDonation(created.id, createdSecret);
            }}
          >
            Chuyển đến màn hình tra cứu đóng góp này
          </button>
        </div>
      </section>
      </>
    );
  const driveActions = (drive: Drive) => (
    <div className="donation-drive-actions">
      <button type="button" className="button secondary" aria-expanded={selected?.id === drive.id}
        onClick={() => selected?.id === drive.id ? setSelected(null) : choose(drive.id)}>
        {selected?.id === drive.id ? 'Ẩn vật phẩm' : 'Xem vật phẩm'}
      </button>
      <button type="button" className="button" onClick={() => choose(drive.id, true)}>
        Khai báo vật phẩm
      </button>
    </div>
  );
  return (
    <>{nav}
    <div className="donation-layout">
      <section className="card">
        <h2>Đợt quyên góp đang mở</h2>
        {loading && <p role="status">Đang tải…</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!loading && !drives.length && (
          <div className="empty">Hiện chưa có đợt quyên góp đang mở.</div>
        )}
        <div className="record-list">
          {drives.map((drive) => (
            <article className="record donation-drive-card" key={drive.id}>
              <div className="donation-drive-header">
                <div>
                  <strong>{drive.title}</strong>
                  <p>{drive.description}</p>
                  <small>Điểm tiếp nhận: {drive.intake_location?.warehouse_name}</small>
                </div>
                {selected?.id !== drive.id && driveActions(drive)}
              </div>
              {selected?.id === drive.id && (
                <div className="donation-drive-detail" ref={selectedCardRef}>
                  <p>{selected.intake_location?.address_note}</p>
                  <p className="table-swipe-hint">Vuốt ngang bảng để xem đầy đủ các cột.</p>
                  <div className="stock-table-scroll">
                    <table className="stock-table donation-item-table">
                      <thead><tr><th scope="col">Vật phẩm</th><th scope="col" className="numeric">Mục tiêu</th><th scope="col" className="numeric">Đã tiếp nhận</th><th scope="col" className="numeric">Còn cần</th></tr></thead>
                      <tbody>
                        {selected.items.map((item) => {
                          const remaining = Math.max(0, Number(item.target_quantity) - Number(item.accepted_total));
                          return <tr key={item.item_id}>
                            <th scope="row"><strong>{item.item_name}</strong>{item.acceptance_note && <small>{item.acceptance_note}</small>}</th>
                            <td className="numeric" data-label="Mục tiêu">{formatQuantity(item.target_quantity)} {item.unit_name}</td>
                            <td className="numeric" data-label="Đã tiếp nhận"><span className="available-value">{formatQuantity(item.accepted_total)} {item.unit_name}</span></td>
                            <td className="numeric" data-label="Còn cần">{formatQuantity(remaining.toFixed(item.scale))} {item.unit_name}</td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted">Số đã tiếp nhận chỉ tính vật phẩm đã kiểm đếm, duyệt và ghi sổ.</p>
                  {driveActions(drive)}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      {selected && showDeclaration && <div className={`donation-modal-backdrop ${closingDeclaration ? 'is-closing' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeclaration(); }}>
            <section className="donation-modal" role="dialog" aria-modal="true" aria-label="Khai báo vật phẩm" style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}>
              <div className="donation-modal-header" onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; dragStart.current = { x: event.clientX, y: event.clientY, left: dialogOffset.x, top: dialogOffset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragStart.current) return; setDialogOffset({ x: Math.max(-Math.min(220, innerWidth / 3), Math.min(Math.min(220, innerWidth / 3), dragStart.current.left + event.clientX - dragStart.current.x)), y: Math.max(-120, Math.min(120, dragStart.current.top + event.clientY - dragStart.current.y)) }); }} onPointerUp={() => { dragStart.current = null; }}>
                <h2>Khai báo vật phẩm</h2><button type="button" className="modal-close-button" aria-label="Đóng cửa sổ khai báo" onClick={closeDeclaration}>×</button>
              </div>
            <form className="form-stack" onSubmit={declare} noValidate>
              <p className="required-note"><span className="required-mark" aria-hidden="true">*</span> Số lượng dự kiến của ít nhất một vật phẩm là bắt buộc.</p>
              <div className="form-grid">
                <label>
                  <span>Họ tên người đóng góp <span className="required-mark" aria-hidden="true">*</span></span>
                  <input
                    required
                    maxLength={201}
                    aria-invalid={Boolean((declarationAttempted || declarationTouched.donorName) && declarationErrors.donorName)}
                    value={donorName}
                    onChange={(e) => {
                      setDonorName(e.target.value);
                      setDeclarationTouched((current) => ({ ...current, donorName: true }));
                      pending.current = null;
                    }}
                    onBlur={() => setDeclarationTouched((current) => ({ ...current, donorName: true }))}
                  />
                  {(declarationAttempted || declarationTouched.donorName) && declarationErrors.donorName && <small className="field-error" role="alert">{declarationErrors.donorName}</small>}
                </label>
                <label>
                  <span>Số điện thoại <span className="required-mark" aria-hidden="true">*</span></span>
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={33}
                    aria-invalid={Boolean((declarationAttempted || declarationTouched.donorPhone) && declarationErrors.donorPhone)}
                    aria-describedby="donor-phone-hint"
                    value={donorPhone}
                    onChange={(e) => {
                      setDonorPhone(e.target.value);
                      setDeclarationTouched((current) => ({ ...current, donorPhone: true }));
                      pending.current = null;
                    }}
                    onBlur={() => setDeclarationTouched((current) => ({ ...current, donorPhone: true }))}
                  />
                  <small id="donor-phone-hint">Số liên hệ gồm 8–15 chữ số, có thể bắt đầu bằng +.</small>
                  {(declarationAttempted || declarationTouched.donorPhone) && declarationErrors.donorPhone && <small className="field-error" role="alert">{declarationErrors.donorPhone}</small>}
                </label>
              </div>
              {selected.items.map((item) => (
                <label key={item.item_id}>
                  {item.item_name} · {item.unit_name}
                  <input
                    type="number"
                    min="0"
                    step={item.scale ? 1 / 10 ** item.scale : 1}
                    aria-invalid={Boolean((declarationAttempted || declarationTouched[`quantity:${item.item_id}`]) && declarationErrors[`quantity:${item.item_id}`])}
                    value={quantities[item.item_id] || ''}
                    onChange={(e) => {
                      setQuantities({ ...quantities, [item.item_id]: e.target.value });
                      setDeclarationTouched((current) => ({ ...current, [`quantity:${item.item_id}`]: true }));
                      pending.current = null;
                    }}
                    onBlur={() => setDeclarationTouched((current) => ({ ...current, [`quantity:${item.item_id}`]: true }))}
                    placeholder="Số lượng dự kiến bàn giao"
                  />
                  {(declarationAttempted || declarationTouched[`quantity:${item.item_id}`]) && declarationErrors[`quantity:${item.item_id}`] && <small className="field-error" role="alert">{declarationErrors[`quantity:${item.item_id}`]}</small>}
                  {selected.items[0]?.item_id === item.item_id && (declarationAttempted || Object.keys(declarationTouched).some((field) => field.startsWith('quantity:'))) && !hasPositiveQuantity && <small className="field-error" role="alert">Số lượng của ít nhất một vật phẩm là bắt buộc.</small>}
                  <small>{item.acceptance_note}</small>
                </label>
              ))}
              <p className="notice">
                Bản khai chỉ ghi số dự kiến. Nhân viên sẽ đếm thực tế, người khác duyệt độc lập rồi
                mới ghi sổ kho.
              </p>
              <button
                className="button"
                disabled={
                  loading ||
                  declarationInvalid ||
                  (selected.campaign_status != null && selected.campaign_status !== 'ACTIVE')
                }
              >
                Gửi bản khai vật phẩm
              </button>
            </form>
            {error && <p className="notice error" role="alert">{error}</p>}
            </section>
          </div>}
    </div>
    </>
  );
}
