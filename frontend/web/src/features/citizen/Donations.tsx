import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, upload } from '../../api/client';
import { label } from '../../i18n/labels';
import { formatQuantity } from '../../i18n/quantity';
import type { Me } from '../../auth/session';
import { confirmAction } from '../../components/confirmAction';

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

export function Donations({
  page,
  user,
}: {
  page: 'drives' | 'declare' | 'donation';
  user: Me | null;
}) {
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
  const guestCredentials = user ? ('include' as const) : ('omit' as const);
  const [showCreatedTracking, setShowCreatedTracking] = useState(false);
  useEffect(() => {
    setShowCreatedTracking(false);
    setError('');
  }, [page]);
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
    if (page === 'donation') return;
    let live = true;
    setLoading(true);
    setError('');
    api<{ items: Drive[] }>('logistics', '/public/donation-drives')
      .then((result) => {
        if (live) setDrives(result.items);
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
  }, [page]);
  async function choose(id: string) {
    setError('');
    setLoading(true);
    try {
      setSelected(await api('logistics', `/public/donation-drives/${encodeURIComponent(id)}`));
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
    setError('');
    if (!donorName.trim()) {
      setError('Vui lòng nhập họ tên người đóng góp.');
      return;
    }
    const digits = donorPhone.replace(/\D/g, '');
    if (!/^[+0-9 ()-]+$/.test(donorPhone.trim()) || digits.length < 8 || digits.length > 15) {
      setError('Số điện thoại người đóng góp cần có 8–15 chữ số và không chứa chữ cái.');
      return;
    }
    for (const item of selected.items) {
      const value = quantities[item.item_id]?.trim();
      if (!value) continue;
      if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) < 0) {
        setError(`${item.item_name}: số lượng phải là số không âm.`);
        return;
      }
      if ((value.split('.')[1]?.length || 0) > item.scale) {
        setError(`${item.item_name}: chỉ được có tối đa ${item.scale} chữ số thập phân.`);
        return;
      }
    }
    setLoading(true);
    try {
      let command = pending.current;
      if (!command) {
        const lines = selected.items
          .filter((item) => quantities[item.item_id] && Number(quantities[item.item_id]) > 0)
          .map((item) => ({ item_id: item.item_id, declared_quantity: quantities[item.item_id] }));
        if (!lines.length) throw new Error('Vui lòng nhập số lượng cho ít nhất một vật phẩm.');
        command = {
          key: newCommandKey(),
          secret: user ? '' : secret32(),
          driveId: selected.id,
          body: { donor_name: donorName.trim(), donor_phone: donorPhone.trim(), lines },
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
  async function track(event: FormEvent) {
    event.preventDefault();
    const version = ++lookupVersion.current;
    const id = trackId.trim();
    const secret = trackSecret.trim();
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
    setLoading(true);
    setRecoveryMessage('');
    try {
      recoveryKey.current ||= newCommandKey();
      await api('logistics', '/public/donations/recover', {
        method: 'POST',
        body: { public_code: recoveryPublicCode.trim() },
        headers: { 'X-Recovery-Code': recoveryCode.trim() },
        idempotencyKey: recoveryKey.current,
      });
      recoveryKey.current = null;
      setRecoveryCode('');
      setRecoveryMessage(
        'Bản khai đã được gắn với tài khoản. Hãy tra cứu bằng định danh bản khai.'
      );
    } catch (cause) {
      setRecoveryMessage(cause instanceof Error ? cause.message : 'Chưa khôi phục được bản khai.');
    } finally {
      setLoading(false);
    }
  }
  if (page === 'donation' || showCreatedTracking)
    return (
      <div className="grid-two donation-layout">
        <section className="card">
          <h2>Tra cứu đóng góp</h2>
          <p>Nhập định danh bản khai và mã bảo mật riêng tư. Mã bảo mật không nằm trong URL.</p>
          <form className="form-stack" onSubmit={track}>
            <label>
              Định danh bản khai
              <input
                required
                disabled={loading}
                value={trackId}
                onChange={(e) => {
                  setTrackId(e.target.value);
                  invalidateTracking();
                }}
                autoComplete="off"
              />
            </label>
            <label>
              Mã bảo mật (nếu khai với tư cách khách)
              <input
                type="password"
                disabled={loading}
                value={trackSecret}
                onChange={(e) => {
                  setTrackSecret(e.target.value);
                  invalidateTracking();
                }}
                autoComplete="off"
              />
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
            <form className="form-stack command-form" onSubmit={recover}>
              <h3>Khôi phục bản khai</h3>
              <p>Nhập mã một lần do nhân viên tiếp nhận cấp sau khi xác minh liên hệ.</p>
              <label>
                Mã bản khai công khai
                <input
                  required
                  value={recoveryPublicCode}
                  onChange={(event) => {
                    setRecoveryPublicCode(event.target.value);
                    recoveryKey.current = null;
                  }}
                  autoComplete="off"
                />
              </label>
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
              <button className="button secondary" disabled={loading}>
                Gắn bản khai với tài khoản
              </button>
              {recoveryMessage && (
                <p className="notice" role="status">
                  {recoveryMessage}
                </p>
              )}
            </form>
          )}
        </section>
        {tracking && (
          <section className="card">
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
            <form className="form-stack donation-dispute-form" onSubmit={dispute}>
              <label>
                Nội dung cần rà soát
                <textarea
                  required
                  value={disputeReason}
                  onChange={(event) => {
                    setDisputeReason(event.target.value);
                    disputeKey.current = null;
                  }}
                />
              </label>
              <button className="button donation-action" disabled={loading}>
                Gửi khiếu nại
              </button>
            </form>
            <form className="form-stack donation-evidence-form" onSubmit={attach}>
              <label>
                Minh chứng riêng tư (JPEG, PNG hoặc MP4)
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
    );
  if (created)
    return (
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
            Chọn tệp ảnh (JPEG, PNG hoặc MP4)
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
              setTrackId(created.id);
              setTrackSecret(createdSecret);
              setCreated(null);
              setCreatedSecret('');
              setShowCreatedTracking(true);
            }}
          >
            Chuyển đến màn hình tra cứu đóng góp này
          </button>
        </div>
      </section>
    );
  return (
    <div className="grid-two donation-layout">
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
            <article className="record" key={drive.id}>
              <div>
                <strong>{drive.title}</strong>
                <p>{drive.description}</p>
                <small>{drive.intake_location?.warehouse_name}</small>
              </div>
              <button type="button" className="button secondary" onClick={() => choose(drive.id)}>
                Xem vật phẩm
              </button>
            </article>
          ))}
        </div>
      </section>
      {selected && (
        <section className="card">
          <h2>{selected.title}</h2>
          <p>{selected.description}</p>
          <p>
            Điểm tiếp nhận: {selected.intake_location?.warehouse_name} ·{' '}
            {selected.intake_location?.address_note}
          </p>
          {page === 'declare' && (
            <form className="form-stack" onSubmit={declare} noValidate>
              <div className="form-grid">
                <label>
                  Họ tên người đóng góp
                  <input
                    required
                    value={donorName}
                    onChange={(e) => {
                      setDonorName(e.target.value);
                      pending.current = null;
                    }}
                  />
                </label>
                <label>
                  Số điện thoại
                  <input
                    required
                    type="tel"
                    value={donorPhone}
                    onChange={(e) => {
                      setDonorPhone(e.target.value);
                      pending.current = null;
                    }}
                  />
                </label>
              </div>
              {selected.items.map((item) => (
                <label key={item.item_id}>
                  {item.item_name} · {item.unit_name}
                  <input
                    type="number"
                    min="0"
                    step={item.scale ? 1 / 10 ** item.scale : 1}
                    value={quantities[item.item_id] || ''}
                    onChange={(e) => {
                      setQuantities({ ...quantities, [item.item_id]: e.target.value });
                      pending.current = null;
                    }}
                    placeholder="Số lượng dự kiến bàn giao"
                  />
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
                  (selected.campaign_status != null && selected.campaign_status !== 'ACTIVE')
                }
              >
                Gửi bản khai vật phẩm
              </button>
            </form>
          )}
          {page === 'drives' && (
            <div>
              {selected.items.map((item) => (
                <p key={item.item_id}>
                  {item.item_name} · đã chấp nhận {formatQuantity(item.accepted_total)}{' '}
                  {item.unit_name} / mục tiêu {formatQuantity(item.target_quantity)}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
