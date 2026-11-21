import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { Pager } from '../../components/ui/Pager';
import { WarehouseCoverageMap, type Coverage, type MapCampaign } from '../../maps/WarehouseCoverageMap';
import { DriveCreateForm, distanceMetres, type DriveEdit, type WarehouseArea } from './DriveCreateForm';

type Option = { value: string; label: string };
type Warehouse = {
  id?: string; name?: string; status?: string; version?: number; address_note?: string | null;
  location_public?: boolean; service_radius_m?: number | null; location?: { coordinates?: [number, number] } | null;
};
type DriveItem = {
  item_id: string; item_name: string; unit_name: string; scale?: number; target_quantity: string; accepted_total?: string; acceptance_note?: string | null;
};
type Drive = {
  id: string; title: string; description?: string | null; status: string; version: number; intake_warehouse_id: string;
  campaign_id?: string | null; opens_at?: string | null; closes_at?: string | null; items: DriveItem[];
  location?: { coordinates?: [number, number] } | null; location_note?: string | null;
};
type Dialog =
  | { kind: 'edit-warehouse'; warehouse: Warehouse }
  | { kind: 'new-drive'; warehouseId?: string; location?: { latitude: number; longitude: number } }
  | { kind: 'edit-drive'; drive: Drive }
  | { kind: 'drive-action'; drive: Drive; action: 'pause' | 'close' };

const DRIVE_STATUS: Record<string, string> = { DRAFT: 'Bản nháp', OPEN: 'Đang mở', PAUSED: 'Tạm dừng', CLOSED: 'Đã đóng' };
const PAGE_SIZE = 5;
type CampaignRow = { id?: string; name?: string; status?: string; center?: { lat: number; lng: number } | null; radius_m?: number | null };
/** Great-circle distance in metres, used to test whether a warehouse radius overlaps a campaign area. */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLng - aLng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
const when = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : 'Không giới hạn';

/** Decimal subtraction on strings so scaled quantities never pass through floating point. */
function remaining(target: string, accepted: string | undefined, scale: number): string {
  const factor = 10n ** BigInt(scale);
  const units = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole || '0') * factor + BigInt(fraction.padEnd(scale, '0').slice(0, scale) || '0');
  };
  const left = units(target) - units(accepted ?? '0');
  const clamped = left < 0n ? 0n : left;
  if (scale === 0) return clamped.toString();
  const text = clamped.toString().padStart(scale + 1, '0');
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}
const fmt = (value: string | undefined) => value === undefined ? '0' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

/**
 * Warehouse map for operations: shows every warehouse with its radius and, for the selected one, its donation drives with the
 * goods still needed. Managers can add and adjust warehouses and drives without leaving the map.
 */
