import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { CommandForm } from '../../components/CommandForm';

type ResolutionOperation = {
  operation_id: string;
  kind: 'RESOLUTION' | 'CANCELLATION';
  state: 'PENDING' | 'ABORTING' | 'COMPLETED' | 'ABORTED';
  request_id: string;
  request_status: string;
  version: number;
};

const stateLabels: Record<ResolutionOperation['state'], string> = {
  PENDING: 'Đang chờ hoàn tất',
  ABORTING: 'Đang hủy thao tác',
  COMPLETED: 'Đã hoàn tất',
  ABORTED: 'Đã hủy thao tác',
};

export function operationIdFromTimeline(
  events: { event_type: string; payload?: Record<string, unknown> }[]
): string | undefined {
  const operationEvents = new Set([
    'RESOLUTION_INTENT_CREATED',
    'CANCELLATION_INTENT_CREATED',
    'RESOLUTION_INTENT_ADOPTED',
    'RESOLUTION_ABORT_REQUESTED',
    'CANCELLATION_ABORT_REQUESTED',
  ]);
  const latest = events.find((event) => operationEvents.has(event.event_type));
  const id = latest?.payload?.operation_id ?? latest?.payload?.intent_id;
  return typeof id === 'string' ? id : undefined;
}

export function ResolutionOperationPanel({
  operationId,
  requestVersion,
  onChanged,
  onStale,
}: {
  operationId: string;
  requestVersion: number;
  onChanged: () => void;
  onStale: () => void;
}) {
  const [operation, setOperation] = useState<ResolutionOperation | null>(null);
  const [error, setError] = useState('');
  const finished = useRef(false);

  useEffect(() => {
    let active = true;
    let checking = false;
    let timer: number | undefined;
    async function check() {
      if (!active || checking) return;
      checking = true;
      try {
        const result = await api<ResolutionOperation>('response', `/operations/${operationId}`);
        if (!active) return;
        setOperation(result);
        setError('');
        if (['COMPLETED', 'ABORTED'].includes(result.state)) {
          if (timer !== undefined) window.clearInterval(timer);
          if (!finished.current) {
            finished.current = true;
            onChanged();
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải trạng thái thao tác.');
      } finally {
        checking = false;
      }
    }
    timer = window.setInterval(() => void check(), 4000);
    void check();
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [operationId, onChanged]);

  const open = operation && ['PENDING', 'ABORTING'].includes(operation.state);
  return (
    <section className="notice resolution-operation-panel">
      <h3>Thao tác kết thúc đang chờ</h3>
      {!operation ? <p role="status">Đang tải trạng thái thao tác…</p> : (
        <>
          <p>
            Loại thao tác: {operation.kind === 'CANCELLATION' ? 'Hủy yêu cầu' : 'Kết thúc xử lý'}.
            {' '}Trạng thái: {stateLabels[operation.state]}.
          </p>
          {open && (
            <>
              <p>Điều phối viên có quyền xử lý có thể tiếp nhận thao tác này sau khi kiểm tra hồ sơ.</p>
              <CommandForm
                key={`adopt-${operationId}-${requestVersion}-${operation.state}`}
                spec={{
                  title: 'Tiếp nhận xử lý thao tác đang chờ',
                  service: 'response',
                  path: `/operations/${operationId}/adopt`,
                  version: requestVersion,
                  fields: [{ name: 'reason', label: 'Lý do tiếp nhận', type: 'textarea', required: true }],
                  warning: 'Tiếp nhận xử lý sẽ yêu cầu máy chủ tiếp tục hoàn tất thao tác. Xác nhận?',
                }}
                onSuccess={onChanged}
                onStale={onStale}
              />
              {operation.state === 'PENDING' && (
                <CommandForm
                  key={`abort-${operationId}-${requestVersion}`}
                  spec={{
                    title: 'Yêu cầu hủy thao tác đang chờ',
                    service: 'response',
                    path: `/operations/${operationId}/abort`,
                    version: requestVersion,
                    fields: [{ name: 'reason', label: 'Lý do hủy thao tác', type: 'textarea', required: true }],
                    warning: 'Yêu cầu hủy sẽ đưa hồ sơ về trạng thái trước khi bắt đầu thao tác. Xác nhận?',
                  }}
                  onSuccess={onChanged}
                  onStale={onStale}
                />
              )}
            </>
          )}
        </>
      )}
      {error && (
        <>
          <p className="notice error" role="alert">{error}</p>
          <button type="button" className="button secondary" onClick={onChanged}>Tải lại hồ sơ</button>
        </>
      )}
    </section>
  );
}
