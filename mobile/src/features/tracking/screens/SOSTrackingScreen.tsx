import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TimelineStep } from '../../../components/common/TimelineStep';
import { ResponseApi } from '../../../api/responseApi';
import { generateUUID, StorageService } from '../../../utils/secureStore';
import { getApiErrorMessage, isApiErrorCode } from '../../../api/client';
import { RequestTrackingDetail } from '../../../types/api';
import { TIMELINE_EVENT_LABELS } from '../../../constants/labels';
import { THEME } from '../../../constants/theme';
import {
  RefreshCw,
  Copy,
  PlusCircle,
  AlertCircle,
  ShieldCheck,
  Camera,
  ImageIcon,
  Video,
  X,
} from 'lucide-react-native';

export const SOSTrackingScreen: React.FC = () => {
  const router = useRouter();
  const { trackingCode: routeCode } = useLocalSearchParams<{ trackingCode?: string }>();
  const initialCode = Array.isArray(routeCode) ? routeCode[0] : routeCode;

  const [trackingCode, setTrackingCode] = useState<string>(initialCode || '');
  const [trackingSecret, setTrackingSecret] = useState<string>('');
  const [data, setData] = useState<RequestTrackingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(initialCode));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State cho Modal bổ sung thông tin
  const [showSupplementModal, setShowSupplementModal] = useState<boolean>(false);
  const [supplementNote, setSupplementNote] = useState<string>('');
  const [selectedImage, setSelectedImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isSubmittingSupplement, setIsSubmittingSupplement] = useState<boolean>(false);
  const [uploadedEvidence, setUploadedEvidence] = useState<{ uri: string; type: 'image' | 'video'; name: string }[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const initialFetchStarted = useRef(false);
  const evidenceIdempotencyKeys = useRef(new Map<string, string>());

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
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
    if (!trackingCode.trim()) {
      setLoading(false);
      setErrorMsg(null);
      setData(null);
      return;
    }
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

      const normalizedCode = trackingCode.trim().toUpperCase();
      const result = await ResponseApi.trackRequest(normalizedCode, secret);
      if (secret) {
        try {
          await StorageService.saveGuestTrackingSecret(normalizedCode, secret);
        } catch {
          // The successful API result remains usable for this screen session.
        }
      }
      setData(result);

      // Tải danh sách sự kiện chi tiết từ API chuyên biệt GET /requests/:id/events
      if (result?.id) {
        try {
          const eventsRes = await ResponseApi.getRequestEvents(result.id, normalizedCode, secret);
          if (eventsRes?.items && eventsRes.items.length > 0) {
            setData((prev) => (prev ? { ...prev, timeline: eventsRes.items as any } : prev));
          }
        } catch {
          // Nếu không tải được events nâng cao, vẫn dùng timeline mặc định từ result
        }
      }
    } catch (err: any) {
      setErrorMsg(getApiErrorMessage(err, 'Không thể tải thông tin. Vui lòng kiểm tra lại mã và khóa tra cứu.'));
    } finally {
      setLoading(false);
    }
  }, [trackingCode, trackingSecret]);

  useEffect(() => {
    if (initialCode && !initialFetchStarted.current) {
      initialFetchStarted.current = true;
      fetchTrackingData();
    }
  }, [initialCode, fetchTrackingData]);

  const openSupplementModal = async () => {
    if (!data) return;
    try {
      const pending = await StorageService.getPendingSupplement(data.id);
      if (pending) {
        if (supplementNote.trim() && supplementNote.trim() !== pending.payload.description) {
          Alert.alert(
            'Có ghi chú đang chờ xác nhận',
            'Để tránh gửi trùng hoặc mất thông tin, hãy tiếp tục ghi chú đã lưu trước.'
          );
          setSupplementNote(pending.payload.description);
        } else if (!supplementNote.trim()) {
          setSupplementNote(pending.payload.description);
        }
      }
      setShowSupplementModal(true);
    } catch {
      Alert.alert('Không thể tiếp tục', 'Không truy cập được ghi chú đang chờ gửi. Vui lòng thử lại.');
    }
  };

  const handleSupplementSubmit = async () => {
    if (!supplementNote.trim() && !selectedImage) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập ghi chú hoặc đính kèm ảnh hiện trường.');
      return;
    }
    if (!data) return;

    const note = supplementNote.trim();
    const image = selectedImage;
    let noteSent = false;
    let evidenceSent = false;
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

      // Ghi chú là lệnh có phiên bản; giữ nguyên payload và khóa để retry an toàn.
      if (note) {
        const payload = {
          expected_version: data.version,
          description: note,
        };
        const pending = await StorageService.getOrCreatePendingSupplement(data.id, payload);
        await ResponseApi.updateReport(
          data.id,
          pending.payload,
          trackingCode,
          secret,
          pending.idempotencyKey
        );
        noteSent = true;
        setSupplementNote('');
        try {
          await StorageService.clearPendingSupplement(data.id);
        } catch {
          // Keep the successful screen flow usable if local cleanup temporarily fails.
        }
      }

      // Tải ảnh riêng; nếu thất bại sau khi ghi chú thành công, lần sau chỉ gửi ảnh.
      if (image) {
        const uri = image.uri;
        const fileName = image.fileName || uri.split('/').pop() || 'evidence.jpg';
        const extension = /\.(\w+)$/.exec(fileName)?.[1]?.toLowerCase();
        const extensionMimeType = extension === 'jpg' || extension === 'jpeg'
          ? 'image/jpeg'
          : extension === 'png'
            ? 'image/png'
            : extension === 'mp4'
              ? 'video/mp4'
              : undefined;
        const supportedMimeTypes = ['image/jpeg', 'image/png', 'video/mp4'];
        const type = image.mimeType || extensionMimeType;
        if (!type || !supportedMimeTypes.includes(type)) {
          throw new Error('UNSUPPORTED_EVIDENCE_TYPE');
        }
        const sizeLimit = type === 'video/mp4' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (image.fileSize !== undefined && image.fileSize > sizeLimit) {
          throw new Error('EVIDENCE_FILE_TOO_LARGE');
        }
        const key = `${data.id}:${uri}`;
        let idempotencyKey = evidenceIdempotencyKeys.current.get(key);
        if (!idempotencyKey) {
          idempotencyKey = generateUUID();
          evidenceIdempotencyKeys.current.set(key, idempotencyKey);
        }

        await ResponseApi.uploadEvidence(
          data.id,
          { uri, name: fileName, type },
          trackingCode,
          secret,
          idempotencyKey
        );
        evidenceSent = true;
        evidenceIdempotencyKeys.current.delete(key);
        setUploadedEvidence((prev) => [
          { uri, type: type === 'video/mp4' ? 'video' : 'image', name: fileName },
          ...prev,
        ]);
        setSelectedImage(null);
      }

      await fetchTrackingData();
      setShowSupplementModal(false);
      const successMessage = noteSent && evidenceSent
        ? 'Đã gửi ghi chú và tải ảnh hiện trường lên.'
        : noteSent
          ? 'Đã gửi ghi chú hiện trường.'
          : 'Đã tải ảnh hiện trường lên.';
      Alert.alert('Thành công', successMessage);
    } catch (err: any) {
      if (isApiErrorCode(err, 'VERSION_CONFLICT')) {
        try {
          await StorageService.clearPendingSupplement(data.id);
        } catch {
          // The next read will still expose the pending command for safe recovery.
        }
        await fetchTrackingData();
      }
      const localMessage = err instanceof Error && err.message === 'PENDING_SUPPLEMENT_MUST_BE_RESUMED'
        ? 'Có ghi chú trước đang chờ xác nhận. Hãy mở lại phần bổ sung và gửi ghi chú đã lưu.'
        : err instanceof Error && err.message === 'UNSUPPORTED_EVIDENCE_TYPE'
            ? 'Định dạng tệp chưa được hỗ trợ. Vui lòng chọn ảnh JPEG, PNG hoặc video MP4.'
          : err instanceof Error && err.message === 'EVIDENCE_FILE_TOO_LARGE'
            ? 'Tệp vượt giới hạn tải lên: ảnh tối đa 10 MB, video MP4 tối đa 50 MB.'
            : null;
      const failureMessage = localMessage || getApiErrorMessage(err, 'Không thể gửi bổ sung thông tin.');
      if (noteSent) {
        await fetchTrackingData();
        Alert.alert(
          'Ghi chú đã được gửi',
          `Ảnh chưa tải lên. Hãy gửi lại ảnh đã chọn. ${failureMessage}`
        );
      } else {
        Alert.alert('Lỗi', failureMessage);
      }
    } finally {
      setIsSubmittingSupplement(false);
    }
  };

  const copyCodeToClipboard = async () => {
    const code = data?.tracking_code || trackingCode;
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      Alert.alert('Đã sao chép mã', 'Mã tra cứu đã được sao chép vào bộ nhớ tạm.');
    } catch {
      Alert.alert('Không thể sao chép', 'Vui lòng thử lại.');
    }
  };

  return (
    <ScreenContainer
      title="Tiến Độ Cứu Hộ"
      subtitle={trackingCode ? `Mã: ${trackingCode}` : 'Tra cứu bằng mã và khóa bí mật'}
      onBack={() => goBackOrHome(router)}
      headerRight={
        <TouchableOpacity onPress={fetchTrackingData} style={styles.refreshBtn}>
          <RefreshCw size={20} color={THEME.colors.primary.main} />
        </TouchableOpacity>
      }
    >
      {!data && !loading ? (
        <View style={styles.lookupCard}>
          <Text style={styles.lookupTitle}>Tra cứu yêu cầu cứu trợ</Text>
          <TextInput
            style={styles.lookupInput}
            placeholder="Mã tra cứu"
            placeholderTextColor={THEME.colors.text.muted}
            value={trackingCode}
            onChangeText={(value) => setTrackingCode(value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <TextInput
            style={styles.lookupInput}
            placeholder="Khóa bí mật (nếu có)"
            placeholderTextColor={THEME.colors.text.muted}
            value={trackingSecret}
            onChangeText={setTrackingSecret}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          {errorMsg ? <Text style={styles.errorCardDesc}>{errorMsg}</Text> : null}
          <TouchableOpacity style={styles.retryBtn} onPress={fetchTrackingData}>
            <Text style={styles.retryBtnText}>Tra cứu</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
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
                    title: 'Cập nhật tiến độ hồ sơ',
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
              <TimelineStep
                  title="Đã tiếp nhận yêu cầu"
                  description="Hồ sơ cứu trợ đã được ghi nhận. Trạng thái hiện tại được hiển thị ở phía trên."
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
                  isCurrent={false}
                  isLast={true}
                />
            )}
          </View>

          {/* ẢNH HIỆN TRƯỜNG ĐÃ ĐÍNH KÈM */}
          {uploadedEvidence.length > 0 && (
            <View style={styles.uploadedImagesCard}>
              <View style={styles.uploadedImagesHeader}>
                <ImageIcon size={18} color={THEME.colors.primary.main} />
                <Text style={styles.uploadedImagesTitle}>BẰNG CHỨNG ĐÃ TẢI LÊN ({uploadedEvidence.length})</Text>
              </View>
              <View style={styles.uploadedImagesList}>
                {uploadedEvidence.map((evidence, index) => (
                  evidence.type === 'video' ? (
                    <View key={`${evidence.uri}-${index}`} style={styles.uploadedVideoWrapper}>
                      <Video size={20} color={THEME.colors.primary.main} />
                      <Text style={styles.uploadedVideoText}>Video MP4 đã tải lên</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      key={`${evidence.uri}-${index}`}
                      style={styles.uploadedImageWrapper}
                      onPress={() => setPreviewImage(evidence.uri)}
                      activeOpacity={0.8}
                    >
                      <Image source={{ uri: evidence.uri }} style={styles.uploadedThumbnail} />
                    </TouchableOpacity>
                  )
                ))}
              </View>
            </View>
          )}

          {/* NÚT BỔ SUNG THÔNG TIN HIỆN TRƯỜNG */}
          {data.can_supplement && (
            <TouchableOpacity
              style={styles.supplementBtn}
              onPress={() => void openSupplementModal()}
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
                3. Theo dõi trạng thái cập nhật và giữ điện thoại sẵn sàng liên lạc.
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
              <Text style={styles.imagePickerLabel}>Đính kèm ảnh hoặc video bằng chứng hiện trường (nếu có):</Text>
              <View style={styles.imageButtonRow}>
                <TouchableOpacity style={styles.pickImageBtn} onPress={pickImage} activeOpacity={0.8}>
                  <ImageIcon size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
                  <Text style={styles.pickImageText}>Thư viện ảnh/video</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pickImageBtn} onPress={takePhoto} activeOpacity={0.8}>
                  <Camera size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
                  <Text style={styles.pickImageText}>Chụp ảnh mới</Text>
                </TouchableOpacity>
              </View>

              {selectedImage && (
                <View style={styles.previewContainer}>
                  {selectedImage.type === 'video' ? (
                    <View style={styles.videoPreview}>
                      <Video size={28} color={THEME.colors.primary.main} />
                      <Text style={styles.videoPreviewText} numberOfLines={2}>
                        {selectedImage.fileName || 'Video MP4 đã chọn'}
                      </Text>
                    </View>
                  ) : (
                    <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
                  )}
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
      {/* MODAL XEM ẢNH HIỆN TRƯỜNG PHÓNG TO */}
      <Modal visible={!!previewImage} transparent={true} animationType="fade">
        <View style={styles.imageViewerOverlay}>
          <TouchableOpacity
            style={styles.closeImageBtn}
            onPress={() => setPreviewImage(null)}
            activeOpacity={0.8}
          >
            <X size={26} color="#FFFFFF" />
          </TouchableOpacity>
          {previewImage && (
            <Image
              source={{ uri: previewImage }}
              style={styles.fullPreviewImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  lookupCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    padding: 16,
    marginVertical: 20,
  },
  lookupTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginBottom: 10,
  },
  lookupInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.sm,
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
  videoPreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  videoPreviewText: {
    marginTop: 5,
    fontSize: 9,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
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
  uploadedVideoWrapper: {
    width: 92,
    height: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  uploadedVideoText: {
    marginTop: 5,
    fontSize: 9,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
  },
  uploadedThumbnail: {
    width: 76,
    height: 76,
    borderRadius: 8,
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  closeImageBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 20,
    padding: 8,
  },
  fullPreviewImage: {
    width: '100%',
    height: '80%',
  },
});
