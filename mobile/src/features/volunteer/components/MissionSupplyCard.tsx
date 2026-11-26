import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Package, Navigation } from 'lucide-react-native';
import {
  CatalogItemOption, LogisticsApi, MissionSupply, SupplyStatus, SupplySuggestionLine, SupplyTeamRequest,
} from '../../../api/logisticsApi';
import { getApiErrorMessage, isApiErrorCode } from '../../../api/client';
import { SingleChoicePicker } from '../../../components/common/SingleChoicePicker';
import { CompactTextInput } from '../../../components/common/CompactTextInput';
import { THEME } from '../../../constants/theme';
import { generateUUID } from '../../../utils/secureStore';

const STATUS_LABELS: Record<SupplyStatus, string> = {
  READY: 'Chờ nhận hàng',
  HANDED_OVER: 'Đã nhận hàng',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn nhận',
};

const BASIS_LABELS: Record<SupplySuggestionLine['basis'], string> = {
  AI_TEXT: 'AI gợi ý từ nội dung SOS',
  NORM: 'Theo định mức số người',
  CONFIRMED: 'Nhu cầu đã xác nhận',
};

const LIVE_MISSION = ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];

type DraftLine = { item_id: string; item_name: string; unit_name: string; quantity: string; basis?: SupplySuggestionLine['basis'] };

function formatQuantity(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ''] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${grouped},${trimmed}` : grouped;
}

function deadlineText(expiresAt: string): string {
  const left = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(left)) return '';
  if (left <= 0) return 'Đã quá hạn nhận';
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `Còn ${minutes} phút để nhận hàng`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Còn ${hours} giờ ${rest} phút để nhận hàng` : `Còn ${hours} giờ để nhận hàng`;
}

/**
 * Relief goods for the mission. The leader asks for goods in one step (list pre-filled from the AI/norm suggestion);
 * the system picks the warehouse and returns a six-digit code to read out to the warehouse staff.
 */
export function MissionSupplyCard({ missionId, missionStatus }: { missionId: string; missionStatus: string }) {
  const [data, setData] = useState<MissionSupply | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);

  const [revision, setRevision] = useState(0);
  const load = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let live = true;
    LogisticsApi.getMissionSupply(missionId)
      .then((value) => { if (live) { setData(value); setHidden(false); setError(''); } })
      .catch((cause: unknown) => {
        if (!live) return;
        if (isApiErrorCode(cause, 'FORBIDDEN')) setHidden(true);
        else setError(getApiErrorMessage(cause, 'Không tải được thông tin hàng cứu trợ.'));
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [missionId, revision]);

  if (hidden) return null;
  const open = data?.items.find((item) => item.status === 'READY') ?? null;
  const last = data?.items.find((item) => item.status !== 'READY') ?? null;
  const canRequest = Boolean(data?.can_request) && LIVE_MISSION.includes(missionStatus);

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Package size={18} color={THEME.colors.primary.main} />
        <Text style={styles.title}>HÀNG CỨU TRỢ CHO NHIỆM VỤ</Text>
      </View>
      {loading && !data ? <ActivityIndicator color={THEME.colors.primary.main} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {open ? <OpenRequest request={open} canCancel={canRequest} onChanged={load} /> : null}
      {data && !open && !composing ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.muted}>
            {canRequest
              ? 'Đội cần mang hàng đến hiện trường? Gửi yêu cầu, hệ thống tự chọn kho gần và giữ hàng cho đội.'
              : 'Chưa có yêu cầu hàng đang chờ cho nhiệm vụ này.'}
          </Text>
          {last ? <Text style={styles.muted}>Lần gần nhất: {STATUS_LABELS[last.status]} · {last.warehouse.name}</Text> : null}
          {canRequest ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setComposing(true)} accessibilityRole="button">
              <Text style={styles.primaryText}>Yêu cầu hàng cứu trợ</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {data && !open && composing ? (
        <RequestForm missionId={missionId} onCancel={() => setComposing(false)} onCreated={() => { setComposing(false); void load(); }} />
      ) : null}
    </View>
  );
}

