import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { roles, type Me } from '../../auth/session';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { timeLabel } from '../../i18n/labels';
import { formatQuantity } from '../../i18n/quantity';
import {
  labelFor,
  normActiveOptions,
  normBasisLabels,
  normBasisOptions,
  normCategoryLabels,
  normFieldLabels,
  normItemTypeLabels,
} from '../../i18n/supplyLabels';
import { buildNormPatch, canManageNeedNorms, type NeedNorm } from './supplyModel';

type ActiveItem = { id: string; name: string; item_type: { code: string; display_name?: string } };

/** Human summary of a norm, in the basis's own terms. */
function normSummary(norm: NeedNorm): string {
  if (norm.quantity_basis === 'BY_GROUP') {
    return `Người lớn ${formatQuantity(norm.qty_adult)}, trẻ em ${formatQuantity(norm.qty_child)}, người cao tuổi ${formatQuantity(norm.qty_elderly)}`;
  }
  if (norm.quantity_basis === 'PER_N_PEOPLE') {
    return `1 đơn vị cho mỗi ${norm.people_per_unit ?? '—'} người`;
  }
  return `${norm.fixed_quantity == null ? '—' : formatQuantity(norm.fixed_quantity)} cho mỗi yêu cầu`;
}

/**
 * Default-item choices for a norm: ACTIVE items of the norm's item type. A default that is no longer ACTIVE is
 * kept as a choice so that saving the form does not silently clear it.
 */
function defaultItemOptions(norm: NeedNorm, items: ActiveItem[]): { value: string; label: string }[] {
  const options = items
    .filter((item) => item.item_type.code === norm.item_type_code)
    .map((item) => ({ value: item.id, label: item.name }));
  if (norm.default_item_id && !options.some((option) => option.value === norm.default_item_id)) {
    options.unshift({ value: norm.default_item_id, label: 'Vật phẩm hiện không còn hoạt động' });
  }
  return options;
}

