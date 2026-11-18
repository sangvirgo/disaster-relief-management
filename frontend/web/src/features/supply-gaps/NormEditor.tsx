import { useEffect, useState } from 'react';
import { api } from '../../api/client';
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
  normItemTypeLabels,
} from '../../i18n/supplyLabels';
import { canManageNeedNorms, type NeedNorm } from './supplyModel';

const sameNumber = (left: string, right: string) => Number(left) === Number(right);

/** Edits the per-person norm table used by SOS need estimates. Only OPERATIONS_MANAGER can save changes. */
export function NormEditor({ user }: { user: Me }) {
  const canManage = canManageNeedNorms(roles(user));
  const [norms, setNorms] = useState<NeedNorm[]>([]);
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

  function normSpec(norm: NeedNorm): CommandSpec {
    return {
      title: 'Sửa định mức',
      service: 'logistics',
      method: 'PATCH',
      path: `/need-norms/${norm.id}`,
      version: norm.version,
      warning: 'Xác nhận cập nhật định mức này? Định mức mới được dùng cho các lần ước tính nhu cầu sau khi lưu.',
      fields: [
        { name: 'qty_per_person_per_day', label: 'Định mức mỗi người (theo đơn vị vật phẩm)', type: 'number', required: true, min: 0, initialValue: norm.qty_per_person_per_day },
        { name: 'quantity_basis', label: 'Cách tính', type: 'select', required: true, options: [...normBasisOptions], initialValue: norm.quantity_basis },
        { name: 'modifier_infant', label: 'Hệ số thêm cho trẻ nhỏ', type: 'number', required: true, min: 0, initialValue: norm.modifier_infant },
        { name: 'modifier_elderly', label: 'Hệ số thêm cho người cao tuổi', type: 'number', required: true, min: 0, initialValue: norm.modifier_elderly },
        { name: 'active', label: 'Trạng thái áp dụng', type: 'select', required: true, options: [...normActiveOptions], initialValue: norm.active ? 'true' : 'false' },
      ],
      build: (values) => {
        const body: Record<string, unknown> = {};
        if (!sameNumber(values.qty_per_person_per_day, norm.qty_per_person_per_day)) body.qty_per_person_per_day = values.qty_per_person_per_day;
        if (values.quantity_basis !== norm.quantity_basis) body.quantity_basis = values.quantity_basis;
        if (!sameNumber(values.modifier_infant, norm.modifier_infant)) body.modifier_infant = values.modifier_infant;
        if (!sameNumber(values.modifier_elderly, norm.modifier_elderly)) body.modifier_elderly = values.modifier_elderly;
        if ((values.active === 'true') !== norm.active) body.active = values.active === 'true';
        if (!Object.keys(body).length) throw new Error('Chưa có thay đổi nào để lưu.');
        return body;
      },
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
      <p className="muted">Định mức dùng để ước tính nhu cầu SOS. Nhu cầu ước tính chỉ được cam kết xuất kho sau khi điều phối viên xác nhận.</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
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
                <th scope="col">Hệ số trẻ nhỏ</th>
                <th scope="col">Hệ số người cao tuổi</th>
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
                  <td>{formatQuantity(norm.qty_per_person_per_day)}</td>
                  <td>{formatQuantity(norm.modifier_infant)}</td>
                  <td>{formatQuantity(norm.modifier_elderly)}</td>
                  <td>
                    <Badge tone={norm.active ? 'success' : 'neutral'}>{norm.active ? 'Đang áp dụng' : 'Tạm ngưng'}</Badge>
                    {norm.updated_at && <small className="muted"> · {timeLabel(norm.updated_at)}</small>}
                  </td>
                  <td>
                    {canManage
                      ? <button type="button" className="button secondary" aria-haspopup="dialog" aria-label={`Sửa định mức ${labelFor(normCategoryLabels, norm.category, 'nhóm khác')}`} onClick={() => { setNotice(''); setEditing(norm); }}>Sửa</button>
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
