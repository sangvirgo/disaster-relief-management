import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { sendRetryableCommand } from '../../api/retryableCommand';
import { roles, type Me } from '../../auth/session';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { confirmAction } from '../../components/confirmAction';
import { DetailSurface } from '../../components/DetailSurface';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatQuantity } from '../../i18n/quantity';
import {
  extractionSourceLabels,
  extractionSourceTones,
  labelFor,
  needReasonLabels,
  normCategoryLabels,
} from '../../i18n/supplyLabels';
import {
  canManageNeedProposals,
  isStaleProposalError,
  proposalErrorMessage,
  runInSequence,
  sameQuantity,
  summarizeProposalGroup,
  swapOptionsFor,
  type ProposalGroup,
  type ProposalLine,
  type ProposalPage,
  type SwapItem,
} from './needProposalModel';
import './need-proposals.css';

type Resolution = 'CONFIRMED' | 'REJECTED';
type Dialog = { mode: 'confirm' | 'reject'; line: ProposalLine } | null;

const PAGE_SIZE = 20;
const PICKUP_HREF = '/?workspace=operations&page=pickup';
const shortId = (id: string) => `…${id.slice(-8)}`;

function confirmSpec(line: ProposalLine, options: { value: string; label: string }[], unitById: ReadonlyMap<string, string>): CommandSpec {
  const scale = line.item.unit.scale;
  return {
    title: 'Xác nhận',
    hideTitle: true,
    service: 'logistics',
    method: 'POST',
    path: `/needs/${line.need_id}/confirm`,
    version: line.version,
    fields: [
      {
        name: 'quantity',
        label: 'Số lượng',
        type: 'number',
        required: true,
        scaleFor: () => scale,
        initialValue: line.quantity,
        hintFor: (values) => `Đơn vị: ${unitById.get(values.item_id) ?? line.item.unit.display_name}.`,
      },
      {
        name: 'item_id',
        label: 'Vật phẩm',
        type: 'select',
        required: true,
        options,
        initialValue: line.item.id,
        hintFor: () => 'Chỉ đổi sang vật phẩm đang hoạt động cùng nhóm hàng.',
      },
      {
        name: 'reason',
        label: 'Lý do điều chỉnh',
        type: 'textarea',
        maxLength: 1000,
        hintFor: () => 'Bắt buộc khi thay đổi số lượng hoặc vật phẩm.',
      },
    ],
    build: (values) => {
      const quantity = (values.quantity ?? '').trim();
      const itemId = values.item_id || line.item.id;
      const reason = (values.reason ?? '').trim();
      const quantityChanged = !sameQuantity(quantity, line.quantity);
      const itemChanged = itemId !== line.item.id;
      if ((quantityChanged || itemChanged) && !reason) {
        throw new Error('Hãy nhập lý do khi thay đổi số lượng hoặc vật phẩm.');
      }
      return {
        ...(quantityChanged ? { quantity } : {}),
        ...(itemChanged ? { item_id: itemId } : {}),
        ...((quantityChanged || itemChanged) ? { reason } : {}),
      };
    },
  };
}

function rejectSpec(line: ProposalLine): CommandSpec {
  return {
    title: 'Từ chối',
    hideTitle: true,
    service: 'logistics',
    method: 'POST',
    path: `/needs/${line.need_id}/cancel`,
    version: line.version,
    warning: 'Từ chối dòng nhu cầu này? Dòng sẽ bị hủy và không được tính vào kho.',
    fields: [
      {
        name: 'reason',
        label: 'Lý do từ chối',
        type: 'textarea',
        required: true,
        maxLength: 1000,
      },
    ],
    build: (values) => ({ reason: (values.reason ?? '').trim() }),
  };
}

