import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { formatQuantity } from '../../i18n/quantity';
import { ListNav } from '../../components/ui/Pager';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import './warehouse-detail.css';

type Stock = {
  balance_id: string;
  item_name: string;
  unit: string;
  on_hand: string;
  reserved: string;
  available: string;
};
type StockPage = { items: Stock[]; more?: boolean; cursor?: string | null };
type Warehouse = { id: string; location?: { coordinates?: [number, number] } | null };

export function WarehouseDetailPage({ warehouseId, warehouseName }: { warehouseId: string; warehouseName?: string }) {
  const [stock, setStock] = useState<Stock[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [nearbyAddress, setNearbyAddress] = useState('Đang tìm địa chỉ gần đúng…');

  useEffect(() => {
    const controller = new AbortController();
    setNearbyAddress('Đang tìm địa chỉ gần đúng…');
    void fetchAll<Warehouse>('logistics', '/warehouses')
      .then(async (warehouses) => {
        const coordinates = warehouses.find((item) => item.id === warehouseId)?.location?.coordinates;
        if (!coordinates || !coordinates.every(Number.isFinite)) return 'Kho chưa khai báo vị trí.';
        const [longitude, latitude] = coordinates.map((value) => Math.round(value * 100) / 100);
        const query = new URLSearchParams({ location: `${longitude},${latitude}`, langCode: 'VI', featureTypes: 'Locality', forStorage: 'false', f: 'json' });
        const response = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?${query}`, { signal: controller.signal });
        if (!response.ok) return 'Chưa tìm được địa chỉ gần đúng cho kho này.';
        const result = await response.json() as { address?: { Match_addr?: string; CountryCode?: string } };
        return result.address?.CountryCode === 'VNM' && result.address.Match_addr?.trim()
          ? `Gần ${result.address.Match_addr.trim()}` : 'Chưa tìm được địa chỉ gần đúng cho kho này.';
      })
      .then((address) => { if (!controller.signal.aborted) setNearbyAddress(address); })
      .catch(() => { if (!controller.signal.aborted) setNearbyAddress('Chưa tìm được địa chỉ gần đúng cho kho này.'); });
    return () => controller.abort();
  }, [warehouseId, revision]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ warehouse_id: warehouseId, limit: String(LIST_PAGE_SIZE) });
    if (cursor) query.set('cursor', cursor);
    api<StockPage>('logistics', `/stock?${query}`)
      .then((value) => { if (live) { setStock(value.items || []); setNext(value.more ? value.cursor || null : null); } })
      .catch((cause) => { if (live) { setStock([]); setNext(null); setError(cause instanceof Error ? cause.message : 'Không thể tải tồn kho.'); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [warehouseId, cursor, revision]);

  return <div className="warehouse-detail">
    <a className="table-row-link" href="?workspace=operations&page=assets&view=warehouses">← Danh sách kho</a>
    <div className="warehouse-detail__heading">
      <div>
        <h2>Tồn kho {warehouseName ? `— ${warehouseName}` : ''}</h2>
        <p>Số lượng vật phẩm hiện có tại kho này.</p>
      </div>
      <button type="button" className="button secondary refresh-action" onClick={() => setRevision((value) => value + 1)}>Làm mới</button>
    </div>
    <section className="card warehouse-detail__location" aria-label="Vị trí gần đúng của kho">
      <h3>Vị trí gần đúng</h3>
      <p role="status">{nearbyAddress}</p>
    </section>
    <section className="card" aria-label="Tồn kho của kho">
      {loading && <p role="status">Đang tải tồn kho…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {!loading && !error && stock.length === 0 && <p>Kho chưa có vật phẩm trong tồn kho.</p>}
      {stock.length > 0 && <div className="stock-table-scroll" role="region" aria-label="Bảng tồn kho" tabIndex={0}>
        <table className="stock-table"><thead><tr><th>Vật phẩm</th><th>Đơn vị</th><th>Tồn thực tế</th><th>Đã giữ</th><th>Có thể xuất</th></tr></thead>
          <tbody>{stock.map((row) => <tr key={row.balance_id}>
            <th scope="row">{row.item_name}</th><td>{row.unit}</td>
            <td>{formatQuantity(row.on_hand)}</td><td>{formatQuantity(row.reserved)}</td><td><strong>{formatQuantity(row.available)}</strong></td>
          </tr>)}</tbody></table>
      </div>}
      <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={stock.length} noun="vật phẩm" />
    </section>
  </div>;
}
