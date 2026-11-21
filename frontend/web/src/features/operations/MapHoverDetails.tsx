import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';

type StockRow = { balance_id: string; item_name: string; on_hand: string; available: string; unit: string };
type StockPage = { items?: StockRow[]; more?: boolean; cursor?: string | null };
type DriveItem = { item_id: string; item_name: string; unit_name: string; target_quantity: string; accepted_total?: string };

const amount = (value?: string) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

export function MapHoverDetails({ warehouse, drive, onClose }: {
  warehouse: { id: string; name: string; service_radius_m?: number | null };
  drive?: { title: string; status: string; items: DriveItem[] };
  onClose: () => void;
}) {
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (drive) return;
    let live = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ warehouse_id: warehouse.id, limit: String(LIST_PAGE_SIZE) });
    if (cursor) query.set('cursor', cursor);
    api<StockPage>('logistics', `/stock?${query}`)
      .then(value => { if (live) { setStock(value.items || []); setNext(value.more ? value.cursor || null : null); } })
      .catch(cause => { if (live) { setStock([]); setNext(null); setError(cause instanceof Error ? cause.message : 'Chưa tải được tồn kho.'); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [warehouse.id, drive, cursor]);
  const offset = pageIndex * LIST_PAGE_SIZE;
  const driveItems = drive?.items.slice(offset, offset + LIST_PAGE_SIZE) || [];
  return <section aria-label={drive ? `Vật phẩm của ${drive.title}` : `Tồn kho ${warehouse.name}`}>
    <div className="warehouse-map-hover__heading">
      <strong>{drive ? drive.title : warehouse.name}</strong>
      <button type="button" className="button secondary small" onClick={onClose} aria-label="Đóng thông tin trên bản đồ">×</button>
    </div>
    <p>{drive ? `Điểm quyên góp · ${warehouse.name}` : `Kho · Bán kính ${warehouse.service_radius_m ? `${(warehouse.service_radius_m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : 'chưa khai báo'}`}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loading && <p role="status">Đang tải tồn kho…</p>}
    {!loading && !error && <div className="warehouse-map-hover__table-wrap" role="region" aria-label={drive ? 'Bảng vật phẩm tiếp nhận' : 'Bảng tồn kho'} tabIndex={0}>
      <table className="warehouse-map-hover__table">
        <thead><tr><th scope="col">Vật phẩm</th><th scope="col">{drive ? 'Mục tiêu' : 'Tồn thực tế'}</th><th scope="col">{drive ? 'Đã tiếp nhận' : 'Khả dụng'}</th></tr></thead>
        <tbody>{drive ? driveItems.map(item => <tr key={item.item_id}><th scope="row">{item.item_name}</th><td>{amount(item.target_quantity)} {item.unit_name}</td><td>{amount(item.accepted_total)} {item.unit_name}</td></tr>)
          : stock.map(item => <tr key={item.balance_id}><th scope="row">{item.item_name}</th><td>{amount(item.on_hand)} {item.unit}</td><td>{amount(item.available)} {item.unit}</td></tr>)}
          {(drive ? !driveItems.length : !stock.length) && <tr><td colSpan={3}>{drive ? 'Chưa có vật phẩm trong đợt.' : 'Kho chưa có vật phẩm tồn.'}</td></tr>}</tbody>
      </table>
    </div>}
    <ListNav page={pageIndex} hasNext={drive ? offset + LIST_PAGE_SIZE < drive.items.length : Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => drive ? setCursor(String(offset + LIST_PAGE_SIZE)) : next && setCursor(next)} count={drive ? driveItems.length : stock.length} noun="vật phẩm" />
  </section>;
}