export function WarehouseMapManager({ canManage, canManageDrives, warehouseOptions, campaigns, items, itemScales, refreshKey, onCreateWarehouse, onChanged }: {
  canManage: boolean; canManageDrives: boolean;
  warehouseOptions: Option[]; campaigns: Option[]; items: Option[]; itemScales: Option[];
  refreshKey: number; onCreateWarehouse: () => void; onChanged: () => void;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [campaignRows, setCampaignRows] = useState<MapCampaign[]>([]);
  const [showCampaigns, setShowCampaigns] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Warehouse | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [revision, setRevision] = useState(0);
  const [actionError, setActionError] = useState('');
  const [cardPage, setCardPage] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [placeMessage, setPlaceMessage] = useState('');

  useEffect(() => {
    let live = true;
    setState('loading');
    Promise.all([
      fetchAll<Warehouse>('logistics', '/warehouses?status=ACTIVE'),
      fetchAll<Drive>('logistics', '/donation-drives').catch(() => [] as Drive[]),
      // Relief campaigns come from Response; the map still works without them.
      fetchAll<CampaignRow>('response', '/campaigns').catch(() => [] as CampaignRow[]),
    ]).then(([warehouseRows, driveRows, campaignList]) => {
      if (!live) return;
      setWarehouses(warehouseRows);
      setDrives(driveRows);
      setCampaignRows(campaignList.flatMap((campaign) => campaign.id && campaign.center && campaign.radius_m && campaign.status !== 'DRAFT'
        ? [{ id: campaign.id, name: campaign.name || 'Chiến dịch', status: campaign.status || 'ACTIVE', lat: campaign.center.lat, lng: campaign.center.lng, radiusM: campaign.radius_m }] : []));
      setState('ready');
    }).catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, [refreshKey, revision]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    api<Warehouse>('logistics', `/warehouses/${encodeURIComponent(selectedId)}`)
      .then((row) => { if (live) setDetail(row); })
      .catch(() => { if (live) setDetail(warehouses.find((row) => row.id === selectedId) ?? null); });
    return () => { live = false; };
  }, [selectedId, revision, refreshKey, warehouses]);

  const rows = useMemo<Coverage[]>(() => warehouses.flatMap((warehouse, index) => {
    const coordinates = warehouse.location?.coordinates;
    if (!warehouse.id || !coordinates || !coordinates.every((value) => Number.isFinite(value))) return [];
    const live = drives.filter((drive) => drive.intake_warehouse_id === warehouse.id && drive.status !== 'CLOSED')
      .map((drive) => ({ id: drive.id, title: drive.title, status: drive.status,
        ...(drive.location?.coordinates ? { lat: drive.location.coordinates[1], lng: drive.location.coordinates[0] } : {}) }));
    return [{ id: warehouse.id, index, name: warehouse.name || 'Kho chưa đặt tên', lat: coordinates[1], lng: coordinates[0], radiusM: warehouse.service_radius_m ?? null, drives: live }];
  }), [warehouses, drives]);
  /** Campaigns whose area overlaps a warehouse's service area (same rule the system uses to assign warehouses). */
  const servedBy = useMemo(() => {
    const result = new Map<string, MapCampaign[]>();
    for (const row of rows) {
      const radius = row.radiusM ?? 0;
      result.set(row.id, campaignRows.filter((campaign) => radius > 0 && distanceM(row.lat, row.lng, campaign.lat, campaign.lng) <= radius + campaign.radiusM));
    }
    return result;
  }, [rows, campaignRows]);
  const unservedCampaigns = campaignRows.filter((campaign) => campaign.status !== 'CLOSED'
    && ![...servedBy.values()].some((list) => list.some((served) => served.id === campaign.id)));
  const areaFor = useCallback((warehouseId: string): WarehouseArea | null => {
    const row = rows.find((candidate) => candidate.id === warehouseId);
    return row && row.radiusM ? { name: row.name, latitude: row.lat, longitude: row.lng, radiusM: row.radiusM } : null;
  }, [rows]);
  /** Tapping the map while placing: the nearest warehouse whose service area contains the point hosts the new drive. */
  function placeAt(lat: number, lng: number) {
    const containing = rows.filter((row) => row.radiusM && distanceMetres({ latitude: row.lat, longitude: row.lng }, { latitude: lat, longitude: lng }) <= row.radiusM)
      .sort((left, right) => distanceMetres({ latitude: left.lat, longitude: left.lng }, { latitude: lat, longitude: lng }) - distanceMetres({ latitude: right.lat, longitude: right.lng }, { latitude: lat, longitude: lng }));
    if (!containing[0]) { setPlaceMessage('Vị trí này nằm ngoài vùng phục vụ của mọi kho. Hãy chạm vào bên trong một vòng tròn kho.'); return; }
    setPlaceMessage('');
    setPlacing(false);
    setSelectedId(containing[0].id);
    setDialog({ kind: 'new-drive', warehouseId: containing[0].id, location: { latitude: lat, longitude: lng } });
  }
  useEffect(() => {
    if (!placing) return undefined;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPlacing(false); setPlaceMessage(''); } };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [placing]);
  const pageCount = Math.max(1, Math.ceil(warehouses.length / PAGE_SIZE));
  const visibleWarehouses = warehouses.slice(cardPage * PAGE_SIZE, (cardPage + 1) * PAGE_SIZE);
  function select(id: string, driveId?: string) {
    setSelectedId(id);
    const position = warehouses.findIndex((row) => row.id === id);
    if (position >= 0) setCardPage(Math.floor(position / PAGE_SIZE));
    if (driveId) window.setTimeout(() => document.getElementById(`drive-${driveId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    else window.setTimeout(() => document.getElementById(`warehouse-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
  }
  const refresh = useCallback(() => { setDialog(null); setRevision((value) => value + 1); onChanged(); }, [onChanged]);

  async function transition(drive: Drive, action: 'open' | 'resume') {
    setActionError('');
    try {
      await api('logistics', `/donation-drives/${drive.id}/${action}`, {
        method: 'POST', body: { expected_version: drive.version }, idempotencyKey: newCommandKey(),
      });
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Chưa thể cập nhật đợt quyên góp.');
    }
  }

  const warehouseSpec = (warehouse: Warehouse): CommandSpec => ({
    title: 'Sửa kho', hideTitle: true, service: 'logistics', method: 'PATCH', path: `/warehouses/${warehouse.id}`, version: warehouse.version,
    fields: [
      { name: 'name', label: 'Tên kho', required: true, maxLength: 200, initialValue: warehouse.name ?? '' },
      { name: 'location', label: 'Vị trí kho và vùng phục vụ', type: 'service-area', radiusFieldName: 'service_radius_m', addressFieldName: 'address_note', radiusRange: { min: 500, max: 200_000 },
        initialValue: warehouse.location?.coordinates ? warehouse.location.coordinates.join(',') : undefined },
      { name: 'address_note', label: 'Địa chỉ', maxLength: 500, initialValue: warehouse.address_note ?? undefined, visibleFor: (values) => Boolean(values.location) },
      { name: 'service_radius_m', label: 'Bán kính phục vụ (mét)', type: 'number', integer: true, min: 500, max: 200_000,
        initialValue: warehouse.service_radius_m ? String(warehouse.service_radius_m) : undefined, visibleFor: (values) => Boolean(values.location) },
      { name: 'location_public', label: 'Công khai vị trí kho để người quyên góp tìm đợt gần nhất', type: 'checkbox', initialValue: warehouse.location_public ? 'true' : 'false' },
    ],
    build: (values) => ({
      name: values.name,
      address_note: values.address_note?.trim() ? values.address_note.trim() : null,
      location_public: values.location_public === 'true',
      ...(values.location
        ? { location: { type: 'Point', coordinates: values.location.split(',').map(Number) }, service_radius_m: Number(values.service_radius_m) }
        : { location: null, service_radius_m: null }),
    }),
  });

  const driveEdit = (drive: Drive): DriveEdit => ({
    id: drive.id, version: drive.version,
    initial: {
      title: drive.title, description: drive.description ?? '', campaignId: drive.campaign_id ?? '', opensAt: drive.opens_at ?? null, closesAt: drive.closes_at ?? null,
      location: drive.location?.coordinates ? { longitude: drive.location.coordinates[0], latitude: drive.location.coordinates[1] } : null, locationNote: drive.location_note ?? '',
      lines: drive.items.map((item) => ({ item_id: item.item_id, target_quantity: item.target_quantity, acceptance_note: item.acceptance_note ?? '' })),
    },
  });

  const toolbar = <>
    {canManage && <button type="button" className="button" onClick={onCreateWarehouse}>+ Thêm kho</button>}
    {canManageDrives && <button type="button" className={`button ${placing ? '' : 'secondary'}`} aria-pressed={placing} onClick={() => { setPlacing((value) => !value); setPlaceMessage(''); }}>{placing ? 'Hủy chọn điểm' : '+ Thêm đợt quyên góp'}</button>}
    <label className="warehouse-map-toggle"><input type="checkbox" checked={showCampaigns} onChange={(event) => setShowCampaigns(event.target.checked)} /> Vùng chiến dịch</label>
  </>;
  const drivesSection = (warehouseId: string) => {
    const own = drives.filter((drive) => drive.intake_warehouse_id === warehouseId);
    return <div className="warehouse-card__drives">
      <h4>Đợt quyên góp và vật phẩm đang cần</h4>
      {actionError && <p className="notice error" role="alert">{actionError}</p>}
      {state === 'ready' && own.length === 0 && <p className="muted">Kho này chưa có đợt quyên góp. Bấm "+ Đợt quyên góp" để tạo.</p>}
      {own.map((drive) => <article className="record warehouse-drive" id={`drive-${drive.id}`} key={drive.id}>
        <div className="warehouse-drive__head">
          <div>
            <strong>{drive.title}</strong> <span className={`status-chip status-${drive.status.toLowerCase()}`}>{DRIVE_STATUS[drive.status] ?? drive.status}</span>
            {drive.description && <p>{drive.description}</p>}
            {drive.location && <small className="muted">Điểm quyên góp: {drive.location.coordinates?.[1].toFixed(5)}, {drive.location.coordinates?.[0].toFixed(5)}{drive.location_note ? ` · ${drive.location_note}` : ''}<br /></small>}
            <small className="muted">Nhận hàng: {when(drive.opens_at)} → {when(drive.closes_at)}{drive.campaign_id ? ` · Chiến dịch: ${campaigns.find((campaign) => campaign.value === drive.campaign_id)?.label ?? 'đã liên kết'}` : ''}</small>
          </div>
          {canManageDrives && <div className="list-header-actions">
            {drive.status === 'DRAFT' && <>
              <button type="button" className="button secondary" onClick={() => setDialog({ kind: 'edit-drive', drive })}>Sửa</button>
              <button type="button" className="button" onClick={() => void transition(drive, 'open')}>Mở đợt</button>
            </>}
            {drive.status === 'OPEN' && <>
              <button type="button" className="button secondary" onClick={() => setDialog({ kind: 'drive-action', drive, action: 'pause' })}>Tạm dừng</button>
              <button type="button" className="button secondary" onClick={() => setDialog({ kind: 'drive-action', drive, action: 'close' })}>Đóng đợt</button>
            </>}
            {drive.status === 'PAUSED' && <>
              <button type="button" className="button" onClick={() => void transition(drive, 'resume')}>Tiếp tục</button>
              <button type="button" className="button secondary" onClick={() => setDialog({ kind: 'drive-action', drive, action: 'close' })}>Đóng đợt</button>
            </>}
          </div>}
        </div>
        <div className="stock-table-scroll">
          <table className="stock-table donation-item-table">
            <thead><tr><th scope="col">Vật phẩm</th><th scope="col" className="numeric">Mục tiêu</th><th scope="col" className="numeric">Đã tiếp nhận</th><th scope="col" className="numeric">Còn cần</th></tr></thead>
            <tbody>{drive.items.map((item) => <tr key={item.item_id}>
              <th scope="row"><strong>{item.item_name}</strong>{item.acceptance_note && <small>{item.acceptance_note}</small>}</th>
              <td className="numeric" data-label="Mục tiêu">{fmt(item.target_quantity)} {item.unit_name}</td>
              <td className="numeric" data-label="Đã tiếp nhận">{fmt(item.accepted_total)} {item.unit_name}</td>
              <td className="numeric" data-label="Còn cần">{fmt(remaining(item.target_quantity, item.accepted_total, item.scale ?? 3))} {item.unit_name}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>)}
    </div>;
  };

  return <div className="warehouse-manager">
    <div className="warehouse-manager__layout">
      <div className="warehouse-manager__map">
        <WarehouseCoverageMap placing={placing} onMapClick={placeAt} banner={placing ? (placeMessage || 'Chạm vào bản đồ, bên trong vòng tròn của một kho, để đặt điểm quyên góp. Nhấn Esc để hủy.') : undefined} rows={rows} campaigns={showCampaigns ? campaignRows : []} loading={state === 'loading'} error={state === 'error'} selectedId={selectedId}
          onSelectWarehouse={(id) => select(id)} onSelectDrive={(driveId, warehouseId) => select(warehouseId, driveId)} toolbar={toolbar} />
      </div>
      <aside className="warehouse-manager__side" aria-label="Danh sách kho">
        <p className="muted warehouse-manager__summary">{warehouses.length} kho · {drives.filter((drive) => drive.status === 'OPEN').length} đợt quyên góp đang mở</p>
        {unservedCampaigns.length > 0 && <p className="notice warning" role="status">{unservedCampaigns.length} chiến dịch chưa có kho phục vụ: {unservedCampaigns.map((campaign) => campaign.name).join(', ')}. Hãy thêm kho có bán kính phủ vùng chiến dịch.</p>}
        {state === 'ready' && warehouses.length === 0 && <p className="muted">Chưa có kho nào. Bấm "+ Thêm kho" để tạo kho đầu tiên.</p>}
        {visibleWarehouses.map((warehouse) => {
          const index = warehouses.indexOf(warehouse);
          const open = drives.filter((drive) => drive.intake_warehouse_id === warehouse.id && drive.status === 'OPEN').length;
          const isSelected = warehouse.id === selectedId;
          const hasLocation = rows.some((row) => row.id === warehouse.id);
          const detailed: Warehouse = isSelected && detail && detail.id === warehouse.id ? detail : warehouse;
          return <article id={`warehouse-${warehouse.id}`} key={warehouse.id} className={`warehouse-card${isSelected ? ' is-selected' : ''}`}>
            <button type="button" className="warehouse-card__main" aria-pressed={isSelected} onClick={() => setSelectedId(isSelected ? null : warehouse.id!)}>
              <span className="warehouse-card__badge" style={{ borderColor: ['#2563eb', '#059669', '#d97706', '#db2777', '#0891b2', '#65a30d', '#9333ea', '#dc2626'][index % 8] }}>{index + 1}</span>
              <span className="warehouse-card__text">
                <strong>{warehouse.name}</strong>
                <small className="muted">
                  {warehouse.service_radius_m ? `Bán kính ${(warehouse.service_radius_m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : 'Chưa khai báo bán kính'}
                  {' · '}{open ? `${open} đợt đang mở` : 'chưa có đợt đang mở'}{hasLocation ? '' : ' · chưa có vị trí'}
                </small>
              </span>
            </button>
            <div className="warehouse-card__actions">
              {canManage && <button type="button" className="button secondary small" onClick={() => setDialog({ kind: 'edit-warehouse', warehouse: detailed })}>Sửa kho</button>}
              {canManageDrives && <button type="button" className="button small" onClick={() => { setSelectedId(warehouse.id!); setDialog({ kind: 'new-drive', warehouseId: warehouse.id }); }}>+ Đợt quyên góp</button>}
              <a className="button secondary small" href={`?workspace=operations&page=assets&view=warehouses&warehouse_id=${encodeURIComponent(warehouse.id!)}&warehouse_name=${encodeURIComponent(warehouse.name ?? '')}`}>Tồn kho</a>
            </div>
            {isSelected && <>
              <dl className="warehouse-panel__facts">
                <div><dt>Địa chỉ</dt><dd>{detailed.address_note || 'Chưa khai báo'}</dd></div>
                <div><dt>Vị trí công khai</dt><dd>{detailed.location_public ? 'Có, người quyên góp thấy khoảng cách' : 'Không, chỉ hiện tên kho'}</dd></div>
              </dl>
              <div className="warehouse-card__served"><strong>Chiến dịch trong vùng phục vụ: </strong>{(servedBy.get(warehouse.id!) ?? []).length ? (servedBy.get(warehouse.id!) ?? []).map((campaign) => campaign.name).join(', ') : 'chưa có'}</div>
              {drivesSection(warehouse.id!)}
            </>}
          </article>;
        })}
        <Pager page={cardPage} hasNext={cardPage + 1 < pageCount} onPrev={() => setCardPage((value) => Math.max(0, value - 1))} onNext={() => setCardPage((value) => Math.min(pageCount - 1, value + 1))} noun="kho" count={visibleWarehouses.length} />
      </aside>
    </div>
    {dialog && <DetailSurface modal open onClose={() => setDialog(null)} className="operations-management-dialog"
      heading={dialog.kind === 'edit-warehouse' ? 'Sửa kho' : dialog.kind === 'new-drive' ? 'Thêm đợt quyên góp' : dialog.kind === 'edit-drive' ? 'Sửa đợt quyên góp' : dialog.action === 'pause' ? 'Tạm dừng đợt quyên góp' : 'Đóng đợt quyên góp'}
      label="Quản lý kho và đợt quyên góp">
      {dialog.kind === 'edit-warehouse' && <CommandForm key={`wh-${dialog.warehouse.id}-${dialog.warehouse.version}`} spec={warehouseSpec(dialog.warehouse)} onSuccess={refresh} onStale={refresh} />}
      {dialog.kind === 'new-drive' && <DriveCreateForm warehouses={warehouseOptions} campaigns={campaigns} items={items} itemScales={itemScales} lockedWarehouseId={dialog.warehouseId} areaFor={areaFor} initialLocation={dialog.location} onSuccess={refresh} />}
      {dialog.kind === 'edit-drive' && <DriveCreateForm warehouses={warehouseOptions} campaigns={campaigns} items={items} itemScales={itemScales} lockedWarehouseId={dialog.drive.intake_warehouse_id} areaFor={areaFor} edit={driveEdit(dialog.drive)} onSuccess={refresh} />}
      {dialog.kind === 'drive-action' && <CommandForm key={`${dialog.action}-${dialog.drive.id}-${dialog.drive.version}`} onSuccess={refresh} onStale={refresh}
        spec={{ title: dialog.action === 'pause' ? 'Tạm dừng đợt' : 'Đóng đợt', hideTitle: true, service: 'logistics', path: `/donation-drives/${dialog.drive.id}/${dialog.action}`, version: dialog.drive.version,
          fields: [{ name: 'reason', label: dialog.action === 'pause' ? 'Lý do tạm dừng' : 'Lý do đóng', required: true, maxLength: 500 }],
          warning: dialog.action === 'pause' ? 'Tạm dừng tiếp nhận đóng góp?' : 'Đóng đợt quyên góp này?' }} />}
    </DetailSurface>}
  </div>;
}
