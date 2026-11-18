import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { Me } from '../../auth/session';
import { confirmAction } from '../../components/confirmAction';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { timeLabel } from '../../i18n/labels';
import { formatQuantity } from '../../i18n/quantity';
import { readPickup, sendPickupCommand } from './pickupCommands';
import { CloseoutPanel } from './CloseoutPanel';
import { DeliveryForm } from './DeliveryForm';
import {
  canPickupAction,
  MISSION_CAN_HAVE_TICKET,
  permissionsForRoles,
  selfActionBlock,
  type PickupActionKey,
  type PickupCloseout,
  type PickupTicket,
  type PickupTicketList,
  type PickupTicketLine,
} from './pickupRules';
import {
  actorLabel,
  pickupErrorCode,
  pickupErrorMessage,
  pickupStatusLabels,
  pickupStatusTone,
  type PickupStatus,
} from './pickupCopy';
import './pickup.css';

type Notice = { tone: 'success' | 'error' | 'warning'; text: string } | null;
type LoadState = 'loading' | 'ready' | 'empty' | 'error';
interface RosterMember { user_id: string; display_name: string }

const STEPS: { id: PickupStatus; text: string }[] = [
  { id: 'OPEN', text: 'Mới tạo' },
  { id: 'READY', text: 'Sẵn sàng' },
  { id: 'HANDED_OVER', text: 'Đã bàn giao' },
  { id: 'CLOSED', text: 'Đã đóng' },
];

/** Reloads the ticket that belongs to a mission, preferring a live (non-cancelled) one. */
async function findMissionTicket(missionId: string): Promise<PickupTicket | null> {
  const page = await readPickup<PickupTicketList>(`/pickup-tickets?mission_id=${encodeURIComponent(missionId)}&limit=5`);
  const found = page.items.find((item) => item.status !== 'CANCELLED') ?? page.items[0];
  return (found as PickupTicket | undefined) ?? null;
}

