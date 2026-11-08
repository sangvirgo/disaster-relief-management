import { CommandForm } from '../../components/CommandForm';

export function TeamReadinessForm({ teamId, teamName, version, recorded, onSuccess, onStale }: {
  teamId: string; teamName: string; version: number; recorded: boolean;
  onSuccess: () => void; onStale: () => void;
}) {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
  return <div className="form-stack team-readiness-form">
    <p>Chỉ xác nhận sau khi đã kiểm tra đội có thể tiếp tục nhận nhiệm vụ. Vị trí đội vẫn cần được cập nhật riêng.</p>
    <CommandForm
      spec={{
        title: 'Xác nhận đội sẵn sàng', service: 'response', path: `/teams/${teamId}/ready`, version,
        warning: `Bạn đã kiểm tra và xác nhận ${teamName} sẵn sàng nhận nhiệm vụ mới?`,
        fields: recorded ? [
          { name: 'confirmation_basis', label: 'Cách nhận xác nhận từ đội', type: 'select', required: true,
            options: [{ value: 'RADIO', label: 'Bộ đàm' }, { value: 'PHONE', label: 'Điện thoại' },
              { value: 'IN_PERSON', label: 'Trao đổi trực tiếp' }, { value: 'OTHER', label: 'Cách khác' }] },
          { name: 'reported_by', label: 'Người từ đội xác nhận sẵn sàng', required: true, maxLength: 200 },
          { name: 'occurred_at', label: 'Thời điểm xác nhận', type: 'datetime-local', required: true, initialValue: localTime },
        ] : [],
        build: values => ({ confirmation_basis: recorded ? values.confirmation_basis : 'SELF',
          ...(recorded ? { reported_by: values.reported_by.trim() } : {}),
          occurred_at: recorded ? new Date(values.occurred_at).toISOString() : new Date().toISOString() }),
      }}
      onSuccess={onSuccess} onStale={onStale}
    />
  </div>;
}
