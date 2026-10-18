import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { ResponseApi } from '../../../api/responseApi';
import { Mission, MissionStatus } from '../../../types/api';
import { INCIDENT_CATEGORIES, MISSION_STATUS_LABELS } from '../../../constants/labels';
import { THEME } from '../../../constants/theme';
import {
  MapPin,
  Users,
  Phone,
  Navigation,
  CheckCircle2,
  XCircle,
  Truck,
  Flag,
  AlertTriangle,
  FileCheck,
  Camera,
  ImageIcon,
  X,
} from 'lucide-react-native';

export const MissionDetailScreen: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { missionId } = route.params || {};

  const [mission, setMission] = useState<Mission | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Modal hoàn thành nhiệm vụ & ảnh bằng chứng cứu nạn
  const [showCompleteModal, setShowCompleteModal] = useState<boolean>(false);
  const [outcomeNote, setOutcomeNote] = useState<string>('');
  const [completionImage, setCompletionImage] = useState<ImagePicker.ImagePickerAsset | null>(null);

  // Modal từ chối hoặc báo thất bại
  const [showDeclineModal, setShowDeclineModal] = useState<boolean>(false);
  const [declineReason, setDeclineReason] = useState<string>('');

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setCompletionImage(result.assets[0]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở thư viện ảnh.');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Quyền máy ảnh', 'Vui lòng cấp quyền máy ảnh để chụp ảnh hiện trường cứu nạn.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setCompletionImage(result.assets[0]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở máy ảnh.');
    }
  };

  const fetchDetail = async () => {
    if (!missionId) return;
    setLoading(true);
    try {
      const data = await ResponseApi.getMissionDetail(missionId);
      setMission(data);
    } catch (e: any) {
      Alert.alert('Lỗi', typeof e === 'string' ? e : 'Không thể tải chi tiết nhiệm vụ.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [missionId]);

  // Mở Google Maps ngoài điều hướng đường đi
  const openExternalMaps = () => {
    if (!mission?.location?.coordinates) {
      Alert.alert('Chưa có vị trí', 'Sự cố này chưa có tọa độ bản đồ cụ thể.');
      return;
    }
    const [lng, lat] = mission.location.coordinates;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Không thể mở bản đồ', 'Thiết bị không hỗ trợ ứng dụng bản đồ điều hướng.');
    });
  };

  // Gọi điện thoại trực tiếp cho nạn nhân
  const callVictimPhone = () => {
    if (!mission?.reporter_contact_phone) return;
    Linking.openURL(`tel:${mission.reporter_contact_phone}`);
  };

  // Xử lý Tiếp nhận
  const handleAccept = async () => {
    if (!mission) return;
    setActionLoading(true);
    try {
      await ResponseApi.acceptMission(mission.id, mission.version || 1);
      Alert.alert('Thành công', 'Đã tiếp nhận nhiệm vụ. Hãy chuẩn bị phương tiện cứu hộ và lên đường!');
      fetchDetail();
    } catch (e: any) {
      Alert.alert('Lỗi tiếp nhận', typeof e === 'string' ? e : 'Không thể tiếp nhận nhiệm vụ.');
    } finally {
      setActionLoading(false);
    }
  };

  // Xử lý Từ chối hoặc Báo thất bại
  const handleDeclineSubmit = async () => {
    if (!mission || !declineReason.trim()) {
      Alert.alert('Thiếu lý do', 'Vui lòng nêu rõ lý do không thể tiếp nhận ca cứu nạn này.');
      return;
    }
    setActionLoading(true);
    try {
      if (mission.status === 'OFFERED') {
        await ResponseApi.declineMission(mission.id, mission.version || 1, declineReason.trim());
        Alert.alert('Đã từ chối', 'Đã báo về trung tâm điều phối để chuyển giao đội cứu nạn khác.');
      } else {
        await ResponseApi.transitionMission(
          mission.id,
          mission.version || 1,
          'FAILED',
          declineReason.trim()
        );
        Alert.alert('Đã ghi nhận', 'Đã báo cáo không thể tiếp cận hiện trường để điều phối viên có phương án chi viện.');
      }
      setShowDeclineModal(false);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Lỗi', typeof e === 'string' ? e : 'Không thể cập nhật trạng thái nhiệm vụ.');
    } finally {
      setActionLoading(false);
    }
  };

  // Xử lý Chuyển trạng thái tiến độ (EN_ROUTE, ON_SCENE)
  const handleTransition = async (toStatus: MissionStatus, promptTitle: string) => {
    if (!mission) return;
    Alert.alert('Xác nhận cập nhật', `Đồng chí xác nhận chuyển trạng thái sang: "${promptTitle}"?`, [
      { text: 'Hủy' },
      {
        text: 'Xác nhận',
        onPress: async () => {
          setActionLoading(true);
          try {
            await ResponseApi.transitionMission(mission.id, mission.version || 1, toStatus);
            fetchDetail();
          } catch (e: any) {
            Alert.alert('Lỗi cập nhật', typeof e === 'string' ? e : 'Không thể cập nhật trạng thái.');
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  // Xử lý Hoàn thành cứu nạn thành công (kèm ảnh bằng chứng nếu có)
  const handleCompleteSubmit = async () => {
    if (!mission || !outcomeNote.trim()) {
      Alert.alert('Thiếu báo cáo kết quả', 'Vui lòng nhập báo cáo kết quả cứu hộ (số người đã giải cứu, bàn giao ở đâu...).');
      return;
    }
    setActionLoading(true);
    try {
      // 1. Tải lên ảnh bằng chứng hiện trường nếu có
      if (completionImage) {
        try {
          await ResponseApi.uploadMissionEvidence(mission.id, {
            uri: completionImage.uri,
            name: completionImage.fileName || `mission-${mission.id}-${Date.now()}.jpg`,
            type: completionImage.mimeType || 'image/jpeg',
          });
        } catch (uploadErr) {
          console.warn('Lỗi tải ảnh bằng chứng:', uploadErr);
          // Không ngắt tiến trình nếu MinIO bận, nhưng ghi log
        }
      }

      // 2. Chuyển trạng thái sang COMPLETED
      await ResponseApi.transitionMission(
        mission.id,
        mission.version || 1,
        'COMPLETED',
        undefined,
        outcomeNote.trim()
      );
      Alert.alert('Cứu nạn thành công', 'Hoan hô đồng chí! Nhiệm vụ đã hoàn thành xuất sắc.');
      setShowCompleteModal(false);
      setCompletionImage(null);
      fetchDetail();
    } catch (e: any) {
      Alert.alert('Lỗi', typeof e === 'string' ? e : 'Không thể kết thúc nhiệm vụ.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <ScreenContainer title="Chi Tiết Nhiệm Vụ" onBack={() => navigation.goBack()}>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang tải chi tiết nhiệm vụ cứu nạn...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!mission) {
    return (
      <ScreenContainer title="Chi Tiết Nhiệm Vụ" onBack={() => navigation.goBack()}>
        <Text style={styles.errorText}>Không tìm thấy thông tin ca cứu hộ này.</Text>
      </ScreenContainer>
    );
  }

  const categoryInfo = INCIDENT_CATEGORIES[mission.category] || { label: 'Sự cố cứu hộ' };

  return (
    <ScreenContainer
      title="Chi Tiết Nhiệm Vụ Cứu Nạn"
      subtitle={`Mã: ${mission.id.slice(0, 8)}`}
      onBack={() => navigation.goBack()}
    >
      {/* 1. THẺ TỔNG QUAN SỰ CỐ */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText}>{categoryInfo.label}</Text>
          </View>
          <StatusBadge missionStatus={mission.status} />
        </View>

        {mission.declared_danger && (
          <View style={styles.dangerAlertBox}>
            <AlertTriangle size={18} color={THEME.colors.emergency.main} />
            <Text style={styles.dangerAlertText}>NGUY CƠ ĐE DỌA TÍNH MẠNG TỨC THỜI!</Text>
          </View>
        )}

        <Text style={styles.descText}>
          {mission.description || 'Không có mô tả chi tiết từ người dân.'}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Users size={18} color={THEME.colors.text.secondary} />
            <Text style={styles.metaValue}>{mission.people_affected || 1} người</Text>
            <Text style={styles.metaLabel}>Cần cứu nạn</Text>
          </View>

          <View style={styles.metaCol}>
            <MapPin size={18} color={THEME.colors.primary.main} />
            <Text style={styles.metaValue}>
              {mission.distance_m ? `${(mission.distance_m / 1000).toFixed(1)} km` : '~1.2 km'}
            </Text>
            <Text style={styles.metaLabel}>Khoảng cách</Text>
          </View>
        </View>
      </View>

      {/* 2. VỊ TRÍ & ĐIỀU HƯỚNG BẢN ĐỒ */}
      <View style={styles.card}>
        <Text style={styles.cardSectionTitle}>VỊ TRÍ NẠN NHÂN MẮC KẸT</Text>
        {mission.location?.coordinates ? (
          <>
            <Text style={styles.coordsText}>
              Tọa độ: {mission.location.coordinates[0].toFixed(5)}, {mission.location.coordinates[1].toFixed(5)}
            </Text>

            <TouchableOpacity style={styles.navigateBtn} onPress={openExternalMaps} activeOpacity={0.85}>
              <Navigation size={20} color="#FFFFFF" />
              <Text style={styles.navigateBtnText}>Mở Bản Đồ Google Maps Chỉ Đường</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.coordsText}>
            Chưa có thông tin tọa độ GPS cụ thể từ hiện trường.
          </Text>
        )}
      </View>

      {/* 3. LIÊN HỆ HIỆN TRƯỜNG */}
      <View style={styles.card}>
        <Text style={styles.cardSectionTitle}>LIÊN HỆ NẠN NHÂN / NGƯỜI BÁO TIN</Text>
        {mission.reporter_contact_phone ? (
          <View style={styles.contactRow}>
            <View>
              <Text style={styles.phoneText}>{mission.reporter_contact_phone}</Text>
              <Text style={styles.phoneLabel}>Số điện thoại người báo cứu hộ</Text>
            </View>
            <TouchableOpacity style={styles.callBtn} onPress={callVictimPhone}>
              <Phone size={18} color="#FFFFFF" />
              <Text style={styles.callBtnText}>Gọi điện</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.noContactText}>Nạn nhân chưa để lại số điện thoại hoặc đã mất sóng.</Text>
        )}

        {mission.alternate_contact ? (
          <View style={[styles.contactRow, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: THEME.colors.surface.border }]}>
            <View>
              <Text style={styles.phoneText}>{mission.alternate_contact.phone || 'Chưa cung cấp SĐT'}</Text>
              <Text style={styles.phoneLabel}>Người liên hệ phụ: {mission.alternate_contact.name}</Text>
            </View>
            {mission.alternate_contact.phone ? (
              <TouchableOpacity
                style={styles.callBtn}
                onPress={() => Linking.openURL(`tel:${mission.alternate_contact!.phone}`)}
              >
                <Phone size={18} color="#FFFFFF" />
                <Text style={styles.callBtnText}>Gọi điện</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* 4. CÁC NÚT HÀNH ĐỘNG VẬN HÀNH (THEO STATE MACHINE) */}
      <View style={styles.actionSection}>
        {actionLoading && <ActivityIndicator size="small" color={THEME.colors.primary.main} style={{ marginBottom: 10 }} />}

        {/* Khi mới nhận (OFFERED) */}
        {mission.status === 'OFFERED' && (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.declineBtn, actionLoading && { opacity: 0.6 }]}
              onPress={() => setShowDeclineModal(true)}
              disabled={actionLoading}
            >
              <XCircle size={18} color={THEME.colors.emergency.main} />
              <Text style={styles.declineBtnText}>Từ Chối</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.acceptBtn, actionLoading && { opacity: 0.6 }]}
              onPress={handleAccept}
              disabled={actionLoading}
            >
              <CheckCircle2 size={18} color="#FFFFFF" />
              <Text style={styles.acceptBtnText}>Tiếp Nhận Nhiệm Vụ</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Khi đã tiếp nhận (ACCEPTED) */}
        {mission.status === 'ACCEPTED' && (
          <TouchableOpacity
            style={styles.primaryActionBtn}
            onPress={() => handleTransition('EN_ROUTE', 'Đang trên đường di chuyển')}
            disabled={actionLoading}
          >
            <Truck size={20} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>BẮT ĐẦU DI CHUYỂN (EN_ROUTE)</Text>
          </TouchableOpacity>
        )}

        {/* Khi đang di chuyển (EN_ROUTE) */}
        {mission.status === 'EN_ROUTE' && (
          <TouchableOpacity
            style={[styles.primaryActionBtn, { backgroundColor: '#7C3AED' }]}
            onPress={() => handleTransition('ON_SCENE', 'Đã tiếp cận hiện trường')}
            disabled={actionLoading}
          >
            <Flag size={20} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>ĐÃ ĐẾN HIỆN TRƯỜNG (ON_SCENE)</Text>
          </TouchableOpacity>
        )}

        {/* Khi đã ở hiện trường (ON_SCENE) */}
        {mission.status === 'ON_SCENE' && (
          <View>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { backgroundColor: THEME.colors.success.main }]}
              onPress={() => setShowCompleteModal(true)}
              disabled={actionLoading}
            >
              <FileCheck size={20} color="#FFFFFF" />
              <Text style={styles.primaryActionText}>HOÀN THÀNH CỨU NẠN THÀNH CÔNG</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.failedBtn}
              onPress={() => {
                setDeclineReason('');
                setShowDeclineModal(true);
              }}
              disabled={actionLoading}
            >
              <Text style={styles.failedBtnText}>Báo Trở Ngại Không Thể Tiếp Cận (FAILED)</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* MODAL HOÀN THÀNH NHIỆM VỤ */}
      <Modal visible={showCompleteModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>BÁO CÁO KẾT QUẢ CỨU NẠN</Text>
            <Text style={styles.modalSubtitle}>
              Ghi chú kết quả hoàn thành để trung tâm điều phối chốt hồ sơ:
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ví dụ: Đã đưa 2 người lên ca nô an toàn, sức khỏe bình thường, đã bàn giao cho trạm y tế xã..."
              placeholderTextColor={THEME.colors.text.muted}
              value={outcomeNote}
              onChangeText={setOutcomeNote}
              multiline={true}
              numberOfLines={4}
            />

            {/* ĐÍNH KÈM ẢNH BẰNG CHỨNG CỨU NẠN */}
            <View style={styles.imagePickerSection}>
              <Text style={styles.imageSectionTitle}>ẢNH BẰNG CHỨNG HIỆN TRƯỜNG (KHUYẾN KHÍCH):</Text>
              {completionImage ? (
                <View style={styles.imagePreviewContainer}>
                  <Image source={{ uri: completionImage.uri }} style={styles.imagePreview} />
                  <TouchableOpacity
                    style={styles.removeImageBtn}
                    onPress={() => setCompletionImage(null)}
                    activeOpacity={0.8}
                  >
                    <X size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.imageBtnRow}>
                  <TouchableOpacity style={styles.imagePickerBtn} onPress={takePhoto} activeOpacity={0.8}>
                    <Camera size={16} color={THEME.colors.primary.main} />
                    <Text style={styles.imagePickerBtnText}>Chụp Ảnh</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.imagePickerBtn} onPress={pickImage} activeOpacity={0.8}>
                    <ImageIcon size={16} color={THEME.colors.primary.main} />
                    <Text style={styles.imagePickerBtnText}>Chọn Từ Máy</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowCompleteModal(false);
                  setCompletionImage(null);
                }}
              >
                <Text style={styles.modalCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: THEME.colors.success.main }]}
                onPress={handleCompleteSubmit}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Xác Nhận Hoàn Thành</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL TỪ CHỐI / BÁO THẤT BẠI */}
      <Modal visible={showDeclineModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: THEME.colors.emergency.main }]}>
              LÝ DO TỪ CHỐI / TRỞ NGẠI
            </Text>
            <Text style={styles.modalSubtitle}>
              Nêu rõ lý do để điều phối viên cử đội cứu nạn khác chi viện:
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ví dụ: Nước chảy quá xiết, sạt lở chia cắt đường không thể đưa ca nô vào..."
              placeholderTextColor={THEME.colors.text.muted}
              value={declineReason}
              onChangeText={setDeclineReason}
              multiline={true}
              numberOfLines={4}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDeclineModal(false)}
              >
                <Text style={styles.modalCancelText}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: THEME.colors.emergency.main }]}
                onPress={handleDeclineSubmit}
              >
                <Text style={styles.modalSubmitText}>Gửi Báo Cáo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  categoryPill: {
    backgroundColor: THEME.colors.surface.background,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  dangerAlertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.emergency.bg,
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  dangerAlertText: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.emergency.dark,
    marginLeft: 6,
  },
  descText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
    lineHeight: 22,
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
    paddingTop: 12,
  },
  metaCol: {
    flex: 1,
    alignItems: 'center',
  },
  metaValue: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginTop: 4,
  },
  metaLabel: {
    fontSize: 10,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  cardSectionTitle: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  coordsText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginBottom: 12,
  },
  navigateBtn: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...THEME.shadows.sm,
  },
  navigateBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.xs + 1,
    marginLeft: 8,
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  phoneText: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
  },
  phoneLabel: {
    fontSize: 11,
    color: THEME.colors.text.muted,
    marginTop: 2,
  },
  callBtn: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.success.main,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  callBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.xs,
    marginLeft: 6,
  },
  noContactText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.muted,
    marginTop: 4,
  },
  actionSection: {
    marginTop: 8,
    marginBottom: 40,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  declineBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 50,
    backgroundColor: THEME.colors.emergency.bg,
    borderWidth: 1,
    borderColor: THEME.colors.emergency.border,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  declineBtnText: {
    color: THEME.colors.emergency.main,
    fontWeight: '800',
    fontSize: THEME.typography.fontSizes.sm,
    marginLeft: 6,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    height: 50,
    backgroundColor: THEME.colors.primary.main,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    ...THEME.shadows.md,
  },
  acceptBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: THEME.typography.fontSizes.sm,
    marginLeft: 6,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    height: 52,
    backgroundColor: THEME.colors.primary.main,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...THEME.shadows.md,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: THEME.typography.fontSizes.sm + 1,
    marginLeft: 8,
    letterSpacing: 0.5,
  },
  failedBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 10,
  },
  failedBtnText: {
    color: THEME.colors.emergency.main,
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
  },
  errorText: {
    textAlign: 'center',
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.emergency.main,
    marginTop: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: THEME.colors.surface.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
  },
  modalSubtitle: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 4,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
  },
  modalCancelText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
    fontWeight: '600',
  },
  modalSubmitBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
  },
  imagePickerSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
  },
  imageSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  imageBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  imagePickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingVertical: 10,
  },
  imagePickerBtnText: {
    marginLeft: 6,
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },
  imagePreviewContainer: {
    position: 'relative',
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  imagePreview: {
    width: 100,
    height: 100,
    borderRadius: 10,
  },
  removeImageBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: THEME.colors.emergency.main,
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
