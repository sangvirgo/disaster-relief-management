import { DriveNearbyMap, type MapDrive } from '../../maps/DriveNearbyMap';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, upload } from '../../api/client';
import { useCursorPages } from '../../api/useCursorPages';
import { Pager } from '../../components/ui/Pager';
import { LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { SelectedFiles } from '../../components/ui/SelectedFiles';
import { label } from '../../i18n/labels';
import { formatQuantity, quantityFitsScale, remainingQuantity } from '../../i18n/quantity';
import { evidenceFileError as donationEvidenceError } from '../../i18n/evidence';
import type { Me } from '../../auth/session';
import { confirmAction } from '../../components/confirmAction';
import { useUrlView } from '../../app/useUrlView';
import { donationViews } from '../../app/routeViews';
import { StatusBadge } from '../../components/StatusBadge';
import { DetailSurface } from '../../components/DetailSurface';
import { useModalScrollLock } from '../../components/modalScrollLock';
import { SuccessBanner } from '../../components/SuccessBanner';

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
  opens_at?: string | null;
  closes_at?: string | null;
  items: DriveItem[];
  intake_location?: { warehouse_name?: string; address_note?: string | null; location?: { coordinates?: [number, number] } | null };
  distance_m?: number | null;
  generated_at?: string;
};
const distanceLabel = (meters: number) => meters < 1000 ? `${meters} m` : `${(meters / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`;
type Declaration = { id: string; public_code: string; status: string };
function driveUnavailable(drive: Drive): string {
  if (drive.status !== 'OPEN') return 'Đợt quyên góp hiện không nhận bản khai.';
  if (drive.campaign_status && drive.campaign_status !== 'ACTIVE') return 'Chiến dịch hiện không tiếp nhận đóng góp.';
  if (drive.opens_at && Date.parse(drive.opens_at) > Date.now()) return 'Chưa đến thời gian nhận vật phẩm.';
  if (drive.closes_at && Date.parse(drive.closes_at) <= Date.now()) return 'Đã hết thời gian nhận vật phẩm.';
  return '';
}
type OwnedDonation = { id: string; public_code: string; status: string; created_at: string; drive_title: string; has_count_result: boolean };
type Tracking = {
  id: string;
  public_code: string;
  status: string;
  can_manage: boolean;
  attachments?: { id: string; size_bytes: number; detected_mime: string; created_at: string; dispute_id: string | null }[];
  declaration?: { lines: { item_id: string; item_name: string; unit_name: string; declared_quantity: string }[] };
  receipt?: {
    id: string;
    count_revision: number;
    lines: {
      item_id: string;
      item_name: string;
      unit_name: string;
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

function DonationLookupCode({ id }: { id: string }) {
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setMessage('Đã sao chép định danh bản khai.');
    } catch {
      setMessage('Chưa sao chép được. Hãy chọn và sao chép định danh trong ô bên trên.');
    }
  }
  return <div className="donation-lookup-code">
    <strong>Định danh bản khai</strong>
    <div className="donation-lookup-code-row">
      <input aria-label="Định danh để lưu và tra cứu" readOnly value={id} onFocus={event => event.currentTarget.select()} />
      <button type="button" className="button secondary" onClick={() => void copy()}>Sao chép</button>
    </div>
    <small>Giữ định danh này để tra cứu trên thiết bị khác.</small>
    {message && <small className="donation-copy-message" role="status">{message}</small>}
  </div>;
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
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const drivePages = useCursorPages<Drive>('logistics', position
    ? `/public/donation-drives?lat=${position.lat.toFixed(5)}&lng=${position.lng.toFixed(5)}` : '/public/donation-drives', LIST_PAGE_SIZE);
  const drives = drivePages.items;
  const nearest = position ? drives.find((drive) => typeof drive.distance_m === 'number' && !driveUnavailable(drive)) : undefined;
  const mapDrives: MapDrive[] = drives.flatMap((drive) => {
    const coordinates = drive.intake_location?.location?.coordinates;
    return coordinates && coordinates.every((value) => Number.isFinite(value))
      ? [{ id: drive.id, title: drive.title, warehouseName: drive.intake_location?.warehouse_name, lat: coordinates[1], lng: coordinates[0], distanceM: drive.distance_m, open: !driveUnavailable(drive) }] : [];
  });
  function locateMe() {
    if (!navigator.geolocation) { setLocationError('Trình duyệt không hỗ trợ định vị. Vui lòng chọn đợt quyên góp trong danh sách.'); return; }
    setLocating(true); setLocationError('');
    navigator.geolocation.getCurrentPosition(
      (result) => { setPosition({ lat: result.coords.latitude, lng: result.coords.longitude }); setLocating(false); },
      () => { setLocating(false); setLocationError('Không lấy được vị trí. Hãy cho phép định vị hoặc chọn đợt quyên góp trong danh sách.'); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }
  const [selected, setSelected] = useState<Drive | null>(null);
  useModalScrollLock(Boolean(selected && showDeclaration));
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [donorName, setDonorName] = useState('');
  const [donorPhone, setDonorPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<Declaration | null>(null);
  const [createdSecret, setCreatedSecret] = useState('');
  useEffect(() => { if (created) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' })); }, [created]);
  const [trackId, setTrackId] = useState('');
  const trackIdInput = useRef<HTMLInputElement>(null);
  const [ownedSearch, setOwnedSearch] = useState('');
  const [ownedSearchTerm, setOwnedSearchTerm] = useState('');
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [trackingFor, setTrackingFor] = useState<string | null>(null);
  const [ownedDonations, setOwnedDonations] = useState<OwnedDonation[]>([]);
  const [ownedFor, setOwnedFor] = useState<string | null>(null);
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [ownedError, setOwnedError] = useState('');
  const [ownedRevision, setOwnedRevision] = useState(0);
  const selectedCardRef = useRef<HTMLDivElement | null>(null);
  const [verifiedSecret, setVerifiedSecret] = useState('');
  const lookupVersion = useRef(0);
  const [disputeReason, setDisputeReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);
  const [uploadedEvidence, setUploadedEvidence] = useState<{ id: string; donationId: string; name: string; owner: string | null }[]>([]);
  const [evidenceLink, setEvidenceLink] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => { setEvidenceLink(null); }, [tracking?.id, user?.id]);
  const [actionMessage, setActionMessage] = useState('');
  const disputeKey = useRef<string | null>(null);
  const uploadKey = useRef<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPublicCode, setRecoveryPublicCode] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const recoveryKey = useRef<string | null>(null);
  const [createdFile, setCreatedFile] = useState<File | null>(null);
  const [createdUploadMessage, setCreatedUploadMessage] = useState('');
  const createdFileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<Pending | null>(null);
  const [declarationTouched, setDeclarationTouched] = useState<Record<string, boolean>>({});
  const [declarationAttempted, setDeclarationAttempted] = useState(false);
  const [trackingTouched, setTrackingTouched] = useState<Record<string, boolean>>({});
  const [trackingAttempted, setTrackingAttempted] = useState(false);
  const [recoveryTouched, setRecoveryTouched] = useState<Record<string, boolean>>({});
  const [recoveryAttempted, setRecoveryAttempted] = useState(false);
  const [disputeTouched, setDisputeTouched] = useState(false);
  const [disputeAttempted, setDisputeAttempted] = useState(false);
  const evidenceError = file ? donationEvidenceError(file) : null;
  const createdEvidenceError = createdFile ? donationEvidenceError(createdFile) : null;
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
      declarationErrors[`quantity:${item.item_id}`] = item.scale === 0
        ? 'Vật phẩm này cần số lượng nguyên, ví dụ 1 hoặc 2.'
        : `Số lượng chỉ được có tối đa ${item.scale} chữ số thập phân.`;
  }
  const declarationInvalid = Boolean(Object.keys(declarationErrors).length || !hasPositiveQuantity);
  const donationTrackIdError = !trackId.trim() ? 'Định danh bản khai là bắt buộc.'
    : trackId.trim().length > 36 ? 'Định danh bản khai không được vượt quá 36 ký tự.'
      : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trackId.trim())
        ? 'Định danh bản khai không đúng định dạng.' : '';
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
    setOwnedSearch('');
    setOwnedSearchTerm('');
    setVerifiedSecret('');
    setTracking(null);
    setTrackingFor(null);
    setCreated(null);
    setCreatedSecret('');
    setShowCreatedTracking(false);
    setTrackingAttempted(false);
    setTrackingTouched({});
    setError('');
  }, [accountKey]);
  useEffect(() => {
    let live = true;
    if (!user) { setOwnedDonations([]); setOwnedFor(null); setOwnedError(''); setOwnedLoading(false); return; }
    setOwnedDonations([]);
    setOwnedFor(accountKey);
    setOwnedError('');
    setOwnedLoading(true);
    const refresh = async () => {
      const normalizedSearch = ownedSearchTerm.trim().toLocaleLowerCase('vi');
      const matchesSearch = (item: OwnedDonation) => !normalizedSearch ||
        [item.id, item.public_code, item.drive_title].some((value) => value?.toLocaleLowerCase('vi').includes(normalizedSearch));
      const saved: unknown = JSON.parse(localStorage.getItem('reliva.donation-history.' + accountKey) || '[]');
      const records: OwnedDonation[] = Array.isArray(saved) ? saved.filter((item): item is OwnedDonation => Boolean(item && typeof item.id === 'string' && typeof item.public_code === 'string' && typeof item.status === 'string' && typeof item.created_at === 'string')).slice(0, 10) : [];
      if (live) setOwnedDonations(records.filter(matchesSearch));
      if (view !== 'donation') return;
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (ownedSearchTerm.trim()) params.set('q', ownedSearchTerm.trim());
        const page = await api<{ items: OwnedDonation[] }>('logistics', `/public/donations/mine?${params}`);
        if (!live) return;
        const updated = page.items.map((item) => ({ id: item.id, public_code: item.public_code, status: item.status,
          created_at: item.created_at, drive_title: item.drive_title || 'Phiếu quyên góp', has_count_result: Boolean(item.has_count_result) }));
        setOwnedDonations(updated);
        localStorage.setItem('reliva.donation-history.' + accountKey, JSON.stringify(updated.slice(0, 10)));
      } catch {
        if (live) setOwnedError('Chưa tải được danh sách phiếu từ máy chủ; đang hiển thị lần lưu gần nhất trên trình duyệt. Hãy thử cập nhật lại.');
      }
    };
    void refresh().catch(() => { if (live) setOwnedError('Không đọc được lịch sử trên trình duyệt này. Bạn vẫn có thể tra cứu bằng định danh.'); })
      .finally(() => { if (live) setOwnedLoading(false); });
    return () => { live = false; };
  }, [accountKey, ownedRevision, ownedSearchTerm, view]);
  function rememberDonation(value: Declaration, driveTitle?: string, hasCountResult = false) {
    if (!user) return;
    try {
      const key = `reliva.donation-history.${accountKey}`;
      const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      const old = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : [];
      const previous = old.find((item) => item.id === value.id);
      const record: OwnedDonation = { ...value, drive_title: driveTitle || previous?.drive_title || 'Phiếu quyên góp',
        created_at: previous?.created_at || new Date().toISOString(), has_count_result: hasCountResult };
      localStorage.setItem(key, JSON.stringify([record, ...old.filter((item) => item.id !== value.id)].slice(0, 10)));
      setOwnedRevision((current) => current + 1);
    } catch { setOwnedError('Không lưu được lịch sử trên trình duyệt này. Hãy giữ định danh phiếu để tra cứu lại.'); }
  }
  const nav = <div className="donation-nav tabs" role="group" aria-label="Mục đóng góp">
    <button type="button" className={view === 'drives' ? 'active' : ''} aria-pressed={view === 'drives'} onClick={() => { setView('drives'); setShowCreatedTracking(false); setCreated(null); setShowDeclaration(false); setQuantities({}); setError(''); }}>Đợt quyên góp</button>
    <button type="button" className={view === 'donation' ? 'active' : ''} aria-pressed={view === 'donation'} onClick={() => { setView('donation'); setError(''); }}>Theo dõi đóng góp</button>
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
  async function attachCreated(event: FormEvent) {
    event.preventDefault();
    if (!created || !createdFile) return;
    const validationError = donationEvidenceError(createdFile);
    if (validationError) { setCreatedUploadMessage(validationError); return; }
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
      if (createdFileInput.current) createdFileInput.current.value = '';
      setCreatedUploadMessage('Đã tải ảnh kiện hàng lên thành công.');
    } catch (cause) {
      setCreatedUploadMessage(
        cause instanceof Error ? cause.message : 'Chưa tải được tệp minh chứng.'
      );
    } finally {
      setLoading(false);
    }
  }
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
    const unavailable = driveUnavailable(selected);
    if (unavailable) { setError(unavailable); return; }
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
      setShowDeclaration(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
      rememberDonation(result, selected.title);
      if (user) setOwnedRevision((current) => current + 1);
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
    setVerifiedSecret('');
    setActionMessage('');
    try {
      const result = await api<Tracking>(
        'logistics',
        `/public/donations/${encodeURIComponent(id)}`,
        { headers: secret ? { 'X-Donation-Secret': secret } : {}, credentials: guestCredentials }
      );
      if (version === lookupVersion.current) {
        setVerifiedSecret(secret);
        setTracking(result);
        if (!secret && result.can_manage) rememberDonation(result, undefined, Boolean(result.receipt));
        setTrackingFor(accountKey);
      }
    } catch (cause) {
      if (version === lookupVersion.current) {
        setError(cause instanceof Error ? cause.message : 'Không thể tra cứu đóng góp.');
      }
    } finally {
      if (version === lookupVersion.current) setLoading(false);
    }
  }
  function track(event: FormEvent) {
    event.preventDefault();
    setTrackingAttempted(true);
    if (donationTrackIdError) return;
    void lookupDonation(trackId, '');
  }
  function invalidateTracking() {
    lookupVersion.current += 1;
    setLoading(false);
    setTracking(null);
    setTrackingFor(null);
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
    const validationError = donationEvidenceError(file);
    if (validationError) { setActionMessage(validationError); return; }
    setLoading(true);
    setActionMessage('');
    try {
      uploadKey.current ||= newCommandKey();
      const result = await upload<{ id: string; state: string }>(
        'logistics',
        `/public/donations/${encodeURIComponent(tracking.id)}/evidence`,
        file,
        {
          idempotencyKey: uploadKey.current,
          headers: verifiedSecret ? { 'X-Donation-Secret': verifiedSecret } : {},
          credentials: guestCredentials,
        }
      );
      if (result.state === 'READY') {
        setUploadedEvidence(current => [...current.filter(item => item.id !== result.id),
          { id: result.id, donationId: tracking.id, name: file.name, owner: user?.id || null }]);
      }
      uploadKey.current = null;
      setFile(null);
      if (evidenceInput.current) evidenceInput.current.value = '';
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
  async function prepareEvidenceDownload(id: string) {
    setLoading(true);
    setEvidenceLink(null);
    setActionMessage('');
    try {
      const result = await api<{ url: string }>('logistics', `/evidence/${encodeURIComponent(id)}/download`, {
        headers: verifiedSecret ? { 'X-Donation-Secret': verifiedSecret } : {}, credentials: guestCredentials,
      });
      setEvidenceLink({ id, url: result.url });
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : 'Chưa mở được tệp minh chứng.');
    } finally { setLoading(false); }
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
      setVerifiedSecret('');
      setActionMessage('Bản khai đã được gắn với tài khoản của bạn.');
      rememberDonation(tracking, undefined, Boolean(tracking.receipt));
      setOwnedRevision((current) => current + 1);
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
      setOwnedRevision((current) => current + 1);
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
        <section className="card donation-lookup-card">
          <h2>Tra cứu đóng góp</h2>
          <p>Nhập định danh bản khai để xem tiến độ. Không cần mã bảo mật, dù bạn đã đăng nhập hay đang là khách.</p>
          <form className="form-stack" onSubmit={track} noValidate>
            <label>
              <span>Định danh bản khai <span className="required-mark" aria-hidden="true">*</span></span>
              <input
                ref={trackIdInput}
                aria-label="Định danh bản khai"
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
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-describedby="donation-lookup-id-hint"
              />
              <small id="donation-lookup-id-hint">Dùng định danh được cấp sau khi gửi bản khai, khác với mã phiếu ngắn.</small>
              {(trackingAttempted || trackingTouched.trackId) && donationTrackIdError && <small className="field-error" role="alert">{donationTrackIdError}</small>}
            </label>
            <button className="button" disabled={loading || Boolean(donationTrackIdError)}>
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
                  name="donation-public-code"
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
                  name="donation-recovery-code"
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
                  autoComplete="one-time-code"
                />
                {(recoveryAttempted || recoveryTouched.code) && donationRecoveryCodeError && <small className="field-error" role="alert">{donationRecoveryCodeError}</small>}
              </label>
              <button className="button secondary" disabled={loading || Boolean(donationRecoveryPublicError || donationRecoveryCodeError)}>
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
        {user && <section className="card donation-owned-list">
          <div className="section-header"><div><h2>Phiếu quyên góp của tôi</h2><p>Chọn một phiếu để xem trạng thái mới nhất.</p></div><button type="button" className="button secondary refresh-action" disabled={ownedLoading} onClick={() => setOwnedRevision((value) => value + 1)}>Làm mới danh sách</button></div>
          <form className="donation-history-search" onSubmit={(event) => { event.preventDefault(); if (ownedSearch.trim() === ownedSearchTerm) setOwnedRevision((value) => value + 1); else setOwnedSearchTerm(ownedSearch.trim()); }}>
            <label htmlFor="donation-history-search">Tìm theo mã phiếu, định danh hoặc đợt quyên góp</label>
            <div className="donation-lookup-code-row">
              <input id="donation-history-search" type="search" value={ownedSearch} maxLength={120} disabled={ownedLoading}
                onChange={(event) => setOwnedSearch(event.target.value)} placeholder="Nhập từ khóa cần tìm" />
              {ownedSearchTerm && <button type="button" className="button secondary" disabled={ownedLoading} onClick={() => { setOwnedSearch(''); setOwnedSearchTerm(''); }}>Xóa lọc</button>}
            </div>
          </form>
          {ownedLoading && <p role="status">Đang tải đóng góp của bạn…</p>}
          {ownedError && <p className="notice error" role="alert">{ownedError}</p>}
          {!ownedLoading && !ownedError && ownedFor === accountKey && !ownedDonations.length && <div className="donation-history-empty">
            {ownedSearchTerm ? <><p>Không tìm thấy phiếu quyên góp phù hợp.</p><button type="button" className="button secondary" onClick={() => { setOwnedSearch(''); setOwnedSearchTerm(''); }}>Xóa từ khóa tìm kiếm</button></>
              : <><p>Chưa có phiếu quyên góp nào gắn với tài khoản này.</p><button type="button" className="button secondary" onClick={() => trackIdInput.current?.focus()}>Tra cứu phiếu đã có</button></>}
          </div>}
          <div className="record-list">
            {(ownedFor === accountKey ? ownedDonations : []).map((donation) => <button type="button" key={donation.id}
              className="record record-clickable" aria-label={`Xem phiếu quyên góp ${donation.public_code}`}
              onClick={() => { setTrackId(donation.id); void lookupDonation(donation.id, ''); }}>
              <span><strong>{donation.drive_title}</strong><small>Phiếu {donation.public_code} · Tạo lúc {new Date(donation.created_at).toLocaleString('vi-VN')}</small></span>
              <span className="record-actions"><StatusBadge status={donation.status} /><small>{donation.has_count_result ? 'Đã có kết quả kiểm đếm' : 'Chờ kết quả kiểm đếm'}</small></span>
            </button>)}
          </div>
        </section>}
        {tracking && trackingFor === accountKey && (
          <DetailSurface modal open label="Chi tiết phiếu quyên góp" className="donation-tracking-dialog" onClose={invalidateTracking}>
            <div className="donation-tracking-heading">
              <div><h2>Đóng góp</h2><p>Mã phiếu: <strong>{tracking.public_code}</strong></p></div>
              <StatusBadge status={tracking.status} />
            </div>
            <DonationLookupCode key={tracking.id} id={tracking.id} />
            <h3>Đã khai báo</h3>
            <div className="donation-declaration-table">
              <table>
                <thead><tr><th scope="col">Tên vật phẩm</th><th scope="col">Số lượng</th></tr></thead>
                <tbody>
                  {tracking.declaration?.lines.map((line) => (
                    <tr key={line.item_id}>
                      <th scope="row">{line.item_name}</th>
                      <td>{formatQuantity(line.declared_quantity)} {line.unit_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tracking.receipt ? (
              <>
                <h3>Phiếu tiếp nhận và kết quả kiểm đếm</h3>
                <p>Mã phiếu: {tracking.public_code} · Lần kiểm đếm: {tracking.receipt.count_revision}</p>
                {tracking.status === 'PENDING_REVIEW' && <p className="notice" role="status">Đã có lượt kiểm đếm đầu tiên. Số lượng sẽ hiển thị sau khi người thứ hai xác nhận độc lập.</p>}
                {tracking.status !== 'PENDING_REVIEW' && <>
                <p className="receipt-count-scroll-hint">Cuộn ngang bảng để xem đủ các cột số lượng.</p>
                <div className="stock-table-scroll receipt-count-scroll" role="region" aria-label="Kết quả kiểm đếm đóng góp" tabIndex={0}>
                <table className="stock-table receipt-count-table">
                  <caption>Số lượng vật phẩm · lần kiểm đếm {tracking.receipt.count_revision}</caption>
                  <thead><tr><th scope="col">Vật phẩm</th><th scope="col">Khai báo</th><th scope="col">Kiểm đếm</th><th scope="col">Tiếp nhận</th><th scope="col">Tạm giữ</th><th scope="col">Từ chối</th></tr></thead>
                  <tbody>{tracking.receipt.lines.map((line, i) => {
                  const declared = tracking.declaration?.lines.find((item) => item.item_id === line.item_id);
                  const itemName = line.item_name || declared?.item_name || `Vật phẩm ${i + 1}`;
                  const unitName = line.unit_name || declared?.unit_name || '';
                  return (
                    <tr key={`${line.item_id}-${i}`}>
                      <th scope="row">{itemName}</th>
                      <td className="numeric">{formatQuantity(line.declared_quantity)} {unitName}</td>
                      <td className="numeric">{formatQuantity(line.counted_quantity)} {unitName}</td>
                      <td className="numeric">{formatQuantity(line.accepted_quantity)} {unitName}</td>
                      <td className="numeric">{formatQuantity(line.held_quantity)} {unitName}</td>
                      <td className="numeric">{formatQuantity(line.rejected_quantity)} {unitName}</td>
                    </tr>
                  );
                })}</tbody></table></div></>}
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
            {tracking.can_manage ? <>
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
              <button className="button donation-action" disabled={loading || Boolean(donationDisputeError)}>
                Gửi khiếu nại
              </button>
            </form>
            <form className="form-stack donation-evidence-form" onSubmit={attach}>
              <label>
                <span>Minh chứng riêng tư (JPEG, PNG hoặc MP4) <span className="required-mark" aria-hidden="true">*</span></span>
                <input
                  className="donation-file-input"
                  type="file"
                  ref={evidenceInput}
                  required
                  accept="image/jpeg,image/png,video/mp4"
                  aria-invalid={Boolean(evidenceError)}
                  aria-describedby={evidenceError ? 'donation-evidence-error' : undefined}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    uploadKey.current = null;
                    setActionMessage('');
                  }}
                />
              </label>
              <SelectedFiles files={file ? [file] : []} onRemove={() => { setFile(null); if (evidenceInput.current) evidenceInput.current.value = ''; uploadKey.current = null; }} />
              {evidenceError && <small className="field-error" id="donation-evidence-error" role="alert">{evidenceError}</small>}
              <button className="button donation-action" disabled={loading || !file || Boolean(evidenceError)}>
                Tải minh chứng lên
              </button>
            </form>
            {tracking.can_manage && (tracking.attachments?.length ?? 0) > 0 && <section>
              <h3>Tệp đã gửi cho lần bàn giao này</h3>
              {tracking.attachments!.map(item => <div key={item.id}>
                <p>{item.detected_mime === 'video/mp4' ? 'Video' : 'Ảnh'} · {Math.ceil(item.size_bytes / 1024)} KB · {new Date(item.created_at).toLocaleString('vi-VN')}</p>
                <button type="button" className="button secondary" disabled={loading} onClick={() => void prepareEvidenceDownload(item.id)}>Lấy liên kết mở tệp</button>
                {evidenceLink?.id === item.id && <p><a href={evidenceLink.url} target="_blank" rel="noopener noreferrer">Mở tệp trong tab mới</a> · Liên kết có thời hạn; lấy lại liên kết nếu đã hết hạn.</p>}
              </div>)}
            </section>}
            {uploadedEvidence.some(item => item.donationId === tracking.id && item.owner === (user?.id || null)) && <section>
              <h3>Tên tệp vừa tải trong phiên này</h3>
              <p>Tên tệp gốc chỉ có trong phiên này; danh sách đầy đủ các tệp đã gửi nằm ở mục phía trên.</p>
              {uploadedEvidence.filter(item => item.donationId === tracking.id && item.owner === (user?.id || null)).map(item => <div key={item.id}>
                <p style={{ overflowWrap: 'anywhere' }}>{item.name}</p>
                <button type="button" className="button secondary" disabled={loading} onClick={() => void prepareEvidenceDownload(item.id)}>Lấy liên kết mở tệp {item.name}</button>
                {evidenceLink?.id === item.id && <p><a href={evidenceLink.url} target="_blank" rel="noopener noreferrer">Mở tệp trong tab mới</a> · Liên kết có thời hạn; lấy lại liên kết nếu đã hết hạn.</p>}
              </div>)}
            </section>}
            {user && verifiedSecret && (
              <button className="button secondary" onClick={claim} disabled={loading}>
                Gắn bản khai với tài khoản
              </button>
            )}
            </> : <p className="notice donation-readonly-note">Bạn đang tra cứu bằng định danh. Các thao tác gửi khiếu nại hoặc minh chứng chỉ dành cho chủ phiếu.</p>}
            {actionMessage && (
              <p className="notice" role="status">
                {actionMessage}
              </p>
            )}
          </DetailSurface>
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
          Mã phiếu: <strong>{created.public_code}</strong>
        </p>
        <DonationLookupCode key={created.id} id={created.id} />
        <p>
          Trạng thái: {label(created.status)}. Vật phẩm chưa được ghi vào tồn kho cho đến khi kiểm
          đếm và duyệt.
        </p>
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
              ref={createdFileInput}
              required
              accept="image/jpeg,image/png,video/mp4"
              aria-invalid={Boolean(createdEvidenceError)}
              aria-describedby={createdEvidenceError ? 'created-donation-evidence-error' : undefined}
              onChange={(e) => { setCreatedFile(e.target.files?.[0] || null); setCreatedUploadMessage(''); }}
            />
          </label>
          <SelectedFiles files={createdFile ? [createdFile] : []} onRemove={() => { setCreatedFile(null); if (createdFileInput.current) createdFileInput.current.value = ''; }} />
          {createdEvidenceError && <small className="field-error" id="created-donation-evidence-error" role="alert">{createdEvidenceError}</small>}
          <button className="button donation-action" disabled={loading || !createdFile || Boolean(createdEvidenceError)}>
            Tải ảnh kiện hàng lên
          </button>
          {createdUploadMessage && (
            createdUploadMessage.startsWith('Đã tải')
              ? <SuccessBanner title="Tải ảnh kiện hàng thành công" description="Ảnh đã được đính kèm vào phiếu khai báo của bạn." />
              : <p className="notice error" role="alert">{createdUploadMessage}</p>
          )}
        </form>
        <div style={{ marginTop: '1rem' }}>
          <button
            className="button"
            onClick={() => {
              setView('donation');
              setTrackId(created.id);
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
      <button type="button" className="button" disabled={Boolean(driveUnavailable(drive))} onClick={() => choose(drive.id, true)}>
        Khai báo vật phẩm
      </button>
    </div>
  );
  return (
    <>{nav}
    <div className="donation-layout">
      <section className="card">
        <h2>Các đợt quyên góp</h2>
        <div className="donation-nearest">
          {position
            ? <button type="button" className="button secondary" onClick={() => setPosition(null)}>Bỏ sắp xếp theo vị trí</button>
            : <button type="button" className="button secondary" disabled={locating} onClick={locateMe}>{locating ? 'Đang lấy vị trí…' : 'Tìm đợt gần tôi'}</button>}
          {locationError && <p className="notice warning" role="alert">{locationError}</p>}
          {position && nearest && <p className="notice" role="status">
            Đợt gần bạn nhất: <strong>{nearest.title}</strong> · {nearest.intake_location?.warehouse_name} · cách khoảng {distanceLabel(nearest.distance_m!)}.{' '}
            <button type="button" className="button" onClick={() => choose(nearest.id, true)}>Khai báo cho đợt này</button>
          </p>}
          {mapDrives.length > 0 && <DriveNearbyMap drives={mapDrives} position={position} selectedId={selected?.id ?? null} onSelect={(id) => void choose(id)} />}
          {position && !drivePages.loading && drives.length > 0 && !nearest && <p className="muted">Các kho nhận hàng chưa công khai vị trí nên chưa tính được khoảng cách. Vui lòng chọn đợt trong danh sách.</p>}
        </div>
        {(loading || drivePages.loading) && <p role="status">Đang tải…</p>}
        {(error || drivePages.error) && (
          <p className="notice error" role="alert">
            {error || drivePages.error}
          </p>
        )}
        {!drivePages.loading && !drivePages.error && !drives.length && (
          <div className="empty">Hiện chưa có đợt quyên góp đang mở.</div>
        )}
        <div className="record-list">
          {drives.map((drive) => (
            <article className="record donation-drive-card" key={drive.id}>
              <div className="donation-drive-header">
                <div>
                  <strong>{drive.title}</strong>
                  <p>{drive.description}</p>
                  <small>Điểm tiếp nhận: {drive.intake_location?.warehouse_name}{typeof drive.distance_m === 'number' ? ` · cách khoảng ${distanceLabel(drive.distance_m)}` : ''}</small>
                  {drive.opens_at && <p>Bắt đầu nhận: {new Date(drive.opens_at).toLocaleString('vi-VN')}</p>}
                  {drive.closes_at && <p>Hạn nhận: {new Date(drive.closes_at).toLocaleString('vi-VN')}</p>}
                  {driveUnavailable(drive) && <p className="notice warning">{driveUnavailable(drive)}</p>}
                </div>
                {selected?.id !== drive.id && driveActions(drive)}
              </div>
              {selected?.id === drive.id && (
                <div className="donation-drive-detail" ref={selectedCardRef}>
                  <p>{selected.intake_location?.address_note}</p>
                  {selected.items.some(item => !quantityFitsScale(item.target_quantity, item.scale) || !quantityFitsScale(item.accepted_total, item.scale)) &&
                    <p className="notice warning" role="status">Một số số liệu tiếp nhận chưa phù hợp với đơn vị vật phẩm. Các dòng này cần được kiểm tra trước khi xác định số lượng còn cần; vui lòng xác nhận với điểm tiếp nhận.</p>}
                  <p className="table-swipe-hint">Vuốt ngang bảng để xem đầy đủ các cột.</p>
                  <div className="stock-table-scroll">
                    <table className="stock-table donation-item-table">
                      <thead><tr><th scope="col">Vật phẩm</th><th scope="col" className="numeric">Số lượng mục tiêu</th><th scope="col" className="numeric">Số lượng tiếp nhận</th></tr></thead>
                      <tbody>
                        {selected.items.map((item) => {
                          const compatible = quantityFitsScale(item.target_quantity, item.scale) && quantityFitsScale(item.accepted_total, item.scale);
                          return <tr key={item.item_id}>
                            <th scope="row"><strong>{item.item_name}</strong></th>
                            <td className="numeric" data-label="Mục tiêu">{formatQuantity(item.target_quantity)} {item.unit_name}</td>
                            <td className="numeric" data-label="Đã tiếp nhận"><span className="available-value">{formatQuantity(item.accepted_total)} {item.unit_name}</span>{!compatible && <small>Cần kiểm tra số liệu</small>}</td>
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
        <Pager page={drivePages.page} hasNext={drivePages.hasNext} loading={drivePages.loading}
          onPrev={() => { setSelected(null); drivePages.prev(); }} onNext={() => { setSelected(null); drivePages.next(); }} count={drives.length} noun="đợt" />
      </section>
      {selected && showDeclaration && <div className={`donation-modal-backdrop ${closingDeclaration ? 'is-closing' : ''}`} onClick={(event) => event.stopPropagation()}>
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
                    value={donorPhone}
                    onChange={(e) => {
                      setDonorPhone(e.target.value);
                      setDeclarationTouched((current) => ({ ...current, donorPhone: true }));
                      pending.current = null;
                    }}
                    onBlur={() => setDeclarationTouched((current) => ({ ...current, donorPhone: true }))}
                  />
                  {(declarationAttempted || declarationTouched.donorPhone) && declarationErrors.donorPhone && <small className="field-error" role="alert">{declarationErrors.donorPhone}</small>}
                </label>
              </div>
              <div className="donation-declaration-items">
                {selected.items.map((item) => {
                  const compatible = quantityFitsScale(item.target_quantity, item.scale) && quantityFitsScale(item.accepted_total, item.scale);
                  const remaining = compatible ? remainingQuantity(item.target_quantity, item.accepted_total) : null;
                  const quantityError = declarationErrors[`quantity:${item.item_id}`];
                  const showQuantityError = (declarationAttempted || declarationTouched[`quantity:${item.item_id}`]) && quantityError;
                  return (
                    <div className="donation-declaration-item" key={item.item_id}>
                      <div className="donation-declaration-item-info">
                        <strong>{item.item_name}</strong>
                        {compatible && remaining !== null ? (
                          <div className="donation-declaration-stats" id={`declaration-progress-${item.item_id}`}>
                            <span><span>Mục tiêu</span><strong>{formatQuantity(item.target_quantity)} {item.unit_name}</strong></span>
                            <span><span>Đã nhập kho</span><strong>{formatQuantity(item.accepted_total)} {item.unit_name}</strong></span>
                            <span>
                              <span>{remaining === '0' ? 'Tiến độ' : 'Còn cần'}</span>
                              <strong className={remaining === '0' ? 'is-complete' : 'is-remaining'}>
                                {remaining === '0' ? 'Đã đủ' : `${formatQuantity(remaining)} ${item.unit_name}`}
                              </strong>
                            </span>
                          </div>
                        ) : (
                          <small className="donation-declaration-progress-unavailable">
                            Chưa xác định được số lượng còn cần; vui lòng xác nhận với điểm tiếp nhận.
                          </small>
                        )}

                      </div>
                      <label className="donation-declaration-quantity">
                        <span>Số lượng dự kiến ({item.unit_name})</span>
                        <input
                          type="number"
                          min="0"
                          step={item.scale ? 1 / 10 ** item.scale : 1}
                          aria-describedby={compatible && remaining !== null ? `declaration-progress-${item.item_id}` : undefined}
                          aria-invalid={Boolean((declarationAttempted || declarationTouched[`quantity:${item.item_id}`]) && quantityError)}
                          value={quantities[item.item_id] || ''}
                          onChange={(e) => {
                            setQuantities({ ...quantities, [item.item_id]: e.target.value });
                            setDeclarationTouched((current) => ({ ...current, [`quantity:${item.item_id}`]: true }));
                            pending.current = null;
                          }}
                          onBlur={() => setDeclarationTouched((current) => ({ ...current, [`quantity:${item.item_id}`]: true }))}
                          placeholder="Nhập số lượng"
                        />
                      </label>
                      {showQuantityError && <small className="field-error" role="alert">{quantityError}</small>}
                    </div>
                  );
                })}
              </div>
              {selected.items[0] && (declarationAttempted || Object.keys(declarationTouched).some((field) => field.startsWith('quantity:'))) && !hasPositiveQuantity && <small className="field-error" role="alert">Số lượng của ít nhất một vật phẩm là bắt buộc.</small>}
              <p className="notice">
                Bản khai chỉ ghi số dự kiến. Nhân viên sẽ đếm thực tế, người khác duyệt độc lập rồi
                mới ghi sổ kho.
              </p>
              <button
                className="button"
                disabled={
                  loading ||
                  declarationInvalid ||
                  Boolean(driveUnavailable(selected))
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
