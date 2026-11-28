import { itemUnitName } from '../../i18n/units';
import { useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { useCursorPages } from '../../api/useCursorPages';
import { roles, type Me } from '../../auth/session';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { confirmAction } from '../../components/confirmAction';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { timeLabel } from '../../i18n/labels';
import { proposalErrorMessage } from '../need-proposals/needProposalModel';
import { CreateItemForm } from './CreateItemForm';
import { AliasEditor } from './AliasEditor';
import { ItemActionsMenu } from './ItemActionsMenu';
import { ALIAS_MAX_COUNT } from './itemAliasModel';
import './catalog-items.css';

interface CatalogItem {
  id: string; name: string; version: number; status: 'ACTIVE' | 'INACTIVE'; created_at: string;
  item_type: { code: string; display_name: string };
  unit: { code: string; display_name: string; scale: number };
  aliases?: string[];
}

function editSpec(item: CatalogItem): CommandSpec {
  return {
    title: 'Lưu thay đổi', hideTitle: true, service: 'logistics', method: 'PATCH',
    path: `/items/${item.id}`, version: item.version,
    fields: [
      { name: 'name', label: 'Tên vật phẩm', type: 'text', required: true, maxLength: 200, initialValue: item.name },
    ],
    build: (values) => ({ name: values.name.trim() }),
  };
}

/** Server-paged catalog; historical stock retains its original item type and unit. */
export function ItemCatalogPage({ user }: { user: Me }) {
  const canManage = roles(user).has('OPERATIONS_MANAGER');
  const pages = useCursorPages<CatalogItem>('logistics', '/items', 10, canManage);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [mode, setMode] = useState<'edit' | 'aliases'>('edit');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  function stale() {
    setSelected(null);
    setNotice('Vật phẩm đã thay đổi ở nơi khác. Danh sách đã được tải lại; hãy kiểm tra trước khi sửa.');
    pages.reload();
  }

  async function deleteItem(item: CatalogItem) {
    if (busy) return;
    if (!(await confirmAction(`Xóa vật phẩm ${item.name}? Chỉ vật phẩm chưa được sử dụng mới có thể xóa.`))) return;
    setBusy(true); setActionError('');
    try {
      await api('logistics', `/items/${item.id}`, {
        method: 'DELETE', body: { expected_version: item.version }, idempotencyKey: newCommandKey(),
      });
      setSelected(null); setNotice(`Đã xóa vật phẩm ${item.name}.`); pages.reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') stale();
      else setActionError(cause instanceof ApiError && cause.code === 'ITEM_IN_USE'
        ? 'Vật phẩm đã được sử dụng nên không thể xóa; dữ liệu lịch sử được giữ nguyên.'
        : proposalErrorMessage(cause));
    } finally { setBusy(false); }
  }

  if (!canManage) return <section className="card catalog-items" aria-labelledby="catalog-items-title">
    <h2 id="catalog-items-title">Danh mục vật phẩm</h2>
    <EmptyState icon="lock" title="Chưa có quyền quản lý danh mục" description="Màn hình này dành cho quản lý vận hành." />
  </section>;

  return <div className="catalog-items">
    <section className="card catalog-items__header" aria-labelledby="catalog-items-title">
      <div className="section-header list-action-header">
        <div><span className="eyebrow">Quản lý vận hành</span><h2 id="catalog-items-title">Danh mục vật phẩm</h2></div>
        <div className="list-header-actions">
          <Button size="sm" aria-haspopup="dialog" onClick={() => { setNotice(''); setCreating(true); }}>Thêm vật phẩm</Button>
          <Button variant="secondary" size="sm" className="refresh-action" disabled={pages.loading} onClick={pages.reload}>Làm mới</Button>
        </div>
      </div>
      <p className="muted">Chọn dấu ba chấm trên từng dòng để sửa vật phẩm, sửa từ khóa hoặc xóa vật phẩm chưa được sử dụng. Nhóm hàng và đơn vị tính không thay đổi sau khi tạo.</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {actionError && <p className="notice error" role="alert">{actionError}</p>}
      {pages.error && <div className="notice error" role="alert"><p>{pages.error}</p><Button variant="secondary" size="sm" onClick={pages.reload}>Thử lại</Button></div>}
    </section>

    {pages.loading && !pages.items.length && <Skeleton rows={5} label="Đang tải danh mục vật phẩm…" />}
    {!pages.loading && !pages.error && !pages.items.length && <EmptyState title="Chưa có vật phẩm" description="Danh mục vật phẩm chưa có dòng nào." />}
    {pages.items.length > 0 && <section className="card catalog-items__table-card">
      <div className="operations-table-scroll" role="region" aria-label="Bảng vật phẩm" tabIndex={0}>
        <table className="operations-record-table catalog-items__table">
          <thead><tr><th scope="col">Vật phẩm</th><th scope="col">Nhóm hàng</th><th scope="col">Đơn vị</th><th scope="col">Từ khóa</th><th scope="col">Trạng thái</th><th scope="col">Ngày tạo</th><th scope="col" aria-label="Tùy chọn"></th></tr></thead>
          <tbody>{pages.items.map((item) => <tr key={item.id}>
            <th scope="row"><button type="button" className="table-row-link" aria-haspopup="dialog" onClick={() => { setSelected(item); setMode('edit'); setActionError(''); }}>{item.name}</button></th>
            <td>{item.item_type.display_name}</td><td>{itemUnitName(item.id, item.unit.display_name)}</td>
            <td>{item.aliases?.length ?? 0} / {ALIAS_MAX_COUNT}</td>
            <td><Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>{item.status === 'ACTIVE' ? 'Đang dùng' : 'Ngừng dùng'}</Badge></td>
            <td>{timeLabel(item.created_at)}</td>
            <td className="catalog-items__actions"><ItemActionsMenu name={item.name}
              onEdit={() => { setSelected(item); setMode('edit'); setActionError(''); }}
              onAliases={() => { setSelected(item); setMode('aliases'); setActionError(''); }}
              onDelete={() => void deleteItem(item)} /></td>
          </tr>)}</tbody>
        </table>
      </div>
      <nav className="catalog-items__pager" aria-label="Phân trang vật phẩm">
        <span>Trang {pages.page + 1}</span>
        <Button variant="secondary" size="sm" disabled={pages.loading || pages.page === 0} onClick={pages.prev}>‹ Trang trước</Button>
        <Button variant="secondary" size="sm" disabled={pages.loading || !pages.hasNext} onClick={pages.next}>Trang sau ›</Button>
      </nav>
    </section>}

    {creating && <DetailSurface modal open onClose={() => setCreating(false)} label="Thêm vật phẩm" heading="Thêm vật phẩm" className="campaign-management-dialog">
      <CreateItemForm onCreated={(name) => { setCreating(false); setNotice(`Đã thêm vật phẩm ${name}.`); pages.first(); }} />
    </DetailSurface>}

    {selected && <DetailSurface key={`${selected.id}-${selected.version}-${mode}`} modal open onClose={() => setSelected(null)}
      label={`${mode === 'edit' ? 'Sửa vật phẩm' : 'Sửa từ khóa'} ${selected.name}`}
      heading={`${mode === 'edit' ? 'Sửa vật phẩm' : 'Sửa từ khóa'} ${selected.name}`} className="campaign-management-dialog catalog-item-dialog">
      {mode === 'edit' ? <>
        <p className="muted">Nhóm hàng: {selected.item_type.display_name} · Đơn vị tính: {itemUnitName(selected.id, selected.unit.display_name)}</p>
        <CommandForm spec={editSpec(selected)} onSuccess={(result) => { setSelected(null); setNotice(`Đã cập nhật vật phẩm ${String((result as { name?: string } | undefined)?.name ?? selected.name)}.`); pages.reload(); }} onStale={stale} />
      </> : <AliasEditor item={{ ...selected, aliases: selected.aliases ?? [] }}
        onSaved={() => { setSelected(null); setNotice(`Đã lưu từ khóa cho ${selected.name}.`); pages.reload(); }} onStale={stale} />}
    </DetailSurface>}
  </div>;
}
