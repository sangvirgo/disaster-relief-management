import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { label } from '../../i18n/labels';

type Kind = 'cancel' | 'resolve';
export function AsyncRequestForm({ requestId, version, kind, onCompleted }: { requestId: string; version: number; kind: Kind; onCompleted: () => void }) {
  const [reason, setReason] = useState(''); const [basis, setBasis] = useState(''); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [operationId, setOperationId] = useState(''); const [state, setState] = useState('');
  const key = useRef<string | null>(null);
  useEffect(() => { if (!operationId || ['COMPLETED', 'ABORTED'].includes(state)) return; let active = true; let checking = false;
    async function check() { if (checking) return; checking = true;
      try { const result = await api<{ state: string }>('response', `/operations/${operationId}`);
        if (active) { setState(result.state); if (result.state === 'COMPLETED') { key.current = null; onCompleted(); } } }
      catch (cause) { if (active) setMessage(cause instanceof Error ? cause.message : 'Chưa tải được tiến độ xử lý.'); }
      finally { checking = false; }
    }
    void check(); const timer = window.setInterval(check, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [operationId, state, onCompleted]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!window.confirm(kind === 'cancel' ? 'Xác nhận hủy yêu cầu này?' : 'Xác nhận đề nghị kết thúc xử lý yêu cầu này?')) return;
    setBusy(true); setMessage('');
    try { key.current ||= newCommandKey(); const result = await api<{ operation_id: string; state: string }>('response', `/requests/${requestId}/${kind}`, {
      method: 'POST', idempotencyKey: key.current,
      body: kind === 'cancel' ? { expected_version: version, reason: reason.trim() }
        : { expected_version: version, resolution_reason: reason.trim(), outcome_basis: basis },
    }); setOperationId(result.operation_id); setState(result.state); setMessage('Máy chủ đã nhận lệnh xử lý. Đang kiểm tra kết quả cuối cùng.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Lệnh chưa được xác nhận.'); }
    finally { setBusy(false); }
  }
  return <form className="form-stack command-form" onSubmit={submit}><h3>{kind === 'cancel' ? 'Hủy yêu cầu' : 'Kết thúc xử lý yêu cầu'}</h3>
    {!operationId && <><label>Lý do<textarea required value={reason} onChange={(event) => { setReason(event.target.value); key.current = null; }} /></label>
      {kind === 'resolve' && <label>Căn cứ kết thúc<select required value={basis} onChange={(event) => { setBasis(event.target.value); key.current = null; }}><option value="">Chọn căn cứ</option><option value="RESCUE_COMPLETED">Nhiệm vụ cứu hộ đã hoàn thành</option><option value="SUPPLY_ONLY">Chỉ hỗ trợ vật tư và đã bàn giao</option><option value="NO_ACTION_REQUIRED">Không còn cần hành động</option></select></label>}
      <button className="button" disabled={busy}>{busy ? 'Đang gửi lệnh…' : kind === 'cancel' ? 'Xác nhận hủy' : 'Gửi đề nghị kết thúc'}</button></>}
    {operationId && <p className="notice" role="status">Tiến độ xử lý: {label(state)}. {state !== 'COMPLETED' && 'Yêu cầu chưa có kết quả cuối cùng.'}</p>}
    {message && <p className="notice" role="status">{message}</p>}
  </form>;
}
