import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import * as ImagePicker from 'expo-image-picker';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { RequiredAsterisk } from '../../../components/common/RequiredAsterisk';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TimelineStep } from '../../../components/common/TimelineStep';
import { ResponseApi } from '../../../api/responseApi';
import { getApiErrorMessage, isApiErrorCode } from '../../../api/client';
import { MissionDetail, MissionStatus } from '../../../types/api';
import { INCIDENT_CATEGORIES, MISSION_KIND_LABELS, MISSION_STATUS_LABELS } from '../../../constants/labels';
import { THEME } from '../../../constants/theme';
import { generateUUID } from '../../../utils/secureStore';
import { getEvidenceSizeLimitBytes, getSupportedEvidenceMimeType } from '../../../utils/evidence';
import { getTeamRoleFromMissionView } from '../utils/teamMembershipRole';
import type { TeamMembershipRole } from '../utils/teamMembershipRole';
import {
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
  Video,
  X,
  Info,
} from 'lucide-react-native';

const isLoopbackDownloadUrl = (url: string) =>
  /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/)/i.test(url);

export const MissionDetailScreen: React.FC = () => {
  const router = useRouter();
  const { missionId: routeMissionId, teamRole: routeTeamRole } = useLocalSearchParams<{
    missionId?: string;
    teamRole?: string;
  }>();
  const missionId = Array.isArray(routeMissionId) ? routeMissionId[0] : routeMissionId;
  const routeTeamRoleValue = Array.isArray(routeTeamRole) ? routeTeamRole[0] : routeTeamRole;
  const teamRoleHint: TeamMembershipRole | undefined = routeTeamRoleValue === 'LEADER' || routeTeamRoleValue === 'MEMBER'
    ? routeTeamRoleValue
    : undefined;

  const [mission, setMission] = useState<MissionDetail | null>(null);
  const [teamRole, setTeamRole] = useState<TeamMembershipRole>(teamRoleHint ?? 'UNKNOWN');
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Modal hoàn thành nhiệm vụ & ảnh bằng chứng cứu nạn
  const [showCompleteModal, setShowCompleteModal] = useState<boolean>(false);
  const [outcomeNote, setOutcomeNote] = useState<string>('');
  const [formErrors, setFormErrors] = useState<Record<string, string | undefined>>({});
  const [completionImage, setCompletionImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const evidenceUploadKey = useRef<{ uri: string; key: string } | null>(null);

  // Modal từ chối hoặc báo thất bại
  const [showDeclineModal, setShowDeclineModal] = useState<boolean>(false);
  const [declineReason, setDeclineReason] = useState<string>('');

  // Xem ảnh minh chứng phóng to
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [previewImageError, setPreviewImageError] = useState(false);
  const [loadingEvidence, setLoadingEvidence] = useState<boolean>(false);

  const handleViewEvidence = async (evidenceId: string, mimeType: string) => {
    setLoadingEvidence(true);
    try {
      const res = await ResponseApi.getEvidenceDownloadUrl(evidenceId);
      if (res?.url) {
        if (isLoopbackDownloadUrl(res.url)) {
          Alert.alert(
            'Không thể mở minh chứng',
            'Đường dẫn tệp chưa truy cập được từ điện thoại. Vui lòng kiểm tra cấu hình kho lưu trữ hoặc liên hệ quản trị viên.'
          );
          return;
        }
        if (mimeType === 'video/mp4') {
          await Linking.openURL(res.url);
        } else {
          setPreviewImageError(false);
          setPreviewImageUri(res.url);
        }
      } else {
        Alert.alert('Không thể mở minh chứng', 'Chưa nhận được đường dẫn tệp. Vui lòng thử lại sau.');
      }
    } catch (e: any) {
      Alert.alert('Lỗi', getApiErrorMessage(e, 'Không thể mở tệp minh chứng.'));
    } finally {
      setLoadingEvidence(false);
    }
  };

  const pickEvidence = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const mimeType = getSupportedEvidenceMimeType(asset);
        if (!mimeType) {
          Alert.alert('Định dạng chưa hỗ trợ', 'Chỉ chọn ảnh JPEG, PNG hoặc video MP4.');
          return;
        }
        if (asset.fileSize !== undefined && asset.fileSize > getEvidenceSizeLimitBytes(mimeType)) {
          Alert.alert('Tệp quá lớn', mimeType === 'video/mp4'
            ? 'Video MP4 phải có dung lượng không quá 50 MB.'
            : 'Ảnh phải có dung lượng không quá 10 MB.');
          return;
        }
        evidenceUploadKey.current = null;
        setCompletionImage(asset);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở thư viện ảnh và video.');
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
        evidenceUploadKey.current = null;
        setCompletionImage(result.assets[0]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở máy ảnh.');
    }
  };

  const fetchDetail = useCallback(async () => {
    if (!missionId) return;
    setLoading(true);
    try {
      const [data, missionsPage] = await Promise.all([
        ResponseApi.getMissionDetail(missionId),
        ResponseApi.getMyMissions(50).catch(() => null),
      ]);
      const missionFromMine = missionsPage?.items.find((item) => item.id === missionId);
      const currentTeamRole = missionFromMine
        ? getTeamRoleFromMissionView(missionFromMine)
        : teamRoleHint ?? 'UNKNOWN';
      setTeamRole(currentTeamRole);
      if (currentTeamRole !== 'LEADER') {
        setShowCompleteModal(false);
        setShowDeclineModal(false);
      }
      setMission(data);
    } catch (e: any) {
      Alert.alert('Lỗi', getApiErrorMessage(e, 'Không thể tải chi tiết nhiệm vụ.'));
    } finally {
      setLoading(false);
    }
  }, [missionId, teamRoleHint]);

  useEffect(() => {
    // Fetch the route's initial mission snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
  }, [fetchDetail]);

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
    const phone = teamRole === 'LEADER' ? mission?.reporter_contact_phone : undefined;
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Không thể gọi điện', 'Thiết bị không hỗ trợ cuộc gọi điện thoại.'));
  };

  // Xử lý Tiếp nhận
  const handleAccept = async () => {
    if (!mission?.can_manage_mission) return;
    setActionLoading(true);
    try {
      await ResponseApi.acceptMission(mission.id, mission.version);
      Alert.alert('Đã tiếp nhận', 'Việc tiếp nhận nhiệm vụ đã được ghi nhận.');
      fetchDetail();
    } catch (e: any) {
      Alert.alert('Lỗi tiếp nhận', getApiErrorMessage(e, 'Không thể tiếp nhận nhiệm vụ.'));
    } finally {
      setActionLoading(false);
    }
  };

  // Xử lý Từ chối hoặc Báo thất bại
  const handleDeclineSubmit = async () => {
    if (!mission?.can_manage_mission) return;
    const reason = declineReason.trim();
    if (!reason) {
      setFormErrors((current) => ({ ...current, declineReason: 'Vui lòng nêu rõ lý do từ chối hoặc trở ngại.' }));
      return;
    }
    if (reason.length > 2000) {
      setFormErrors((current) => ({ ...current, declineReason: 'Lý do không được vượt quá 2.000 ký tự.' }));
      return;
    }
    setFormErrors((current) => ({ ...current, declineReason: undefined }));
    setActionLoading(true);
    try {
      if (mission.status === 'OFFERED') {
        await ResponseApi.declineMission(mission.id, mission.version, reason);
        Alert.alert('Đã từ chối', 'Lý do từ chối nhiệm vụ đã được ghi nhận.');
      } else {
        await ResponseApi.transitionMission(
          mission.id,
          mission.version,
          'FAILED',
          reason
        );
        Alert.alert('Đã ghi nhận', 'Trạng thái nhiệm vụ không thể tiếp cận đã được ghi nhận.');
      }
      setShowDeclineModal(false);
      goBackOrHome(router);
    } catch (e: any) {
      Alert.alert('Lỗi', getApiErrorMessage(e, 'Không thể cập nhật trạng thái nhiệm vụ.'));
    } finally {
      setActionLoading(false);
    }
  };

  // Xử lý Chuyển trạng thái tiến độ (EN_ROUTE, ON_SCENE)
  const handleTransition = async (toStatus: MissionStatus, promptTitle: string) => {
    if (!mission?.can_manage_mission) return;
    Alert.alert('Xác nhận cập nhật', `Đồng chí xác nhận chuyển trạng thái sang: "${promptTitle}"?`, [
      { text: 'Hủy' },
      {
        text: 'Xác nhận',
        onPress: async () => {
          setActionLoading(true);
          try {
            await ResponseApi.transitionMission(mission.id, mission.version, toStatus);
            fetchDetail();
          } catch (e: any) {
            Alert.alert('Lỗi cập nhật', getApiErrorMessage(e, 'Không thể cập nhật trạng thái.'));
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  // Xử lý Hoàn thành cứu nạn thành công (kèm ảnh bằng chứng nếu có)
  const handleCompleteSubmit = async () => {
    if (!mission?.can_manage_mission) return;
    const outcome = outcomeNote.trim();
    if (!outcome) {
      setFormErrors((current) => ({ ...current, outcomeNote: 'Vui lòng nhập báo cáo kết quả cứu hộ.' }));
      return;
    }
    if (outcome.length > 2000) {
      setFormErrors((current) => ({ ...current, outcomeNote: 'Báo cáo kết quả không được vượt quá 2.000 ký tự.' }));
      return;
    }
    setFormErrors((current) => ({ ...current, outcomeNote: undefined }));
    setActionLoading(true);
    try {
      // Upload selected media first so a storage failure does not lose the local file.
      if (completionImage) {
        const mimeType = getSupportedEvidenceMimeType(completionImage);
        if (!mimeType) {
          Alert.alert('Định dạng chưa hỗ trợ', 'Chỉ chọn ảnh JPEG, PNG hoặc video MP4.');
          return;
        }
        if (completionImage.fileSize !== undefined && completionImage.fileSize > getEvidenceSizeLimitBytes(mimeType)) {
          Alert.alert('Tệp quá lớn', mimeType === 'video/mp4'
            ? 'Video MP4 phải có dung lượng không quá 50 MB.'
            : 'Ảnh phải có dung lượng không quá 10 MB.');
          return;
        }
        try {
          if (!evidenceUploadKey.current || evidenceUploadKey.current.uri !== completionImage.uri) {
            evidenceUploadKey.current = { uri: completionImage.uri, key: generateUUID() };
          }
          const uploadKey = evidenceUploadKey.current.key;
          await ResponseApi.uploadMissionEvidence(mission.id, {
            uri: completionImage.uri,
            name: completionImage.fileName || `mission-${mission.id}-${Date.now()}${mimeType === 'video/mp4' ? '.mp4' : mimeType === 'image/png' ? '.png' : '.jpg'}`,
            type: mimeType,
          }, uploadKey);
        } catch (uploadError) {
          if (isApiErrorCode(uploadError, 'STORAGE_UNAVAILABLE')) {
            // The backend records this attachment as FAILED; retry it with a new key.
            evidenceUploadKey.current = null;
          }
          Alert.alert(
            'Chưa tải được bằng chứng',
            `${getApiErrorMessage(uploadError, 'Không thể tải tệp minh chứng lên.')} Tệp vẫn được giữ. Hãy thử lại hoặc xóa tệp đã chọn để hoàn tất mà không đính kèm.`,
          );
          return;
        }
      }

      await ResponseApi.transitionMission(
        mission.id,
        mission.version,
        'COMPLETED',
        undefined,
        outcome
      );
      Alert.alert('Đã ghi nhận kết quả', 'Đã ghi nhận kết quả hoàn thành nhiệm vụ.');
      setShowCompleteModal(false);
      setCompletionImage(null);
      evidenceUploadKey.current = null;
      fetchDetail();
    } catch (e: any) {
      if (isApiErrorCode(e, 'VERSION_CONFLICT')) {
        await fetchDetail();
        Alert.alert('Nhiệm vụ đã thay đổi', 'Thông tin mới nhất đã được tải. Hãy kiểm tra lại rồi xác nhận hoàn thành lần nữa.');
      } else {
        Alert.alert('Lỗi', getApiErrorMessage(e, 'Không thể kết thúc nhiệm vụ.'));
      }
    } finally {
      setActionLoading(false);
    }
  };

  const completeSubmitDisabled = actionLoading || !outcomeNote.trim() || outcomeNote.length > 2000;
  const declineSubmitDisabled = actionLoading || !declineReason.trim() || declineReason.length > 2000;

  if (loading) {
    return (
      <ScreenContainer title="Chi Tiết Nhiệm Vụ" onBack={() => goBackOrHome(router)}>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang tải chi tiết nhiệm vụ cứu nạn...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!mission) {
    return (
      <ScreenContainer title="Chi Tiết Nhiệm Vụ" onBack={() => goBackOrHome(router)}>
        <Text style={styles.errorText}>Không tìm thấy thông tin ca cứu hộ này.</Text>
      </ScreenContainer>
    );
  }

  const categoryInfo = INCIDENT_CATEGORIES[mission.category ?? 'UNKNOWN'] || { label: 'Sự cố cứu hộ' };
  const kindInfo = mission.mission_kind ? MISSION_KIND_LABELS[mission.mission_kind] : null;
  const timeline = mission.timeline.items;
  const evidence = mission.evidence.items;
  const canManageMission = mission.can_manage_mission === true;
  const reporterContactPhone = teamRole === 'LEADER' ? mission.reporter_contact_phone : undefined;
  const alternateContact = teamRole === 'LEADER' ? mission.alternate_contact : undefined;

  return (
    <ScreenContainer
      title="Chi Tiết Nhiệm Vụ Cứu Nạn"
      subtitle={`Mã: ${mission.id.slice(0, 8)}`}
      onBack={() => goBackOrHome(router)}
    >
      {/* 1. THẺ TỔNG QUAN SỰ CỐ */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, flex: 1, marginRight: 8 }}>
            <View style={styles.categoryPill}>
              <Text style={styles.categoryText}>{categoryInfo.label}</Text>
            </View>
            {kindInfo && (
              <View style={[styles.kindPill, { backgroundColor: kindInfo.bg }]}>
                <Text style={[styles.kindText, { color: kindInfo.color }]}>{kindInfo.label}</Text>
              </View>
            )}
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
            <Text style={styles.metaValue}>{mission.people_affected ?? 'Chưa rõ'}{mission.people_affected == null ? '' : ' người'}</Text>
            <Text style={styles.metaLabel}>Cần cứu nạn</Text>
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
        <>
            {reporterContactPhone ? (
              <View style={styles.contactRow}>
                <View>
                  <Text style={styles.phoneText}>{reporterContactPhone}</Text>
                  <Text style={styles.phoneLabel}>Số điện thoại người báo cứu hộ</Text>
                </View>
                <TouchableOpacity style={styles.callBtn} onPress={callVictimPhone}>
                  <Phone size={18} color="#FFFFFF" />
                  <Text style={styles.callBtnText}>Gọi điện</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {alternateContact ? (
              <View style={[styles.contactRow, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: THEME.colors.surface.border }]}>
                <View>
                  <Text style={styles.phoneText}>{alternateContact.phone || 'Chưa cung cấp SĐT'}</Text>
                  <Text style={styles.phoneLabel}>Người liên hệ phụ: {alternateContact.name}</Text>
                </View>
                {alternateContact.phone ? (
                  <TouchableOpacity
                    style={styles.callBtn}
                    onPress={() => Linking.openURL(`tel:${alternateContact.phone}`)}
                  >
                    <Phone size={18} color="#FFFFFF" />
                    <Text style={styles.callBtnText}>Gọi điện</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            {!reporterContactPhone && !alternateContact ? (
              <Text style={styles.noContactText}>
                {canManageMission
                  ? 'Hồ sơ hiện không có thông tin liên hệ được cung cấp.'
                  : 'Thông tin liên hệ hiện trường chỉ hiển thị với đội trưởng.'}
              </Text>
            ) : null}
        </>
      </View>

      {/* 4. KẾT QUẢ CỨU NẠN THỰC ĐỊA (KHI ĐÃ HOÀN THÀNH) */}
      {/* 5. TIẾN TRÌNH NHIỆM VỤ (TIMELINE) */}
      {timeline.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>TIẾN TRÌNH NHIỆM VỤ CỨU HỘ</Text>
          {timeline.map((evt, idx) => {
            const info = MISSION_STATUS_LABELS[evt.to_status as MissionStatus] || { label: evt.to_status };
            const isLast = idx === timeline.length - 1;
            const dateObj = new Date(evt.occurred_at);
            const timeStr = !isNaN(dateObj.getTime())
              ? `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')} · ${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}`
              : undefined;
            const desc = evt.outcome_note
              ? `Kết quả: ${evt.outcome_note}`
              : evt.reason
                ? `Lý do: ${evt.reason}`
                : evt.recorded_basis
                  ? `Điều phối viên ghi thay qua hình thức ${evt.recorded_basis}`
                  : `Trạng thái: ${info.label}`;
            return (
              <TimelineStep
                key={evt.id || idx}
                title={info.label}
                description={desc}
                timestamp={timeStr}
                isCompleted={true}
                isCurrent={isLast}
                isLast={isLast}
              />
            );
          })}
        </View>
      )}

      {/* 6. MINH CHỨNG HIỆN TRƯỜNG ĐÃ TẢI LÊN */}
      {evidence.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>ẢNH / VIDEO HIỆN TRƯỜNG ({evidence.length})</Text>
          {loadingEvidence && (
            <ActivityIndicator size="small" color={THEME.colors.primary.main} style={{ marginBottom: 8 }} />
          )}
          <View style={styles.evidenceGrid}>
            {evidence.map((ev) => (
              <TouchableOpacity
                key={ev.id}
                style={styles.evidenceThumbCard}
                onPress={() => handleViewEvidence(ev.id, ev.detected_mime)}
                activeOpacity={0.8}
              >
                {ev.detected_mime === 'video/mp4'
                  ? <Video size={22} color={THEME.colors.primary.main} />
                  : <ImageIcon size={22} color={THEME.colors.primary.main} />}
                <Text style={styles.evidenceThumbText} numberOfLines={1}>
                  {ev.detected_mime.includes('video') ? 'Video hiện trường' : 'Ảnh hiện trường'}
                </Text>
                <Text style={styles.evidenceSizeText}>
                  {(ev.size_bytes / (1024 * 1024)).toFixed(1)} MB · Chạm để xem
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Quyền thao tác được máy chủ kiểm tra theo trạng thái nhiệm vụ và thành viên hiện tại. */}
      <View style={styles.actionSection}>
        {canManageMission ? (
          <>
          <Text style={styles.memberActionSub}>Bạn là đội trưởng của đội được giao. Hãy cập nhật nhiệm vụ theo tình hình thực tế.</Text>
          {actionLoading && <ActivityIndicator size="small" color={THEME.colors.primary.main} style={{ marginBottom: 10 }} />}

          {/* Khi mới nhận (OFFERED) */}
          {mission.status === 'OFFERED' && (
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.declineBtn, actionLoading && { opacity: 0.6 }]}
                onPress={() => {
                  setFormErrors((current) => ({ ...current, declineReason: undefined }));
                  setShowDeclineModal(true);
                }}
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
              <Text style={styles.primaryActionText}>Bắt đầu di chuyển đến hiện trường</Text>
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
              <Text style={styles.primaryActionText}>Xác nhận đã tiếp cận hiện trường</Text>
            </TouchableOpacity>
          )}

          {/* Khi đã ở hiện trường (ON_SCENE) */}
          {mission.status === 'ON_SCENE' && (
            <View>
              <TouchableOpacity
                style={[styles.primaryActionBtn, { backgroundColor: THEME.colors.success.main }]}
                onPress={() => {
                  setFormErrors((current) => ({ ...current, outcomeNote: undefined }));
                  setShowCompleteModal(true);
                }}
                disabled={actionLoading}
              >
                <FileCheck size={20} color="#FFFFFF" />
                <Text style={styles.primaryActionText}>Báo cáo hoàn thành nhiệm vụ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.failedBtn}
                onPress={() => {
                  setDeclineReason('');
                  setShowDeclineModal(true);
                }}
                disabled={actionLoading}
              >
                <Text style={styles.failedBtnText}>Báo trở ngại không thể tiếp cận</Text>
              </TouchableOpacity>
            </View>
          )}
          </>
        ) : (
          <View style={styles.roleNotice}>
            <Info size={18} color={teamRole === 'MEMBER' ? THEME.colors.primary.main : THEME.colors.warning.dark} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.roleNoticeTitle}>
                {teamRole === 'MEMBER' ? 'Thành viên đội cứu hộ' : teamRole === 'LEADER' ? 'Chưa thể cập nhật nhiệm vụ' : 'Chưa xác định vai trò đội'}
              </Text>
              <Text style={styles.roleNoticeText}>
                {teamRole === 'MEMBER'
                  ? 'Bạn có thể xem nhiệm vụ. Đội trưởng phụ trách tiếp nhận, từ chối và cập nhật tiến độ.'
                  : teamRole === 'LEADER'
                    ? 'Đội hiện không đủ điều kiện cập nhật nhiệm vụ qua ứng dụng. Vui lòng liên hệ điều phối viên.'
                    : 'Bạn vẫn có thể xem nhiệm vụ. Các thao tác cập nhật chỉ hiển thị khi hệ thống xác nhận quyền của bạn.'}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* MODAL HOÀN THÀNH NHIỆM VỤ */}
      <Modal visible={showCompleteModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>BÁO CÁO KẾT QUẢ CỨU NẠN</Text>
            <Text style={styles.modalSubtitle}>
              Ghi chú kết quả hoàn thành để trung tâm điều phối chốt hồ sơ <RequiredAsterisk />:
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ví dụ: Đã đưa 2 người lên ca nô an toàn, sức khỏe bình thường, đã bàn giao cho trạm y tế xã..."
              placeholderTextColor={THEME.colors.text.muted}
              value={outcomeNote}
              onChangeText={(value) => {
                setOutcomeNote(value);
                setFormErrors((current) => ({
                  ...current,
                  outcomeNote: value.length > 2000 ? 'Báo cáo kết quả không được vượt quá 2.000 ký tự.' : undefined,
                }));
              }}
              onBlur={() => {
                if (!outcomeNote.trim()) setFormErrors((current) => ({ ...current, outcomeNote: 'Báo cáo kết quả cứu hộ là bắt buộc.' }));
              }}
              multiline={true}
              numberOfLines={4}
              maxLength={2001}
            />
            <FormFieldError message={formErrors.outcomeNote} />

            {/* ĐÍNH KÈM ẢNH HOẶC VIDEO BẰNG CHỨNG CỨU NẠN */}
            <View style={styles.imagePickerSection}>
              <Text style={styles.imageSectionTitle}>ẢNH HOẶC VIDEO MP4 BẰNG CHỨNG (KHUYẾN KHÍCH):</Text>
              {completionImage ? (
                <View style={styles.imagePreviewContainer}>
                  {getSupportedEvidenceMimeType(completionImage) === 'video/mp4' ? (
                    <View style={styles.videoPreview}>
                      <Video size={24} color={THEME.colors.primary.main} />
                      <Text style={styles.videoPreviewText} numberOfLines={2}>
                        {completionImage.fileName || 'Video MP4 đã chọn'}
                      </Text>
                    </View>
                  ) : (
                    <Image source={{ uri: completionImage.uri }} style={styles.imagePreview} />
                  )}
                  <TouchableOpacity
                    style={styles.removeImageBtn}
                    onPress={() => {
                      setCompletionImage(null);
                      evidenceUploadKey.current = null;
                    }}
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
                  <TouchableOpacity style={styles.imagePickerBtn} onPress={pickEvidence} activeOpacity={0.8}>
                    <Video size={16} color={THEME.colors.primary.main} />
                    <Text style={styles.imagePickerBtnText}>Ảnh / Video</Text>
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
                  evidenceUploadKey.current = null;
                }}
              >
                <Text style={styles.modalCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: THEME.colors.success.main }, completeSubmitDisabled && { opacity: 0.5 }]}
                onPress={handleCompleteSubmit}
                disabled={completeSubmitDisabled}
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
            <Text style={styles.modalSubtitle}>Lý do từ chối hoặc trở ngại <RequiredAsterisk /></Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ví dụ: Nước chảy quá xiết, sạt lở chia cắt đường không thể đưa ca nô vào..."
              placeholderTextColor={THEME.colors.text.muted}
              value={declineReason}
              onChangeText={(value) => {
                setDeclineReason(value);
                setFormErrors((current) => ({
                  ...current,
                  declineReason: value.length > 2000 ? 'Lý do không được vượt quá 2.000 ký tự.' : undefined,
                }));
              }}
              onBlur={() => {
                if (!declineReason.trim()) setFormErrors((current) => ({ ...current, declineReason: 'Lý do từ chối hoặc trở ngại là bắt buộc.' }));
              }}
              multiline={true}
              numberOfLines={4}
              maxLength={2001}
            />
            <FormFieldError message={formErrors.declineReason} />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDeclineModal(false)}
              >
                <Text style={styles.modalCancelText}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: THEME.colors.emergency.main }, declineSubmitDisabled && { opacity: 0.5 }]}
                onPress={handleDeclineSubmit}
                disabled={declineSubmitDisabled}
              >
                <Text style={styles.modalSubmitText}>Gửi Báo Cáo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL XEM ẢNH MINH CHỨNG PHÓNG TO */}
      <Modal visible={Boolean(previewImageUri)} transparent animationType="fade">
        <View style={styles.previewModalOverlay}>
          <TouchableOpacity
            style={styles.previewModalClose}
            onPress={() => setPreviewImageUri(null)}
          >
            <X size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {previewImageUri ? (
            previewImageError ? (
              <Text style={styles.previewImageErrorText}>Không tải được ảnh minh chứng. Vui lòng kiểm tra kết nối rồi thử lại.</Text>
            ) : (
              <Image
                source={{ uri: previewImageUri }}
                style={styles.previewFullImage}
                resizeMode="contain"
                onError={() => setPreviewImageError(true)}
              />
            )
          ) : null}
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
  kindPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  kindText: {
    fontSize: 11,
    fontWeight: '700',
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
  videoPreview: {
    width: 160,
    minHeight: 100,
    borderRadius: 10,
    padding: 12,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPreviewText: {
    marginTop: 6,
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
    textAlign: 'center',
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
  privacyNoteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  privacyNoteTitle: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  privacyNoteDesc: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    lineHeight: 16,
    marginTop: 2,
  },
  memberActionBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginTop: 6,
    marginBottom: 20,
    ...THEME.shadows.sm,
  },
  memberActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  memberActionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1D4ED8',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  memberActionDesc: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
    color: '#1E3A8A',
    lineHeight: 20,
    marginBottom: 10,
  },
  memberActionSub: {
    fontSize: 11,
    color: '#3B82F6',
    fontStyle: 'italic',
  },
  roleNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  roleNoticeTitle: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginBottom: 3,
  },
  roleNoticeText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    lineHeight: 18,
  },
  evidenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  evidenceThumbCard: {
    width: '48%',
    backgroundColor: THEME.colors.surface.background,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    alignItems: 'center',
  },
  evidenceThumbText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginTop: 6,
  },
  evidenceSizeText: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    marginTop: 2,
  },
  previewModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewModalClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  previewFullImage: {
    width: '100%',
    height: '80%',
  },
  previewImageErrorText: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
    marginHorizontal: 28,
  },
});