function PickupStepper({ status }: { status: PickupStatus }) {
  const cancelled = status === 'CANCELLED';
  const current = STEPS.findIndex((step) => step.id === status);
  const items = cancelled ? [...STEPS, { id: 'CANCELLED' as PickupStatus, text: 'Đã hủy' }] : STEPS;
  return (
    <ol className="pickup-stepper" aria-label="Tiến trình phiếu lấy hàng">
      {items.map((step, index) => {
        const isCurrent = step.id === status;
        const isDone = !cancelled && current > index;
        const className = ['pickup-stepper__step', isDone && 'is-done', isCurrent && 'is-current',
          isCurrent && cancelled && 'is-cancelled'].filter(Boolean).join(' ');
        return (
          <li key={step.id} className={className} aria-current={isCurrent ? 'step' : undefined}>
            <span className="pickup-stepper__dot" aria-hidden="true">{isDone ? '' : index + 1}</span>
            <span className="pickup-stepper__text">{step.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PickupLines({ lines }: { lines: PickupTicketLine[] }) {
  if (lines.length === 0) return <p className="pickup-muted">Phiếu chưa có mặt hàng nào.</p>;
  return (
    <div className="pickup-table-wrap">
      <table className="pickup-table">
        <caption className="pickup-visually-hidden">Mặt hàng cần lấy trong phiếu</caption>
        <thead>
          <tr>
            <th scope="col">Mặt hàng</th>
            <th scope="col" className="pickup-num">Yêu cầu</th>
            <th scope="col" className="pickup-num">Đã giữ</th>
            <th scope="col" className="pickup-num">Còn thiếu</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={`${line.relief_need_id}:${line.item_id}`}>
              <th scope="row">{line.item_name}</th>
              <td className="pickup-num">{formatQuantity(line.requested_quantity)} {line.unit_code}</td>
              <td className="pickup-num">{formatQuantity(line.reserved_quantity)} {line.unit_code}</td>
              <td className="pickup-num">
                {Number(line.shortfall_quantity) > 0
                  ? `${formatQuantity(line.shortfall_quantity)} ${line.unit_code}`
                  : 'Đủ'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PickupTicketPanelProps {
  user: Me;
  /** Response mission id. Used to find or create the ticket. */
  missionId?: string;
  /** Response mission status; a ticket is created only while the team has accepted the mission. */
  missionStatus?: string;
  /** Load one ticket directly (ticket list page). */
  ticketId?: string;
  headingLevel?: 2 | 3;
  onChanged?: () => void;
}

export function PickupTicketPanel({ user, missionId, missionStatus, ticketId, headingLevel = 3, onChanged }: PickupTicketPanelProps) {
  const granted = useMemo(() => permissionsForRoles(user.grants.map((grant) => grant.role_code)), [user]);
  const titleId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const [ticket, setTicket] = useState<PickupTicket | null>(null);
  const [closeout, setCloseout] = useState<PickupCloseout | null>(null);
  const [closeoutError, setCloseoutError] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<PickupActionKey | null>(null);
  const [collector, setCollector] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [rosterNote, setRosterNote] = useState('');
  const loadSeq = useRef(0);

  const canView = granted.has('PICKUP_TICKET_VIEW');
  const can = (action: PickupActionKey) => canPickupAction(action, granted);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const next = ticketId
        ? await readPickup<PickupTicket>(`/pickup-tickets/${encodeURIComponent(ticketId)}`)
        : missionId ? await findMissionTicket(missionId) : null;
      if (seq !== loadSeq.current) return;
      setTicket(next);
      setState(next ? 'ready' : 'empty');
      setLoadError('');
      if (next && (next.status === 'HANDED_OVER' || next.status === 'CLOSED')) {
        try {
          const view = await readPickup<PickupCloseout>(`/pickup-tickets/${encodeURIComponent(next.id)}/closeout`);
          if (seq === loadSeq.current) { setCloseout(view); setCloseoutError(''); }
        } catch (error) {
          if (seq === loadSeq.current) { setCloseout(null); setCloseoutError(pickupErrorMessage(error, 'closeoutView')); }
        }
      } else {
        setCloseout(null);
        setCloseoutError('');
      }
    } catch (error) {
      if (seq !== loadSeq.current) return;
      setState('error');
      setLoadError(pickupErrorMessage(error, 'load'));
    }
  }, [ticketId, missionId]);

  useEffect(() => {
    if (!canView) return;
    setState('loading');
    void load();
  }, [canView, load]);

  // Roster is needed only to name the collector at handover; it is not loaded for other steps.
  const teamId = ticket?.team_id ?? null;
  const needsRoster = Boolean(ticket && ticket.status === 'READY' && ticket.confirmed_at && can('handover') && teamId);
  useEffect(() => {
    if (!needsRoster || !teamId) return;
    let live = true;
    api<{ items: RosterMember[] }>('response', `/teams/${encodeURIComponent(teamId)}/members?limit=100`)
      .then((page) => { if (live) { setRoster(page.items); setRosterNote(''); } })
      .catch(() => {
        if (live) {
          setRoster([]);
          setRosterNote('Danh sách đội chưa hiển thị với tài khoản này. Vẫn có thể bàn giao; hệ thống sẽ không ghi tên người nhận.');
        }
      });
    return () => { live = false; };
  }, [needsRoster, teamId]);

  if (!canView) return null;

  async function runCommand(action: PickupActionKey, scope: string, path: string, body: unknown, success: string): Promise<boolean> {
    setBusy(action);
    setNotice(null);
    try {
      await sendPickupCommand(scope, path, body);
      setNotice({ tone: 'success', text: success });
      await load();
      onChanged?.();
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: pickupErrorMessage(error, action) });
      const code = pickupErrorCode(error);
      if (code && ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'APPROVAL_STALE', 'ALREADY_DISPATCHED'].includes(code)) {
        await load();
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  const id = ticket?.id ?? '';
  const version = ticket?.version ?? 0;
  const canCreate = can('create') && Boolean(missionId) && (!missionStatus || (MISSION_CAN_HAVE_TICKET as readonly string[]).includes(missionStatus));
  const cancellable = ticket !== null && can('cancel') && (
    ticket.status === 'OPEN'
    || (ticket.status === 'READY' && (ticket.reserved_by === user.id || ticket.confirmed_by === user.id))
  );
  const confirmBlock = ticket ? selfActionBlock('confirm', user.id, ticket) : null;
  const handoverBlock = ticket ? selfActionBlock('handover', user.id, ticket) : null;
  const unaccounted = Boolean(ticket?.unaccounted_goods);
  const overdue = Boolean(ticket?.handover_overdue);
  const showDelivery = ticket?.status === 'HANDED_OVER' && can('delivery');
  const showCloseout = ticket !== null && (ticket.status === 'HANDED_OVER' || ticket.status === 'CLOSED');

  return (
    <section className="card pickup-panel" aria-labelledby={titleId}>
      <header className="pickup-panel__header">
        <Heading id={titleId} className="pickup-panel__title">Phiếu lấy hàng</Heading>
        {ticket && <Badge tone={pickupStatusTone[ticket.status]} title={pickupStatusLabels[ticket.status]}>{pickupStatusLabels[ticket.status]}</Badge>}
        <Button variant="ghost" size="sm" onClick={() => { setState('loading'); void load(); }}
          disabled={state === 'loading' || busy !== null} aria-label="Tải lại phiếu lấy hàng">Tải lại</Button>
      </header>

      {state === 'loading' && <Skeleton rows={3} label="Đang tải phiếu lấy hàng…" />}

      {state === 'error' && (
        <div className="notice error pickup-notice" role="alert">
          <p>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={() => { setState('loading'); void load(); }}>Thử lại</Button>
        </div>
      )}

      {state === 'empty' && (
        <EmptyState
          title="Chưa có phiếu lấy hàng"
          description={canCreate || !missionId
            ? 'Phiếu gom các nhu cầu của nhiệm vụ để giữ hàng tại kho chính.'
            : 'Phiếu được lập sau khi đội nhận nhiệm vụ.'}
          action={canCreate ? (
            <Button size="sm" loading={busy === 'create'} disabled={busy !== null && busy !== 'create'}
              onClick={() => void runCommand('create', `create:${missionId}`, '/pickup-tickets', { mission_id: missionId },
                'Đã lập phiếu lấy hàng cho nhiệm vụ.')}>
              Tạo phiếu
            </Button>
          ) : undefined}
        />
      )}

      {state === 'ready' && ticket && (
        <div className="pickup-panel__body">
          <PickupStepper status={ticket.status} />

          {notice && (
            <p className={`notice pickup-notice ${notice.tone === 'error' ? 'error' : notice.tone === 'warning' ? 'warning' : 'success'}`}
              role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>
          )}
          {unaccounted && (
            <p className="notice warning pickup-notice" role="status">
              Phiếu còn hàng chưa đối soát. Cần giao, trả lại hoặc hủy hết hàng trước khi SOS được kết thúc.
            </p>
          )}
          {overdue && (
            <p className="notice warning pickup-notice" role="status">
              Đã quá 48 giờ kể từ khi bàn giao nhưng hàng vẫn chưa được ghi nhận đầy đủ. Cần giao hoặc đối soát ngay.
            </p>
          )}

          <PickupLines lines={ticket.lines} />

          {(ticket.backup_warehouses?.length ?? 0) > 0 && (
            <div className="pickup-hints">
              <h4 className="pickup-hints__title">Kho dự phòng còn hàng</h4>
              <ul>
                {ticket.backup_warehouses!.map((backup) => {
                  const line = ticket.lines.find((item) => item.item_id === backup.item_id);
                  return (
                    <li key={`${backup.warehouse_id}:${backup.item_id}`}>
                      {line?.item_name ?? 'Mặt hàng'}: còn {formatQuantity(backup.available_quantity)} {line?.unit_code ?? ''}
                      {' '}tại kho mã …{backup.warehouse_id.slice(-8)}. Chỉ là gợi ý; chưa có hàng nào được chuyển.
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <dl className="pickup-facts">
            <div><dt>Mã kho</dt><dd>…{ticket.warehouse_id.slice(-8)}</dd></div>
            <div><dt>Giữ hàng</dt><dd>{actorLabel(ticket.reserved_by, user.id)}</dd></div>
            <div>
              <dt>Xác nhận</dt>
              <dd>{ticket.confirmed_at ? `${actorLabel(ticket.confirmed_by, user.id)} · ${timeLabel(ticket.confirmed_at)}` : 'Chưa xác nhận'}</dd>
            </div>
            <div>
              <dt>Bàn giao</dt>
              <dd>{ticket.handed_over_at ? `${actorLabel(ticket.handed_over_by, user.id)} · ${timeLabel(ticket.handed_over_at)}` : 'Chưa bàn giao'}</dd>
            </div>
            {ticket.collected_by_user_id && (
              <div>
                <dt>Người nhận hàng</dt>
                <dd>{roster.find((m) => m.user_id === ticket.collected_by_user_id)?.display_name ?? actorLabel(ticket.collected_by_user_id, user.id)}</dd>
              </div>
            )}
            {ticket.closed_at && (
              <div><dt>Đóng phiếu</dt><dd>{actorLabel(ticket.closed_by, user.id)} · {timeLabel(ticket.closed_at)}</dd></div>
            )}
          </dl>

          {ticket.status === 'READY' && !ticket.confirmed_at && can('confirm') && (
            <div className="pickup-action-block">
              {confirmBlock && <p className="pickup-hint">{confirmBlock}</p>}
              <Button loading={busy === 'confirm'} disabled={busy !== null || Boolean(confirmBlock)}
                onClick={() => void runCommand('confirm', `confirm:${id}`, `/pickup-tickets/${id}/confirm`,
                  { expected_version: version }, 'Đã xác nhận phiếu. Có thể bàn giao hàng cho đội.')}>
                Xác nhận phiếu
              </Button>
            </div>
          )}

          {ticket.status === 'READY' && ticket.confirmed_at && can('handover') && (
            <div className="pickup-action-block">
              {handoverBlock && <p className="pickup-hint">{handoverBlock}</p>}
              <div className="pickup-field">
                <label htmlFor={`${titleId}-collector`}>Người nhận hàng (không bắt buộc)</label>
                <select id={`${titleId}-collector`} value={collector} disabled={busy !== null}
                  onChange={(event) => setCollector(event.target.value)}>
                  <option value="">Không ghi tên người nhận</option>
                  {roster.map((member) => (
                    <option key={member.user_id} value={member.user_id}>{member.display_name}</option>
                  ))}
                </select>
                {rosterNote && <p className="pickup-muted">{rosterNote}</p>}
              </div>
              <Button loading={busy === 'handover'} disabled={busy !== null || Boolean(handoverBlock)}
                onClick={async () => {
                  const confirmed = await confirmAction('Bàn giao hàng cho đội? Sau khi bàn giao, hàng chuyển sang đội và không còn ở kho.');
                  if (!confirmed) return;
                  const done = await runCommand('handover', `handover:${id}`, `/pickup-tickets/${id}/handover`,
                    { expected_version: version, ...(collector ? { collected_by_user_id: collector } : {}) },
                    'Đã ghi nhận bàn giao hàng cho đội.');
                  if (done) setCollector('');
                }}>
                Bàn giao hàng
              </Button>
            </div>
          )}

          {cancellable && !cancelOpen && (
            <div className="pickup-action-block">
              <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => setCancelOpen(true)}>Hủy phiếu</Button>
            </div>
          )}

          {cancellable && cancelOpen && (
            <form className="pickup-action-block pickup-cancel-form" noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (!cancelReason.trim()) { setCancelError('Cần ghi lý do hủy phiếu.'); return; }
                setCancelError('');
                void runCommand('cancel', `cancel:${id}`, `/pickup-tickets/${id}/cancel`,
                  { expected_version: version, reason: cancelReason.trim() }, 'Đã hủy phiếu lấy hàng.').then((done) => {
                  if (!done) return;
                  setCancelOpen(false);
                  setCancelReason('');
                });
              }}>
              <div className="pickup-field">
                <label htmlFor={`${titleId}-cancel-reason`}>Lý do hủy phiếu <span aria-hidden="true">*</span></label>
                <textarea id={`${titleId}-cancel-reason`} rows={2} value={cancelReason} required aria-required="true"
                  aria-invalid={Boolean(cancelError)} aria-describedby={cancelError ? `${titleId}-cancel-error` : undefined}
                  onChange={(event) => setCancelReason(event.target.value)} />
                {cancelError && <p id={`${titleId}-cancel-error`} className="pickup-field-error">{cancelError}</p>}
              </div>
              <div className="pickup-form-actions">
                <Button variant="secondary" size="sm" onClick={() => { setCancelOpen(false); setCancelError(''); }}>Quay lại</Button>
                <Button type="submit" variant="danger" size="sm" loading={busy === 'cancel'} disabled={busy !== null}>Xác nhận hủy</Button>
              </div>
            </form>
          )}

          {showDelivery && (
            <DeliveryForm ticketId={ticket.id} ticketVersion={ticket.version} closeout={closeout}
              closeoutError={closeoutError}
              onSaved={async (message) => {
                setNotice({ tone: 'success', text: message });
                await load();
                onChanged?.();
              }}
              onFailed={(error) => setNotice({ tone: 'error', text: pickupErrorMessage(error, 'delivery') })} />
          )}

          {showCloseout && closeout && (
            <CloseoutPanel
              key={`${ticket.version}:${closeout.version}:${closeout.closeout_status ?? 'NONE'}`}
              ticket={ticket}
              closeout={closeout}
              granted={granted}
              user={user}
              onChanged={async (message) => {
                setNotice({ tone: 'success', text: message });
                await load();
                onChanged?.();
              }}
              onFailed={(error, action) => setNotice({ tone: 'error', text: pickupErrorMessage(error, action) })}
            />
          )}
          {showCloseout && !closeout && closeoutError && (
            <p className="notice pickup-notice" role="status">{closeoutError}</p>
          )}
        </div>
      )}
    </section>
  );
}
