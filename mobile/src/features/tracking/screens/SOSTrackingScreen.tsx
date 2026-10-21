import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TimelineStep } from '../../../components/common/TimelineStep';
import { ResponseApi } from '../../../api/responseApi';
import { StorageService } from '../../../utils/secureStore';
import { RequestTrackingDetail } from '../../../types/api';
import { TIMELINE_EVENT_LABELS } from '../../../constants/labels';
import { THEME } from '../../../constants/theme';
import {
  RefreshCw,
  Copy,
  PlusCircle,
  AlertCircle,
  FileText,
  Clock,
  Phone,
  ShieldCheck,
  Camera,
  ImageIcon,
  X,
} from 'lucide-react-native';

export const SOSTrackingScreen: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { trackingCode: initialCode, trackingSecret: initialSecret } = route.params || {};

  const [trackingCode, setTrackingCode] = useState<string>(initialCode || '');
  const [trackingSecret, setTrackingSecret] = useState<string>(initialSecret || '');
  const [data, setData] = useState<RequestTrackingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State cho Modal bổ sung thông tin
  const [showSupplementModal, setShowSupplementModal] = useState<boolean>(false);
  const [supplementNote, setSupplementNote] = useState<string>('');
  const [selectedImage, setSelectedImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isSubmittingSupplement, setIsSubmittingSupplement] = useState<boolean>(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setSelectedImage(result.assets[0]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở thư viện ảnh.');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Quyền máy ảnh', 'Vui lòng cấp quyền máy ảnh để chụp ảnh hiện trường.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setSelectedImage(result.assets[0]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở máy ảnh.');
    }
  };

  const fetchTrackingData = useCallback(async () => {
    if (!trackingCode) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      // Nếu chưa có secret thì thử lấy từ SecureStore của máy
      let secret: string | undefined = trackingSecret;
      if (!secret) {
        const found = await StorageService.getSecretForTrackingCode(trackingCode);
        if (found) {
          secret = found;
          setTrackingSecret(found);
        }
      }

      const result = await ResponseApi.trackRequest(trackingCode, secret);
      setData(result);
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : 'Không thể tải thông tin. Vui lòng kiểm tra lại mã tra cứu.');
    } finally {
      setLoading(false);
    }
  }, [trackingCode, trackingSecret]);

  useEffect(() => {
    fetchTrackingData();
  }, [fetchTrackingData]);

  const handleSupplementSubmit = async () => {
    if (!supplementNote.trim() && !selectedImage) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập ghi chú hoặc đính kèm ảnh hiện trường.');
      return;
    }
    if (!data) return;

    setIsSubmittingSupplement(true);
    try {
      // Đảm bảo có trackingSecret từ state hoặc StorageService
      let secret: string | undefined = trackingSecret;
      if (!secret && trackingCode) {
        const found = await StorageService.getSecretForTrackingCode(trackingCode);
        if (found) {
          secret = found;
          setTrackingSecret(found);
        }
      }

      // 1. Gửi bổ sung ghi chú hiện trường nếu có
      if (supplementNote.trim()) {
        await ResponseApi.supplementRequest(
          data.id,
          {
            expected_version: data.version,
            description: supplementNote.trim(),
          },
          trackingCode,
          secret
        );
      }

      // 2. Tải ảnh bằng chứng hiện trường lên MinIO nếu có
      if (selectedImage) {
        const uri = selectedImage.uri;
        const fileName = uri.split('/').pop() || 'evidence.jpg';
        const match = /\.(\w+)$/.exec(fileName);
        const type = match ? `image/${match[1].toLowerCase() === 'png' ? 'png' : 'jpeg'}` : 'image/jpeg';

        await ResponseApi.uploadEvidence(
          data.id,
          { uri, name: fileName, type },
          trackingCode,
          secret
        );
        setUploadedImages((prev) => [uri, ...prev]);
      }

      Alert.alert('Thành công', 'Đã gửi bổ sung thông tin và bằng chứng cho điều phối viên.');
      setSupplementNote('');
      setSelectedImage(null);
      setShowSupplementModal(false);
      fetchTrackingData();
    } catch (err: any) {
      Alert.alert('Lỗi', typeof err === 'string' ? err : 'Không thể gửi bổ sung thông tin.');
    } finally {
      setIsSubmittingSupplement(false);
    }
  };

  const copyCodeToClipboard = () => {
    Alert.alert('Đã sao chép mã', `Mã tra cứu: ${trackingCode}`);
  };

  return (
    <ScreenContainer
      title="Tiến Độ Cứu Hộ"
      subtitle={`Mã: ${trackingCode}`}
      onBack={() => navigation.goBack()}
      headerRight={
        <TouchableOpacity onPress={fetchTrackingData} style={styles.refreshBtn}>
          <RefreshCw size={20} color={THEME.colors.primary.main} />
        </TouchableOpacity>
      }
    >
      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang cập nhật tiến độ cứu hộ mới nhất...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.errorCard}>
          <AlertCircle size={40} color={THEME.colors.emergency.main} />
          <Text style={styles.errorCardTitle}>Không tìm thấy yêu cầu</Text>
          <Text style={styles.errorCardDesc}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchTrackingData}>
            <Text style={styles.retryBtnText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <>
          {/* THẺ TRẠNG THÁI TỔNG QUAN */}
          <View style={styles.summaryCard}>
            <View style={styles.codeRow}>
              <View>
                <Text style={styles.codeLabel}>MÃ TRA CỨU CỨU HỘ</Text>
                <Text style={styles.codeValue}>{data.tracking_code}</Text>
              </View>
              <TouchableOpacity style={styles.copyBtn} onPress={copyCodeToClipboard}>
                <Copy size={18} color={THEME.colors.primary.main} />
                <Text style={styles.copyBtnText}>Sao chép</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.statusRow}>
              <Text style={styles.statusHeaderLabel}>Trạng thái hiện tại:</Text>
              <StatusBadge status={data.status} />
            </View>

            {data.rejection_reason && (
              <View style={styles.rejectionBox}>
                <Text style={styles.rejectionTitle}>LÝ DO TỪ CHỐI TIẾP NHẬN:</Text>
                <Text style={styles.rejectionText}>{data.rejection_reason}</Text>
              </View>
            )}

            {data.duplicate_of_code && (
              <View style={styles.duplicateBox}>
                <Text style={styles.duplicateTitle}>YÊU CẦU TRÙNG LẶP:</Text>
                <Text style={styles.duplicateText}>
                  Đã được gộp chung vào hồ sơ cứu nạn gốc số: {data.duplicate_of_code}
                </Text>
              </View>
            )}
          </View>

          {/* DÒNG THỜI GIAN TIẾN TRÌNH CỨU HỘ (TIMELINE THỜI GIAN THỰC) */}
          <View style={styles.timelineCard}>
            <Text style={styles.sectionTitle}>TIẾN TRÌNH ĐIỀU PHỐI & CỨU HỘ</Text>

            {data.timeline && data.timeline.length > 0 ? (
              data.timeline.map((evt, idx) => {
                const info =
                  TIMELINE_EVENT_LABELS[evt.public_text_code] ||
                  TIMELINE_EVENT_LABELS[evt.event_type] || {
                    title: evt.public_text_code || evt.event_type,
                    desc: 'Hệ thống điều phối đã ghi nhận cập nhật tiến độ.',
                  };
                let timeStr: string | undefined = undefined;
                if (evt.occurred_at) {
                  const d = new Date(evt.occurred_at);
                  if (!isNaN(d.getTime())) {
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const mo = String(d.getMonth() + 1).padStart(2, '0');
                    timeStr = `${hh}:${mm} · ${dd}/${mo}`;
                  }
                }
                const isLastItem = idx === data.timeline.length - 1;

                return (
                  <TimelineStep
                    key={idx}
                    title={info.title}
                    description={info.desc}
                    timestamp={timeStr}
                    isCompleted={true}
                    isCurrent={isLastItem}
                    isLast={isLastItem}
                  />
                );
              })
            ) : (
              <>
                <TimelineStep
                  title="1. Đã gửi yêu cầu đến trung tâm"
                  description="Hệ thống đã ghi nhận tọa độ GPS và thông tin ban đầu."
                  timestamp={
                    data.received_at
                      ? `${String(new Date(data.received_at).getHours()).padStart(2, '0')}:${String(
                          new Date(data.received_at).getMinutes()
                        ).padStart(2, '0')} · ${String(new Date(data.received_at).getDate()).padStart(
                          2,
                          '0'
                        )}/${String(new Date(data.received_at).getMonth() + 1).padStart(2, '0')}`
                      : undefined
                  }
                  isCompleted={true}
                  isCurrent={data.status === 'SUBMITTED'}
                />

                <TimelineStep
                  title="2. Điều phối viên đang xác minh"
                  description="Kiểm tra thông tin liên lạc và mức độ nguy cấp."
                  isCompleted={['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS', 'RESOLVED'].includes(data.status)}
                  isCurrent={data.status === 'VERIFYING'}
                />

                <TimelineStep
                  title="3. Điều phối đội cứu nạn tiếp cận"
                  description="Đã lựa chọn đội cứu trợ gần nhất có trang thiết bị phù hợp."
                  isCompleted={['IN_PROGRESS', 'RESOLVED'].includes(data.status)}
                  isCurrent={data.status === 'DISPATCHED'}
                />

                <TimelineStep
                  title="4. Đội cứu nạn đang tác chiến tại chỗ"
                  description="Đang di chuyển ca nô / tiếp cận hiện trường để cứu trợ."
                  isCompleted={data.status === 'RESOLVED'}
                  isCurrent={data.status === 'IN_PROGRESS'}
                />

                <TimelineStep
                  title="5. Cứu hộ thành công hoàn tất"
                  description="Nạn nhân đã được đưa đến nơi an toàn hoặc nhận đủ hàng cứu trợ."
                  isCompleted={data.status === 'RESOLVED' || data.status === 'CLOSED'}
                  isCurrent={data.status === 'RESOLVED'}
                  isLast={true}
                />
              </>
            )}
          </View>

          {/* ẢNH HIỆN TRƯỜNG ĐÃ ĐÍNH KÈM */}
          {uploadedImages.length > 0 && (
            <View style={styles.uploadedImagesCard}>
              <View style={styles.uploadedImagesHeader}>
                <ImageIcon size={18} color={THEME.colors.primary.main} />
                <Text style={styles.uploadedImagesTitle}>ẢNH HIỆN TRƯỜNG ĐÃ ĐÍNH KÈM ({uploadedImages.length})</Text>
              </View>
              <View style={styles.uploadedImagesList}>
                {uploadedImages.map((imgUri, index) => (
                  <View key={index} style={styles.uploadedImageWrapper}>
                    <Image source={{ uri: imgUri }} style={styles.uploadedThumbnail} />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* NÚT BỔ SUNG THÔNG TIN HIỆN TRƯỜNG */}
          {data.can_supplement && (
            <TouchableOpacity
              style={styles.supplementBtn}
              onPress={() => setShowSupplementModal(true)}
              activeOpacity={0.85}
            >
              <PlusCircle size={20} color="#FFFFFF" />
              <Text style={styles.supplementBtnText}>Bổ Sung Tình Hình Hiện Trường</Text>
            </TouchableOpacity>
          )}

          {/* LỜI KHUYÊN AN TOÀN TRONG KHI CHỜ ĐỢI */}
          <View style={styles.safetyCard}>
            <ShieldCheck size={22} color={THEME.colors.primary.main} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.safetyTitle}>HƯỚNG DẪN GIỮ AN TOÀN</Text>
              <Text style={styles.safetyDesc}>
                1. Tránh xa đường dây điện, cột điện bị nghiêng đổ.{'\n'}
                2. Tiết kiệm pin điện thoại, giữ ấm cơ thể.{'\n'}
                3. Đội cứu hộ đang trên đường tới vị trí đã ghim của bạn.
              </Text>
            </View>
          </View>
        </>
      ) : null}

      {/* MODAL BỔ SUNG THÔNG TIN */}
      <Modal visible={showSupplementModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>BỔ SUNG TÌNH HÌNH HIỆN TẠI</Text>
            <Text style={styles.modalSubtitle}>
              Thông tin sẽ được cập nhật trực tiếp đến điều phối viên phụ trách:
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ví dụ: Nước đã dâng thêm 30cm, pin sắp hết..."
              placeholderTextColor={THEME.colors.text.muted}
              value={supplementNote}
              onChangeText={setSupplementNote}
              multiline={true}
              numberOfLines={4}
            />

            {/* Đính kèm ảnh hiện trường */}
            <View style={styles.imagePickerSection}>
              <Text style={styles.imagePickerLabel}>Đính kèm ảnh bằng chứng hiện trường (nếu có):</Text>
              <View style={styles.imageButtonRow}>
                <TouchableOpacity style={styles.pickImageBtn} onPress={pickImage} activeOpacity={0.8}>
                  <ImageIcon size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
                  <Text style={styles.pickImageText}>Thư viện ảnh</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pickImageBtn} onPress={takePhoto} activeOpacity={0.8}>
                  <Camera size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
                  <Text style={styles.pickImageText}>Chụp ảnh mới</Text>
                </TouchableOpacity>
              </View>

              {selectedImage && (
                <View style={styles.previewContainer}>
                  <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
                  <TouchableOpacity
                    style={styles.removeImageBtn}
                    onPress={() => setSelectedImage(null)}
                    activeOpacity={0.8}
                  >
                    <X size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowSupplementModal(false)}
              >
                <Text style={styles.modalCancelText}>Hủy Bỏ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, isSubmittingSupplement && { opacity: 0.6 }]}
                onPress={handleSupplementSubmit}
                disabled={isSubmittingSupplement}
              >
                {isSubmittingSupplement ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Gửi Bổ Sung</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
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
  refreshBtn: {
    padding: 6,
  },
  summaryCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
    paddingBottom: 12,
  },
  codeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.text.muted,
    letterSpacing: 0.5,
  },
  codeValue: {
    fontSize: THEME.typography.fontSizes.xl,
    fontWeight: '900',
    color: THEME.colors.primary.main,
    marginTop: 2,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  copyBtnText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginLeft: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  statusHeaderLabel: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
    color: THEME.colors.text.primary,
  },
  rejectionBox: {
    backgroundColor: THEME.colors.emergency.bg,
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  rejectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.emergency.dark,
  },
  rejectionText: {
    fontSize: 12,
    color: THEME.colors.emergency.main,
    marginTop: 2,
  },
  duplicateBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  duplicateTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
  },
  duplicateText: {
    fontSize: 12,
    color: THEME.colors.text.primary,
    marginTop: 2,
  },
  timelineCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  sectionTitle: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  supplementBtn: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    ...THEME.shadows.md,
  },
  supplementBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.sm,
    marginLeft: 8,
  },
  safetyCard: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.bg,
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
  },
  safetyTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.primary.main,
    letterSpacing: 0.5,
  },
  safetyDesc: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginTop: 4,
    lineHeight: 18,
  },
  errorCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginVertical: 40,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  errorCardTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginTop: 10,
  },
  errorCardDesc: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  retryBtn: {
    backgroundColor: THEME.colors.primary.main,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.sm,
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
    minHeight: 100,
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
    backgroundColor: THEME.colors.primary.main,
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
    marginTop: 12,
  },
  imagePickerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginBottom: 6,
  },
  imageButtonRow: {
    flexDirection: 'row',
  },
  pickImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  pickImageText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },
  previewContainer: {
    marginTop: 10,
    position: 'relative',
    width: 80,
    height: 80,
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  removeImageBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: THEME.colors.emergency.main,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadedImagesCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  uploadedImagesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadedImagesTitle: {
    marginLeft: 8,
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    letterSpacing: 0.5,
  },
  uploadedImagesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  uploadedImageWrapper: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  uploadedThumbnail: {
    width: 76,
    height: 76,
    borderRadius: 8,
  },
});
