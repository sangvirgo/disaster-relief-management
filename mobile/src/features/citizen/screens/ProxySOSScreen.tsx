import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { useAuthStore } from '../../../store/authStore';
import { INCIDENT_CATEGORIES, CONTACTABILITY_LABELS } from '../../../constants/labels';
import { IncidentCategoryCode, CreateProxySOSPayload, GeoLocation } from '../../../types/api';
import { ResponseApi } from '../../../api/responseApi';
import { getApiErrorMessage } from '../../../api/client';
import { PendingProxySOSCommand, StorageService } from '../../../utils/secureStore';
import { THEME } from '../../../constants/theme';
import { LocationPickerModal } from '../../../components/common/LocationPickerModal';
import { CopyableInfoModal } from '../../../components/common/CopyableInfoModal';
import {
  Users,
  MapPin,
  Send,
  AlertCircle,
  Clock,
  LogIn,
  Map,
  Trash2,
  CalendarDays,
  Check,
  X,
} from 'lucide-react-native';

type SituationPickerMode = 'date' | 'time';

const formatLocalSituationDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()} · ${hour}:${minute}`;
};

export const ProxySOSScreen: React.FC = () => {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  const [selectedCategory, setSelectedCategory] = useState<IncidentCategoryCode>('FLOOD');
  const [relationship, setRelationship] = useState<string>('');
  const [peopleAffected, setPeopleAffected] = useState<string>('');
  const [childrenCount, setChildrenCount] = useState<string>('');
  const [elderlyCount, setElderlyCount] = useState<string>('');
  const [declaredDanger, setDeclaredDanger] = useState(false);
  const [needsRescue, setNeedsRescue] = useState(true);
  const [needsRelief, setNeedsRelief] = useState(false);
  const [householdLng, setHouseholdLng] = useState<string>('');
  const [householdLat, setHouseholdLat] = useState<string>('');
  const [householdLocation, setHouseholdLocation] = useState<GeoLocation | null>(null);
  const [householdAddressNote, setHouseholdAddressNote] = useState<string>('');
  const [informationSource, setInformationSource] = useState<string>('');
  const [lastKnownSituationAt, setLastKnownSituationAt] = useState<string>('');
  const [isSituationPickerVisible, setIsSituationPickerVisible] = useState<boolean>(false);
  const [situationPickerMode, setSituationPickerMode] = useState<SituationPickerMode>('date');
  const [draftSituationDate, setDraftSituationDate] = useState<Date>(new Date());
  const [beneficiaryPhone, setBeneficiaryPhone] = useState<string>('');
  const [contactability, setContactability] = useState<'REACHABLE' | 'UNREACHABLE' | 'UNKNOWN'>('UNKNOWN');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isMapModalVisible, setIsMapModalVisible] = useState<boolean>(false);
  const [pendingCommand, setPendingCommand] = useState<PendingProxySOSCommand | null>(null);
  const [restoringPending, setRestoringPending] = useState<boolean>(true);
  const [submissionSuccessCode, setSubmissionSuccessCode] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    StorageService.getPendingProxySOS()
      .then((pending) => {
        if (!mounted || !pending) return;
        const { payload } = pending;
        setPendingCommand(pending);
        setSelectedCategory(payload.incident_category_code);
        setRelationship(payload.relationship);
        setPeopleAffected(payload.people_affected == null ? '' : String(payload.people_affected));
        setChildrenCount(payload.children_count == null ? '' : String(payload.children_count));
        setElderlyCount(payload.elderly_count == null ? '' : String(payload.elderly_count));
        setDeclaredDanger(Boolean(payload.reporter_declared_danger));
        setNeedsRescue(payload.needs_rescue ?? true);
        setNeedsRelief(Boolean(payload.needs_relief_supplies));
        setHouseholdLocation(payload.location);
        setHouseholdLng(String(payload.location.coordinates[0]));
        setHouseholdLat(String(payload.location.coordinates[1]));
        setBeneficiaryPhone(payload.beneficiary_contact_phone || '');
        setContactability(payload.contactability);
        setDescription(payload.description || '');
        setInformationSource(payload.information_source);
        setLastKnownSituationAt(payload.last_known_situation_at);
      })
      .catch(() => mounted && Alert.alert('Không thể khôi phục yêu cầu', 'Không đọc được bản báo hộ đang chờ trên thiết bị.'))
      .finally(() => mounted && setRestoringPending(false));
    return () => { mounted = false; };
  }, []);

  const handleConfirmMapLocation = (coords: [number, number], note?: string) => {
    setHouseholdLng(coords[0].toFixed(6));
    setHouseholdLat(coords[1].toFixed(6));
    setHouseholdLocation({ type: 'Point', coordinates: coords, source: 'MANUAL_PIN', captured_at: new Date().toISOString() });
    if (note) {
      setHouseholdAddressNote(note);
    }
  };

  const openSituationPicker = () => {
    const selectedDate = lastKnownSituationAt ? new Date(lastKnownSituationAt) : new Date();
    setDraftSituationDate(Number.isNaN(selectedDate.getTime()) ? new Date() : selectedDate);
    setSituationPickerMode('date');
    setIsSituationPickerVisible(true);
  };

  const confirmSituationDate = () => {
    setLastKnownSituationAt(draftSituationDate.toISOString());
    setIsSituationPickerVisible(false);
  };

  const handleDiscardPending = () => {
    Alert.alert(
      'Hủy bản báo hộ đang chờ?',
      'Bạn có chắc muốn xóa bản gửi chưa hoàn tất này để bắt đầu soạn báo hộ mới?',
      [
        { text: 'Giữ lại', style: 'cancel' },
        {
          text: 'Xóa & Tạo mới',
          style: 'destructive',
          onPress: async () => {
            try {
              await StorageService.clearPendingProxySOS();
              setPendingCommand(null);
              setSelectedCategory('FLOOD');
              setRelationship('');
              setPeopleAffected('');
              setChildrenCount('');
              setElderlyCount('');
              setDeclaredDanger(false);
              setNeedsRescue(true);
              setNeedsRelief(false);
              setHouseholdLng('');
              setHouseholdLat('');
              setHouseholdLocation(null);
              setHouseholdAddressNote('');
              setInformationSource('');
              setLastKnownSituationAt('');
              setBeneficiaryPhone('');
              setContactability('UNKNOWN');
              setDescription('');
            } catch {
              Alert.alert('Lỗi', 'Không thể xóa bản lưu tạm.');
            }
          },
        },
      ]
    );
  };

  // Nếu chưa đăng nhập, bắt buộc đăng nhập để bảo đảm trách nhiệm báo tin (UC-15)
  if (!isAuthenticated) {
    return (
      <ScreenContainer title="Báo Cứu Trợ Người Thân" onBack={() => goBackOrHome(router)}>
        <View style={styles.authRequiredCard}>
          <AlertCircle size={48} color={THEME.colors.primary.main} />
          <Text style={styles.authRequiredTitle}>YÊU CẦU ĐĂNG NHẬP TÀI KHOẢN</Text>
          <Text style={styles.authRequiredDesc}>
            Theo quy định cứu hộ, chức năng báo cứu trợ từ xa (PROXY) yêu cầu xác thực tài khoản công dân để tránh báo tin giả mạo gây phân tán nguồn lực cứu hộ.
          </Text>
          <TouchableOpacity
            style={styles.loginNowButton}
            onPress={() => router.push('/login')}
            activeOpacity={0.85}
          >
            <LogIn size={20} color="#FFFFFF" />
            <Text style={styles.loginNowText}>Đăng Nhập Hoặc Đăng Ký Ngay</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const handleSubmit = async () => {
    if (!pendingCommand && !householdLocation) {
      Alert.alert('Chưa chọn vị trí hộ gia đình', 'Vui lòng ghim và xác nhận vị trí thực tế của hộ gia đình đang cần hỗ trợ.');
      return;
    }

    const headcountText = peopleAffected.trim();
    const headcount = headcountText ? Number(headcountText) : null;
    if (!pendingCommand && headcountText && (!/^\d+$/.test(headcountText) || !Number.isInteger(headcount) || (headcount as number) < 1 || (headcount as number) > 10000)) {
      Alert.alert('Số lượng chưa hợp lệ', 'Nhập số nguyên từ 1 đến 10.000; để trống nếu chưa rõ.');
      return;
    }
    const children = childrenCount === '' ? null : Number(childrenCount);
    const elderly = elderlyCount === '' ? null : Number(elderlyCount);
    if ([children, elderly].some((value) => value !== null && (!Number.isInteger(value) || value < 0 || value > 10000))) {
      Alert.alert('Số lượng chưa hợp lệ', 'Số trẻ em và người cao tuổi phải là số nguyên từ 0 đến 10.000.');
      return;
    }
    if (headcount !== null && (children ?? 0) + (elderly ?? 0) > headcount) {
      Alert.alert('Số lượng chưa hợp lệ', 'Tổng số trẻ em và người cao tuổi không được lớn hơn tổng số người trong nhà.');
      return;
    }
    if (!pendingCommand && !needsRescue && !needsRelief) {
      Alert.alert('Chưa chọn nhu cầu', 'Hãy chọn cần cứu hộ, cần hàng cứu trợ hoặc cả hai.');
      return;
    }
    if (!pendingCommand && (!relationship.trim() || !informationSource.trim() || !lastKnownSituationAt.trim())) {
      Alert.alert('Thiếu thông tin nguồn tin', 'Hãy nhập mối quan hệ, nguồn nhận tin và chọn thời điểm gần nhất biết tình hình.');
      return;
    }
    if (!pendingCommand && !/Z$/.test(lastKnownSituationAt.trim())) {
      Alert.alert('Thời điểm chưa hợp lệ', 'Vui lòng chọn lại ngày và giờ gần nhất biết tình hình.');
      return;
    }
    const lastKnownDate = new Date(lastKnownSituationAt.trim());
    if (!pendingCommand && Number.isNaN(lastKnownDate.getTime())) {
      Alert.alert('Thời điểm chưa đúng', 'Không thể đọc thời điểm tình hình gần nhất.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: CreateProxySOSPayload = pendingCommand?.payload || {
        incident_category_code: selectedCategory,
        description: [householdAddressNote.trim() ? `Địa chỉ tham chiếu do người báo cung cấp: ${householdAddressNote.trim()}` : '', description.trim()].filter(Boolean).join('\n') || undefined,
        people_affected: headcount,
        ...(children === null ? {} : { children_count: children }),
        ...(elderly === null ? {} : { elderly_count: elderly }),
        reporter_declared_danger: declaredDanger,
        needs_rescue: needsRescue,
        needs_relief_supplies: needsRelief,
        location: householdLocation!,
        relationship: relationship.trim(),
        information_source: informationSource.trim(),
        last_known_situation_at: lastKnownDate.toISOString(),
        contactability,
        beneficiary_contact_phone: beneficiaryPhone.trim() || undefined,
      };

      const command = pendingCommand || await StorageService.getOrCreatePendingProxySOS(payload);
      setPendingCommand(command);
      const response = await ResponseApi.createProxySOS(command.payload, command.idempotencyKey);
      await StorageService.clearPendingProxySOS();
      setPendingCommand(null);

      setSubmissionSuccessCode(response.tracking_code);
    } catch (error: any) {
      Alert.alert('Lỗi gửi yêu cầu', getApiErrorMessage(error, 'Không thể gửi báo hộ. Nội dung và khóa lần gửi được giữ lại để thử lại an toàn.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer
      title="Báo Cứu Trợ Người Thân"
      subtitle="Báo hộ vị trí cho gia đình gặp nạn (PROXY)"
      onBack={() => goBackOrHome(router)}
    >
      {/* Banner khôi phục bản gửi cũ */}
      {pendingCommand ? (
        <View style={styles.pendingBanner}>
          <View style={styles.pendingBannerHeader}>
            <AlertCircle size={18} color={THEME.colors.warning.dark} />
            <Text style={styles.pendingBannerTitle}>Có bản báo hộ chưa hoàn tất</Text>
          </View>
          <Text style={styles.pendingBannerDesc}>
            Ứng dụng đã khôi phục lại dữ liệu báo hộ của lần trước để bạn gửi tiếp. Bạn có thể kiểm tra lại rồi bấm Gửi tiếp, hoặc hủy bản cũ để tạo mới.
          </Text>
          <TouchableOpacity
            style={styles.discardPendingBtn}
            onPress={handleDiscardPending}
            activeOpacity={0.8}
          >
            <Trash2 size={14} color={THEME.colors.emergency.main} />
            <Text style={styles.discardPendingText}>Xóa bản cũ & Soạn báo hộ mới</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.noticeBox}>
        <Clock size={18} color={THEME.colors.primary.main} />
        <Text style={styles.noticeText}>
          Lưu ý: Tọa độ cứu hộ phải là vị trí của HỘ GIA ĐÌNH NGƯỜI THÂN đang gặp nạn, không phải vị trí hiện tại của bạn.
        </Text>
      </View>

      {/* 1. VỊ TRÍ HỘ GIA ĐÌNH GẶP NẠN */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <MapPin size={20} color={THEME.colors.primary.main} />
          <Text style={styles.cardTitle}>VỊ TRÍ HỘ GIA ĐÌNH NẠN NHÂN</Text>
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>Ghim bản đồ</Text>
          </View>
        </View>

        {/* Nút mở bản đồ ghim vị trí */}
        <TouchableOpacity
          style={styles.openMapBtn}
          onPress={() => setIsMapModalVisible(true)}
          activeOpacity={0.85}
        >
          <Map size={18} color="#FFFFFF" />
          <Text style={styles.openMapBtnText}>Ghim vị trí trên bản đồ tương tác</Text>
        </TouchableOpacity>

        {/* Khung hiển thị tọa độ đã ghim */}
        <View style={styles.selectedCoordsBox}>
          <Text style={styles.selectedCoordsTitle}>Tọa độ đã chọn:</Text>
          <Text style={styles.selectedCoordsText}>
            {householdLocation ? `Kinh độ: ${householdLng} | Vĩ độ: ${householdLat}` : 'Chưa xác nhận vị trí hộ gia đình'}
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Ghi chú địa chỉ cụ thể:</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Ví dụ: Thôn 2, Xã Tân An, Gần trạm y tế cũ..."
            placeholderTextColor={THEME.colors.text.muted}
            value={householdAddressNote}
            onChangeText={setHouseholdAddressNote}
          />
        </View>

        <View style={styles.coordRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.inputLabel}>Kinh độ (Longitude):</Text>
            <TextInput
              style={styles.textInput}
              value={householdLng}
              onChangeText={(value) => { setHouseholdLng(value); setHouseholdLocation(null); }}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.inputLabel}>Vĩ độ (Latitude):</Text>
            <TextInput
              style={styles.textInput}
              value={householdLat}
              onChangeText={(value) => { setHouseholdLat(value); setHouseholdLocation(null); }}
              keyboardType="numeric"
            />
          </View>
        </View>
      </View>

      {/* Modal Ghim Vị Trí Trên Bản Đồ */}
      <LocationPickerModal
        visible={isMapModalVisible}
        initialCoordinates={householdLocation?.coordinates}
        initialAddressNote={householdAddressNote}
        title="Ghim Vị Trí Hộ Gia Đình Người Thân"
        confirmButtonText="Xác nhận vị trí hộ gia đình"
        onClose={() => setIsMapModalVisible(false)}
        onConfirm={handleConfirmMapLocation}
      />

      <Modal
        visible={isSituationPickerVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsSituationPickerVisible(false)}
      >
        <View style={styles.situationPickerOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsSituationPickerVisible(false)}
            accessibilityLabel="Đóng bộ chọn ngày giờ"
          />
          <View style={styles.situationPickerCard}>
            <View style={styles.situationPickerHeader}>
              <View style={styles.situationPickerIcon}>
                <CalendarDays size={20} color={THEME.colors.primary.main} />
              </View>
              <View style={styles.situationPickerHeaderText}>
                <Text style={styles.situationPickerTitle}>Chọn thời điểm</Text>
                <Text style={styles.situationPickerSubtitle}>Lần gần nhất bạn biết tình hình</Text>
              </View>
              <TouchableOpacity
                style={styles.situationPickerClose}
                onPress={() => setIsSituationPickerVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Đóng"
              >
                <X size={19} color={THEME.colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.situationPickerSummary}>
              <Text style={styles.situationPickerSummaryLabel}>ĐANG CHỌN</Text>
              <Text style={styles.situationPickerSummaryValue}>
                {formatLocalSituationDate(draftSituationDate.toISOString())}
              </Text>
            </View>

            <View style={styles.situationPickerTabs}>
              {([
                { key: 'date', label: 'Ngày', icon: CalendarDays },
                { key: 'time', label: 'Giờ', icon: Clock },
              ] as const).map(({ key, label, icon: Icon }) => {
                const selected = situationPickerMode === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.situationPickerTab, selected && styles.situationPickerTabActive]}
                    onPress={() => setSituationPickerMode(key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                  >
                    <Icon size={16} color={selected ? THEME.colors.primary.main : THEME.colors.text.muted} />
                    <Text style={[styles.situationPickerTabText, selected && styles.situationPickerTabTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.situationNativePicker}>
              <DateTimePicker
                style={{ width: '100%' }}
                value={draftSituationDate}
                mode={situationPickerMode}
                presentation="inline"
                display={situationPickerMode === 'date' ? 'inline' : 'default'}
                is24Hour
                locale="vi_VN"
                accentColor={THEME.colors.primary.main}
                onValueChange={(_event, selectedDate) => setDraftSituationDate(selectedDate)}
              />
            </View>

            <Text style={styles.situationPickerHint}>Ngày giờ hiển thị theo múi giờ trên điện thoại.</Text>

            <View style={styles.situationPickerActions}>
              <TouchableOpacity
                style={styles.situationPickerCancel}
                onPress={() => setIsSituationPickerVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.situationPickerCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.situationPickerConfirm}
                onPress={confirmSituationDate}
                activeOpacity={0.85}
              >
                <Check size={17} color="#FFFFFF" />
                <Text style={styles.situationPickerConfirmText}>Xác nhận</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 2. CHỌN LOẠI THIÊN TAI / SỰ CỐ NGƯỜI THÂN ĐANG GẶP */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>LOẠI SỰ CỐ NGƯỜI THÂN ĐANG GẶP</Text>
        <View style={styles.categoryGrid}>
          {(['FLOOD', 'TRAPPED', 'LANDSLIDE', 'STORM', 'MEDICAL', 'FIRE', 'SUPPLY_SHORTAGE', 'OTHER'] as IncidentCategoryCode[]).map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryButton, isSelected && styles.categoryButtonActive]}
                onPress={() => setSelectedCategory(cat)}
                activeOpacity={0.8}
              >
                <Text style={[styles.categoryButtonText, isSelected && styles.categoryButtonTextActive]}>
                  {INCIDENT_CATEGORIES[cat]?.label || cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 3. MỐI QUAN HỆ & TÌNH TRẠNG LIÊN LẠC */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Users size={20} color={THEME.colors.primary.main} />
          <Text style={styles.cardTitle}>THÔNG TIN NGƯỜI THÂN</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Mối quan hệ với nạn nhân:</Text>
          <TextInput
            style={styles.textInput}
            value={relationship}
            onChangeText={setRelationship}
            placeholder="Con cái, Cha mẹ, Hàng xóm..."
            placeholderTextColor={THEME.colors.text.muted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Nguồn nhận thông tin (bắt buộc):</Text>
          <TextInput
            style={styles.textInput}
            value={informationSource}
            onChangeText={setInformationSource}
            placeholder="Ví dụ: Gọi điện trực tiếp cho người thân lúc 14:30"
            placeholderTextColor={THEME.colors.text.muted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Thời điểm gần nhất biết tình hình:</Text>
          {Platform.OS === 'web' ? (
            <TextInput
              style={styles.textInput}
              value={lastKnownSituationAt}
              onChangeText={setLastKnownSituationAt}
              placeholder="2026-10-25T07:30:00Z"
              placeholderTextColor={THEME.colors.text.muted}
              autoCapitalize="none"
            />
          ) : (
            <TouchableOpacity
              style={styles.situationDateButton}
              onPress={openSituationPicker}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Chọn ngày giờ gần nhất biết tình hình"
            >
              <CalendarDays size={19} color={THEME.colors.primary.main} />
              <Text style={[styles.situationDateValue, !lastKnownSituationAt && styles.situationDatePlaceholder]}>
                {lastKnownSituationAt ? formatLocalSituationDate(lastKnownSituationAt) : 'Chạm để chọn ngày và giờ'}
              </Text>
              <Clock size={18} color={THEME.colors.text.muted} />
            </TouchableOpacity>
          )}
          <Text style={styles.fieldHint}>
            {Platform.OS === 'web'
              ? 'Nhập thời điểm theo định dạng UTC, kết thúc bằng Z.'
              : 'Ngày giờ hiển thị theo giờ trên điện thoại và sẽ được chuẩn hóa UTC khi gửi.'}
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Số người dự kiến trong nhà:</Text>
          <TextInput
            style={styles.textInput}
            value={peopleAffected}
            onChangeText={setPeopleAffected}
            placeholder="Để trống nếu chưa rõ"
            placeholderTextColor={THEME.colors.text.muted}
            keyboardType="number-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Trẻ em:</Text>
          <TextInput
            style={styles.textInput}
            value={childrenCount}
            onChangeText={setChildrenCount}
            placeholder="Để trống nếu chưa rõ"
            placeholderTextColor={THEME.colors.text.muted}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Người cao tuổi:</Text>
          <TextInput
            style={styles.textInput}
            value={elderlyCount}
            onChangeText={setElderlyCount}
            placeholder="Để trống nếu chưa rõ"
            placeholderTextColor={THEME.colors.text.muted}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.inputLabel}>Có nguy cơ đe dọa tính mạng</Text>
          <Switch value={declaredDanger} onValueChange={setDeclaredDanger} />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.inputLabel}>Cần đội cứu hộ</Text>
            <Text style={styles.fieldHint}>Mặc định đã chọn cho yêu cầu báo hộ.</Text>
          </View>
          <Switch value={needsRescue} onValueChange={setNeedsRescue} />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.inputLabel}>Cần hàng cứu trợ</Text>
            <Text style={styles.fieldHint}>Chọn thêm nếu hộ gia đình cần thực phẩm, nước hoặc vật tư.</Text>
          </View>
          <Switch value={needsRelief} onValueChange={setNeedsRelief} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Số điện thoại của người thân (nếu có):</Text>
          <TextInput
            style={styles.textInput}
            placeholder="09xx xxx xxx"
            placeholderTextColor={THEME.colors.text.muted}
            value={beneficiaryPhone}
            onChangeText={setBeneficiaryPhone}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Khả năng liên lạc hiện tại:</Text>
          <View style={styles.contactOptionRow}>
            {(['REACHABLE', 'UNREACHABLE', 'UNKNOWN'] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.contactOptBtn, contactability === opt && styles.contactOptBtnActive]}
                onPress={() => setContactability(opt)}
              >
                <Text style={[styles.contactOptText, contactability === opt && styles.contactOptTextActive]}>
                  {CONTACTABILITY_LABELS[opt]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* 3. MÔ TẢ TÌNH HÌNH */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>MÔ TẢ CHI TIẾT HIỆN TRƯỜNG</Text>
        <TextInput
          style={[styles.textInput, styles.textArea]}
          placeholder="Mô tả đặc điểm ngôi nhà, dấu hiệu nhận biết, lương thực còn lại..."
          placeholderTextColor={THEME.colors.text.muted}
          value={description}
          onChangeText={setDescription}
          multiline={true}
          numberOfLines={4}
        />
      </View>

      {/* NÚT BẤM GỬI */}
      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={isSubmitting || restoringPending}
        activeOpacity={0.85}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Send size={20} color="#FFFFFF" />
            <Text style={styles.submitButtonText}>GỬI YÊU CẦU CỨU HỘ NGƯỜI THÂN</Text>
          </>
        )}
      </TouchableOpacity>

      {submissionSuccessCode ? (
        <CopyableInfoModal
          visible
          title="Đã ghi nhận yêu cầu cứu trợ"
          description="Máy chủ đã ghi nhận báo hộ. Điều phối viên sẽ xác minh thông tin trước khi có quyết định điều phối."
          helperText="Lưu hoặc sao chép mã tra cứu để xem tiến độ của yêu cầu này."
          credentials={[
            { key: 'tracking-code', label: 'Mã tra cứu yêu cầu', value: submissionSuccessCode },
          ]}
          onClose={() => setSubmissionSuccessCode(null)}
          primaryAction={{
            label: 'Xem tiến độ cứu hộ',
            onPress: () => {
              const trackingCode = submissionSuccessCode;
              setSubmissionSuccessCode(null);
              router.replace({ pathname: '/tracking', params: { trackingCode } });
            },
          }}
        />
      ) : null}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
  },
  noticeText: {
    fontSize: 11,
    color: THEME.colors.primary.dark,
    marginLeft: 8,
    flex: 1,
    lineHeight: 16,
  },
  pendingBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  pendingBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  pendingBannerTitle: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: '#92400E',
    marginLeft: 6,
  },
  pendingBannerDesc: {
    fontSize: THEME.typography.fontSizes.xs,
    color: '#78350F',
    lineHeight: 18,
    marginBottom: 10,
  },
  discardPendingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME.colors.emergency.main,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  discardPendingText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: THEME.colors.emergency.main,
    marginLeft: 6,
  },
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
    marginLeft: 6,
  },
  sourceBadge: {
    marginLeft: 'auto',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },
  openMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.main,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginTop: 6,
    marginBottom: 10,
    ...THEME.shadows.sm,
  },
  openMapBtnText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  selectedCoordsBox: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 4,
  },
  selectedCoordsTitle: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    fontWeight: '600',
  },
  selectedCoordsText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginTop: 2,
  },
  inputGroup: {
    marginTop: 10,
  },
  inputLabel: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '600',
    color: THEME.colors.text.primary,
    marginBottom: 6,
  },
  fieldHint: {
    color: THEME.colors.text.muted,
    fontSize: THEME.typography.fontSizes.xs,
    lineHeight: 17,
    marginTop: 6,
  },
  situationDateButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  situationDateValue: {
    flex: 1,
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
    marginHorizontal: 10,
  },
  situationDatePlaceholder: {
    color: THEME.colors.text.muted,
    fontWeight: '400',
  },
  situationPickerOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  situationPickerCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.md,
  },
  situationPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  situationPickerIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  situationPickerHeaderText: {
    flex: 1,
    marginLeft: 11,
  },
  situationPickerTitle: {
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
  },
  situationPickerSubtitle: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
    marginTop: 2,
  },
  situationPickerClose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: THEME.colors.surface.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  situationPickerSummary: {
    backgroundColor: THEME.colors.primary.bg,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 13,
    marginBottom: 14,
  },
  situationPickerSummaryLabel: {
    color: THEME.colors.primary.main,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  situationPickerSummaryValue: {
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    marginTop: 3,
  },
  situationPickerTabs: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.surface.background,
    borderRadius: 12,
    padding: 4,
    marginBottom: 8,
  },
  situationPickerTab: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  situationPickerTabActive: {
    backgroundColor: THEME.colors.surface.card,
    ...THEME.shadows.sm,
  },
  situationPickerTabText: {
    color: THEME.colors.text.muted,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
    marginLeft: 7,
  },
  situationPickerTabTextActive: {
    color: THEME.colors.primary.main,
    fontWeight: '800',
  },
  situationNativePicker: {
    minHeight: 230,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  situationPickerHint: {
    color: THEME.colors.text.muted,
    fontSize: THEME.typography.fontSizes.xs,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 14,
  },
  situationPickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  situationPickerCancel: {
    minHeight: 44,
    minWidth: 78,
    paddingHorizontal: 16,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.surface.background,
  },
  situationPickerCancelText: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
  },
  situationPickerConfirm: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: THEME.colors.primary.main,
  },
  situationPickerConfirmText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '800',
    marginLeft: 7,
  },
  textInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  coordRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  contactOptionRow: {
    marginTop: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  contactOptBtn: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.surface.background,
    marginBottom: 6,
  },
  contactOptBtnActive: {
    backgroundColor: THEME.colors.primary.bg,
    borderColor: THEME.colors.primary.main,
  },
  contactOptText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
  },
  contactOptTextActive: {
    color: THEME.colors.primary.main,
    fontWeight: '700',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: 6,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 30,
    ...THEME.shadows.md,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm + 1,
    fontWeight: '800',
    marginLeft: 8,
  },
  authRequiredCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginTop: 40,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  authRequiredTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginTop: 14,
  },
  authRequiredDesc: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  loginNowButton: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
    alignItems: 'center',
  },
  loginNowText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.sm,
    marginLeft: 8,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  categoryButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.surface.background,
  },
  categoryButtonActive: {
    backgroundColor: THEME.colors.emergency.main,
    borderColor: THEME.colors.emergency.main,
  },
  categoryButtonText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
  },
  categoryButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
