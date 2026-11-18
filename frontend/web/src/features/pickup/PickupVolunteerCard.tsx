import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatQuantity } from '../../i18n/quantity';
import { readPickup } from './pickupCommands';
import { type PickupTicket, type PickupTicketList } from './pickupRules';
import { pickupErrorMessage, pickupStatusLabels, pickupStatusTone, type PickupStatus } from './pickupCopy';
import './pickup.css';

type CardState =
  | { kind: 'loading' }
  | { kind: 'restricted' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ready'; ticket: PickupTicket };

/**
 * Read-only pickup card for a volunteer's active mission. Volunteers cannot act here; the manager
 * records the handover. The backend gives volunteers no PICKUP_TICKET_VIEW, so a 403 shows a
 * restricted note instead of the ticket.
 */
export function PickupVolunteerCard({ missionId }: { missionId: string }) {
  const [state, setState] = useState<CardState>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    readPickup<PickupTicketList>(`/pickup-tickets?mission_id=${encodeURIComponent(missionId)}&limit=5`)
      .then((page) => {
        if (!live) return;
        const ticket = page.items.find((item) => item.status !== 'CANCELLED') ?? page.items[0];
        setState(ticket ? { kind: 'ready', ticket: ticket as PickupTicket } : { kind: 'empty' });
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && error.code === 'FORBIDDEN') setState({ kind: 'restricted' });
        else setState({ kind: 'error', message: pickupErrorMessage(error, 'load') });
      });
    return () => { live = false; };
  }, [missionId]);

  return (
    <section className="card pickup-subcard pickup-volunteer" aria-labelledby={`pickup-volunteer-${missionId}`}>
      <h3 id={`pickup-volunteer-${missionId}`} className="pickup-subcard__title">Phiếu nhận hàng</h3>
      {state.kind === 'loading' && <Skeleton rows={2} label="Đang tải phiếu nhận hàng…" />}
      {state.kind === 'restricted' && (
        <p className="pickup-muted">Phiếu nhận hàng do điều phối viên hoặc quản lý vận hành theo dõi. Hãy hỏi quản lý vận hành khi cần xác nhận hàng.</p>
      )}
      {state.kind === 'error' && <p className="notice error pickup-notice" role="alert">{state.message}</p>}
      {state.kind === 'empty' && <p className="pickup-muted">Chưa có phiếu nhận hàng cho nhiệm vụ này.</p>}
      {state.kind === 'ready' && (
        <>
          <p>
            <Badge tone={pickupStatusTone[state.ticket.status as PickupStatus]}>
              {pickupStatusLabels[state.ticket.status as PickupStatus]}
            </Badge>
          </p>
          <ul className="pickup-volunteer__items">
            {state.ticket.lines.map((line) => (
              <li key={line.item_id}>
                <span>{line.item_name}</span>
                <strong>{formatQuantity(line.reserved_quantity)} {line.unit_code}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
