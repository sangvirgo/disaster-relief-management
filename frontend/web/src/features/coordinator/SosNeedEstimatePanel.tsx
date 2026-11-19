import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import {
  labelFor,
  needReasonLabels,
  needSourceLabels,
  needSourceTones,
  normCategoryLabels,
} from '../../i18n/supplyLabels';
import { formatQuantity } from '../../i18n/quantity';
import { proposalPanelStatus } from './sosProposalStatus';

interface NeedItem {
  id: string;
  source: 'DECLARED' | 'ESTIMATED' | 'CONFIRMED';
  status: string;
  requested: string;
  item: { id: string; name: string };
  unit: { display_name: string };
  version: number;
  estimate?: { category?: string; reason_codes?: string[] } | null;
  reason_codes: string[];
}

interface SosNeedEstimatePanelProps {
  requestId: string;
  workCycle: number;
  status: string;
  needsReliefSupplies: boolean;
  /** OPERATIONS_MANAGER only: shows the link to the manager queue. Read-only for everyone else. */
  canOpenQueue: boolean;
}

const statusTones: Record<string, BadgeTone> = {
  AWAITING_VERIFICATION: 'neutral',
  PENDING_MANAGER: 'warning',
  CONFIRMED: 'success',
  NONE: 'neutral',
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Không thể tải đề xuất cấp phát.';
}

/** Read-only status of the goods proposal for one SOS. Coordinators verify the SOS; the system creates the proposal. */
export function SosNeedEstimatePanel({ requestId, workCycle, status, needsReliefSupplies, canOpenQueue }: SosNeedEstimatePanelProps) {
  const [needs, setNeeds] = useState<NeedItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const wantsLines = needsReliefSupplies && !['SUBMITTED', 'VERIFYING', 'CANCELLED', 'REJECTED'].includes(status);

  useEffect(() => {
    if (!wantsLines) { setNeeds([]); setLoaded(false); return; }
    let live = true;
    setLoadError('');
    setLoaded(false);
    api<{ items: NeedItem[] }>('logistics', `/needs?request_id=${encodeURIComponent(requestId)}&work_cycle=${workCycle}&limit=100`)
      .then((list) => { if (live) { setNeeds(list.items); setLoaded(true); } })
      .catch((error: unknown) => { if (live) setLoadError(errorMessage(error)); });
    return () => { live = false; };
  }, [wantsLines, requestId, workCycle]);

  const panel = proposalPanelStatus({
    requestStatus: status,
    needsReliefSupplies,
    lines: needs,
  });
  if (!panel.visible) return null;

  const lines = needs.filter((need) => need.status !== 'CANCELLED');

  return (
    <section className="sos-need-estimate card" aria-labelledby="sos-need-estimate-title">
      <div className="section-header list-action-header">
        <h3 id="sos-need-estimate-title">Đề xuất cấp phát</h3>
        {canOpenQueue && (
          <a className="button secondary" href="/?workspace=operations&page=drives&section=proposals">Mở hàng đợi cấp phát</a>
        )}
      </div>
      <p className="sos-need-estimate__status">
        <Badge tone={statusTones[panel.code] ?? 'neutral'}>{panel.label}</Badge>
      </p>
      {loadError && <p className="sos-alert sos-alert--danger" role="alert">{loadError}</p>}
      {wantsLines && loaded && lines.length > 0 && (
        <ul className="sos-need-estimate__list" aria-label="Các dòng đề xuất cấp phát">
          {lines.map((need) => {
            const category = need.estimate?.category;
            const reasons = [...new Set([...(need.estimate?.reason_codes ?? []), ...need.reason_codes])];
            return (
              <li key={need.id} className="sos-need-estimate__row">
                <span>{category ? labelFor(normCategoryLabels, category, 'Nhóm khác') : labelFor(needSourceLabels, need.source, 'Khác')}</span>{' '}
                <strong>{need.item.name}</strong>{': '}
                <span>{formatQuantity(need.requested)} {need.unit.display_name}</span>{' '}
                <Badge kind="meta" tone={(needSourceTones[need.source] ?? 'neutral') as BadgeTone}>{labelFor(needSourceLabels, need.source, 'Khác')}</Badge>
                {reasons.length > 0 && (
                  <ul className="sos-need-estimate__reasons">
                    {reasons.map((code) => <li key={code}>{labelFor(needReasonLabels, code, 'Cần kiểm tra lại định mức.')}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {wantsLines && loaded && lines.length === 0 && <p className="sos-need-estimate__hint">Chưa có dòng nhu cầu nào cho đợt này.</p>}
    </section>
  );
}
