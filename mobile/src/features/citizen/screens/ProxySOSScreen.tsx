import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { useAuthStore } from '../../../store/authStore';
import { INCIDENT_CATEGORIES, CONTACTABILITY_LABELS } from '../../../constants/labels';
import { IncidentCategoryCode, CreateProxySOSPayload, GeoLocation } from '../../../types/api';
import { ResponseApi } from '../../../api/responseApi';
import { THEME } from '../../../constants/theme';
import { LocationPickerModal } from '../../../components/common/LocationPickerModal';
import {
  Users,
  MapPin,
  Phone,
  FileText,
  Send,
  AlertCircle,
  Clock,
  LogIn,
  Map,
} from 'lucide-react-native';

export const ProxySOSScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isAuthenticated } = useAuthStore();

  const [selectedCategory, setSelectedCategory] = useState<IncidentCategoryCode>('FLOOD');
  const [relationship, setRelationship] = useState<string>('Bố mẹ / Gia đình ruột thịt');
  const [peopleAffected, setPeopleAffected] = useState<string>('2');
  const [householdLng, setHouseholdLng] = useState<string>('108.2022');
  const [householdLat, setHouseholdLat] = useState<string>('16.0544');
  const [householdAddressNote, setHouseholdAddressNote] = useState<string>('');
  const [beneficiaryPhone, setBeneficiaryPhone] = useState<string>('');
  const [contactability, setContactability] = useState<'REACHABLE' | 'UNREACHABLE' | 'UNKNOWN'>('UNREACHABLE');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isMapModalVisible, setIsMapModalVisible] = useState<boolean>(false);

  const handleConfirmMapLocation = (coords: [number, number], note?: string) => {
    setHouseholdLng(coords[0].toFixed(6));
    setHouseholdLat(coords[1].toFixed(6));
    if (note) {
      setHouseholdAddressNote(note);
    }
  };

  // Nếu chưa đăng nhập, bắt buộc đăng nhập để bảo đảm trách nhiệm báo tin (UC-15)
  if (!isAuthenticated) {
    return (
      <ScreenContainer title="Báo Cứu Trợ Người Thân" onBack={() => navigation.goBack()}>
        <View style={styles.authRequiredCard}>
          <AlertCircle size={48} color={THEME.colors.primary.main} />
          <Text style={styles.authRequiredTitle}>YÊU CẦU ĐĂNG NHẬP TÀI KHOẢN</Text>
          <Text style={styles.authRequiredDesc}>
            Theo quy định cứu hộ, chức năng báo cứu trợ từ xa (PROXY) yêu cầu xác thực tài khoản công dân để tránh báo tin giả mạo gây phân tán nguồn lực cứu hộ.
          </Text>
          <TouchableOpacity
            style={styles.loginNowButton}
            onPress={() => navigation.navigate('LoginScreen')}
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
    const lng = parseFloat(householdLng);
    const lat = parseFloat(householdLat);

    if (isNaN(lng) || isNaN(lat)) {
      Alert.alert('Tọa độ chưa đúng', 'Vui lòng nhập tọa độ vị trí hộ gia đình nạn nhân hợp lệ.');
      return;
    }

    const headcount = parseInt(peopleAffected, 10);
    if (isNaN(headcount) || headcount < 1) {
      Alert.alert('Số lượng chưa hợp lệ', 'Vui lòng nhập số lượng người cần cứu trợ.');
      return;
    }

    setIsSubmitting(true);
    try {
      const location: GeoLocation = {
        type: 'Point',
        coordinates: [lng, lat],
        source: 'MANUAL_PIN',
        captured_at: new Date().toISOString(),
      };

      const payload: CreateProxySOSPayload = {
        incident_category_code: selectedCategory,
        description: `${householdAddressNote ? `[Địa chỉ: ${householdAddressNote}] ` : ''}${description}`.trim(),
        people_affected: headcount,
        location,
        relationship: relationship.trim(),
        information_source: 'Gia đình liên lạc trước khi mất sóng',
        last_known_situation_at: new Date().toISOString(),
        contactability,
        beneficiary_contact_phone: beneficiaryPhone.trim() || undefined,
      };

      const response = await ResponseApi.createProxySOS(payload);

      Alert.alert(
        'ĐÃ GHI NHẬN YÊU CẦU CỨU TRỢ',
        `Mã tra cứu yêu cầu của người thân: ${response.tracking_code}\n\nĐiều phối viên sẽ đối soát thông tin và điều phối đội cứu nạn đến vị trí bạn đã chỉ định.`,
        [
          {
            text: 'Xem tiến độ cứu hộ',
            onPress: () =>
              navigation.replace('SOSTrackingScreen', {
                trackingCode: response.tracking_code,
              }),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Lỗi gửi yêu cầu', typeof error === 'string' ? error : 'Không thể gửi yêu cầu báo hộ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer
      title="Báo Cứu Trợ Người Thân"
      subtitle="Báo hộ vị trí cho gia đình gặp nạn (PROXY)"
      onBack={() => navigation.goBack()}
    >
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
            Kinh độ: {householdLng} | Vĩ độ: {householdLat}
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
              onChangeText={setHouseholdLng}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.inputLabel}>Vĩ độ (Latitude):</Text>
            <TextInput
              style={styles.textInput}
              value={householdLat}
              onChangeText={setHouseholdLat}
              keyboardType="numeric"
            />
          </View>
        </View>
      </View>

      {/* Modal Ghim Vị Trí Trên Bản Đồ */}
      <LocationPickerModal
        visible={isMapModalVisible}
        initialCoordinates={[
          parseFloat(householdLng) || 108.2022,
          parseFloat(householdLat) || 16.0544,
        ]}
        initialAddressNote={householdAddressNote}
        title="Ghim Vị Trí Hộ Gia Đình Người Thân"
        confirmButtonText="Xác nhận vị trí hộ gia đình"
        onClose={() => setIsMapModalVisible(false)}
        onConfirm={handleConfirmMapLocation}
      />

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
          <Text style={styles.inputLabel}>Số người dự kiến trong nhà:</Text>
          <TextInput
            style={styles.textInput}
            value={peopleAffected}
            onChangeText={setPeopleAffected}
            keyboardType="number-pad"
          />
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
        disabled={isSubmitting}
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
