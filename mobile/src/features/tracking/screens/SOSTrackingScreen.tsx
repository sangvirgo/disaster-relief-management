import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Image,
  Platform,
  ScrollView,
  Linking,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { consumeTrackingCodeForNavigation } from '../../../navigation/trackingCodeHandoff';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { CompactTextInput } from '../../../components/common/CompactTextInput';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TimelineStep } from '../../../components/common/TimelineStep';
import { LocationPickerModal } from '../../../components/common/LocationPickerModal';
import { ResponseApi } from '../../../api/responseApi';
import { generateUUID, PendingSupplementCommand, StorageService } from '../../../utils/secureStore';
import { getApiErrorMessage, getApiFieldErrors, isApiErrorCode } from '../../../api/client';
import { useAuthStore } from '../../../store/authStore';
import {
  GeoLocation,
  RequestReportUpdatePayload,
  RequestSupplementPayload,
  RequestTrackingDetail,
  RequestEvidenceReference,
} from '../../../types/api';
import { TIMELINE_EVENT_LABELS } from '../../../constants/labels';
import { THEME } from '../../../constants/theme';
import {
  getTrackingCodeError,
  getTrackingSecretError,
  isValidTrackingCode,
  isValidTrackingSecret,
  TRACKING_CODE_MAX_LENGTH,
} from '../../../utils/formValidation';
import { getEvidenceSizeLimitBytes, getSupportedEvidenceMimeType } from '../../../utils/evidence';
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
  KeyRound,
  MapPin,
  Users,
  AlertTriangle,
} from 'lucide-react-native';

const MAX_EVIDENCE_FILES_PER_REQUEST = 5;
type OptionalBooleanChoice = 'UNCHANGED' | 'YES' | 'NO';

const REPORTER_UPDATE_FIELD_ALIASES: Record<string, string> = {
  description: 'supplementError',
  household_reference_note: 'supplementError',
  people_affected: 'supplementError',
  children_count: 'supplementError',
  elderly_count: 'supplementError',
  'location.coordinates': 'supplementError',
  'location.accuracy_m': 'supplementError',
  location: 'supplementError',
  reporter_declared_danger: 'supplementError',
  needs_rescue: 'supplementError',
  needs_relief_supplies: 'supplementError',
  body: 'supplementError',
};

function isUnverifiedRequestStatus(status: string): boolean {
  return status === 'SUBMITTED' || status === 'VERIFYING';
}

function optionalCountError(value: string, label: string, allowZero: boolean): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const amount = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(amount) || amount < (allowZero ? 0 : 1) || amount > 10000) {
    return `${label} phải là số nguyên từ ${allowZero ? '0' : '1'} đến 10.000.`;
  }
  return undefined;
}

function booleanForChoice(choice: OptionalBooleanChoice): boolean | undefined {
  if (choice === 'YES') return true;
  if (choice === 'NO') return false;
  return undefined;
}

