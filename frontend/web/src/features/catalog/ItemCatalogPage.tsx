import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { roles, type Me } from '../../auth/session';
import { DetailSurface } from '../../components/DetailSurface';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { proposalErrorMessage } from '../need-proposals/needProposalModel';
import { AliasEditor, type AliasItem } from './AliasEditor';
import { CreateItemForm } from './CreateItemForm';
import { ALIAS_MAX_COUNT } from './itemAliasModel';
import './catalog-items.css';

interface CatalogItem extends AliasItem {
  status: 'ACTIVE' | 'INACTIVE';
  item_type: { code: string; display_name: string };
  unit: { display_name: string; scale: number };
  aliases: string[];
}

interface ItemPage {
  items: (Omit<CatalogItem, 'aliases'> & { aliases?: string[] })[];
  next_cursor?: string | null;
}

const PAGE_SIZE = 50;
const withAliases = (item: ItemPage['items'][number]): CatalogItem => ({
  ...item,
  aliases: Array.isArray(item.aliases) ? item.aliases : [],
});

function catalogLoadError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    if (error.status === 404) return 'Dịch vụ Logistics đang chạy chưa có API danh mục vật phẩm của phiên bản mới. Cần cập nhật dịch vụ để xem danh sách này.';
    if (error.status === 403) return 'Tài khoản hiện tại chưa được cấp quyền xem danh mục vật phẩm trong phạm vi này.';
  }
  return proposalErrorMessage(error);
}

/** Catalog items with their aliases. Only OPERATIONS_MANAGER (CATALOG_MANAGE) can edit aliases. */
export function ItemCatalogPage({ user }: { user: Me }) {
  const canManage = roles(user).has('OPERATIONS_MANAGER');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [aliasesAvailable, setAliasesAvailable] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    setLoading(true);
    setError('');
    api<ItemPage>('logistics', `/items?limit=${PAGE_SIZE}`)
      .then((page) => {
        if (!live) return;
        setItems(page.items.map(withAliases));
        setAliasesAvailable(page.items.every((item) => Array.isArray(item.aliases)));
        setCursor(page.next_cursor ?? '');
      })
      .catch((cause) => { if (live) { setItems([]); setError(catalogLoadError(cause)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [canManage, revision]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<ItemPage>('logistics', `/items?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`);
      setItems((current) => [...current, ...page.items.map(withAliases)]);
      if (page.items.some((item) => !Array.isArray(item.aliases))) setAliasesAvailable(false);
      setCursor(page.next_cursor ?? '');
    } catch (cause) {
      setError(catalogLoadError(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!canManage) {
    return (
      <section className="card catalog-items" aria-labelledby="catalog-items-title">
        <h2 id="catalog-items-title">Danh mục vật phẩm</h2>
        <EmptyState icon="lock" title="Chưa có quyền quản lý danh mục" description="Màn hình này dành cho quản lý vận hành." />
      </section>
    );
  }

  return (
    <div className="catalog-items">
      <section className="card catalog-items__header" aria-labelledby="catalog-items-title">
        <div className="section-header list-action-header">
          <div>
            <span className="eyebrow">Quản lý vận hành</span>
            <h2 id="catalog-items-title">Danh mục vật phẩm</h2>
          </div>
          <div className="list-header-actions">
            <Button size="sm" aria-haspopup="dialog" onClick={() => { setNotice(''); setCreating(true); }}>Thêm vật phẩm</Button>
            <Button variant="secondary" size="sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Cập nhật</Button>
          </div>
        </div>
        <p className="muted">Từ khóa (tên gọi khác) giúp hệ thống nhận ra vật phẩm trong mô tả của người dân. Tối đa {ALIAS_MAX_COUNT} từ khóa cho mỗi vật phẩm.</p>
        {!aliasesAvailable && <p className="notice warning" role="status">Danh mục đang chạy phiên bản cũ: vẫn xem được vật phẩm, nhưng cần cập nhật dịch vụ Logistics để xem và sửa từ khóa.</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {error && (
          <div className="notice error" role="alert">
            <p>{error}</p>
            <Button variant="secondary" size="sm" onClick={() => setRevision((value) => value + 1)}>Thử lại</Button>
          </div>
        )}
      </section>

      {loading && items.length === 0 && <Skeleton rows={4} label="Đang tải danh mục vật phẩm…" />}

      {!loading && !error && items.length === 0 && (
        <EmptyState title="Chưa có vật phẩm" description="Danh mục vật phẩm chưa có dòng nào." />
      )}

      {items.length > 0 && (
        <ul className="catalog-items__list" aria-label="Danh sách vật phẩm">
          {items.map((item) => (
            <li key={item.id} className="card catalog-item">
              <div className="catalog-item__main">
                <strong className="catalog-item__name">{item.name}</strong>
                <span className="muted">{item.item_type.display_name} · {item.unit.display_name}</span>
                <Badge kind="meta" tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {item.status === 'ACTIVE' ? 'Đang dùng' : 'Ngừng dùng'}
                </Badge>
              </div>
              {item.aliases.length > 0 ? (
                <ul className="alias-chips" aria-label={`Từ khóa của ${item.name}`}>
                  {item.aliases.map((alias) => <li key={alias} className="alias-chip"><span>{alias}</span></li>)}
                </ul>
              ) : (
                <p className="muted catalog-item__no-alias">{aliasesAvailable ? 'Chưa có từ khóa.' : 'Phiên bản API này chưa cung cấp từ khóa.'}</p>
              )}
              {aliasesAvailable && <div>
                <Button variant="secondary" size="sm" aria-haspopup="dialog" aria-label={`Sửa từ khóa của ${item.name}`}
                  onClick={() => { setNotice(''); setEditing(item); }}>
                  Sửa từ khóa
                </Button>
              </div>}
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="catalog-items__more">
          <Button variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>Tải thêm</Button>
        </div>
      )}

      {creating && (
        <DetailSurface
          modal
          open
          onClose={() => setCreating(false)}
          label="Thêm vật phẩm"
          heading="Thêm vật phẩm"
          className="campaign-management-dialog"
        >
          <CreateItemForm
            onCreated={(name) => {
              setCreating(false);
              setNotice(`Đã thêm vật phẩm ${name}.`);
              setRevision((value) => value + 1);
            }}
          />
        </DetailSurface>
      )}

      {editing && (
        <DetailSurface
          key={`${editing.id}-${editing.version}`}
          modal
          open
          onClose={() => setEditing(null)}
          label={`Từ khóa của ${editing.name}`}
          heading={`Từ khóa của ${editing.name}`}
          className="campaign-management-dialog"
        >
          <AliasEditor
            item={editing}
            onSaved={(aliases) => {
              setEditing(null);
              setNotice(`Đã lưu ${aliases.length} từ khóa cho ${editing.name}.`);
              setRevision((value) => value + 1);
            }}
            onStale={() => {
              setEditing(null);
              setNotice('Vật phẩm đã thay đổi ở nơi khác. Danh sách đã được tải lại; hãy kiểm tra trước khi sửa.');
              setRevision((value) => value + 1);
            }}
          />
        </DetailSurface>
      )}
    </div>
  );
}
