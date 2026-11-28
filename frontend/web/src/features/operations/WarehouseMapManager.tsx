import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { loadStaffDrive } from '../../api/staffDrive';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { WarehouseCoverageMap, type Coverage, type HoverTarget, type MapCampaign, type WarehouseDraft } from '../../maps/WarehouseCoverageMap';
import { DriveCreateForm, distanceMetres, type DriveEdit, type WarehouseArea } from './DriveCreateForm';
import { MapHoverDetails } from './MapHoverDetails';
import { OpeningStockForm } from './OpeningStockForm';
import { LocationPicker, type Point } from '../../maps/LocationPicker';

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
  | { kind: 'opening-stock'; warehouse: Warehouse }
  | { kind: 'new-drive'; warehouseId?: string; location?: { latitude: number; longitude: number } }
  | { kind: 'edit-drive'; drive: Drive }
  | { kind: 'drive-action'; drive: Drive; action: 'pause' | 'close' };

type CampaignRow = { id?: string; name?: string; status?: string; center?: { lat: number; lng: number } | null; radius_m?: number | null };

/**
 * Warehouse map for operations: shows every warehouse with its radius and, for the selected one, its donation drives with the
 * goods still needed. Managers can add and adjust warehouses and drives without leaving the map.
 */
export function WarehouseMapManager({ canManage, canManageDrives, warehouseOptions, campaigns, items, itemScales, itemUnits, refreshKey, onChanged, onRefresh }: {
  canManage: boolean; canManageDrives: boolean;
  warehouseOptions: Option[]; campaigns: Option[]; items: Option[]; itemScales: Option[]; itemUnits: Option[];
  refreshKey: number; onChanged: () => void; onRefresh: () => void;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [campaignRows, setCampaignRows] = useState<MapCampaign[]>([]);
  const [showCampaigns, setShowCampaigns] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [driveDirty, setDriveDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [actionError, setActionError] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeMessage, setPlaceMessage] = useState('');
  const [creatingWarehouse, setCreatingWarehouse] = useState(false);
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WarehouseDraft | null>(null);
  const [draftName, setDraftName] = useState('');
  const [searchedPoint, setSearchedPoint] = useState<Point | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState('');
  const draftKey = useRef<string | null>(null);
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  const addMenuRef = useRef<HTMLDetailsElement>(null);
  const [requestedEditDrive] = useState(() => new URL(window.location.href).searchParams.get('edit_drive'));
  useEffect(() => {
    const url = new URL(window.location.href);
    const driveId = requestedEditDrive;
    if (!canManageDrives || !driveId || !/^[0-9a-f-]{36}$/i.test(driveId)) return;
    url.searchParams.delete('edit_drive');
    window.history.replaceState(null, '', url);
    setActionError('');
    let live = true;
    void loadStaffDrive<Drive>(driveId).then(drive => {
      if (!live) return;
      if (drive.status !== 'DRAFT') { setActionError('Đợt này không còn là bản nháp. Hãy chọn trên bản đồ để xem trạng thái mới.'); return; }
      setSelectedId(drive.intake_warehouse_id);
      setDialog({ kind: 'edit-drive', drive });
    }).catch(error => { if (live) setActionError(error instanceof Error ? error.message : 'Chưa mở được bản nháp.'); });
    return () => { live = false; };
  }, [canManageDrives, requestedEditDrive]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('create') !== 'drive') return;
    setPlacing(true);
    setPlaceMessage('');
    url.searchParams.delete('create');
    window.history.replaceState(null, '', url);
  }, []);

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
    setHovered(driveId ? { kind: 'drive', id: driveId, warehouseId: id } : { kind: 'warehouse', id, warehouseId: id });
  }
  const refresh = useCallback(() => { setDialog(null); setRevision((value) => value + 1); onChanged(); }, [onChanged]);

  function cancelWarehouseDraft() {
    setCreatingWarehouse(false);
    setEditingWarehouseId(null);
    setHovered(null);
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
      const created = await api<Warehouse>('logistics', '/warehouses', {
        method: 'POST', idempotencyKey: draftKey.current,
        body: { name: draftName.trim().normalize('NFC'), location: { type: 'Point', coordinates: [draft.lng, draft.lat] },
          service_radius_m: Math.round(draft.radiusM), location_public: false },
      });
      cancelWarehouseDraft();
      refresh();
      if (created.id) {
        setSelectedId(created.id);
        setDialog({ kind: 'opening-stock', warehouse: created });
      }
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
    {creatingWarehouse ? <button type="button" className="button secondary warehouse-map-tool" aria-label="Hủy thêm kho" title="Hủy thêm kho" onClick={cancelWarehouseDraft}>× Hủy</button>
      : placing ? <button type="button" className="button secondary warehouse-map-tool" aria-label="Hủy chọn điểm quyên góp" title="Hủy chọn điểm" onClick={() => { setPlacing(false); setPlaceMessage(''); }}>× Hủy</button>
      : !editingWarehouseId && (canManage || canManageDrives) && <details ref={addMenuRef} className="warehouse-map-add-menu">
        <summary>＋ Thêm</summary>
        <div className="warehouse-map-add-menu__items">
          {canManage && <button type="button" aria-label="Thêm kho" onClick={() => { addMenuRef.current?.removeAttribute('open'); setCreatingWarehouse(true); setSearchedPoint(null); setPlacing(false); setSelectedId(null); setHovered(null); setPlaceMessage(''); }}>Kho</button>}
          {canManageDrives && <button type="button" aria-label="Thêm đợt quyên góp" onClick={() => { addMenuRef.current?.removeAttribute('open'); setPlacing(true); setPlaceMessage(''); }}>Đợt quyên góp</button>}
        </div>
      </details>}
    <button type="button" className={`warehouse-map-layer-button${showCampaigns ? ' is-active' : ''}`} aria-label={showCampaigns ? 'Ẩn vùng chiến dịch' : 'Hiện vùng chiến dịch'} title={showCampaigns ? 'Ẩn vùng chiến dịch' : 'Hiện vùng chiến dịch'} aria-pressed={showCampaigns} onClick={() => setShowCampaigns(value => !value)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>
    </button>
    <button type="button" className="button secondary refresh-action refresh-action--icon-only warehouse-map-tool" aria-label="Làm mới bản đồ kho" title="Làm mới bản đồ kho" disabled={state === 'loading'} onClick={onRefresh} />
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

  </> : null;
  const hoverCard = hovered && hoveredWarehouse?.id && hoveredWarehouse.name
    ? <MapHoverDetails key={`${hovered.kind}:${hovered.id}`} warehouse={{ id: hoveredWarehouse.id, name: hoveredWarehouse.name, service_radius_m: hoveredWarehouse.service_radius_m, address_note: hoveredWarehouse.address_note, location: hoveredWarehouse.location }} drive={hoveredDrive}
        actions={selectedId === hoveredWarehouse.id && <>{hoverActions}{actionError && <p className="notice error" role="alert">{actionError}</p>}</>} onClose={() => setHovered(null)} />
    : null;
  const radiusKm = draft ? (draft.radiusM / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '0';
  const radiusInvalid = Boolean(draft && (draft.radiusM < 500 || draft.radiusM > 200_000));
  const draftEditor = creatingWarehouse && draft && <form className="warehouse-map-editor warehouse-map-editor--card warehouse-map-editor--create" onSubmit={event => void createWarehouse(event)} noValidate>
    <label className="warehouse-map-editor__field" htmlFor="warehouse-draft-name">Tên kho</label>
    <div className="warehouse-map-editor__create-row">
      <input id="warehouse-draft-name" autoFocus required maxLength={200} value={draftName} onChange={event => { setDraftName(event.target.value); draftKey.current = null; }} placeholder="Nhập tên kho" />
      <button type="submit" className="warehouse-map-editor__confirm" aria-label={draftBusy ? 'Đang tạo kho' : 'Xác nhận tạo kho'} title={draftName.trim() ? 'Xác nhận tạo kho' : 'Nhập tên kho để xác nhận'} disabled={draftBusy || !draftName.trim() || radiusInvalid}>{draftBusy ? '…' : '✓'}</button>
    </div>
    <label>Bán kính phục vụ (km)<input type="number" min="0.5" max="200" step="0.5" value={draft.radiusM / 1000} disabled={draftBusy} onChange={event => { const radiusM = Number(event.target.value) * 1000; setDraft(current => current ? { ...current, radiusM } : current); draftKey.current = null; }} /></label>
    {draftError && <p className="notice error" role="alert">{draftError}</p>}
    {radiusInvalid && <p className="notice error" role="alert">Bán kính phải từ 0,5 đến 200 km.</p>}
  </form>;
  const editEditor = editingWarehouseId && draft && <form className="warehouse-map-editor warehouse-map-editor--card" onSubmit={event => void saveWarehouseMapEdit(event)}>
    <div className="warehouse-map-editor__heading"><strong>{draftName}</strong></div>
    <small>Kéo biểu tượng kho để đổi vị trí, hoặc kéo nút ↔ ở mép vòng tròn để đổi bán kính.</small>
    <small>Bán kính hiện tại: {radiusKm} km (kéo nút ↔ trên bản đồ để thay đổi).</small>
    {draftError && <p className="notice error" role="alert">{draftError}</p>}
    <div className="warehouse-map-editor__actions">
      <button type="button" className="button secondary" onClick={cancelWarehouseDraft}>Hủy</button>
      <button type="submit" className="button" disabled={draftBusy || radiusInvalid}>{draftBusy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
    </div>
  </form>;
  return <div className="warehouse-manager">
    {creatingWarehouse && <LocationPicker initiallyOpen hideMap hideToggle selectOnPick value={searchedPoint} onSelect={setSearchedPoint} />}
    <div className="warehouse-manager__layout">
      <div className="warehouse-manager__map">
        <WarehouseCoverageMap placing={placing} onMapClick={placeAt} banner={creatingWarehouse ? (draft ? undefined : 'Chạm vào bản đồ để đặt kho.') : editingWarehouseId ? 'Đang chỉnh kho trên bản đồ. Kéo tâm hoặc nút ở mép vòng tròn, rồi bấm “Lưu thay đổi”.' : placing ? (placeMessage || 'Chạm vào bản đồ, bên trong vòng tròn của một kho, để đặt điểm quyên góp. Nhấn Esc để hủy.') : undefined} rows={rows} campaigns={showCampaigns ? campaignRows : []} loading={state === 'loading'} error={state === 'error'} selectedId={selectedId}
          onSelectWarehouse={(id) => select(id)} onEditWarehouse={canManage ? beginWarehouseMapEdit : undefined} onSelectDrive={(driveId, warehouseId) => select(warehouseId, driveId)} onHover={target => { if (!creatingWarehouse && !editingWarehouseId && !placing) setHovered(target); }} onEmptyClick={() => { if (!editingWarehouseId) { setHovered(null); setSelectedId(null); } }} toolbar={toolbar} hoverCard={creatingWarehouse ? draftEditor : editingWarehouseId ? editEditor : hoverCard}
          searchPoint={searchedPoint} creatingWarehouse={creatingWarehouse} editingWarehouse={Boolean(editingWarehouseId)} draft={draft} onDraftChange={next => { setDraft(next); setDraftError(''); draftKey.current = null; }} />
      </div>
    </div>
    {dialog && <DetailSurface modal open protectUnsaved={dialog.kind === 'new-drive' || dialog.kind === 'edit-drive'} hasUnsavedChanges={driveDirty} onClose={() => setDialog(null)} className="operations-management-dialog"
      heading={dialog.kind === 'edit-warehouse' ? 'Sửa kho' : dialog.kind === 'opening-stock' ? 'Khai báo tồn đầu kỳ' : dialog.kind === 'new-drive' ? 'Thêm đợt quyên góp' : dialog.kind === 'edit-drive' ? 'Sửa đợt quyên góp' : dialog.action === 'pause' ? 'Tạm dừng đợt quyên góp' : 'Đóng đợt quyên góp'}
      label="Quản lý kho và đợt quyên góp">
      {dialog.kind === 'edit-warehouse' && <><button type="button" className="button secondary" onClick={() => setDialog({ kind: 'opening-stock', warehouse: dialog.warehouse })}>Quản lý tồn đầu kỳ</button><CommandForm key={`wh-${dialog.warehouse.id}-${dialog.warehouse.version}`} spec={warehouseSpec(dialog.warehouse)} onSuccess={refresh} onStale={refresh} /></>}
      {dialog.kind === 'opening-stock' && dialog.warehouse.id && <OpeningStockForm key={`opening-${dialog.warehouse.id}`}
        warehouse={{ id: dialog.warehouse.id, name: dialog.warehouse.name || 'kho' }} items={items} itemScales={itemScales} itemUnits={itemUnits} onSuccess={refresh} />}
      {dialog.kind === 'new-drive' && <DriveCreateForm warehouses={warehouseOptions} campaigns={campaigns} items={items} itemScales={itemScales} lockedWarehouseId={dialog.warehouseId} areaFor={areaFor} initialLocation={dialog.location} onDirtyChange={setDriveDirty} onSuccess={refresh} />}
      {dialog.kind === 'edit-drive' && <DriveCreateForm warehouses={warehouseOptions} campaigns={campaigns} items={items} itemScales={itemScales} lockedWarehouseId={dialog.drive.intake_warehouse_id} areaFor={areaFor} edit={driveEdit(dialog.drive)} onDirtyChange={setDriveDirty} onSuccess={refresh} />}
      {dialog.kind === 'drive-action' && <CommandForm key={`${dialog.action}-${dialog.drive.id}-${dialog.drive.version}`} onSuccess={refresh} onStale={refresh}
        spec={{ title: dialog.action === 'pause' ? 'Tạm dừng đợt' : 'Đóng đợt', hideTitle: true, service: 'logistics', path: `/donation-drives/${dialog.drive.id}/${dialog.action}`, version: dialog.drive.version,
          fields: [{ name: 'reason', label: dialog.action === 'pause' ? 'Lý do tạm dừng' : 'Lý do đóng', required: true, maxLength: 500 }],
          warning: dialog.action === 'pause' ? 'Tạm dừng tiếp nhận đóng góp?' : 'Đóng đợt quyên góp này?' }} />}
    </DetailSurface>}
  </div>;
}
