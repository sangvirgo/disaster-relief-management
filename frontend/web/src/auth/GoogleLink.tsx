import { useEffect, useRef, useState } from 'react';
import { linkGoogle, type Me } from './session';

export function GoogleLink({ user }: { user: Me }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const button = useRef<HTMLDivElement>(null);
  const credential = useRef('');
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!open || !clientId) return;
    let active = true;
    setReady(false);
    const render = () => {
      if (!active || !button.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (!active || !response.credential) return;
          credential.current = response.credential;
          setSelected(true);
          setError('');
        },
      });
      button.current.replaceChildren();
      window.google.accounts.id.renderButton(button.current, {
        theme: 'outline', size: 'large', text: 'continue_with', locale: 'vi',
        width: Math.min(400, Math.floor(button.current.getBoundingClientRect().width)),
      });
      setReady(true);
    };
    const failed = () => { if (active) setError('Không tải được Google. Kiểm tra kết nối rồi đóng và mở lại phần liên kết.'); };
    let script = document.querySelector<HTMLScriptElement>('script[data-c48-google="true"]');
    if (window.google) render();
    else {
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.dataset.c48Google = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
      script.addEventListener('error', failed);
    }
    const timeout = window.setTimeout(() => { if (!window.google) failed(); }, 15000);
    return () => {
      active = false;
      credential.current = '';
      window.clearTimeout(timeout);
      script?.removeEventListener('load', render);
      script?.removeEventListener('error', failed);
    };
  }, [open, clientId]);

  async function confirm() {
    if (!credential.current || busy) return;
    setBusy(true);
    setError('');
    try {
      await linkGoogle(credential.current);
      setSuccess(true);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể liên kết Google.');
    } finally {
      credential.current = '';
      setSelected(false);
      setBusy(false);
    }
  }

  if (!clientId) return null;
  return <section className="card" aria-label="Bảo mật và liên kết Google">
    <h2>Đăng nhập bằng Google</h2>
    <p>Tùy chọn: dùng Google để đăng nhập vào tài khoản <strong>{user.username}</strong>, giữ nguyên dữ liệu hiện có.</p>
    {success && <p className="notice success" role="status">Đã liên kết Google thành công. Bạn có thể dùng Google để đăng nhập vào tài khoản Reliva này.</p>}
    {!open && !success && <button className="button secondary" type="button" onClick={() => { setError(''); setSelected(false); setOpen(true); }}>Liên kết tài khoản Google</button>}
    {open && <>
      <p>Chọn Google của bạn rồi xác nhận liên kết. Nếu phiên đăng nhập quá 15 phút, hãy đăng nhập lại Reliva trước khi tiếp tục.</p>
      {!ready && !error && <p role="status">Đang tải nút Google…</p>}
      <div ref={button} aria-label="Chọn Google để liên kết" hidden={busy || selected} />
      {selected && <p role="status">Đã nhận xác thực Google. Xác nhận để cho phép Google vừa chọn đăng nhập vào tài khoản {user.username}.</p>}
      <div className="account-actions">
        <button type="button" className="button" disabled={!selected || busy} onClick={() => void confirm()}>{busy ? 'Đang liên kết…' : 'Xác nhận liên kết'}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => { credential.current = ''; setSelected(false); setOpen(false); setError(''); }}>Đóng</button>
      </div>
    </>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>;
}
