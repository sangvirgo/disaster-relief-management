import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { WarehouseCoverageMap, type Coverage, type HoverTarget, type MapCampaign, type WarehouseDraft } from '../../maps/WarehouseCoverageMap';
import { DriveCreateForm, distanceMetres, type DriveEdit, type WarehouseArea } from './DriveCreateForm';
import { MapHoverDetails } from './MapHoverDetails';

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

type CampaignRow = { id?: string; name?: string; status?: string; center?: { lat: number; lng: number } | null; radius_m?: number | null };

/**
 * Warehouse map for operations: shows every warehouse with its radius and, for the selected one, its donation drives with the
 * goods still needed. Managers can add and adjust warehouses and drives without leaving the map.
 */
export function WarehouseMapManager({ canManage, canManageDrives, warehouseOptions, campaigns, items, itemScales, refreshKey, onChanged }: {
  canManage: boolean; canManageDrives: boolean;
  warehouseOptions: Option[]; campaigns: Option[]; items: Option[]; itemScales: Option[];
  refreshKey: number; onChanged: () => void;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [campaignRows, setCampaignRows] = useState<MapCampaign[]>([]);
  const [showCampaigns, setShowCampaigns] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [revision, setRevision] = useState(0);
  const [actionError, setActionError] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeMessage, setPlaceMessage] = useState('');
  const [creatingWarehouse, setCreatingWarehouse] = useState(false);
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WarehouseDraft | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState('');
  const draftKey = useRef<string | null>(null);
  const [hovered, setHovered] = useState<HoverTarget | null>(null);

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

  const rows = useMemo<Coverage[]>(() => warehouses.flatMap((warehouse, index) => {
    const coordinates = warehouse.location?.coordinates;
    if (!warehouse.id || !coordinates || !coordinates.every((value) => Number.isFinite(value))) return [];
    const live = drives.filter((drive) => drive.intake_warehouse_id === warehouse.id && drive.status !== 'CLOSED')
      .map((drive) => ({ id: drive.id, title: drive.title, status: drive.status,
        ...(drive.location?.coordinates ? { lat: drive.location.coordinates[1], lng: drive.location.coordinates[0] } : {}) }));
    return [{ id: warehouse.id, index, name: warehouse.name || 'Kho chưa đặt tên', lat: coordinates[1], lng: coordinates[0], radiusM: warehouse.service_radius_m ?? null, drives: live }];
  }), [warehouses, drives]);
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
  function select(id: string, driveId?: string) {
    setSelectedId(id);
    if (driveId) setHovered({ kind: 'drive', id: driveId, warehouseId: id });
  }
  const refresh = useCallback(() => { setDialog(null); setRevision((value) => value + 1); onChanged(); }, [onChanged]);

  function cancelWarehouseDraft() {
    setCreatingWarehouse(false);
    setEditingWarehouseId(null);
    setDraft(null);
    setDraftName('');
    setDraftError('');
    draftKey.current = null;
  }

  function beginWarehouseMapEdit(id: string) {
    if (!canManage || creatingWarehouse) return;
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return;
    setPlacing(false);
    setSelectedId(id);
    setHovered(null);
    setEditingWarehouseId(id);
    setDraft({ lat: row.lat, lng: row.lng, radiusM: row.radiusM ?? 5_000 });
    setDraftName(row.name);
    setDraftError('');
    draftKey.current = null;
  }

  async function saveWarehouseMapEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingWarehouseId || !draft || draft.radiusM < 500 || draft.radiusM > 200_000) {
      setDraftError('Kiểm tra vùng phục vụ của kho.'); return;
    }
    setDraftBusy(true);
    setDraftError('');
    try {
      const current = await api<Warehouse>('logistics', `/warehouses/${encodeURIComponent(editingWarehouseId)}`);
      if (current.version === undefined) throw new Error('Chưa đọc được phiên bản kho để lưu thay đổi.');
      draftKey.current ||= newCommandKey();
      await api('logistics', `/warehouses/${encodeURIComponent(editingWarehouseId)}`, {
        method: 'PATCH', idempotencyKey: draftKey.current,
        body: { expected_version: current.version,
          location: { type: 'Point', coordinates: [draft.lng, draft.lat] },
          service_radius_m: Math.round(draft.radiusM) },
      });
      cancelWarehouseDraft();
      refresh();
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : 'Chưa lưu được vị trí và vùng phục vụ.');
    } finally { setDraftBusy(false); }
  }

  async function createWarehouse(event: FormEvent) {
    event.preventDefault();
    if (!draft || !draftName.trim()) { setDraftError('Chọn vị trí trên bản đồ và nhập tên kho.'); return; }
    if (draftName.trim().length > 200 || draft.radiusM < 500 || draft.radiusM > 200_000) {
      setDraftError('Kiểm tra tên kho và vòng phục vụ.'); return;
    }
    setDraftBusy(true);
    setDraftError('');
    try {
      draftKey.current ||= newCommandKey();
      await api('logistics', '/warehouses', {
        method: 'POST', idempotencyKey: draftKey.current,
        body: { name: draftName.trim().normalize('NFC'), location: { type: 'Point', coordinates: [draft.lng, draft.lat] },
          service_radius_m: Math.round(draft.radiusM), location_public: false },
      });
      cancelWarehouseDraft();
      refresh();
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : 'Chưa tạo được kho.');
    } finally { setDraftBusy(false); }
  }

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

  async function openWarehouseEdit(warehouse: Warehouse) {
    try {
      const full = await api<Warehouse>('logistics', `/warehouses/${encodeURIComponent(warehouse.id!)}`);
      setDialog({ kind: 'edit-warehouse', warehouse: full });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Chưa tải được thông tin kho.');
    }
  }

  const driveEdit = (drive: Drive): DriveEdit => ({
    id: drive.id, version: drive.version,
    initial: {
      title: drive.title, description: drive.description ?? '', campaignId: drive.campaign_id ?? '', opensAt: drive.opens_at ?? null, closesAt: drive.closes_at ?? null,
      location: drive.location?.coordinates ? { longitude: drive.location.coordinates[0], latitude: drive.location.coordinates[1] } : null, locationNote: drive.location_note ?? '',
      lines: drive.items.map((item) => ({ item_id: item.item_id, target_quantity: item.target_quantity, acceptance_note: item.acceptance_note ?? '' })),
    },
  });

  const toolbar = <>
    {canManage && !editingWarehouseId && <button type="button" className={`button ${creatingWarehouse ? 'secondary' : ''}`} aria-pressed={creatingWarehouse} onClick={() => {
      if (creatingWarehouse) cancelWarehouseDraft();
      else { setCreatingWarehouse(true); setPlacing(false); setSelectedId(null); setHovered(null); setPlaceMessage(''); }
    }}>{creatingWarehouse ? 'Hủy thêm kho' : '+ Thêm kho'}</button>}
    {canManageDrives && !creatingWarehouse && !editingWarehouseId && <button type="button" className={`button ${placing ? '' : 'secondary'}`} aria-pressed={placing} onClick={() => { setPlacing((value) => !value); setPlaceMessage(''); }}>{placing ? 'Hủy chọn điểm' : '+ Thêm đợt quyên góp'}</button>}
    <label className="warehouse-map-toggle"><input type="checkbox" checked={showCampaigns} onChange={(event) => setShowCampaigns(event.target.checked)} /> Vùng chiến dịch</label>
  </>;
  const hoveredWarehouse = warehouses.find(row => row.id === hovered?.warehouseId);
  const hoveredDrive = hovered?.kind === 'drive' ? drives.find(row => row.id === hovered.id) : undefined;
  const hoverActions = hoveredDrive ? <>
    {canManageDrives && hoveredDrive.status === 'DRAFT' && <>
      <button type="button" className="button secondary small" onClick={() => setDialog({ kind: 'edit-drive', drive: hoveredDrive })}>Sửa đợt</button>
      <button type="button" className="button small" onClick={() => void transition(hoveredDrive, 'open')}>Mở đợt</button>
    </>}
    {canManageDrives && hoveredDrive.status === 'OPEN' && <>
      <button type="button" className="button secondary small" onClick={() => setDialog({ kind: 'drive-action', drive: hoveredDrive, action: 'pause' })}>Tạm dừng</button>
      <button type="button" className="button secondary small" onClick={() => setDialog({ kind: 'drive-action', drive: hoveredDrive, action: 'close' })}>Đóng đợt</button>
    </>}
    {canManageDrives && hoveredDrive.status === 'PAUSED' && <>
      <button type="button" className="button small" onClick={() => void transition(hoveredDrive, 'resume')}>Tiếp tục</button>
      <button type="button" className="button secondary small" onClick={() => setDialog({ kind: 'drive-action', drive: hoveredDrive, action: 'close' })}>Đóng đợt</button>
    </>}
  </> : hoveredWarehouse?.id ? <>
    {canManage && <button type="button" className="button secondary small" onClick={() => void openWarehouseEdit(hoveredWarehouse)}>Sửa kho</button>}
    {canManageDrives && <button type="button" className="button small" onClick={() => setDialog({ kind: 'new-drive', warehouseId: hoveredWarehouse.id })}>+ Đợt quyên góp</button>}
    <a className="button secondary small" href={`?workspace=operations&page=assets&view=warehouses&warehouse_id=${encodeURIComponent(hoveredWarehouse.id)}&warehouse_name=${encodeURIComponent(hoveredWarehouse.name ?? '')}`}>Tồn kho</a>
  </> : null;
  const contextMenu = selectedId && hoveredWarehouse?.id === selectedId && !creatingWarehouse && !editingWarehouseId && hoverActions &&
    <details className="warehouse-map-actions"><summary>Thao tác</summary><div className="warehouse-map-actions__menu">{hoverActions}{actionError && <p className="notice error" role="alert">{actionError}</p>}</div></details>;
  const hoverCard = hovered && hoveredWarehouse?.id && hoveredWarehouse.name
    ? <MapHoverDetails key={`${hovered.kind}:${hovered.id}`} warehouse={{ id: hoveredWarehouse.id, name: hoveredWarehouse.name, service_radius_m: hoveredWarehouse.service_radius_m }} drive={hoveredDrive} onClose={() => setHovered(null)} />
    : null;
  const draftEditor = creatingWarehouse && draft && <form className="warehouse-map-editor" onSubmit={event => void createWarehouse(event)} noValidate>
    <label className="warehouse-map-editor__name"><span>Tên kho</span><input autoFocus required maxLength={201} value={draftName} onChange={event => { setDraftName(event.target.value); draftKey.current = null; }} placeholder="Nhập tên kho" aria-label="Tên kho" /></label>
    <button className="warehouse-map-editor__confirm" aria-label="Tạo kho tại vị trí và vùng đã chọn" title="Tạo kho" disabled={draftBusy || !draftName.trim() || draft.radiusM < 500 || draft.radiusM > 200_000}>{draftBusy ? '…' : '✓'}</button>
    <button type="button" className="warehouse-map-editor__cancel" aria-label="Hủy thêm kho" title="Hủy" onClick={cancelWarehouseDraft}>×</button>
    {draftError && <p className="notice error" role="alert">{draftError}</p>}
  </form>;
  const editEditor = editingWarehouseId && draft && <form className="warehouse-map-editor" onSubmit={event => void saveWarehouseMapEdit(event)}>
    <span className="warehouse-map-editor__name"><strong>{draftName}</strong><small>Kéo kho hoặc mép vòng tròn để chỉnh</small></span>
    <button className="warehouse-map-editor__confirm" aria-label="Lưu vị trí và bán kính kho" title="Lưu thay đổi" disabled={draftBusy}>{draftBusy ? '…' : '✓'}</button>
    <button type="button" className="warehouse-map-editor__cancel" aria-label="Hủy chỉnh sửa kho" title="Hủy" onClick={cancelWarehouseDraft}>×</button>
    {draftError && <p className="notice error" role="alert">{draftError}</p>}
  </form>;
  return <div className="warehouse-manager">
    <div className="warehouse-manager__layout">
      <div className="warehouse-manager__map">
        <WarehouseCoverageMap placing={placing} onMapClick={placeAt} banner={creatingWarehouse ? (draft ? undefined : 'Chạm vào bản đồ để đặt tâm kho. Sau đó kéo ghim hoặc vòng tròn để điều chỉnh.') : editingWarehouseId ? 'Đang chỉnh kho trên bản đồ. Kéo tâm hoặc nút ở mép vòng tròn, rồi bấm dấu ✓ để lưu.' : placing ? (placeMessage || 'Chạm vào bản đồ, bên trong vòng tròn của một kho, để đặt điểm quyên góp. Nhấn Esc để hủy.') : undefined} rows={rows} campaigns={showCampaigns ? campaignRows : []} loading={state === 'loading'} error={state === 'error'} selectedId={selectedId}
          onSelectWarehouse={(id) => select(id)} onEditWarehouse={canManage ? beginWarehouseMapEdit : undefined} onSelectDrive={(driveId, warehouseId) => select(warehouseId, driveId)} onHover={target => { if (!creatingWarehouse && !editingWarehouseId && !placing) setHovered(target); }} onEmptyClick={() => { if (!editingWarehouseId) { setHovered(null); setSelectedId(null); } }} toolbar={<>{toolbar}{contextMenu}</>} hoverCard={creatingWarehouse ? draftEditor : editingWarehouseId ? editEditor : hoverCard}
          creatingWarehouse={creatingWarehouse} editingWarehouse={Boolean(editingWarehouseId)} draft={draft} onDraftChange={next => { setDraft(next); setDraftError(''); draftKey.current = null; }} />
      </div>
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