/** Edits the norm table used by SOS need estimates. Only OPERATIONS_MANAGER can save changes. */
export function NormEditor({ user }: { user: Me }) {
  const canManage = canManageNeedNorms(roles(user));
  const [norms, setNorms] = useState<NeedNorm[]>([]);
  const [items, setItems] = useState<ActiveItem[]>([]);
  const [itemsReady, setItemsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<NeedNorm | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<{ items: NeedNorm[]; generated_at?: string }>('logistics', '/need-norms')
      .then((value) => { if (live) setNorms(value.items || []); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải bảng định mức.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [revision]);

  // The default-item choices come from the ACTIVE catalog. Editing waits until they load, so a select never shows a wrong value.
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    setItemsReady(false);
    fetchAll<ActiveItem>('logistics', '/items?status=ACTIVE')
      .then((value) => { if (live) { setItems(value); setItemsReady(true); } })
      .catch(() => { if (live) setItemsReady(false); });
    return () => { live = false; };
  }, [canManage, revision]);

  function normSpec(norm: NeedNorm): CommandSpec {
    return {
      title: 'Sửa định mức',
      service: 'logistics',
      method: 'PATCH',
      path: `/need-norms/${norm.id}`,
      version: norm.version,
      warning: 'Xác nhận cập nhật định mức này? Định mức mới được dùng cho các lần ước tính nhu cầu sau khi lưu.',
      fields: [
        { name: 'quantity_basis', label: 'Cách tính', type: 'select', required: true, options: [...normBasisOptions], initialValue: norm.quantity_basis },
        { name: 'qty_adult', label: normFieldLabels.qty_adult!, type: 'number', min: 0, visibleFor: (values) => values.quantity_basis === 'BY_GROUP', initialValue: norm.qty_adult },
        { name: 'qty_child', label: normFieldLabels.qty_child!, type: 'number', min: 0, visibleFor: (values) => values.quantity_basis === 'BY_GROUP', initialValue: norm.qty_child },
        { name: 'qty_elderly', label: normFieldLabels.qty_elderly!, type: 'number', min: 0, visibleFor: (values) => values.quantity_basis === 'BY_GROUP', initialValue: norm.qty_elderly },
        { name: 'people_per_unit', label: normFieldLabels.people_per_unit!, type: 'number', integer: true, min: 1, visibleFor: (values) => values.quantity_basis === 'PER_N_PEOPLE', initialValue: norm.people_per_unit == null ? '' : String(norm.people_per_unit) },
        { name: 'fixed_quantity', label: normFieldLabels.fixed_quantity!, type: 'number', min: 0, visibleFor: (values) => values.quantity_basis === 'PER_REQUEST', initialValue: norm.fixed_quantity ?? '' },
        {
          name: 'default_item_id',
          label: 'Vật phẩm mặc định',
          type: 'select',
          emptyLabel: 'Không đặt vật phẩm mặc định',
          options: defaultItemOptions(norm, items),
          initialValue: norm.default_item_id ?? '',
          hintFor: () => 'Vật phẩm này được dùng khi người dân không nêu rõ hàng cần. Chỉ chọn vật phẩm đang hoạt động cùng nhóm.',
        },
        {
          name: 'in_default_bundle',
          label: 'Thuộc gói mặc định',
          type: 'checkbox',
          initialValue: norm.in_default_bundle ? 'true' : 'false',
          hintFor: () => 'Nếu bật, nhóm hàng này được đưa vào danh sách mặc định khi người dân không nêu rõ hàng cần.',
        },
        { name: 'active', label: 'Trạng thái áp dụng', type: 'select', required: true, options: [...normActiveOptions], initialValue: norm.active ? 'true' : 'false' },
      ],
      build: (values) => buildNormPatch(norm, values),
    };
  }

  return (
    <section className="card norm-editor" aria-labelledby="norm-editor-title">
      <div className="section-header list-action-header">
        <div>
          <span className="eyebrow">Định mức vật tư</span>
          <h2 id="norm-editor-title">Bảng định mức ước tính nhu cầu</h2>
        </div>
        <div className="list-header-actions">
          <button type="button" className="button secondary" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Cập nhật</button>
        </div>
      </div>
      <p className="muted">Định mức dùng để ước tính nhu cầu SOS từ số người, trẻ em và người cao tuổi. Nhu cầu ước tính chỉ được cam kết xuất kho sau khi quản lý vận hành duyệt.</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {canManage && !loading && !itemsReady && norms.length > 0 && (
        <p className="notice error" role="alert">Chưa tải được danh mục vật phẩm nên chưa thể sửa định mức. Hãy bấm Cập nhật để thử lại.</p>
      )}
      {loading && <Skeleton rows={4} label="Đang tải bảng định mức…" />}
      {!loading && !error && !norms.length && <EmptyState title="Chưa có định mức" description="Bảng định mức chưa có dòng nào. Hãy liên hệ quản trị viên để khởi tạo." />}
      {norms.length > 0 && (
        <div className="operations-table-scroll" role="region" aria-label="Bảng định mức vật tư" tabIndex={0}>
          <table className="operations-record-table">
            <thead>
              <tr>
                <th scope="col">Nhóm hàng</th>
                <th scope="col">Vật phẩm</th>
                <th scope="col">Cách tính</th>
                <th scope="col">Định mức</th>
                <th scope="col">Gói mặc định</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {norms.map((norm) => (
                <tr key={norm.id}>
                  <th scope="row">{labelFor(normCategoryLabels, norm.category, 'Nhóm khác')}</th>
                  <td>{labelFor(normItemTypeLabels, norm.item_type_code, 'Vật phẩm khác')}</td>
                  <td>{labelFor(normBasisLabels, norm.quantity_basis, 'Chưa rõ cách tính')}</td>
                  <td>{normSummary(norm)}</td>
                  <td>{norm.in_default_bundle ? 'Có' : 'Không'}</td>
                  <td>
                    <Badge tone={norm.active ? 'success' : 'neutral'}>{norm.active ? 'Đang áp dụng' : 'Tạm ngưng'}</Badge>
                    {norm.updated_at && <small className="muted"> · {timeLabel(norm.updated_at)}</small>}
                  </td>
                  <td>
                    {canManage
                      ? <button type="button" className="button secondary" aria-haspopup="dialog" disabled={!itemsReady}
                          aria-label={`Sửa định mức ${labelFor(normCategoryLabels, norm.category, 'nhóm khác')}`}
                          onClick={() => { setNotice(''); setEditing(norm); }}>Sửa</button>
                      : <span className="muted">Chỉ xem</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <DetailSurface key={editing.id} modal open onClose={() => setEditing(null)} label={`Sửa định mức ${labelFor(normCategoryLabels, editing.category, 'nhóm khác')}`} heading={`Sửa định mức ${labelFor(normCategoryLabels, editing.category, 'nhóm khác')}`} className="campaign-management-dialog">
          <CommandForm
            key={`${editing.id}-${editing.version}`}
            spec={normSpec(editing)}
            onSuccess={() => { setEditing(null); setNotice('Đã lưu định mức mới.'); setRevision((value) => value + 1); }}
            onStale={() => { setEditing(null); setNotice('Định mức đã thay đổi ở nơi khác. Bảng đã được tải lại; hãy kiểm tra trước khi sửa.'); setRevision((value) => value + 1); }}
          />
        </DetailSurface>
      )}
    </section>
  );
}

