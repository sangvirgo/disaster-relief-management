import { useCallback, useEffect, useState } from 'react';
import { fetchAll } from '../../api/fetchAll';
import { roles, type Me } from '../../auth/session';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  labelFor,
  needReasonLabels,
  needSourceDescriptions,
  needSourceLabels,
  needSourceTones,
  severityDescriptions,
  severityLabels,
  severityTones,
} from '../../i18n/supplyLabels';
import { canViewSupplyGapWarnings, summarizeSupplyGapWarnings, warningTone, type SupplyGap } from './supplyModel';
import './supply-gaps.css';

/** Badge for a gap severity: Đỏ (RED) or Vàng (YELLOW). */
export function SeverityBadge({ severity }: { severity: string }) {
  const name = labelFor(severityLabels, severity, 'Chưa rõ mức');
  return (
    <Badge
      tone={labelFor(severityTones, severity, 'neutral') as BadgeTone}
      title={labelFor(severityDescriptions, severity, '')}
      ariaLabel={`Mức ${name.toLocaleLowerCase('vi-VN')}`}
    >
      {name}
    </Badge>
  );
}

/** Badge that says where a need came from: estimated, confirmed or declared. */
export function NeedSourceBadge({ source }: { source: unknown }) {
  const code = typeof source === 'string' ? source : '';
  const name = labelFor(needSourceLabels, code, 'Chưa rõ nguồn');
  return (
    <Badge
      kind="meta"
      tone={labelFor(needSourceTones, code, 'neutral') as BadgeTone}
      title={labelFor(needSourceDescriptions, code, '')}
      ariaLabel={`Nguồn nhu cầu: ${name}`}
    >
      {name}
    </Badge>
  );
}

/**
 * Need reason codes from the read model. Only QUANTITY_FAR_ABOVE_ESTIMATE is a warning chip in the list;
 * with `all`, every known code is shown as text (used in the detail view).
 */
export function NeedReasonChips({ codes, all = false }: { codes: unknown; all?: boolean }) {
  const list = Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [];
  const shown = all ? list : list.filter((code) => code === 'QUANTITY_FAR_ABOVE_ESTIMATE');
  if (!shown.length) return null;
  return (
    <span className="supply-reason-chips">
      {shown.map((code) => {
        const copy = labelFor(needReasonLabels, code, 'Có lưu ý về nhu cầu này.');
        const warning = code === 'QUANTITY_FAR_ABOVE_ESTIMATE';
        return all ? (
          <span key={code} className={`supply-reason-line${warning ? ' supply-reason-line--warning' : ''}`}>{copy}</span>
        ) : (
          <Badge key={code} kind="meta" tone={warning ? 'warning' : 'neutral'} title={copy} ariaLabel={`Cảnh báo: ${copy}`}>
            Cao hơn 3 lần ước tính
          </Badge>
        );
      })}
    </span>
  );
}

/**
 * Read-only warning for operations managers. Shows the open supply-gap count by severity and the
 * API's own reason text. It never offers accept or dismiss; the backend enforces that too.
 */
export function SupplyGapWarningBadge({ user }: { user: Me }) {
  const allowed = canViewSupplyGapWarnings(roles(user));
  const [gaps, setGaps] = useState<SupplyGap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setLoading(true);
    setError('');
    fetchAll<SupplyGap>('logistics', '/supply-gaps?status=OPEN')
      .then((items) => { if (live) setGaps(items); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải cảnh báo.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [allowed, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  if (!allowed) return null;
  const summary = summarizeSupplyGapWarnings(gaps);
  const tone = warningTone(summary);
  const top = summary.top;
  const reasonText = top ? top.reasons.map((reason) => reason.message).join(' ') : '';
  const badgeText = summary.red > 0 ? `Đỏ · ${summary.red}` : `Vàng · ${summary.yellow}`;
  return (
    <section className="supply-warning" aria-label="Cảnh báo thiếu hàng">
      <div className="supply-warning__row">
        {loading && <p role="status" className="muted">Đang kiểm tra cảnh báo thiếu hàng…</p>}
        {!loading && error && <p role="alert" className="notice error">Không tải được cảnh báo thiếu hàng. {error}</p>}
        {!loading && !error && summary.open === 0 && <p className="muted">Hiện không có cảnh báo thiếu hàng.</p>}
        {!loading && !error && summary.open > 0 && top && (
          <details className="supply-warning__details">
            <summary>
              <span>Cảnh báo thiếu hàng</span>{' '}
              <Badge
                tone={tone}
                title={reasonText}
                ariaLabel={`Cảnh báo thiếu hàng ${summary.red > 0 ? 'mức đỏ' : 'mức vàng'}: ${summary.open} đề xuất đang mở`}
              >
                {badgeText}
              </Badge>
            </summary>
            <p className="supply-warning__text">
              {top.warehouse_name} · {top.item_name}. {reasonText || 'Chưa có giải thích từ máy chủ.'}
            </p>
            <p className="muted">Đang mở {summary.open} đề xuất. Quản lý vận hành sẽ quyết định việc quyên góp.</p>
          </details>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={loading} aria-label="Làm mới cảnh báo thiếu hàng">
          Làm mới
        </Button>
      </div>
    </section>
  );
}
