import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { useLocation } from '../../../hooks/useLocation';
import { INCIDENT_CATEGORIES } from '../../../constants/labels';
import { IncidentCategoryCode, CreateSOSPayload } from '../../../types/api';
import { ResponseApi } from '../../../api/responseApi';
import { StorageService, generateRandomSecret } from '../../../utils/secureStore';
import { THEME } from '../../../constants/theme';
import { LocationPickerModal } from '../../../components/common/LocationPickerModal';
import {
  MapPin,
  AlertTriangle,
  Users,
  Phone,
  FileText,
  Send,
  RefreshCw,
  Info,
  Map,
  CheckCircle2,
} from 'lucide-react-native';

export const CreateSOSScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {
    location,
    loading: locationLoading,
    errorMsg: locationError,
    refreshLocation,
    setManualLocation,
  } = useLocation();

  const [selectedCategory, setSelectedCategory] = useState<IncidentCategoryCode>('FLOOD');
  const [peopleAffected, setPeopleAffected] = useState<string>('1');
  const [declaredDanger, setDeclaredDanger] = useState<boolean>(false);
  const [reporterName, setReporterName] = useState<string>('');
  const [reporterPhone, setReporterPhone] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isMapModalVisible, setIsMapModalVisible] = useState<boolean>(false);
  const [locationNote, setLocationNote] = useState<string>('');

  const handleConfirmManualLocation = (coords: [number, number], note?: string) => {
    setManualLocation(coords[0], coords[1]);
    if (note) {
      setLocationNote(note);
    }
  };

  const handleSubmit = async () => {
    if (!location) {
      Alert.alert(
        'Chưa có vị trí',
        'Vui lòng chọn hoặc ghim vị trí hiện trường trên bản đồ trước khi gửi yêu cầu cứu nạn.',
        [
          { text: 'Ghim trên bản đồ ngay', onPress: () => setIsMapModalVisible(true) },
          { text: 'Đóng', style: 'cancel' },
        ]
      );
      return;
    }

    const headcount = parseInt(peopleAffected, 10);
    if (isNaN(headcount) || headcount < 1) {
      Alert.alert('Thông tin chưa hợp lệ', 'Vui lòng nhập số người cần hỗ trợ ít nhất là 1 người.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Sinh chuỗi bí mật tra cứu dành riêng cho thiết bị này
      const trackingSecret = generateRandomSecret();

      const combinedDescription = [
        locationNote ? `[Vị trí: ${locationNote}]` : '',
        description.trim(),
      ]
        .filter(Boolean)
        .join(' ');

      const payload: CreateSOSPayload = {
        incident_category_code: selectedCategory,
        description: combinedDescription || undefined,
        people_affected: headcount,
        reporter_name: reporterName.trim() || undefined,
        reporter_contact_phone: reporterPhone.trim() || undefined,
        reporter_declared_danger: declaredDanger,
        location,
      };

      // 2. Gửi yêu cầu lên máy chủ Response
      const response = await ResponseApi.createSelfSOS(payload, trackingSecret);

      // 3. Lưu mã bí mật vào SecureStore để tra cứu về sau
      await StorageService.saveGuestTrackingSecret(response.tracking_code, trackingSecret);

      Alert.alert(
        'ĐÃ GỬI YÊU CẦU THÀNH CÔNG',
        `Mã tra cứu của bạn là: ${response.tracking_code}\n\nĐiều phối viên đang xác minh và điều phối đội cứu hộ đến vị trí của bạn. Vui lòng giữ liên lạc và tiết kiệm pin!`,
        [
          {
            text: 'Theo dõi tiến độ ngay',
            onPress: () =>
              navigation.replace('SOSTrackingScreen', {
                trackingCode: response.tracking_code,
                trackingSecret,
              }),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Không thể gửi yêu cầu', typeof error === 'string' ? error : 'Đã có lỗi xảy ra. Vui lòng kiểm tra kết nối mạng và thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer
      title="Báo Cứu Nạn Tại Chỗ"
      subtitle="Gửi vị trí & tình trạng khẩn cấp"
      onBack={() => navigation.goBack()}
    >
      {/* 1. TỌA ĐỘ VỊ TRÍ HIỆN TRƯỜNG */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <MapPin size={20} color={THEME.colors.emergency.main} />
          <Text style={styles.cardTitle}>VỊ TRÍ HIỆN TRƯỜNG CỦA BẠN</Text>
          {location && (
            <View
              style={[
                styles.sourceBadge,
                location.source === 'MANUAL_PIN' ? styles.sourceBadgeManual : styles.sourceBadgeGps,
              ]}
            >
              <Text
                style={[
                  styles.sourceBadgeText,
                  location.source === 'MANUAL_PIN' ? styles.sourceBadgeTextManual : styles.sourceBadgeTextGps,
                ]}
              >
                {location.source === 'MANUAL_PIN' ? 'Ghim thủ công' : 'Vệ tinh GPS'}
              </Text>
            </View>
          )}
        </View>

        {locationLoading ? (
          <View style={styles.locationLoadingBox}>
            <View style={styles.locationLoadingRow}>
              <ActivityIndicator size="small" color={THEME.colors.primary.main} />
              <Text style={styles.locationLoadingText}>Đang dò tìm tọa độ GPS chính xác...</Text>
            </View>
            <TouchableOpacity
              style={styles.pickMapFastBtn}
              onPress={() => setIsMapModalVisible(true)}
              activeOpacity={0.8}
            >
              <Map size={16} color={THEME.colors.emergency.main} />
              <Text style={styles.pickMapFastText}>Hoặc ghim vị trí trên bản đồ ngay</Text>
            </TouchableOpacity>
          </View>
        ) : location ? (
          <View style={styles.locationInfoBox}>
            <View style={styles.coordDisplayRow}>
              <Text style={styles.coordinatesText}>
                Kinh độ: {location.coordinates[0].toFixed(5)}, Vĩ độ: {location.coordinates[1].toFixed(5)}
              </Text>
            </View>
            <Text style={styles.accuracyText}>
              {location.source === 'GPS'
                ? `Độ chính xác: ±${location.accuracy_m || 10}m (Từ định vị GPS thiết bị)`
                : 'Đã ghim thủ công chính xác trên bản đồ'}
            </Text>
            {locationNote ? (
              <Text style={styles.locationNoteDisplay}>Ghi chú: {locationNote}</Text>
            ) : null}

            {/* Hàng nút bấm chọn lại vị trí */}
            <View style={styles.locationActionRow}>
              <TouchableOpacity
                style={styles.actionBtnSecondary}
                onPress={() => setIsMapModalVisible(true)}
                activeOpacity={0.8}
              >
                <MapPin size={15} color={THEME.colors.primary.main} />
                <Text style={styles.actionBtnText}>
                  {location.source === 'MANUAL_PIN' ? 'Chỉnh lại ghim' : 'Ghim lại trên bản đồ'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtnGhost}
                onPress={refreshLocation}
                activeOpacity={0.8}
              >
                <RefreshCw size={14} color={THEME.colors.text.secondary} />
                <Text style={styles.actionBtnGhostText}>Lấy lại GPS</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.locationErrorBox}>
            <Text style={styles.errorText}>
              {locationError || 'Không thể bắt được vị trí GPS tự động.'}
            </Text>
            <View style={styles.errorActionRow}>
              <TouchableOpacity
                style={styles.errorPinMapBtn}
                onPress={() => setIsMapModalVisible(true)}
                activeOpacity={0.8}
              >
                <MapPin size={16} color="#FFFFFF" />
                <Text style={styles.errorPinMapText}>Ghim vị trí trên bản đồ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.retryLocationBtn}
                onPress={refreshLocation}
                activeOpacity={0.8}
              >
                <RefreshCw size={15} color={THEME.colors.primary.main} />
                <Text style={styles.retryLocationText}>Thử lại GPS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Modal Ghim Vị Trí Trên Bản Đồ */}
      <LocationPickerModal
        visible={isMapModalVisible}
        initialCoordinates={location ? location.coordinates : undefined}
        initialAddressNote={locationNote}
        title="Ghim Vị Trí Cứu Nạn"
        confirmButtonText="Xác nhận vị trí hiện trường"
        onClose={() => setIsMapModalVisible(false)}
        onConfirm={handleConfirmManualLocation}
      />

      {/* 2. CHỌN LOẠI THIÊN TAI / SỰ CỐ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>LOẠI SỰ CỐ / THIÊN TAI ĐANG GẶP</Text>
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

      {/* 3. SỐ NGƯỜI CẦN CỨU & NGUY CƠ TÍNH MẠNG */}
      <View style={styles.card}>
        <View style={styles.formRow}>
          <View style={styles.labelWithIcon}>
            <Users size={18} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Số người cần cứu nạn:</Text>
          </View>
          <TextInput
            style={styles.numberInput}
            value={peopleAffected}
            onChangeText={setPeopleAffected}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>

        {/* Nút bật cờ nguy hiểm tính mạng */}
        <View style={styles.dangerToggleRow}>
          <View style={styles.dangerLabelBox}>
            <AlertTriangle size={20} color={THEME.colors.emergency.main} />
            <View style={{ marginLeft: 8, flex: 1 }}>
              <Text style={styles.dangerTitle}>Nguy cơ đe dọa tính mạng tức thời</Text>
              <Text style={styles.dangerSubtitle}>Nước dâng nóc nhà, chấn thương nặng, sạt lở sát vách</Text>
            </View>
          </View>
          <Switch
            value={declaredDanger}
            onValueChange={setDeclaredDanger}
            trackColor={{ false: '#CBD5E1', true: THEME.colors.emergency.light }}
            thumbColor={declaredDanger ? THEME.colors.emergency.main : '#FFFFFF'}
          />
        </View>
      </View>

      {/* 4. THÔNG TIN LIÊN HỆ & MÔ TẢ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>THÔNG TIN LIÊN LẠC (NẾU CÒN SÓNG)</Text>

        <View style={styles.inputGroup}>
          <View style={styles.labelWithIcon}>
            <Phone size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Số điện thoại của bạn:</Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="0912 345 678"
            placeholderTextColor={THEME.colors.text.muted}
            value={reporterPhone}
            onChangeText={setReporterPhone}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.labelWithIcon}>
            <FileText size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Mô tả chi tiết tình hình:</Text>
          </View>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder="Ví dụ: Nước ngập ngang ngực, có 1 cụ già 80 tuổi và 1 trẻ nhỏ, đang ở trên gác xép..."
            placeholderTextColor={THEME.colors.text.muted}
            value={description}
            onChangeText={setDescription}
            multiline={true}
            numberOfLines={4}
          />
        </View>
      </View>

      {/* NÚT BẤM GỬI CỨU NẠN */}
      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={isSubmitting}
        activeOpacity={0.85}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Send size={20} color="#FFFFFF" />
            <Text style={styles.submitButtonText}>XÁC NHẬN GỬI YÊU CẦU CỨU NẠN</Text>
          </>
        )}
      </TouchableOpacity>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
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
  locationLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  locationLoadingText: {
    marginLeft: 10,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
  },
  locationInfoBox: {
    backgroundColor: THEME.colors.surface.background,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  coordinatesText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  accuracyText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 4,
  },
  locationErrorBox: {
    backgroundColor: THEME.colors.emergency.bg,
    padding: 10,
    borderRadius: 8,
  },
  errorText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.emergency.main,
  },
  retryLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  retryLocationText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.primary.main,
    fontWeight: '700',
    marginLeft: 4,
  },
  sourceBadge: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourceBadgeGps: {
    backgroundColor: THEME.colors.success.bg,
    borderWidth: 1,
    borderColor: THEME.colors.success.border,
  },
  sourceBadgeManual: {
    backgroundColor: THEME.colors.emergency.bg,
    borderWidth: 1,
    borderColor: THEME.colors.emergency.border,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  sourceBadgeTextGps: {
    color: THEME.colors.success.dark,
  },
  sourceBadgeTextManual: {
    color: THEME.colors.emergency.dark,
  },
  locationLoadingBox: {
    paddingVertical: 6,
  },
  pickMapFastBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.emergency.bg,
    borderWidth: 1,
    borderColor: THEME.colors.emergency.border,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  pickMapFastText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: THEME.colors.emergency.main,
    marginLeft: 6,
  },
  coordDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationNoteDisplay: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.primary.dark,
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
  },
  locationActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
  },
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginLeft: 4,
  },
  actionBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  actionBtnGhostText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
    marginLeft: 4,
  },
  errorActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  errorPinMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.emergency.main,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  errorPinMapText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 4,
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
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  labelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
    color: THEME.colors.text.primary,
    marginLeft: 6,
  },
  numberInput: {
    width: 80,
    height: 42,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    backgroundColor: THEME.colors.surface.background,
  },
  dangerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.emergency.bg,
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: THEME.colors.emergency.border,
  },
  dangerLabelBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  dangerTitle: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
    color: THEME.colors.emergency.dark,
  },
  dangerSubtitle: {
    fontSize: 10,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  inputGroup: {
    marginTop: 12,
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
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.emergency.main,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 30,
    ...THEME.shadows.emergency,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm + 1,
    fontWeight: '800',
    marginLeft: 8,
    letterSpacing: 0.5,
  },
});