/** Manager queue of SOS need estimates waiting for review. Each group is one SOS and work cycle. */
export function NeedProposalsPage({ user }: { user: Me }) {
  const canManage = canManageNeedProposals(roles(user));
  const [groups, setGroups] = useState<ProposalGroup[]>([]);
  const [cursor, setCursor] = useState('');
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [bulkBusy, setBulkBusy] = useState('');
  const [bulkError, setBulkError] = useState<Record<string, string>>({});
  const [activeItems, setActiveItems] = useState<SwapItem[]>([]);
  const [warehouses, setWarehouses] = useState<Map<string, string>>(new Map());
  const [lookupError, setLookupError] = useState('');

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    setLoading(true);
    setError('');
    api<ProposalPage>('logistics', `/need-proposals?limit=${PAGE_SIZE}`)
      .then((page) => {
        if (!live) return;
        setGroups(page.items);
        setMore(Boolean(page.more));
        setCursor(page.more ? page.cursor ?? '' : '');
      })
      .catch((cause) => { if (live) { setGroups([]); setError(proposalErrorMessage(cause)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [canManage, revision]);

  // Bounded lookups: the active catalog (swap choices and unit scales) and warehouse names. A failure only limits those features.
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    void Promise.allSettled([
      fetchAll<SwapItem>('logistics', '/items?status=ACTIVE'),
      fetchAll<{ id?: string; name?: string }>('logistics', '/warehouses'),
    ]).then(([itemResult, warehouseResult]) => {
      if (!live) return;
      setActiveItems(itemResult.status === 'fulfilled' ? itemResult.value : []);
      setWarehouses(warehouseResult.status === 'fulfilled'
        ? new Map(warehouseResult.value.filter((row) => row.id).map((row) => [row.id!, row.name || '']))
        : new Map());
      setLookupError(itemResult.status === 'rejected' ? 'Chưa tải được danh mục vật phẩm nên chưa thể đổi vật phẩm.' : '');
    });
    return () => { live = false; };
  }, [canManage]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<ProposalPage>('logistics', `/need-proposals?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`);
      setGroups((current) => [...current, ...page.items]);
      setMore(Boolean(page.more));
      setCursor(page.more ? page.cursor ?? '' : '');
    } catch (cause) {
      setError(proposalErrorMessage(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  function reload(message = '') {
    setNotice(message);
    setRevision((value) => value + 1);
  }

  async function confirmAll(group: ProposalGroup) {
    const open = group.lines.filter((line) => !resolved[line.need_id]);
    if (!open.length) return;
    const approved = await confirmAction(`Xác nhận ${open.length} dòng nhu cầu của SOS ${shortId(group.request_id)} theo số lượng ước tính? Các dòng này sẽ được tính vào kho.`);
    if (!approved) return;
    setBulkBusy(group.cycle_id);
    setBulkError((current) => ({ ...current, [group.cycle_id]: '' }));
    const outcome = await runInSequence(open, (line) => sendRetryableCommand(
      `confirm-all:${line.need_id}`,
      'logistics',
      `/needs/${line.need_id}/confirm`,
      { expected_version: line.version },
    ));
    setResolved((current) => ({
      ...current,
      ...Object.fromEntries(outcome.done.map((line) => [line.need_id, 'CONFIRMED' as const])),
    }));
    setBulkBusy('');
    if (outcome.failure) {
      const { line, error: cause } = outcome.failure;
      setBulkError((current) => ({
        ...current,
        [group.cycle_id]: `Đã dừng tại dòng ${labelFor(normCategoryLabels, line.category, 'nhóm khác')}: ${line.item.name}. `
          + `${outcome.done.length} dòng trước đó đã xác nhận. ${proposalErrorMessage(cause)}`,
      }));
      if (isStaleProposalError(cause)) reload();
    } else {
      setNotice(`Đã xác nhận ${outcome.done.length} dòng của SOS ${shortId(group.request_id)}.`);
    }
  }

  if (!canManage) {
    return (
      <section className="card need-proposals" aria-labelledby="need-proposals-title">
        <h2 id="need-proposals-title">Đề xuất cấp phát</h2>
        <EmptyState icon="lock" title="Chưa có quyền xem đề xuất cấp phát" description="Màn hình này dành cho quản lý vận hành." />
      </section>
    );
  }

  const unitOf = (line: ProposalLine) => line.item.unit.display_name || '(chưa rõ đơn vị)';
  const unitById = new Map(activeItems.map((item) => [item.id, item.unit.display_name || '']));

  return (
    <div className="need-proposals">
      <section className="card need-proposals__header" aria-labelledby="need-proposals-title">
        <div className="section-header list-action-header">
          <div>
            <span className="eyebrow">Quản lý vận hành</span>
            <h2 id="need-proposals-title">Đề xuất cấp phát</h2>
          </div>
          <div className="list-header-actions">
            <Button variant="secondary" size="sm" disabled={loading} onClick={() => reload()}>Cập nhật</Button>
          </div>
        </div>
        <p className="muted">
          Hệ thống tự tạo đề xuất từ SOS đã xác minh và định mức. Quản lý kiểm tra số lượng và vật phẩm rồi xác nhận hoặc từ chối.
          Đề xuất không tự động phân công hay điều phối.
        </p>
        {notice && <p className="notice" role="status">{notice}</p>}
        {lookupError && <p className="notice error" role="alert">{lookupError}</p>}
        {error && (
          <div className="notice error" role="alert">
            <p>{error}</p>
            <Button variant="secondary" size="sm" onClick={() => reload()}>Thử lại</Button>
          </div>
        )}
      </section>

      {loading && groups.length === 0 && <Skeleton rows={4} label="Đang tải đề xuất cấp phát…" />}

      {!loading && !error && groups.length === 0 && (
        <EmptyState title="Chưa có đề xuất cần duyệt" description="Đề xuất được tạo tự động sau khi điều phối viên xác minh SOS có nhu cầu hàng cứu trợ." />
      )}

      {groups.map((group) => {
        const summary = summarizeProposalGroup(group);
        const open = group.lines.filter((line) => !resolved[line.need_id]);
        const confirmedHere = group.lines.some((line) => resolved[line.need_id] === 'CONFIRMED');
        const extractionTone = group.extraction ? (labelFor(extractionSourceTones, group.extraction.source, 'neutral') as BadgeTone) : 'neutral';
        const warehouseName = group.warehouse ? warehouses.get(group.warehouse.id) || `Kho mã ${shortId(group.warehouse.id)}` : '';
        return (
          <section key={group.cycle_id} className="card proposal-group" aria-labelledby={`proposal-${group.cycle_id}-title`}>
            <header className="proposal-group__header">
              <div>
                <h3 id={`proposal-${group.cycle_id}-title`} className="proposal-group__title">
                  SOS {shortId(group.request_id)} · Đợt {group.work_cycle}
                </h3>
                <p className="proposal-group__sos">
                  {group.sos
                    ? `Số người: ${group.sos.people} · Người lớn: ${group.sos.adults} · Trẻ em: ${group.sos.children} · Người cao tuổi: ${group.sos.elderly}`
                    : 'Chưa có số người cần hỗ trợ'}
                </p>
              </div>
              {group.extraction && (
                <Badge kind="meta" tone={extractionTone} title="Nguồn đề xuất vật phẩm">
                  {labelFor(extractionSourceLabels, group.extraction.source, 'Nguồn khác')}
                </Badge>
              )}
            </header>

            {group.warehouse ? (
              <p className="proposal-group__warehouse">Kho phục vụ: {warehouseName}</p>
            ) : (
              <p className="notice error" role="alert">
                Chưa có kho phục vụ cho chiến dịch của SOS này, nên chưa kiểm được tồn kho. Hãy kiểm tra trước khi xác nhận.
              </p>
            )}

            {summary.unmatchedCount > 0 && (
              <p className="proposal-group__note">Chưa có trong danh mục: {group.extraction!.unmatched_terms.join(', ')}</p>
            )}
            {summary.mentionedCount > 0 && (
              <p className="proposal-group__note">
                Công dân nhắc thêm: {group.extraction!.mentioned_items.map((entry) => entry.item_name || `vật phẩm ${shortId(entry.item_id)}`).join(', ')}
              </p>
            )}
            {group.extraction && group.extraction.reasons.length > 0 && (
              <ul className="proposal-group__reasons">
                {group.extraction.reasons.map((reason) => (
                  <li key={reason.code}>{labelFor(needReasonLabels, reason.code, reason.message)}</li>
                ))}
              </ul>
            )}

            <ul className="proposal-lines" aria-label={`Dòng nhu cầu của SOS ${shortId(group.request_id)}, đợt ${group.work_cycle}`}>
              {group.lines.map((line) => {
                const outcome = resolved[line.need_id];
                const reasonCopy = line.reasons.map((reason) => labelFor(needReasonLabels, reason.code, reason.message));
                return (
                  <li key={line.need_id} className="proposal-line">
                    <div className="proposal-line__main">
                      <span className="proposal-line__category">{labelFor(normCategoryLabels, line.category, 'Nhóm khác')}</span>
                      <strong className="proposal-line__item">{line.item.name}</strong>
                      <span className="proposal-line__quantity">{formatQuantity(line.quantity)} {unitOf(line)}</span>
                      {line.shortfall === true && <Badge kind="meta" tone="warning">Thiếu hàng</Badge>}
                      {outcome && (
                        <Badge kind="meta" tone={outcome === 'CONFIRMED' ? 'success' : 'neutral'}>
                          {outcome === 'CONFIRMED' ? 'Đã xác nhận' : 'Đã từ chối'}
                        </Badge>
                      )}
                    </div>
                    {line.available != null && (
                      <p className="proposal-line__stock">Tồn khả dụng tại kho: {formatQuantity(line.available)} {unitOf(line)}</p>
                    )}
                    {reasonCopy.length > 0 && (
                      <ul className="proposal-line__reasons">
                        {reasonCopy.map((copy, index) => <li key={`${line.need_id}-${index}`}>{copy}</li>)}
                      </ul>
                    )}
                    {canManage && !outcome && (
                      <div className="proposal-line__actions">
                        <Button
                          size="sm"
                          aria-label={`Xác nhận dòng ${line.item.name} của SOS ${shortId(group.request_id)}`}
                          disabled={bulkBusy === group.cycle_id}
                          onClick={() => setDialog({ mode: 'confirm', line })}
                        >
                          Xác nhận
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Từ chối dòng ${line.item.name} của SOS ${shortId(group.request_id)}`}
                          disabled={bulkBusy === group.cycle_id}
                          onClick={() => setDialog({ mode: 'reject', line })}
                        >
                          Từ chối
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {bulkError[group.cycle_id] && <p className="notice error" role="alert">{bulkError[group.cycle_id]}</p>}

            <footer className="proposal-group__footer">
              {canManage && open.length > 1 && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={bulkBusy === group.cycle_id}
                  disabled={bulkBusy !== '' && bulkBusy !== group.cycle_id}
                  aria-label={`Xác nhận tất cả ${open.length} dòng của SOS ${shortId(group.request_id)}`}
                  onClick={() => void confirmAll(group)}
                >
                  Xác nhận tất cả
                </Button>
              )}
              {confirmedHere && (
                <a className="button secondary" href={PICKUP_HREF}>Mở phiếu lấy hàng</a>
              )}
            </footer>
          </section>
        );
      })}

      {more && (
        <div className="need-proposals__more">
          <Button variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>Tải thêm</Button>
        </div>
      )}

      {dialog && (
        <DetailSurface
          key={`${dialog.line.need_id}-${dialog.mode}`}
          modal
          open
          onClose={() => setDialog(null)}
          label={dialog.mode === 'confirm' ? `Xác nhận dòng ${dialog.line.item.name}` : `Từ chối dòng ${dialog.line.item.name}`}
          heading={dialog.mode === 'confirm' ? 'Xác nhận dòng nhu cầu' : 'Từ chối dòng nhu cầu'}
          className="campaign-management-dialog"
        >
          <CommandForm
            key={`${dialog.line.need_id}-${dialog.line.version}-${dialog.mode}`}
            spec={dialog.mode === 'confirm'
              ? confirmSpec(dialog.line, swapOptionsFor(dialog.line, activeItems), unitById)
              : rejectSpec(dialog.line)}
            onSuccess={() => {
              const { line, mode } = dialog;
              setDialog(null);
              setResolved((current) => ({ ...current, [line.need_id]: mode === 'confirm' ? 'CONFIRMED' : 'REJECTED' }));
              setNotice(mode === 'confirm'
                ? `Đã xác nhận dòng ${line.item.name}.`
                : `Đã từ chối dòng ${line.item.name}.`);
            }}
            onStale={() => {
              setDialog(null);
              reload('Dòng nhu cầu đã thay đổi hoặc không còn chờ duyệt. Danh sách đã được tải lại.');
            }}
          />
        </DetailSurface>
      )}
    </div>
  );
}