function OpenRequest({ request, canCancel, onChanged }: { request: SupplyTeamRequest; canCancel: boolean; onChanged: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(generateUUID());

  async function cancel() {
    if (!reason.trim()) { setError('Vui lòng ghi lý do hủy.'); return; }
    setBusy(true);
    setError('');
    try {
      await LogisticsApi.cancelSupplyRequest(request.id, request.version, reason.trim(), key.current);
      onChanged();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Không hủy được yêu cầu.'));
    } finally {
      setBusy(false);
    }
  }

  const location = request.warehouse.location;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.codeBox} accessible accessibilityLabel={`Mã nhận hàng ${request.pickup_code?.split('').join(' ')}`}>
        <Text style={styles.codeLabel}>Mã nhận hàng</Text>
        <Text style={styles.code}>{request.pickup_code}</Text>
        <Text style={styles.deadline}>{deadlineText(request.expires_at)}</Text>
      </View>
      <View>
        <Text style={styles.body}><Text style={styles.bold}>Nhận tại: </Text>{request.warehouse.name}</Text>
        {request.warehouse.address_note ? <Text style={styles.muted}>{request.warehouse.address_note}</Text> : null}
        <Text style={styles.muted}>Đọc mã này cho nhân viên kho để nhận hàng.</Text>
      </View>
      {location ? (
        <TouchableOpacity style={styles.secondaryBtn} accessibilityRole="link"
          onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`)}>
          <Navigation size={16} color={THEME.colors.primary.main} />
          <Text style={styles.secondaryText}>Chỉ đường đến kho</Text>
        </TouchableOpacity>
      ) : null}
      <View style={{ gap: 6 }}>
        {request.lines.map((line) => (
          <View key={line.item_id} style={styles.lineRow}>
            <Text style={styles.body}>{line.item_name}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.bold}>{formatQuantity(line.reserved_quantity)} {line.unit_name}</Text>
              {Number(line.shortfall_quantity) > 0 ? <Text style={styles.warn}>Thiếu {formatQuantity(line.shortfall_quantity)} {line.unit_name}</Text> : null}
            </View>
          </View>
        ))}
      </View>
      {request.has_shortfall ? <Text style={styles.warn}>Kho chưa đủ một số mặt hàng; phần thiếu đã được ghi nhận để bổ sung.</Text> : null}
      {canCancel && !cancelling ? (
        <TouchableOpacity onPress={() => setCancelling(true)} accessibilityRole="button"><Text style={styles.link}>Hủy yêu cầu</Text></TouchableOpacity>
      ) : null}
      {cancelling ? (
        <View style={{ gap: 8 }}>
          <CompactTextInput label="Lý do hủy" required value={reason} onChangeText={setReason} maxLength={1000} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCancelling(false)}><Text style={styles.secondaryText}>Quay lại</Text></TouchableOpacity>
            <TouchableOpacity style={styles.dangerBtn} onPress={() => void cancel()} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Hủy yêu cầu</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RequestForm({ missionId, onCancel, onCreated }: { missionId: string; onCancel: () => void; onCreated: () => void }) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [catalog, setCatalog] = useState<CatalogItemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(generateUUID());

  useEffect(() => {
    let live = true;
    void Promise.allSettled([LogisticsApi.getSupplySuggestion(missionId), LogisticsApi.getCatalogItems()]).then(([suggestion, items]) => {
      if (!live) return;
      if (suggestion.status === 'fulfilled') setLines(suggestion.value.map((line) => ({ ...line })));
      if (items.status === 'fulfilled') setCatalog(items.value);
      setLoading(false);
    });
    return () => { live = false; };
  }, [missionId]);

  function edit(index: number, quantity: string) {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, quantity: quantity.replace(',', '.') } : line)));
    key.current = generateUUID();
  }

  async function submit() {
    const chosen = lines.filter((line) => /^\d+(?:\.\d+)?$/.test(line.quantity) && Number(line.quantity) > 0);
    if (!chosen.length) { setError('Chọn ít nhất một mặt hàng với số lượng lớn hơn 0.'); return; }
    setBusy(true);
    setError('');
    try {
      await LogisticsApi.createSupplyRequest(missionId, chosen.map((line) => ({ item_id: line.item_id, quantity: line.quantity })), key.current);
      onCreated();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Không gửi được yêu cầu hàng.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <ActivityIndicator color={THEME.colors.primary.main} />;
  const available = catalog.filter((item) => !lines.some((line) => line.item_id === item.id));
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.muted}>
        {lines.some((line) => line.basis)
          ? 'Danh sách được gợi ý sẵn từ thông tin SOS. Hãy sửa số lượng theo thực tế trước khi gửi.'
          : 'Chưa có gợi ý cho SOS này. Thêm các mặt hàng đội cần mang theo.'}
      </Text>
      {lines.map((line, index) => (
        <View key={line.item_id} style={styles.lineRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bold}>{line.item_name}</Text>
            {line.basis ? <Text style={styles.muted}>{BASIS_LABELS[line.basis]}</Text> : null}
          </View>
          <TextInput style={styles.qtyInput} keyboardType="decimal-pad" value={line.quantity}
            accessibilityLabel={`Số lượng ${line.item_name}`} onChangeText={(value) => edit(index, value)} />
          <Text style={styles.unit}>{line.unit_name}</Text>
          <TouchableOpacity onPress={() => setLines((current) => current.filter((_, at) => at !== index))} accessibilityLabel={`Bỏ ${line.item_name}`}>
            <Text style={styles.link}>Bỏ</Text>
          </TouchableOpacity>
        </View>
      ))}
      {available.length ? (
        <SingleChoicePicker
          label="Thêm mặt hàng"
          value=""
          options={available.map((item) => ({ value: item.id, label: item.name, description: item.unit?.display_name }))}
          onChange={(value) => {
            const item = catalog.find((candidate) => candidate.id === value);
            if (item) setLines((current) => [...current, { item_id: item.id, item_name: item.name, unit_name: item.unit?.display_name ?? '', quantity: '1' }]);
            key.current = generateUUID();
          }}
        />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel}><Text style={styles.secondaryText}>Hủy</Text></TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => void submit()} disabled={busy || !lines.length}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Gửi yêu cầu</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    gap: 10,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: THEME.typography.fontSizes.xs, fontWeight: '800', color: THEME.colors.text.secondary, letterSpacing: 0.5 },
  body: { fontSize: THEME.typography.fontSizes.sm, color: THEME.colors.text.primary },
  bold: { fontSize: THEME.typography.fontSizes.sm, fontWeight: '700', color: THEME.colors.text.primary },
  muted: { fontSize: THEME.typography.fontSizes.xs, color: THEME.colors.text.secondary },
  warn: { fontSize: THEME.typography.fontSizes.xs, color: THEME.colors.warning.dark },
  error: { fontSize: THEME.typography.fontSizes.xs, color: THEME.colors.emergency.dark },
  link: { fontSize: THEME.typography.fontSizes.sm, color: THEME.colors.primary.main, fontWeight: '600' },
  codeBox: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: THEME.colors.primary.border,
    backgroundColor: THEME.colors.primary.bg,
  },
  codeLabel: { fontSize: THEME.typography.fontSizes.xs, color: THEME.colors.text.secondary },
  code: { fontSize: 34, fontWeight: '800', letterSpacing: 8, color: THEME.colors.primary.dark },
  deadline: { fontSize: THEME.typography.fontSizes.xs, color: THEME.colors.text.secondary },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: THEME.colors.surface.background,
  },
  qtyInput: {
    minWidth: 64,
    height: 40,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 8,
    textAlign: 'right',
    color: THEME.colors.text.primary,
  },
  unit: { fontSize: THEME.typography.fontSizes.xs, color: THEME.colors.text.secondary, minWidth: 28 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  primaryBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.main,
  },
  dangerBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.emergency.main,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    backgroundColor: THEME.colors.surface.card,
  },
  secondaryText: { color: THEME.colors.primary.main, fontWeight: '700' },
});