export const SOSTrackingScreen: React.FC = () => {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const [trackingCode, setTrackingCode] = useState<string>('');
  const [data, setData] = useState<RequestTrackingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [trackingCodeError, setTrackingCodeError] = useState<string | undefined>();
  const [eventsCursor, setEventsCursor] = useState<string | undefined>();
  const [eventsMore, setEventsMore] = useState(false);
  const [loadingOlderEvents, setLoadingOlderEvents] = useState(false);

  // State cho Modal bổ sung thông tin
  const [showSupplementModal, setShowSupplementModal] = useState<boolean>(false);
  const [supplementNote, setSupplementNote] = useState<string>('');
  const [supplementError, setSupplementError] = useState<string | undefined>();
  const [householdReferenceNote, setHouseholdReferenceNote] = useState('');
  const [supplementPeopleAffected, setSupplementPeopleAffected] = useState('');
  const [supplementChildrenCount, setSupplementChildrenCount] = useState('');
  const [supplementElderlyCount, setSupplementElderlyCount] = useState('');
  const [supplementLocation, setSupplementLocation] = useState<GeoLocation | null>(null);
  const [dangerChoice, setDangerChoice] = useState<OptionalBooleanChoice>('UNCHANGED');
  const [needsRescueChoice, setNeedsRescueChoice] = useState<OptionalBooleanChoice>('UNCHANGED');
  const [needsReliefChoice, setNeedsReliefChoice] = useState<OptionalBooleanChoice>('UNCHANGED');
  const [pendingSupplementCommand, setPendingSupplementCommand] = useState<PendingSupplementCommand | null>(null);
  const [showSupplementLocationPicker, setShowSupplementLocationPicker] = useState(false);
  const [selectedImages, setSelectedImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [isSubmittingSupplement, setIsSubmittingSupplement] = useState<boolean>(false);
  const [uploadedEvidence, setUploadedEvidence] = useState<RequestEvidenceReference[]>([]);
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const initialFetchStarted = useRef(false);
  const evidenceIdempotencyKeys = useRef(new Map<string, string>());

  // One-time coordinator-issued code for binding an unowned request to an account.
  const [showRecoveryModal, setShowRecoveryModal] = useState<boolean>(false);
  const [recoveryTrackingCode, setRecoveryTrackingCode] = useState<string>('');
  const [recoveryCode, setRecoveryCode] = useState<string>('');
  const [recoveryErrors, setRecoveryErrors] = useState<Record<string, string | undefined>>({});
  const [isRecovering, setIsRecovering] = useState<boolean>(false);

  const addSelectedEvidence = (assets: ImagePicker.ImagePickerAsset[]) => {
    const existingUris = new Set(selectedImages.map((asset) => asset.uri));
    const availableSlots = Math.max(0, MAX_EVIDENCE_FILES_PER_REQUEST - uploadedEvidence.length - selectedImages.length);
    const acceptedAssets: ImagePicker.ImagePickerAsset[] = [];
    let unsupportedCount = 0;
    let oversizedCount = 0;
    let limitExceeded = false;

    for (const asset of assets) {
      if (existingUris.has(asset.uri) || acceptedAssets.some((item) => item.uri === asset.uri)) continue;
      const mimeType = getSupportedEvidenceMimeType(asset);
      if (!mimeType) {
        unsupportedCount += 1;
        continue;
      }
      if (asset.fileSize !== undefined && asset.fileSize > getEvidenceSizeLimitBytes(mimeType)) {
        oversizedCount += 1;
        continue;
      }
      if (acceptedAssets.length >= availableSlots) {
        limitExceeded = true;
        continue;
      }
      acceptedAssets.push(asset);
    }

    if (acceptedAssets.length > 0) {
      setSelectedImages((current) => {
        const currentUris = new Set(current.map((asset) => asset.uri));
        const newAssets = acceptedAssets.filter((asset) => !currentUris.has(asset.uri));
        return [...current, ...newAssets].slice(0, MAX_EVIDENCE_FILES_PER_REQUEST);
      });
      if (!supplementNote.trim()) setSupplementError(undefined);
    }

    const warnings: string[] = [];
    if (unsupportedCount > 0) warnings.push(`${unsupportedCount} tệp không đúng định dạng JPEG, PNG hoặc MP4.`);
    if (oversizedCount > 0) warnings.push(`${oversizedCount} tệp vượt giới hạn dung lượng.`);
    if (limitExceeded) warnings.push(`Mỗi hồ sơ chỉ đính kèm tối đa ${MAX_EVIDENCE_FILES_PER_REQUEST} tệp.`);
    if (warnings.length > 0) {
      Alert.alert('Một số tệp chưa được thêm', warnings.join('\n'));
    }
  };

  const pickImage = async () => {
    const availableSlots = Math.max(0, MAX_EVIDENCE_FILES_PER_REQUEST - uploadedEvidence.length - selectedImages.length);
    if (availableSlots <= 0) {
      Alert.alert('Đã đủ số tệp', `Mỗi hồ sơ chỉ đính kèm tối đa ${MAX_EVIDENCE_FILES_PER_REQUEST} tệp.`);
      return;
    }
    try {
      if (Platform.OS === 'ios') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Cần quyền thư viện', 'Hãy cho phép truy cập thư viện để chọn ảnh hoặc video.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: availableSlots,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.8,
      });
      if (!result.canceled && result.assets.length > 0) {
        addSelectedEvidence(result.assets);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở thư viện ảnh và video.');
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
        addSelectedEvidence([result.assets[0]]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở máy ảnh.');
    }
  };

  const fetchTrackingData = useCallback(async (codeInput?: string) => {
    const input = (codeInput ?? trackingCode).trim();
    const normalizedCode = input.toUpperCase();
    setUploadedEvidence([]);
    setEventsCursor(undefined);
    setEventsMore(false);
    if (!normalizedCode) {
      setLoading(false);
      setData(null);
      setErrorMsg('Vui lòng nhập mã tra cứu cứu trợ.');
      return;
    }
    if (!isValidTrackingCode(normalizedCode)) {
      setLoading(false);
      setData(null);
      setErrorMsg('Mã tra cứu phải gồm từ 10 đến 16 ký tự hợp lệ.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await ResponseApi.trackRequest(normalizedCode);
      setTrackingCode(result.tracking_code);
      setTrackingCodeError(undefined);
      try {
        await StorageService.deleteLegacyGuestTrackingSecret(result.tracking_code);
      } catch {
        // The tracking-code capability remains sufficient if legacy local cleanup fails.
      }
      // The tracking summary returns newest first; render the timeline chronologically.
      setData({ ...result, timeline: [...result.timeline].reverse() });
      const savedEvidence = result?.id
        ? await StorageService.getRequestEvidence(result.id).catch(() => [])
        : [];
      // The server list is authoritative (it survives a reinstall or another device); local entries only fill gaps.
      const serverEvidence = result.evidence ?? [];
      const knownIds = new Set(serverEvidence.map((item) => item.id));
      setUploadedEvidence([...serverEvidence, ...savedEvidence.filter((item) => !knownIds.has(item.id))]);

      // Tải danh sách sự kiện chi tiết từ API chuyên biệt GET /requests/:id/events
      if (result?.id) {
        try {
          const eventsRes = await ResponseApi.getRequestEvents(result.id, result.tracking_code);
          setData((prev) => (prev ? { ...prev, timeline: [...eventsRes.items].reverse() as any } : prev));
          setEventsCursor(eventsRes.cursor);
          setEventsMore(eventsRes.more);
        } catch {
          // Nếu không tải được events nâng cao, vẫn dùng timeline mặc định từ result
        }
      }
    } catch (err: any) {
      setErrorMsg(getApiErrorMessage(err, 'Không thể tải thông tin. Vui lòng kiểm tra lại mã tra cứu.'));
    } finally {
      setLoading(false);
    }
  }, [trackingCode]);

  const openUploadedEvidence = async (evidence: RequestEvidenceReference) => {
    if (!data?.id || openingEvidenceId) return;

    setOpeningEvidenceId(evidence.id);
    try {
      const download = await ResponseApi.getEvidenceDownloadUrl(evidence.id, data.tracking_code);
      if (evidence.detected_mime === 'video/mp4') {
        await Linking.openURL(download.url);
      } else {
        setPreviewImage(download.url);
      }
    } catch (error) {
      Alert.alert('Không thể mở tệp', getApiErrorMessage(error, 'Vui lòng thử lại sau.'));
    } finally {
      setOpeningEvidenceId(null);
    }
  };

  const loadOlderEvents = async () => {
    if (!data?.id || !eventsMore || !eventsCursor || loadingOlderEvents) return;
    setLoadingOlderEvents(true);
    try {
      const code = trackingCode.trim().toUpperCase();
      const page = await ResponseApi.getRequestEvents(data.id, code, eventsCursor);
      const olderEvents = [...page.items].reverse();
      setData((current) => current
        ? { ...current, timeline: [...(olderEvents as any[]), ...(current.timeline || [])] }
        : current);
      setEventsCursor(page.cursor);
      setEventsMore(page.more);
    } catch (error) {
      Alert.alert('Không thể tải lịch sử', getApiErrorMessage(error, 'Không thể tải các cập nhật trước đó. Vui lòng thử lại.'));
    } finally {
      setLoadingOlderEvents(false);
    }
  };

  useEffect(() => {
    const initialCode = consumeTrackingCodeForNavigation();
    if (initialCode && !initialFetchStarted.current) {
      initialFetchStarted.current = true;
      void fetchTrackingData(initialCode);
    }
  }, [fetchTrackingData]);

  const clearSupplementFields = () => {
    setSupplementNote('');
    setHouseholdReferenceNote('');
    setSupplementPeopleAffected('');
    setSupplementChildrenCount('');
    setSupplementElderlyCount('');
    setSupplementLocation(null);
    setDangerChoice('UNCHANGED');
    setNeedsRescueChoice('UNCHANGED');
    setNeedsReliefChoice('UNCHANGED');
  };

  const openSupplementModal = async () => {
    if (!data) return;
    setSupplementError(undefined);
    try {
      const pending = await StorageService.getPendingSupplement(data.id);
      if (pending) {
        const payload = pending.payload;
        setPendingSupplementCommand({
          ...pending,
          kind: pending.kind || (isUnverifiedRequestStatus(data.status) ? 'REPORT_UPDATE' : 'SUPPLEMENT'),
        });
        setSupplementNote(payload.description || '');
        setHouseholdReferenceNote(payload.household_reference_note || '');
        setSupplementPeopleAffected(payload.people_affected == null ? '' : String(payload.people_affected));
        setSupplementLocation(payload.location || null);
        setDangerChoice(payload.reporter_declared_danger === undefined
          ? 'UNCHANGED'
          : payload.reporter_declared_danger ? 'YES' : 'NO');
        setSupplementChildrenCount('children_count' in payload && payload.children_count != null
          ? String(payload.children_count)
          : '');
        setSupplementElderlyCount('elderly_count' in payload && payload.elderly_count != null
          ? String(payload.elderly_count)
          : '');
        setNeedsRescueChoice('needs_rescue' in payload && payload.needs_rescue !== undefined
          ? payload.needs_rescue ? 'YES' : 'NO'
          : 'UNCHANGED');
        setNeedsReliefChoice('needs_relief_supplies' in payload && payload.needs_relief_supplies !== undefined
          ? payload.needs_relief_supplies ? 'YES' : 'NO'
          : 'UNCHANGED');
      } else {
        setPendingSupplementCommand(null);
      }
      setShowSupplementModal(true);
    } catch {
      Alert.alert('Không thể tiếp tục', 'Không truy cập được ghi chú đang chờ gửi. Vui lòng thử lại.');
    }
  };

  const handleSupplementSubmit = async () => {
    const note = supplementNote.trim();
    if (!pendingSupplementCommand && note.length > 2000) {
      setSupplementError('Ghi chú không được vượt quá 2.000 ký tự.');
      return;
    }
    if (!data) return;

    const kind = pendingSupplementCommand?.kind || (isUnverifiedRequestStatus(data.status) ? 'REPORT_UPDATE' : 'SUPPLEMENT');
    const isReportUpdate = kind === 'REPORT_UPDATE';
    const peopleError = optionalCountError(supplementPeopleAffected, 'Số người bị ảnh hưởng', false);
    const childrenError = isReportUpdate
      ? optionalCountError(supplementChildrenCount, 'Số trẻ em', true)
      : undefined;
    const elderlyError = isReportUpdate
      ? optionalCountError(supplementElderlyCount, 'Số người cao tuổi', true)
      : undefined;
    const referenceNote = householdReferenceNote.trim();
    if (!pendingSupplementCommand && referenceNote.length > 500) {
      setSupplementError('Ghi chú nhận diện hộ gia đình không được vượt quá 500 ký tự.');
      return;
    }
    if (!pendingSupplementCommand && (peopleError || childrenError || elderlyError)) {
      setSupplementError(peopleError || childrenError || elderlyError);
      return;
    }
    const total = supplementPeopleAffected.trim() ? Number(supplementPeopleAffected) : null;
    const vulnerableTotal = (supplementChildrenCount.trim() ? Number(supplementChildrenCount) : 0) +
      (supplementElderlyCount.trim() ? Number(supplementElderlyCount) : 0);
    if (!pendingSupplementCommand && isReportUpdate && total !== null && vulnerableTotal > total) {
      setSupplementError('Tổng số trẻ em và người cao tuổi không được lớn hơn tổng số người bị ảnh hưởng.');
      return;
    }
    if (!pendingSupplementCommand && isReportUpdate && needsRescueChoice === 'NO' && needsReliefChoice === 'NO') {
      setSupplementError('Yêu cầu phải còn ít nhất một nhu cầu: cứu hộ hoặc hàng cứu trợ.');
      return;
    }

    const peopleAffected = supplementPeopleAffected.trim() ? Number(supplementPeopleAffected) : undefined;
    const childrenCount = supplementChildrenCount.trim() ? Number(supplementChildrenCount) : undefined;
    const elderlyCount = supplementElderlyCount.trim() ? Number(supplementElderlyCount) : undefined;
    const dangerValue = booleanForChoice(dangerChoice);
    const needsRescueValue = booleanForChoice(needsRescueChoice);
    const needsReliefValue = booleanForChoice(needsReliefChoice);
    const hasStructuredUpdate = Boolean(
      pendingSupplementCommand || referenceNote || peopleAffected !== undefined || supplementLocation || dangerValue !== undefined ||
      (isReportUpdate && (
        childrenCount !== undefined || elderlyCount !== undefined ||
        needsRescueValue !== undefined || needsReliefValue !== undefined
      ))
    );
    if (!note && !hasStructuredUpdate && selectedImages.length === 0) {
      setSupplementError('Nhập thông tin cần cập nhật hoặc đính kèm ảnh/video hiện trường.');
      return;
    }
    setSupplementError(undefined);

    const images = selectedImages;
    let updateSent = false;
    let uploadedCount = 0;
    setIsSubmittingSupplement(true);
    try {
      if (pendingSupplementCommand || note || hasStructuredUpdate) {
        const commonFields = {
          expected_version: data.version,
          ...(note ? { description: note } : {}),
          ...(referenceNote ? { household_reference_note: referenceNote } : {}),
          ...(peopleAffected !== undefined ? { people_affected: peopleAffected } : {}),
          ...(supplementLocation ? { location: supplementLocation } : {}),
          ...(dangerValue !== undefined ? { reporter_declared_danger: dangerValue } : {}),
        };
        const payload: RequestReportUpdatePayload | RequestSupplementPayload = pendingSupplementCommand?.payload || (isReportUpdate
          ? {
              ...commonFields,
              ...(childrenCount !== undefined ? { children_count: childrenCount } : {}),
              ...(elderlyCount !== undefined ? { elderly_count: elderlyCount } : {}),
              ...(needsRescueValue !== undefined ? { needs_rescue: needsRescueValue } : {}),
              ...(needsReliefValue !== undefined ? { needs_relief_supplies: needsReliefValue } : {}),
            }
          : commonFields);
        const pending = await StorageService.getOrCreatePendingSupplement(data.id, kind, payload);
        setPendingSupplementCommand(pending);
        const pendingKind = pending.kind || kind;
        if (pendingKind === 'REPORT_UPDATE') {
          await ResponseApi.updateReport(
            data.id,
            pending.payload as RequestReportUpdatePayload,
            trackingCode,
            pending.idempotencyKey
          );
        } else {
          await ResponseApi.supplementRequest(
            data.id,
            pending.payload as RequestSupplementPayload,
            trackingCode,
            pending.idempotencyKey
          );
        }
        updateSent = true;
        clearSupplementFields();
        setPendingSupplementCommand(null);
        try {
          await StorageService.clearPendingSupplement(data.id);
        } catch {
          // Keep the successful screen flow usable if local cleanup temporarily fails.
        }
      }

      // Upload each media file separately so successful files do not need to be retried.
      for (const image of images) {
        const uri = image.uri;
        const fileName = image.fileName || uri.split('/').pop() || 'evidence.jpg';
        const type = getSupportedEvidenceMimeType(image);
        if (!type) {
          throw new Error('UNSUPPORTED_EVIDENCE_TYPE');
        }
        if (image.fileSize !== undefined && image.fileSize > getEvidenceSizeLimitBytes(type)) {
          throw new Error('EVIDENCE_FILE_TOO_LARGE');
        }
        const key = `${data.id}:${uri}`;
        let idempotencyKey = evidenceIdempotencyKeys.current.get(key);
        if (!idempotencyKey) {
          idempotencyKey = generateUUID();
          evidenceIdempotencyKeys.current.set(key, idempotencyKey);
        }

        try {
          const evidence = await ResponseApi.uploadEvidence(
            data.id,
            { uri, name: fileName, type },
            trackingCode,
            idempotencyKey
          );
          try {
            await StorageService.saveRequestEvidence(data.id, evidence);
          } catch {
            // The upload succeeded; keep the current screen usable if local caching fails.
          }
          setUploadedEvidence((current) => [
            evidence,
            ...current.filter((item) => item.id !== evidence.id),
          ].slice(0, MAX_EVIDENCE_FILES_PER_REQUEST));
        } catch (uploadError) {
          if (isApiErrorCode(uploadError, 'STORAGE_UNAVAILABLE')) {
            // The backend records this attachment as FAILED; retry it with a fresh key.
            evidenceIdempotencyKeys.current.delete(key);
          }
          throw uploadError;
        }

        evidenceIdempotencyKeys.current.delete(key);
        uploadedCount += 1;
        setSelectedImages((current) => current.filter((asset) => asset.uri !== uri));
      }

      await fetchTrackingData();
      setShowSupplementModal(false);
      const evidenceMessage = images.length > 0
        ? `Đã tải lên ${uploadedCount} tệp bằng chứng hiện trường.`
        : '';
      const successMessage = updateSent && evidenceMessage
        ? `Đã gửi thông tin cập nhật. ${evidenceMessage}`
        : updateSent
          ? 'Đã gửi thông tin cập nhật hiện trường.'
          : evidenceMessage;
      Alert.alert('Thành công', successMessage);
    } catch (err: any) {
      const serverFieldErrors = getApiFieldErrors(err, REPORTER_UPDATE_FIELD_ALIASES);
      const serverFieldMessage = serverFieldErrors.supplementError;
      if (serverFieldMessage) setSupplementError(serverFieldMessage);

      if (isApiErrorCode(err, 'VERSION_CONFLICT', 'VALIDATION_FAILED')) {
        try {
          await StorageService.clearPendingSupplement(data.id);
          setPendingSupplementCommand(null);
        } catch {
          // The state changes only after local cleanup succeeds.
        }
        if (isApiErrorCode(err, 'VERSION_CONFLICT')) await fetchTrackingData();
      }
      const localMessage = err instanceof Error && err.message === 'PENDING_SUPPLEMENT_MUST_BE_RESUMED'
        ? 'Có thông tin cập nhật trước đang chờ xác nhận. Hãy mở lại phần bổ sung và gửi nội dung đã lưu.'
        : err instanceof Error && err.message === 'UNSUPPORTED_EVIDENCE_TYPE'
            ? 'Định dạng tệp chưa được hỗ trợ. Vui lòng chọn ảnh JPEG, PNG hoặc video MP4.'
          : err instanceof Error && err.message === 'EVIDENCE_FILE_TOO_LARGE'
            ? 'Tệp vượt giới hạn tải lên: ảnh tối đa 10 MB, video MP4 tối đa 50 MB.'
            : isApiErrorCode(err, 'EVIDENCE_LIMIT_REACHED')
              ? `Hồ sơ đã đạt giới hạn ${MAX_EVIDENCE_FILES_PER_REQUEST} tệp bằng chứng.`
            : null;
      const failureMessage = localMessage || serverFieldMessage || getApiErrorMessage(err, 'Không thể gửi bổ sung thông tin.');
      if (updateSent || uploadedCount > 0) {
        await fetchTrackingData();
        const pendingCount = images.length - uploadedCount;
        const sentMessage = uploadedCount > 0
          ? `Đã tải lên ${uploadedCount}/${images.length} tệp. `
          : '';
        const pendingMessage = pendingCount > 0
          ? `${pendingCount} tệp chưa gửi vẫn được giữ để bạn thử lại.`
          : 'Các tệp đã tải lên thành công.';
        Alert.alert(
          updateSent ? 'Thông tin cập nhật đã được gửi' : 'Đã tải một phần bằng chứng',
          `${updateSent ? 'Thông tin cập nhật đã được gửi. ' : ''}${sentMessage}${pendingMessage} ${failureMessage}`
        );
      } else if (!serverFieldMessage) {
        const retainedMessage = images.length > 0 ? ' Tệp đã chọn vẫn được giữ để bạn thử lại.' : '';
        Alert.alert('Lỗi', `${failureMessage}${retainedMessage}`);
      }
    } finally {
      setIsSubmittingSupplement(false);
    }
  };

  const handleRecoverSubmit = async () => {
    const code = recoveryTrackingCode.trim().toUpperCase();
    const token = recoveryCode.trim();
    const errors: Record<string, string> = {};
    if (!code) errors.trackingCode = 'Vui lòng nhập mã tra cứu.';
    else if (!isValidTrackingCode(code)) errors.trackingCode = 'Mã tra cứu phải gồm từ 10 đến 16 ký tự hợp lệ.';
    if (!token) errors.recoveryCode = 'Vui lòng nhập mã gắn tài khoản.';
    else if (!isValidTrackingSecret(token)) errors.recoveryCode = 'Mã gắn tài khoản phải gồm đúng 43 ký tự hợp lệ.';
    setRecoveryErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    if (!isAuthenticated) {
      Alert.alert(
        'Yêu cầu đăng nhập',
        'Bạn cần đăng nhập trước khi gắn hồ sơ SOS vào tài khoản cá nhân.',
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Đăng nhập', onPress: () => router.push('/login') },
        ]
      );
      return;
    }

    setIsRecovering(true);
    try {
      const result = await ResponseApi.recoverRequest(code, token);
      try {
        await StorageService.deleteLegacyGuestTrackingSecret(result.tracking_code || code);
      } catch {
        // Recovery succeeded; a local cleanup failure must not change that result.
      }
      setShowRecoveryModal(false);
      setRecoveryCode('');
      setTrackingCode(result.tracking_code || code);
      Alert.alert('Thành công', 'Hồ sơ SOS đã được gắn vào tài khoản của bạn.');
      await fetchTrackingData(result.tracking_code || code);
    } catch (err: any) {
      Alert.alert('Không thể gắn hồ sơ SOS', getApiErrorMessage(err, 'Mã gắn tài khoản không hợp lệ hoặc đã hết hiệu lực.'));
    } finally {
      setIsRecovering(false);
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

  const isReportEditable = Boolean(
    (data?.status && isUnverifiedRequestStatus(data.status)) || pendingSupplementCommand?.kind === 'REPORT_UPDATE'
  );
  const supplementalPeopleCount = supplementPeopleAffected.trim() ? Number(supplementPeopleAffected) : undefined;
  const supplementalChildrenCount = supplementChildrenCount.trim() ? Number(supplementChildrenCount) : undefined;
  const supplementalElderlyCount = supplementElderlyCount.trim() ? Number(supplementElderlyCount) : undefined;
  const hasStructuredUpdate = Boolean(
    pendingSupplementCommand || householdReferenceNote.trim() || supplementalPeopleCount !== undefined || supplementLocation ||
    dangerChoice !== 'UNCHANGED' || (isReportEditable && (
      supplementalChildrenCount !== undefined || supplementalElderlyCount !== undefined ||
      needsRescueChoice !== 'UNCHANGED' || needsReliefChoice !== 'UNCHANGED'
    ))
  );
  const lookupDisabled = loading || trackingCode.length > TRACKING_CODE_MAX_LENGTH || !isValidTrackingCode(trackingCode);
  const supplementSubmitDisabled = isSubmittingSupplement ||
    (!supplementNote.trim() && !hasStructuredUpdate && selectedImages.length === 0);
  const recoverySubmitDisabled = isRecovering || recoveryTrackingCode.length > TRACKING_CODE_MAX_LENGTH || recoveryCode.length > 43 ||
    !isValidTrackingCode(recoveryTrackingCode) || !isValidTrackingSecret(recoveryCode);
  const renderChoiceSwitch = (
    fieldLabel: string,
    value: OptionalBooleanChoice,
    onChange: (next: OptionalBooleanChoice) => void,
    Icon: typeof AlertCircle,
    iconColor: string,
    emergencySwitch = false,
  ) => (
    <View style={styles.dangerToggleRow}>
      <View style={styles.dangerLabelBox}>
        <Icon size={20} color={iconColor} />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.dangerTitle}>{fieldLabel}</Text>
        </View>
      </View>
      <Switch
        value={value === 'YES'}
        onValueChange={(enabled) => onChange(enabled ? 'YES' : 'NO')}
        disabled={isSubmittingSupplement || Boolean(pendingSupplementCommand)}
        trackColor={emergencySwitch ? { false: '#CBD5E1', true: THEME.colors.emergency.light } : undefined}
        thumbColor={emergencySwitch ? (value === 'YES' ? THEME.colors.emergency.main : '#FFFFFF') : undefined}
        accessibilityLabel={fieldLabel}
        accessibilityState={{ checked: value === 'YES', disabled: isSubmittingSupplement || Boolean(pendingSupplementCommand) }}
        accessibilityHint="Không chạm vào để giữ nguyên dữ kiện. Bật để chọn Có; tắt để chọn Không."
      />
    </View>
  );

  return (
    <ScreenContainer
      title="Tiến Độ Cứu Hộ"
      subtitle={data ? `Mã: ${data.tracking_code}` : 'Tra cứu bằng mã SOS hoặc số điện thoại'}
      onBack={() => goBackOrHome(router)}
      headerRight={
        <TouchableOpacity onPress={() => void fetchTrackingData()} style={styles.refreshBtn}>
          <RefreshCw size={20} color={THEME.colors.primary.main} />
        </TouchableOpacity>
      }
    >
      {!data && !loading ? (
        <View style={styles.lookupCard}>
          <Text style={styles.lookupTitle}>Tra cứu yêu cầu cứu trợ</Text>
          {!isAuthenticated ? (
            <View style={styles.lookupNotice}>
              <Text style={styles.lookupNoticeText}>
                Nhập mã SOS bạn nhận được khi gửi yêu cầu để xem tiến độ.
              </Text>
            </View>
          ) : null}
          <CompactTextInput
            label="Mã tra cứu"
            required
            style={styles.lookupInput}
            placeholder="Nhập mã SOS đã nhận"
            placeholderTextColor={THEME.colors.text.muted}
            value={trackingCode}
            onChangeText={(value) => {
              const normalized = value.toUpperCase();
              setTrackingCode(normalized);
              setTrackingCodeError(!normalized.trim() ? undefined : getTrackingCodeError(normalized));
              setErrorMsg(null);
            }}
            onBlur={async () => {
              const value = trackingCode.trim();
              if (!value) {
                setTrackingCodeError('Mã tra cứu là bắt buộc.');
              } else if (!isValidTrackingCode(value)) {
                setTrackingCodeError(getTrackingCodeError(value));
              } else {
                setTrackingCodeError(undefined);
              }
            }}
            keyboardType="default"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={TRACKING_CODE_MAX_LENGTH + 1}
          />
          <FormFieldError message={trackingCodeError} />
          <FormFieldError message={errorMsg ?? undefined} />
          <TouchableOpacity
            style={[styles.retryBtn, lookupDisabled && { opacity: 0.5 }]}
            onPress={() => void fetchTrackingData()}
            disabled={lookupDisabled}
          >
            <Text style={styles.retryBtnText}>Tra cứu</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.recoveryLinkBtn}
            onPress={() => {
              setRecoveryTrackingCode(trackingCode);
              setShowRecoveryModal(true);
            }}
          >
            <KeyRound size={16} color={THEME.colors.primary.main} style={{ marginRight: 6 }} />
            <Text style={styles.recoveryLinkText}>Gắn hồ sơ SOS vào tài khoản</Text>
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
          <TouchableOpacity style={styles.retryBtn} onPress={() => void fetchTrackingData()}>
            <Text style={styles.retryBtnText}>Thử lại</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.recoveryLinkBtn, { marginTop: 12 }]}
            onPress={() => {
              setRecoveryTrackingCode(trackingCode);
              setShowRecoveryModal(true);
            }}
          >
            <KeyRound size={16} color={THEME.colors.primary.main} style={{ marginRight: 6 }} />
            <Text style={styles.recoveryLinkText}>Gắn hồ sơ SOS vào tài khoản</Text>
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

            {eventsMore && (
              <TouchableOpacity
                style={styles.olderEventsButton}
                onPress={loadOlderEvents}
                disabled={loadingOlderEvents}
                activeOpacity={0.8}
              >
                {loadingOlderEvents
                  ? <ActivityIndicator size="small" color={THEME.colors.primary.main} />
                  : <Text style={styles.olderEventsButtonText}>Xem các cập nhật trước đó</Text>}
              </TouchableOpacity>
            )}

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
                {uploadedEvidence.map((evidence) => {
                  const isVideo = evidence.detected_mime === 'video/mp4';
                  const isOpening = openingEvidenceId === evidence.id;
                  return (
                    <TouchableOpacity
                      key={evidence.id}
                      style={styles.uploadedEvidenceRow}
                      onPress={() => void openUploadedEvidence(evidence)}
                      disabled={openingEvidenceId !== null}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Mở ${isVideo ? 'video' : 'ảnh'} bằng chứng đã tải lên`}
                    >
                      {isOpening ? (
                        <ActivityIndicator size="small" color={THEME.colors.primary.main} />
                      ) : isVideo ? (
                        <Video size={20} color={THEME.colors.primary.main} />
                      ) : (
                        <ImageIcon size={20} color={THEME.colors.primary.main} />
                      )}
                      <View style={styles.uploadedEvidenceTextBlock}>
                        <Text style={styles.uploadedEvidenceTitle}>
                          {isVideo ? 'Video MP4 hiện trường' : 'Ảnh hiện trường'}
                        </Text>
                        <Text style={styles.uploadedEvidenceMeta}>
                          {new Date(evidence.created_at).toLocaleString('vi-VN')} · {(evidence.size_bytes / (1024 * 1024)).toFixed(1)} MB
                        </Text>
                      </View>
                      <Text style={styles.uploadedEvidenceAction}>Mở</Text>
                    </TouchableOpacity>
                  );
                })}
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
      <Modal
        visible={showSupplementModal}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowSupplementModal(false)}
      >
        <ScreenContainer
          title="Bổ sung hiện trường"
          subtitle={
            isReportEditable
              ? 'Chỉ nhập mục cần thay đổi; phần để trống sẽ được giữ nguyên.'
              : 'Điều phối viên sẽ rà soát thông tin mới; phần để trống sẽ được giữ nguyên.'
          }
          onBack={() => setShowSupplementModal(false)}
          scrollable={false}
        >
          <View style={styles.supplementPage}>
            <ScrollView
              style={styles.supplementFormScroll}
              contentContainerStyle={styles.supplementFormContent}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.formCard}>
                <View style={styles.supplementCardHeader}>
                  <Text style={styles.supplementCardTitle}>DIỄN BIẾN HIỆN TRƯỜNG</Text>
                </View>
                <CompactTextInput
                  label="Mô tả tình hình mới"
                  containerStyle={styles.formField}
                  style={styles.supplementNoteInput}
                  placeholder="Ví dụ: Nước đã dâng thêm 30 cm, pin sắp hết..."
                  placeholderTextColor={THEME.colors.text.muted}
                  value={supplementNote}
                  onChangeText={(value) => {
                    setSupplementNote(value);
                    setSupplementError(value.length > 2000
                      ? 'Ghi chú không được vượt quá 2.000 ký tự.'
                      : undefined);
                  }}
                  onBlur={() => {
                    if (supplementNote.length > 2000) setSupplementError('Ghi chú không được vượt quá 2.000 ký tự.');
                  }}
                  multiline
                  numberOfLines={4}
                  maxLength={2001}
                  editable={!isSubmittingSupplement && !pendingSupplementCommand}
                />
              </View>

              <View style={styles.formCard}>
                <View style={styles.supplementCardHeader}>
                  <Users size={18} color={THEME.colors.text.secondary} />
                  <Text style={styles.supplementCardTitle}>SỐ NGƯỜI CẦN HỖ TRỢ</Text>
                </View>
                <View style={styles.formField}>
                  <CompactTextInput
                    label="Tổng số người"
                    style={styles.supplementModalInputSingle}
                    placeholder="Nhập nếu cần cập nhật"
                    placeholderTextColor={THEME.colors.text.muted}
                    value={supplementPeopleAffected}
                    onChangeText={setSupplementPeopleAffected}
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!isSubmittingSupplement && !pendingSupplementCommand}
                  />
                </View>
                {isReportEditable ? (
                  <>
                    <View style={styles.vulnerableCountGrid}>
                      <CompactTextInput
                        label="Trẻ em"
                        containerStyle={styles.vulnerableCountField}
                        style={styles.supplementModalInputSingle}
                        placeholder="Cập nhật số lượng"
                        placeholderTextColor={THEME.colors.text.muted}
                        value={supplementChildrenCount}
                        onChangeText={setSupplementChildrenCount}
                        keyboardType="number-pad"
                        maxLength={6}
                        editable={!isSubmittingSupplement && !pendingSupplementCommand}
                      />
                      <CompactTextInput
                        label="Người cao tuổi"
                        containerStyle={styles.vulnerableCountField}
                        style={styles.supplementModalInputSingle}
                        placeholder="Cập nhật số lượng"
                        placeholderTextColor={THEME.colors.text.muted}
                        value={supplementElderlyCount}
                        onChangeText={setSupplementElderlyCount}
                        keyboardType="number-pad"
                        maxLength={6}
                        editable={!isSubmittingSupplement && !pendingSupplementCommand}
                      />
                    </View>
                    {renderChoiceSwitch(
                      'Cần đội cứu hộ',
                      needsRescueChoice,
                      setNeedsRescueChoice,
                      AlertTriangle,
                      THEME.colors.emergency.main,
                    )}
                    {renderChoiceSwitch(
                      'Cần hàng cứu trợ',
                      needsReliefChoice,
                      setNeedsReliefChoice,
                      AlertCircle,
                      THEME.colors.primary.main,
                    )}
                  </>
                ) : null}
                {renderChoiceSwitch(
                  'Nguy cơ đe dọa tính mạng',
                  dangerChoice,
                  setDangerChoice,
                  AlertTriangle,
                  THEME.colors.emergency.main,
                  true,
                )}
              </View>

              <View style={styles.formCard}>
                <View style={styles.supplementCardHeader}>
                  <MapPin size={18} color={THEME.colors.text.secondary} />
                  <Text style={styles.supplementCardTitle}>VỊ TRÍ HIỆN TRƯỜNG</Text>
                </View>
                <CompactTextInput
                  label="Dấu mốc nhận diện hộ gia đình"
                  containerStyle={styles.formField}
                  style={styles.supplementModalInputSingle}
                  placeholder="Ví dụ: cổng xanh cạnh trạm y tế, lối vào phía đông"
                  placeholderTextColor={THEME.colors.text.muted}
                  value={householdReferenceNote}
                  onChangeText={(value) => {
                    setHouseholdReferenceNote(value);
                    setSupplementError(value.length > 500
                      ? 'Ghi chú nhận diện hộ gia đình không được vượt quá 500 ký tự.'
                      : undefined);
                  }}
                  maxLength={501}
                  editable={!isSubmittingSupplement && !pendingSupplementCommand}
                />
                <View style={styles.supplementLocationRow}>
                  <TouchableOpacity
                    style={[styles.pickImageBtn, styles.supplementLocationButton]}
                    onPress={() => {
                      setShowSupplementModal(false);
                      setShowSupplementLocationPicker(true);
                    }}
                    disabled={isSubmittingSupplement || Boolean(pendingSupplementCommand)}
                    accessibilityRole="button"
                    accessibilityLabel="Chọn vị trí hiện trường mới trên bản đồ"
                  >
                    <MapPin size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
                    <Text style={styles.pickImageText}>Cập nhật vị trí trên bản đồ</Text>
                  </TouchableOpacity>
                  {supplementLocation ? (
                    <TouchableOpacity
                      onPress={() => setSupplementLocation(null)}
                      disabled={isSubmittingSupplement || Boolean(pendingSupplementCommand)}
                      accessibilityRole="button"
                      accessibilityLabel="Bỏ vị trí thay đổi"
                    >
                      <Text style={styles.clearLocationText}>Bỏ thay đổi vị trí</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {supplementLocation ? (
                  <Text style={styles.supplementLocationText}>
                    Vị trí mới: {supplementLocation.coordinates[1].toFixed(5)}, {supplementLocation.coordinates[0].toFixed(5)}
                  </Text>
                ) : null}
              </View>

              <View style={styles.formCard}>
                <View style={styles.evidenceHeading}>
                  <View style={[styles.supplementCardHeader, styles.evidenceCardHeader]}>
                    <ImageIcon size={18} color={THEME.colors.text.secondary} />
                    <Text style={styles.supplementCardTitle}>ẢNH/VIDEO HIỆN TRƯỜNG</Text>
                  </View>
                  <Text style={styles.evidenceLimit}>{MAX_EVIDENCE_FILES_PER_REQUEST} tệp tối đa</Text>
                </View>
                <View style={styles.imageButtonRow}>
                  <TouchableOpacity
                    style={[
                      styles.pickImageBtn,
                      (isSubmittingSupplement || selectedImages.length >= MAX_EVIDENCE_FILES_PER_REQUEST) && styles.disabledButton,
                    ]}
                    onPress={pickImage}
                    activeOpacity={0.8}
                    disabled={isSubmittingSupplement || selectedImages.length >= MAX_EVIDENCE_FILES_PER_REQUEST}
                    accessibilityRole="button"
                    accessibilityLabel="Chọn ảnh hoặc video từ thư viện"
                  >
                    <ImageIcon size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
                    <Text style={styles.pickImageText}>Chọn ảnh/video</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pickImageBtn, isSubmittingSupplement && styles.disabledButton]}
                    onPress={takePhoto}
                    activeOpacity={0.8}
                    disabled={isSubmittingSupplement || selectedImages.length >= MAX_EVIDENCE_FILES_PER_REQUEST}
                    accessibilityRole="button"
                    accessibilityLabel="Chụp ảnh hiện trường"
                  >
                    <Camera size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
                    <Text style={styles.pickImageText}>Chụp ảnh mới</Text>
                  </TouchableOpacity>
                </View>

                {selectedImages.length > 0 && (
                  <>
                    <Text style={styles.selectedEvidenceCount}>
                      Đã chọn {selectedImages.length}/{MAX_EVIDENCE_FILES_PER_REQUEST} tệp
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.selectedEvidenceRow}
                      accessibilityLabel="Các tệp bằng chứng đã chọn"
                    >
                      {selectedImages.map((asset) => (
                        <View key={asset.uri} style={styles.previewContainer}>
                          {asset.type === 'video' ? (
                            <View style={styles.videoPreview}>
                              <Video size={28} color={THEME.colors.primary.main} />
                              <Text style={styles.videoPreviewText} numberOfLines={2}>
                                {asset.fileName || 'Video MP4 đã chọn'}
                              </Text>
                            </View>
                          ) : (
                            <Image source={{ uri: asset.uri }} style={styles.previewImage} />
                          )}
                          <TouchableOpacity
                            style={styles.removeImageBtn}
                            onPress={() => {
                              setSelectedImages((current) => current.filter((item) => item.uri !== asset.uri));
                              if (!supplementNote.trim() && selectedImages.length === 1) {
                                setSupplementError('Nhập thông tin cần cập nhật hoặc đính kèm ảnh/video hiện trường.');
                              }
                            }}
                            activeOpacity={0.8}
                            disabled={isSubmittingSupplement}
                            accessibilityRole="button"
                            accessibilityLabel={`Xóa ${asset.fileName || 'tệp đã chọn'}`}
                          >
                            <X size={14} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  </>
                )}
              </View>
            </ScrollView>

            <View style={styles.supplementFooter}>
              <View style={styles.supplementErrorContainer}>
                <FormFieldError message={supplementError} />
              </View>
              <View style={styles.supplementModalActions}>
                <TouchableOpacity
                  style={styles.supplementModalCancelBtn}
                  onPress={() => setShowSupplementModal(false)}
                  disabled={isSubmittingSupplement}
                >
                  <Text style={styles.supplementModalCancelText}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.supplementModalSubmitBtn, supplementSubmitDisabled && { opacity: 0.6 }]}
                  onPress={handleSupplementSubmit}
                  disabled={supplementSubmitDisabled}
                >
                  {isSubmittingSupplement ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.supplementModalSubmitText}>Gửi cập nhật</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScreenContainer>
      </Modal>

      <LocationPickerModal
        visible={showSupplementLocationPicker}
        initialCoordinates={supplementLocation?.coordinates}
        initialAddressNote={householdReferenceNote}
        title="Cập nhật vị trí hiện trường"
        confirmButtonText="Xác nhận vị trí mới"
        onClose={() => {
          setShowSupplementLocationPicker(false);
          setShowSupplementModal(true);
        }}
        onConfirm={(coordinates, addressNote) => {
          setSupplementLocation({
            type: 'Point',
            coordinates,
            source: 'MANUAL_PIN',
            captured_at: new Date().toISOString(),
          });
          if (addressNote !== undefined) setHouseholdReferenceNote(addressNote);
          setShowSupplementLocationPicker(false);
          setShowSupplementModal(true);
        }}
      />

      {/* MODAL KHÔI PHỤC MÃ TRA CỨU */}
      <Modal visible={showRecoveryModal} transparent={true} animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
          <ScrollView
            style={styles.modalContent}
            contentContainerStyle={styles.modalContentBody}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.modalTitle}>GẮN HỒ SƠ SOS VÀO TÀI KHOẢN</Text>
            <Text style={styles.modalSubtitle}>
              Chỉ dùng mã một lần do điều phối viên cấp sau khi xác minh liên hệ để gắn hồ sơ chưa thuộc tài khoản này. Bạn vẫn có thể tra cứu tiến độ bằng mã tra cứu thông thường.
            </Text>

            <CompactTextInput
              label="Mã hồ sơ cứu trợ"
              required
              style={styles.modalInputSingle}
              placeholder="Ví dụ: AB12CD34EF"
              placeholderTextColor={THEME.colors.text.muted}
              value={recoveryTrackingCode}
              onChangeText={(v) => {
                const normalized = v.toUpperCase();
                setRecoveryTrackingCode(normalized);
                setRecoveryErrors((current) => ({
                  ...current,
                  trackingCode: getTrackingCodeError(normalized, 'Mã tra cứu cứu trợ'),
                }));
              }}
              onBlur={() => {
                setRecoveryErrors((current) => ({
                  ...current,
                  trackingCode: !recoveryTrackingCode.trim()
                    ? 'Mã tra cứu cứu trợ là bắt buộc.'
                    : getTrackingCodeError(recoveryTrackingCode, 'Mã tra cứu cứu trợ'),
                }));
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={TRACKING_CODE_MAX_LENGTH + 1}
            />
            <FormFieldError message={recoveryErrors.trackingCode} />

            <CompactTextInput
              label="Mã gắn hồ sơ vào tài khoản"
              required
              style={styles.modalInputSingle}
              placeholder="Mã dùng một lần do điều phối viên cấp"
              placeholderTextColor={THEME.colors.text.muted}
              value={recoveryCode}
              onChangeText={(value) => {
                setRecoveryCode(value);
                setRecoveryErrors((current) => ({
                  ...current,
                  recoveryCode: getTrackingSecretError(value, 'Mã gắn tài khoản'),
                }));
              }}
              onBlur={() => {
                setRecoveryErrors((current) => ({
                  ...current,
                  recoveryCode: !recoveryCode.trim()
                    ? 'Mã gắn tài khoản là bắt buộc.'
                    : getTrackingSecretError(recoveryCode, 'Mã gắn tài khoản'),
                }));
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={44}
              secureTextEntry
            />
            <FormFieldError message={recoveryErrors.recoveryCode} />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowRecoveryModal(false)}
                disabled={recoverySubmitDisabled}
              >
                <Text style={styles.modalCancelText}>Hủy Bỏ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, recoverySubmitDisabled && { opacity: 0.6 }]}
                onPress={handleRecoverSubmit}
                disabled={isRecovering}
              >
                {isRecovering ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Xác nhận gắn SOS</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
  lookupNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  lookupNoticeText: {
    flex: 1,
    marginLeft: 8,
    fontSize: THEME.typography.fontSizes.xs,
    lineHeight: 18,
    color: THEME.colors.text.secondary,
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
  olderEventsButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.surface.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  olderEventsButtonText: {
    color: THEME.colors.primary.main,
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
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
    maxHeight: '92%',
  },
  modalContentBody: {
    padding: 20,
    paddingBottom: 28,
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
  supplementPage: {
    flex: 1,
  },
  supplementFormScroll: {
    flex: 1,
    minHeight: 0,
  },
  supplementFormContent: {
    paddingBottom: 16,
  },
  formCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  supplementCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  supplementCardTitle: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  formField: {
    marginTop: 10,
  },
  supplementNoteInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  modalInputSingle: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  supplementModalInputSingle: {
    width: '100%',
    minHeight: 56,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 12,
    backgroundColor: THEME.colors.surface.background,
    paddingHorizontal: 12,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
    color: THEME.colors.text.primary,
  },
  vulnerableCountGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  vulnerableCountField: {
    flex: 1,
    minWidth: 0,
  },
  peopleCountHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  peopleCountHeadingText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
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
  evidenceHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  evidenceCardHeader: {
    flex: 1,
    marginBottom: 0,
  },
  evidenceLimit: {
    marginLeft: 8,
    color: THEME.colors.text.muted,
    fontSize: THEME.typography.fontSizes.xs,
  },
  supplementLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  supplementLocationButton: {
    minHeight: 44,
  },
  clearLocationText: {
    color: THEME.colors.emergency.main,
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    paddingVertical: 8,
  },
  supplementLocationText: {
    marginTop: 4,
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  supplementFooter: {
    backgroundColor: THEME.colors.surface.background,
    paddingTop: 8,
  },
  supplementModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
  },
  supplementErrorContainer: {
    paddingHorizontal: 2,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
  },
  supplementModalCancelBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 12,
    backgroundColor: THEME.colors.surface.background,
  },
  modalCancelText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
    fontWeight: '600',
  },
  supplementModalCancelText: {
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
  supplementModalSubmitBtn: {
    flex: 1,
    minHeight: 52,
    backgroundColor: THEME.colors.emergency.main,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 14,
    ...THEME.shadows.emergency,
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
  },
  supplementModalSubmitText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
  },
  imageButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  pickImageText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },
  previewContainer: {
    marginTop: 10,
    marginRight: 8,
    position: 'relative',
    width: 80,
    height: 80,
  },
  selectedEvidenceCount: {
    marginTop: 8,
    fontSize: 12,
    color: THEME.colors.text.secondary,
    fontWeight: '600',
  },
  selectedEvidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
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
    gap: 8,
  },
  uploadedEvidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.primary.bg,
  },
  uploadedEvidenceTextBlock: {
    flex: 1,
  },
  uploadedEvidenceTitle: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  uploadedEvidenceMeta: {
    marginTop: 2,
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
  },
  uploadedEvidenceAction: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.primary.main,
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
  recoveryLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingVertical: 8,
  },
  recoveryLinkText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.primary.main,
    fontWeight: '600',
  },
});
