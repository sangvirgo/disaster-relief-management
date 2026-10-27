import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { RequiredAsterisk } from '../../../components/common/RequiredAsterisk';
import { CopyableInfoModal } from '../../../components/common/CopyableInfoModal';
import { LogisticsApi } from '../../../api/logisticsApi';
import {
  DonationDrive,
  DonationTrackingDetail,
  PublicDonationReportSummary,
} from '../../../types/api';
import { PendingDonationCommand, StorageService, generateUUID } from '../../../utils/secureStore';
import { getApiErrorMessage, isApiErrorCode } from '../../../api/client';
import { useAuthStore } from '../../../store/authStore';
import { THEME } from '../../../constants/theme';
import { getTrackingSecretError, isValidPhone, isValidTrackingSecret, normalizePhone } from '../../../utils/formValidation';
import {
  HeartHandshake,
  Package,
  MapPin,
  Plus,
  Search,
  Clock,
  FileCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Camera,
  Copy,
  ImageIcon,
  X,
  BookmarkCheck,
  MessageSquareWarning,
  BarChart3,
} from 'lucide-react-native';

const quantityError = (value: string): string | undefined => {
  const quantity = value.trim();
  if (value.length > 19) return 'Số lượng không được vượt quá 19 ký tự.';
  if (!quantity) return undefined;
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(quantity);
  if (!match || (match[1]?.length ?? 0) > 3 || quantity.split('.')[0]!.length > 15) {
    return 'Nhập số lượng không âm, tối đa 15 chữ số nguyên và 3 chữ số thập phân.';
  }
  return undefined;
};

const isPositiveQuantity = (value: string): boolean => {
  const quantity = value.trim();
  return !quantityError(quantity) && /[1-9]/.test(quantity.replace('.', ''));
};

const isDonationUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
const isPublicDonationCode = (value: string) => /^[0-9A-HJKMNP-TV-Z]{8,16}$/i.test(value.trim());
const isValidDonationQuery = (value: string) => isDonationUuid(value) || isPublicDonationCode(value);
const donationQueryError = (value: string) => {
  const query = value.trim();
  if (value.length > 36) return 'Mã tra cứu không được vượt quá 36 ký tự.';
  if (!query) return undefined;
  if (isDonationUuid(query)) return undefined;
  if (value.length > 16) return 'Mã biên nhận không được vượt quá 16 ký tự, hoặc hãy nhập mã UUID đầy đủ.';
  if (isPublicDonationCode(query)) return undefined;
  if (query.length < 8) return 'Mã biên nhận phải có ít nhất 8 ký tự, hoặc hãy nhập mã UUID đầy đủ.';
  return 'Mã biên nhận chứa ký tự không hợp lệ, hoặc hãy nhập mã UUID đầy đủ.';
};
const quantityFieldError = (value: string) => quantityError(value) ||
  (value.trim() && !isPositiveQuantity(value) ? 'Số lượng phải lớn hơn 0.' : undefined);

export const DonationScreen: React.FC = () => {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  // Tab: 'DRIVES' (Danh sách đợt quyên góp) | 'TRACKING' (Tra cứu biên nhận)
  const [activeTab, setActiveTab] = useState<'DRIVES' | 'TRACKING'>('DRIVES');

  // Dữ liệu đợt quyên góp
  const [drives, setDrives] = useState<DonationDrive[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [drivesError, setDrivesError] = useState<string | null>(null);
  const [driveCursor, setDriveCursor] = useState<string | undefined>();
  const [moreDrives, setMoreDrives] = useState<boolean>(false);
  const [loadingMoreDrives, setLoadingMoreDrives] = useState<boolean>(false);

  // Modal khai báo quyên góp
  const [selectedDrive, setSelectedDrive] = useState<DonationDrive | null>(null);
  const [donorName, setDonorName] = useState<string>('');
  const [donorPhone, setDonorPhone] = useState<string>('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [donationFormErrors, setDonationFormErrors] = useState<Record<string, string | undefined>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [donationPhoto, setDonationPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [pendingDonationCommand, setPendingDonationCommand] = useState<PendingDonationCommand | null>(null);
  const [submissionReceipt, setSubmissionReceipt] = useState<{
    id: string;
    publicCode: string;
    secret: string;
    description: string;
  } | null>(null);

  // Tra cứu & Thao tác biên nhận quyên góp
  const [searchCode, setSearchCode] = useState<string>('');
  const [donationTrackingSecret, setDonationTrackingSecret] = useState<string>('');
  const [donationRecoveryCode, setDonationRecoveryCode] = useState<string>('');
  const [recoveryIdempotencyKey, setRecoveryIdempotencyKey] = useState<string>(generateUUID);
  const [trackingLoading, setTrackingLoading] = useState<boolean>(false);
  const [trackingResult, setTrackingResult] = useState<DonationTrackingDetail | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingCodeError, setTrackingCodeError] = useState<string | undefined>();
  const [trackingSecretError, setTrackingSecretError] = useState<string | undefined>();
  const [donationRecoveryError, setDonationRecoveryError] = useState<string | undefined>();
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [trackingCapabilityAvailable, setTrackingCapabilityAvailable] = useState<boolean>(false);
  const [claimedDonationIds, setClaimedDonationIds] = useState<string[]>([]);

  // Khiếu nại kiểm đếm
  const [showDisputeModal, setShowDisputeModal] = useState<boolean>(false);
  const [disputeReason, setDisputeReason] = useState<string>('');
  const [disputeError, setDisputeError] = useState<string | undefined>();
  const [isSubmittingDispute, setIsSubmittingDispute] = useState<boolean>(false);

  // Báo cáo minh bạch quyên góp
  const [selectedReportDrive, setSelectedReportDrive] = useState<DonationDrive | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<PublicDonationReportSummary | null>(null);

  // Xem ảnh phóng to
  const [previewPhotoUri, setPreviewPhotoUri] = useState<string | null>(null);

  const [recentReceipts, setRecentReceipts] = useState<
    {
      id: string;
      public_code: string;
      drive_title?: string;
      created_at: string;
    }[]
  >([]);

  const fetchDrives = async (cursor?: string, append = false) => {
    setDrivesError(null);
    try {
      const page = await LogisticsApi.getPublicDonationDrives(50, cursor);
      setDrives((current) => append ? [...current, ...page.items] : page.items);
      setDriveCursor(page.cursor);
      setMoreDrives(page.more);
    } catch (error) {
      setDrivesError(getApiErrorMessage(error, 'Không thể tải các đợt tiếp nhận. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
      setLoadingMoreDrives(false);
    }
  };

  const loadRecentReceipts = async () => {
    const list = await StorageService.getSavedDonationReceipts();
    setRecentReceipts(list);
  };

  const getReceiptSecret = async (id: string, publicCode: string): Promise<string | undefined> => {
    return (await StorageService.getSecretForDonation(id))
      || (await StorageService.getSecretForDonation(publicCode))
      || undefined;
  };

  useEffect(() => {
    // Load drives and restore any command left pending by an interrupted submission.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDrives();
    loadRecentReceipts();
    StorageService.getPendingDonation().then(async (pending) => {
      if (!pending) return;
      setPendingDonationCommand(pending);
      setDonorName(pending.payload.donor_name);
      setDonorPhone(pending.payload.donor_phone);
      setQuantities(Object.fromEntries(pending.payload.lines.map((line) => [line.item_id, line.declared_quantity])));
      let knownDrive: DonationDrive | null = null;
      try {
        knownDrive = await LogisticsApi.getDonationDriveDetail(pending.driveId);
      } catch {
        // The pending command can still be retried with its original payload and key.
      }
      setSelectedDrive(knownDrive || { id: pending.driveId, title: pending.driveTitle, status: 'OPEN', items: [] });
    }).catch(() => Alert.alert('Không thể khôi phục lần khai báo', 'Không đọc được bản khai đang chờ trên thiết bị.'));
  }, []);

  const handleOpenDonateModal = (drive: DonationDrive) => {
    if (drive.campaign_status === 'PAUSED' || drive.campaign_status === 'CLOSED') {
      Alert.alert('Đợt tiếp nhận đã dừng', 'Đợt quyên góp này hiện không nhận khai báo bàn giao mới.');
      return;
    }
    setSelectedDrive(drive);
    setQuantities({});
    setDonationFormErrors({});
    setDonationPhoto(null);
  };

  const pickDonationPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setDonationPhoto(result.assets[0]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở thư viện ảnh.');
    }
  };

  const takeDonationPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Quyền máy ảnh', 'Vui lòng cấp quyền máy ảnh để chụp ảnh kiện hàng cứu trợ.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setDonationPhoto(result.assets[0]);
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể mở máy ảnh.');
    }
  };

  const handleQuantityChange = (itemId: string, text: string) => {
    const nextQuantities = { ...quantities, [itemId]: text };
    setQuantities((prev) => ({
      ...prev,
      [itemId]: text,
    }));
    setDonationFormErrors((current) => ({
      ...current,
      [itemId]: quantityFieldError(text),
      quantities: Object.values(nextQuantities).some(isPositiveQuantity) ? undefined : current.quantities,
    }));
  };

  const handleSubmitDeclaration = async () => {
    if (!selectedDrive && !pendingDonationCommand) return;
    if (selectedDrive && (selectedDrive.campaign_status === 'PAUSED' || selectedDrive.campaign_status === 'CLOSED')) {
      Alert.alert('Đợt tiếp nhận đã dừng', 'Đợt quyên góp này hiện không nhận khai báo bàn giao mới.');
      return;
    }
    const normalizedPhone = normalizePhone(donorPhone);
    const errors: Record<string, string> = {};
    if (!pendingDonationCommand && !donorName.trim()) errors.donorName = 'Vui lòng nhập họ tên người bàn giao.';
    else if (!pendingDonationCommand && donorName.trim().length > 200) errors.donorName = 'Họ tên không được vượt quá 200 ký tự.';
    if (!pendingDonationCommand && !normalizedPhone) errors.donorPhone = 'Vui lòng nhập số điện thoại người bàn giao.';
    else if (!pendingDonationCommand && !isValidPhone(donorPhone)) errors.donorPhone = 'Số điện thoại cần có 8–15 chữ số; có thể bắt đầu bằng dấu +.';

    if (!pendingDonationCommand) {
      Object.entries(quantities).forEach(([itemId, value]) => {
        const quantity = value.trim();
        if (!quantity) return;
        const error = quantityFieldError(quantity);
        if (error) errors[itemId] = error;
      });
    }

    const lines = Object.entries(quantities).flatMap(([itemId, value]) => {
      const quantity = value.trim();
      if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(quantity) || !/[1-9]/.test(quantity.replace('.', ''))) return [];
      return [{ item_id: itemId, declared_quantity: quantity }];
    });

    if (!pendingDonationCommand && lines.length === 0) {
      errors.quantities = 'Nhập số lượng lớn hơn 0 cho ít nhất một loại hiện vật.';
    }
    setDonationFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    let evidenceFailed = false;
    try {
      const payload = pendingDonationCommand?.payload || {
        donor_name: donorName.trim(),
        donor_phone: normalizedPhone,
        lines,
      };
      const command = pendingDonationCommand || await StorageService.getOrCreatePendingDonation(
        selectedDrive!.id,
        payload,
        selectedDrive!.title
      );
      setPendingDonationCommand(command);
      const res = await LogisticsApi.declareDonation(
        command.driveId,
        command.payload,
        command.donationSecret,
        command.idempotencyKey
      );

      // Tải ảnh kiện hàng lên MinIO nếu người hảo tâm đã chọn ảnh
      if (donationPhoto) {
        try {
          await LogisticsApi.uploadDonationEvidence(
            res.id,
            {
              uri: donationPhoto.uri,
              name: donationPhoto.fileName || `donation-${res.id}.jpg`,
              type: donationPhoto.mimeType || 'image/jpeg',
            },
            command.donationSecret
          );
        } catch {
          evidenceFailed = true;
        }
      }

      // Lưu biên nhận vào máy để tiện tra cứu
      await StorageService.saveDonationReceipt({
        id: res.id,
        public_code: res.public_code,
        secret: command.donationSecret,
        drive_title: command.driveTitle,
      });
      await StorageService.clearPendingDonation();
      setPendingDonationCommand(null);
      await loadRecentReceipts();

      setSelectedDrive(null);
      setDonorName('');
      setDonorPhone('');
      setDonationPhoto(null);
      setSubmissionReceipt({
        id: res.id,
        publicCode: res.public_code,
        secret: command.donationSecret,
        description: evidenceFailed
          ? 'Tờ khai đã được ghi nhận, nhưng ảnh minh chứng chưa tải lên. Vui lòng liên hệ kho tiếp nhận để gửi bổ sung.'
          : 'Thủ kho sẽ kiểm đếm độc lập khi nhận hàng.',
      });
    } catch (error: any) {
      Alert.alert('Lỗi', getApiErrorMessage(error, 'Không thể gửi khai báo. Bản khai và khóa lần gửi được giữ lại để thử lại an toàn.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Lưu biên nhận vào tài khoản đã đăng nhập
  const handleClaimDonation = async () => {
    if (!trackingResult) return;
    if (!trackingCapabilityAvailable) {
      Alert.alert('Cần khóa bí mật', 'Để liên kết biên nhận, hãy nhập khóa bí mật đã được cấp khi khai báo.');
      return;
    }
    setIsClaiming(true);
    try {
      let secret: string | undefined;
      const saved = recentReceipts.find(
        (r) => r.id === trackingResult.id || r.public_code === trackingResult.public_code
      );
      if (saved) secret = await getReceiptSecret(saved.id, saved.public_code);
      if (!secret) secret = await getReceiptSecret(trackingResult.id, trackingResult.public_code);

      await LogisticsApi.claimDonation(trackingResult.id, secret);
      setClaimedDonationIds((current) => current.includes(trackingResult.id) ? current : [...current, trackingResult.id]);
      Alert.alert('Thành công', 'Biên nhận cứu trợ đã được gắn vĩnh viễn vào tài khoản của bạn.');
    } catch (err: any) {
      if (isApiErrorCode(err, 'ALREADY_CLAIMED')) {
        setClaimedDonationIds((current) => current.includes(trackingResult.id) ? current : [...current, trackingResult.id]);
        Alert.alert('Đã liên kết', 'Biên nhận này đã được liên kết với một tài khoản.');
      } else {
        Alert.alert('Lỗi', getApiErrorMessage(err, 'Không thể lưu biên nhận vào tài khoản.'));
      }
    } finally {
      setIsClaiming(false);
    }
  };

  // Gửi khiếu nại kiểm đếm
  const handleOpenDisputeSubmit = async () => {
    const reason = disputeReason.trim();
    if (!trackingResult) return;
    if (!reason) {
      setDisputeError('Vui lòng nhập rõ lý do khiếu nại kiểm đếm.');
      return;
    }
    if (reason.length > 2000) {
      setDisputeError('Lý do khiếu nại không được vượt quá 2.000 ký tự.');
      return;
    }
    setDisputeError(undefined);
    setIsSubmittingDispute(true);
    try {
      let secret: string | undefined;
      const saved = recentReceipts.find(
        (r) => r.id === trackingResult.id || r.public_code === trackingResult.public_code
      );
      if (saved) secret = await getReceiptSecret(saved.id, saved.public_code);
      if (!secret) secret = await getReceiptSecret(trackingResult.id, trackingResult.public_code);

      await LogisticsApi.openDonationDispute(trackingResult.id, reason, secret);
      Alert.alert('Đã gửi khiếu nại', 'Khiếu nại kiểm đếm đã gửi đến quản lý kho để đối soát lại.');
      setShowDisputeModal(false);
      setDisputeReason('');
      handleTrackDonation(trackingResult.id, secret);
    } catch (err: any) {
      Alert.alert('Lỗi', getApiErrorMessage(err, 'Không thể gửi khiếu nại kiểm đếm.'));
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const handleTrackDonation = async (targetIdOrCode?: string, targetSecret?: string) => {
    const query = (targetIdOrCode || searchCode).trim();
    if (!query) {
      setTrackingError('Vui lòng nhập mã biên nhận hoặc mã nhận diện quyên góp.');
      return;
    }
    if (!isValidDonationQuery(query)) {
      setTrackingCodeError(donationQueryError(query) || 'Mã biên nhận chưa hợp lệ.');
      return;
    }
    setTrackingCodeError(undefined);

    const providedSecret = targetSecret || (
      query.toUpperCase() === searchCode.trim().toUpperCase()
        ? donationTrackingSecret.trim()
        : ''
    );
    if (providedSecret && !isValidTrackingSecret(providedSecret)) {
      setTrackingSecretError('Khóa bí mật phải gồm đúng 43 ký tự hợp lệ.');
      return;
    }
    setTrackingSecretError(undefined);

    setTrackingLoading(true);
    setTrackingError(null);
    setTrackingResult(null);
    setTrackingCapabilityAvailable(false);
    try {
      let resolvedId = query;
      let secret = providedSecret || undefined;

      // Tìm trong danh sách đã lưu nếu là public_code
      const saved = recentReceipts.find(
        (r) => r.public_code.toUpperCase() === query.toUpperCase() || r.id === query
      );
      if (saved) {
        resolvedId = saved.id;
        setSearchCode(saved.public_code);
        if (!secret) secret = await getReceiptSecret(saved.id, saved.public_code);
      } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query)) {
        throw new Error('DONATION_RECOVERY_REQUIRED');
      }

      if (!secret) {
        secret = await getReceiptSecret(resolvedId, query);
      }
      if (secret && !isValidTrackingSecret(secret)) {
        setTrackingError('Khóa bí mật phải gồm đúng 43 ký tự hợp lệ.');
        return;
      }

      const res = await LogisticsApi.trackDonation(resolvedId, secret);
      setTrackingResult(res);
      setTrackingCapabilityAvailable(Boolean(secret));
      setSearchCode(res.public_code || query);
      if (secret) {
        try {
          await StorageService.saveDonationReceipt({ id: res.id, public_code: res.public_code, secret });
          await loadRecentReceipts();
        } catch {
          // Keep the API result visible even if secure local persistence is unavailable.
        }
      }
    } catch (err: any) {
      setTrackingError(err?.message === 'DONATION_RECOVERY_REQUIRED'
        ? 'Mã công khai cần được liên kết bằng mã khôi phục do kho tiếp nhận cấp.'
        : getApiErrorMessage(err, 'Không tìm thấy biên nhận quyên góp. Vui lòng kiểm tra lại mã hoặc thử lại sau.'));
      setTrackingResult(null);
      setTrackingCapabilityAvailable(false);
    } finally {
      setTrackingLoading(false);
    }
  };

  const handleRecoverDonation = async () => {
    const publicCode = searchCode.trim().toUpperCase();
    if (!isPublicDonationCode(publicCode) || searchCode.length > 16) {
      setTrackingCodeError(searchCode.length > 16
        ? 'Mã biên nhận không được vượt quá 16 ký tự.'
        : 'Mã biên nhận phải gồm 8–16 ký tự hợp lệ.');
      return;
    }
    if (!donationRecoveryCode.trim()) {
      setDonationRecoveryError('Mã khôi phục là bắt buộc.');
      return;
    }
    if (!isValidTrackingSecret(donationRecoveryCode.trim())) {
      setDonationRecoveryError('Mã khôi phục phải gồm đúng 43 ký tự hợp lệ.');
      return;
    }
    setTrackingCodeError(undefined);
    setDonationRecoveryError(undefined);
    setTrackingLoading(true);
    setTrackingResult(null);
    setTrackingCapabilityAvailable(false);
    try {
      const recovered = await LogisticsApi.recoverDonation(publicCode, donationRecoveryCode.trim(), recoveryIdempotencyKey);
      const detail = await LogisticsApi.trackDonation(recovered.id);
      setTrackingError(null);
      setTrackingResult(detail);
      setTrackingCapabilityAvailable(false);
      setClaimedDonationIds((current) => current.includes(detail.id) ? current : [...current, detail.id]);
      setSearchCode(detail.public_code);
      setDonationRecoveryCode('');
      setRecoveryIdempotencyKey(generateUUID());
      await loadRecentReceipts();
    } catch (error) {
      setTrackingError(getApiErrorMessage(error, 'Không thể khôi phục biên nhận. Hãy kiểm tra mã hoặc liên hệ kho tiếp nhận.'));
    } finally {
      setTrackingLoading(false);
    }
  };

  const handleOpenReportModal = async (drive: DonationDrive) => {
    setSelectedReportDrive(drive);
    setReportLoading(true);
    setReportData(null);
    try {
      const rep = await LogisticsApi.getPublicDonationReportSummary({ drive_id: drive.id });
      setReportData(rep);
    } catch {
      Alert.alert('Báo cáo minh bạch', 'Chưa có dữ liệu báo cáo tổng hợp cho đợt quyên góp này.');
    } finally {
      setReportLoading(false);
    }
  };

  const formatNumberVN = (val: number | string | undefined | null): string => {
    if (val === undefined || val === null || val === '') return '0';
    const raw = String(val).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) return raw;
    const integer = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const fraction = match[2]?.replace(/0+$/, '');
    return fraction ? `${integer},${fraction}` : integer;
  };

  const copyDonationCode = async (code: string) => {
    try {
      await Clipboard.setStringAsync(code);
      Alert.alert('Đã sao chép', 'Mã biên nhận đã được sao chép vào bộ nhớ tạm.');
    } catch {
      Alert.alert('Không thể sao chép', 'Vui lòng thử lại.');
    }
  };

  const subtractQuantities = (targetValue: string, acceptedValue: string): string => {
    const target = /^(\d+)(?:\.(\d+))?$/.exec(targetValue);
    const accepted = /^(\d+)(?:\.(\d+))?$/.exec(acceptedValue);
    if (!target || !accepted) return '0';
    const scale = Math.max(target[2]?.length || 0, accepted[2]?.length || 0);
    const toScaled = (match: RegExpExecArray) => BigInt(`${match[1]}${(match[2] || '').padEnd(scale, '0')}`);
    const difference = toScaled(target) - toScaled(accepted);
    if (difference <= 0n) return '0';
    const digits = difference.toString().padStart(scale + 1, '0');
    if (scale === 0) return digits;
    const whole = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  };

  const compareQuantities = (leftValue: string, rightValue: string): number => {
    const left = /^(\d+)(?:\.(\d+))?$/.exec(leftValue);
    const right = /^(\d+)(?:\.(\d+))?$/.exec(rightValue);
    if (!left || !right) return 0;
    const scale = Math.max(left[2]?.length || 0, right[2]?.length || 0);
    const toScaled = (match: RegExpExecArray) => BigInt(`${match[1]}${(match[2] || '').padEnd(scale, '0')}`);
    const leftScaled = toScaled(left);
    const rightScaled = toScaled(right);
    return leftScaled > rightScaled ? 1 : leftScaled < rightScaled ? -1 : 0;
  };

  const percentageComplete = (acceptedValue: string, targetValue: string): number => {
    const accepted = /^(\d+)(?:\.(\d+))?$/.exec(acceptedValue);
    const target = /^(\d+)(?:\.(\d+))?$/.exec(targetValue);
    if (!accepted || !target) return 0;
    const scale = Math.max(accepted[2]?.length || 0, target[2]?.length || 0);
    const toScaled = (match: RegExpExecArray) => BigInt(`${match[1]}${(match[2] || '').padEnd(scale, '0')}`);
    const acceptedScaled = toScaled(accepted);
    const targetScaled = toScaled(target);
    if (targetScaled <= 0n) return 0;
    const percent = (acceptedScaled * 100n) / targetScaled;
    return Number(percent > 100n ? 100n : percent);
  };

  const canRecoverDonation = Boolean(
    isAuthenticated &&
    trackingError &&
    searchCode.trim() &&
    !isDonationUuid(searchCode)
  );
  const hasPositiveQuantity = Object.values(quantities).some(isPositiveQuantity);
  const hasInvalidQuantity = Object.values(quantities).some((value) => Boolean(quantityFieldError(value)));
  const declarationSubmitDisabled = isSubmitting || (!pendingDonationCommand && (
    !donorName.trim() || donorName.length > 200 || !normalizePhone(donorPhone) || !isValidPhone(donorPhone) || donorPhone.length > 32 ||
    !hasPositiveQuantity || hasInvalidQuantity
  ));
  const trackingLookupDisabled = trackingLoading || Boolean(donationQueryError(searchCode)) || !isValidDonationQuery(searchCode) ||
    donationTrackingSecret.length > 43 || (donationTrackingSecret.length > 0 && !isValidTrackingSecret(donationTrackingSecret));
  const recoverySubmitDisabled = trackingLoading || searchCode.length > 16 || donationRecoveryCode.length > 43 ||
    !isPublicDonationCode(searchCode) || !isValidTrackingSecret(donationRecoveryCode);
  const disputeSubmitDisabled = isSubmittingDispute || !disputeReason.trim() || disputeReason.length > 2000;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DECLARED':
        return { label: 'Đã khai báo bàn giao', color: '#0284C7', bg: '#E0F2FE' };
      case 'COUNTING':
        return { label: 'Thủ kho đang kiểm đếm', color: '#D97706', bg: '#FEF3C7' };
      case 'PENDING_REVIEW':
        return { label: 'Đang đối soát duyệt kho', color: '#7C3AED', bg: '#EDE9FE' };
      case 'APPROVED':
        return { label: 'Đã duyệt kiểm đếm', color: '#16A34A', bg: '#DCFCE7' };
      case 'POSTED':
        return { label: 'Đã nhập kho chính thức', color: '#059669', bg: '#D1FAE5' };
      default:
        return { label: 'Đang xử lý', color: THEME.colors.text.secondary, bg: '#F1F5F9' };
    }
  };

  const renderDriveItem = (item: DonationDrive) => {
    const canAcceptDonations = item.campaign_status !== 'PAUSED' && item.campaign_status !== 'CLOSED';
    return (
      <View key={item.id} style={styles.driveCard}>
        <View style={styles.driveHeader}>
          <HeartHandshake size={24} color={THEME.colors.primary.main} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.driveTitle}>{item.title}</Text>
            <Text style={styles.driveStatus}>
              {canAcceptDonations ? 'Đang tiếp nhận tại kho' : 'Đợt tiếp nhận đã tạm dừng'}
            </Text>
          </View>
        </View>

        {item.description ? <Text style={styles.driveDesc}>{item.description}</Text> : null}

        <View style={styles.driveMetaRow}>
          <MapPin size={16} color={THEME.colors.text.secondary} />
          <Text style={styles.driveMetaText}>
            Điểm tiếp nhận: {item.intake_location?.warehouse_name || item.intake_warehouse_name || 'Kho cứu trợ trung tâm'}
          </Text>
        </View>

        {/* Danh mục hàng cứu trợ đang cần & tiến độ tiếp nhận */}
        <View style={styles.itemsSection}>
          <Text style={styles.itemsHeader}>TIẾN ĐỘ TIẾP NHẬN NHU YẾU PHẨM:</Text>
          {item.items &&
            item.items.map((it) => {
              const target = it.target_quantity || '0';
              const accepted = it.accepted_total || '0';
              const remaining = subtractQuantities(target, accepted);
              const pct = percentageComplete(accepted, target);
              const unit = it.unit_name || 'đơn vị';
              const isFulfilled = compareQuantities(accepted, target) >= 0 && compareQuantities(target, '0') > 0;

              return (
                <View key={it.item_id} style={styles.itemProgressCard}>
                  <View style={styles.itemHeaderRow}>
                    <View style={styles.itemNameWrapper}>
                      <Package size={15} color={THEME.colors.primary.main} />
                      <Text style={styles.itemName} numberOfLines={1}>
                        {it.item_name || it.name}
                      </Text>
                    </View>
                    <View style={[styles.itemPctBadge, isFulfilled ? styles.itemPctBadgeSuccess : null]}>
                      <Text style={[styles.itemPctText, isFulfilled ? styles.itemPctTextSuccess : null]}>
                        {isFulfilled ? 'Đã đủ 100%' : `${pct}%`}
                      </Text>
                    </View>
                  </View>

                  {/* Thanh tiến độ */}
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${pct}%` },
                        isFulfilled ? styles.progressBarFillSuccess : null,
                      ]}
                    />
                  </View>

                  {/* 3 cột chi tiết: Mục tiêu - Đã quyên góp - Còn thiếu */}
                  <View style={styles.itemStatsRow}>
                    <View style={styles.itemStatCol}>
                      <Text style={styles.itemStatLabel}>Mục tiêu</Text>
                      <Text style={styles.itemStatValue}>
                        {formatNumberVN(target)} {unit}
                      </Text>
                    </View>

                    <View style={styles.itemStatCol}>
                      <Text style={styles.itemStatLabel}>Đã quyên góp</Text>
                      <Text style={[styles.itemStatValue, styles.itemStatAccepted]}>
                        {formatNumberVN(accepted)} {unit}
                      </Text>
                    </View>

                    <View style={styles.itemStatCol}>
                      <Text style={styles.itemStatLabel}>Còn thiếu</Text>
                      <Text
                        style={[
                          styles.itemStatValue,
                          compareQuantities(remaining, '0') > 0 ? styles.itemStatRemaining : styles.itemStatDone,
                        ]}
                      >
                        {compareQuantities(remaining, '0') > 0 ? `${formatNumberVN(remaining)} ${unit}` : 'Đã đủ'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
        </View>

        <View style={styles.driveActionRow}>
          <TouchableOpacity
            style={[styles.donateActionBtn, !canAcceptDonations && { opacity: 0.5 }]}
            onPress={() => handleOpenDonateModal(item)}
            disabled={!canAcceptDonations}
            activeOpacity={0.85}
          >
            <Plus size={18} color="#FFFFFF" />
            <Text style={styles.donateActionText}>Khai Báo Bàn Giao</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.transparencyActionBtn}
            onPress={() => handleOpenReportModal(item)}
            activeOpacity={0.85}
          >
            <BarChart3 size={17} color={THEME.colors.primary.main} />
            <Text style={styles.transparencyActionText}>Minh Bạch</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer
      title="Quyên Góp Cứu Trợ"
      subtitle="Ủng hộ hiện vật trực tiếp & minh bạch"
      onBack={() => goBackOrHome(router)}
    >
      {/* THANH ĐIỀU HƯỚNG TAB */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'DRIVES' && styles.tabButtonActive]}
          onPress={() => setActiveTab('DRIVES')}
          activeOpacity={0.8}
        >
          <HeartHandshake
            size={18}
            color={activeTab === 'DRIVES' ? THEME.colors.primary.main : THEME.colors.text.secondary}
          />
          <Text style={[styles.tabText, activeTab === 'DRIVES' && styles.tabTextActive]}>
            Đợt Quyên Góp
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'TRACKING' && styles.tabButtonActive]}
          onPress={() => setActiveTab('TRACKING')}
          activeOpacity={0.8}
        >
          <FileCheck
            size={18}
            color={activeTab === 'TRACKING' ? THEME.colors.primary.main : THEME.colors.text.secondary}
          />
          <Text style={[styles.tabText, activeTab === 'TRACKING' && styles.tabTextActive]}>
            Tra Cứu Biên Nhận
          </Text>
        </TouchableOpacity>
      </View>

      {/* NỘI DUNG TAB 1: DANH SÁCH ĐỢT TIẾP NHẬN */}
      {activeTab === 'DRIVES' ? (
        <View>
          <View style={styles.bannerBox}>
            <Text style={styles.bannerTitle}>TIẾP NHẬN HIỆN VẬT MINH BẠCH</Text>
            <Text style={styles.bannerDesc}>
              Hệ thống chỉ tiếp nhận nhu yếu phẩm hiện vật thực tế, kiểm đếm độc lập và không nhận quyên góp tiền mặt.
            </Text>
          </View>

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={THEME.colors.primary.main} />
              <Text style={styles.loadingText}>Đang tải các đợt quyên góp mở...</Text>
            </View>
          ) : drivesError ? (
            <View style={styles.emptyCard}>
              <AlertCircle size={40} color={THEME.colors.emergency.main} />
              <Text style={styles.emptyTitle}>Không thể tải các đợt tiếp nhận</Text>
              <Text style={styles.emptySubtitle}>{drivesError}</Text>
              <TouchableOpacity style={[styles.searchButton, { alignSelf: 'center', marginLeft: 0 }]} onPress={() => fetchDrives()}>
                <Text style={styles.searchButtonText}>Thử lại</Text>
              </TouchableOpacity>
            </View>
          ) : drives.length === 0 ? (
            <View style={styles.emptyCard}>
              <HeartHandshake size={48} color={THEME.colors.text.muted} />
              <Text style={styles.emptyTitle}>Chưa có đợt quyên góp nào</Text>
              <Text style={styles.emptySubtitle}>Các đợt kêu gọi cứu trợ mới sẽ được cập nhật tại đây.</Text>
            </View>
          ) : (
            <View>
              {drives.map((drive) => renderDriveItem(drive))}
              {moreDrives ? (
                <TouchableOpacity
                  style={[styles.searchButton, { alignSelf: 'center', marginLeft: 0, marginTop: 12 }]}
                  onPress={() => {
                    if (!driveCursor) return;
                    setLoadingMoreDrives(true);
                    fetchDrives(driveCursor, true);
                  }}
                  disabled={loadingMoreDrives || !driveCursor}
                >
                  {loadingMoreDrives ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.searchButtonText}>Tải thêm đợt tiếp nhận</Text>}
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      ) : (
        /* NỘI DUNG TAB 2: TRA CỨU BIÊN NHẬN QUYÊN GÓP */
        <View>
          {/* Ô TÌM KIẾM MÃ BIÊN NHẬN */}
          <View style={styles.searchCard}>
            <Text style={styles.searchTitle}>TRA CỨU TIẾN ĐỘ KIỂM ĐẾM TẠI KHO</Text>
            <Text style={styles.searchSubtitle}>
              Nhập mã định danh tra cứu; mã biên nhận đã lưu trên thiết bị cũng được chấp nhận:
            </Text>
            <Text style={styles.inputLabel}>Mã biên nhận hoặc mã định danh tra cứu <RequiredAsterisk /></Text>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Mã biên nhận hoặc mã định danh tra cứu"
                placeholderTextColor={THEME.colors.text.muted}
                value={searchCode}
                maxLength={37}
                onChangeText={(value) => {
                  setSearchCode(value);
                  setDonationTrackingSecret('');
                  setTrackingCodeError(donationQueryError(value));
                  setTrackingSecretError(undefined);
                  setDonationRecoveryError(undefined);
                  setTrackingResult(null);
                  setTrackingCapabilityAvailable(false);
                  setTrackingError(null);
                }}
                onBlur={() => {
                  setTrackingCodeError(!searchCode.trim()
                    ? 'Mã biên nhận hoặc mã định danh tra cứu là bắt buộc.'
                    : donationQueryError(searchCode));
                }}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[styles.searchButton, trackingLookupDisabled && { opacity: 0.5 }]}
                onPress={() => handleTrackDonation()}
                disabled={trackingLookupDisabled}
                activeOpacity={0.85}
              >
                {trackingLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Search size={16} color="#FFFFFF" />
                    <Text style={styles.searchButtonText}>Tra Cứu</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            <FormFieldError message={trackingCodeError} />
            <TextInput
              style={[styles.searchInput, styles.secretInput]}
              placeholder="Khóa bí mật (nếu bạn đã lưu)"
              placeholderTextColor={THEME.colors.text.muted}
              value={donationTrackingSecret}
              onChangeText={(value) => {
                setDonationTrackingSecret(value);
                setTrackingSecretError(getTrackingSecretError(value));
              }}
              onBlur={() => {
                setTrackingSecretError(getTrackingSecretError(donationTrackingSecret));
              }}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              maxLength={44}
            />
            <FormFieldError message={trackingSecretError} />
            {canRecoverDonation ? (
              <View style={styles.recoveryBox}>
                <Text style={styles.recoveryHint}>Để liên kết mã biên nhận công khai, cần mã khôi phục do kho tiếp nhận cấp.</Text>
                  <Text style={styles.inputLabel}>Mã khôi phục <RequiredAsterisk /></Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Mã khôi phục"
                  placeholderTextColor={THEME.colors.text.muted}
                  value={donationRecoveryCode}
                  onChangeText={(value) => {
                    setDonationRecoveryCode(value);
                    setDonationRecoveryError(getTrackingSecretError(value, 'Mã khôi phục'));
                  }}
                  onBlur={() => {
                    setDonationRecoveryError(!donationRecoveryCode.trim()
                      ? 'Mã khôi phục là bắt buộc.'
                      : getTrackingSecretError(donationRecoveryCode, 'Mã khôi phục'));
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={44}
                  secureTextEntry
                />
                <FormFieldError message={donationRecoveryError} />
                <TouchableOpacity
                  style={[styles.searchButton, { marginLeft: 0, marginTop: 8, alignSelf: 'flex-start' }, recoverySubmitDisabled && { opacity: 0.5 }]}
                  onPress={handleRecoverDonation}
                  disabled={recoverySubmitDisabled}
                >
                  {trackingLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.searchButtonText}>Khôi phục biên nhận</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
            <FormFieldError message={trackingError ?? undefined} />
          </View>

          {/* DANH SÁCH BIÊN NHẬN GẦN ĐÂY ĐÃ LƯU TRÊN THIẾT BỊ */}
          {recentReceipts.length > 0 && !trackingResult && (
            <View style={styles.recentSection}>
              <View style={styles.recentHeaderRow}>
                <Clock size={16} color={THEME.colors.text.secondary} />
                <Text style={styles.recentSectionTitle}>BIÊN NHẬN GẦN ĐÂY CỦA BẠN</Text>
              </View>
              {recentReceipts.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.recentCard}
                  onPress={() => handleTrackDonation(item.id)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recentCode}>{item.public_code}</Text>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {item.drive_title}
                    </Text>
                    <Text style={styles.recentDate}>
                      {new Date(item.created_at).toLocaleDateString('vi-VN')} {new Date(item.created_at).toLocaleTimeString('vi-VN')}
                    </Text>
                  </View>
                  <Search size={18} color={THEME.colors.primary.main} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* KẾT QUẢ TRA CỨU BIÊN NHẬN */}
          {trackingResult ? (
            <View style={styles.resultContainer}>
              <View style={styles.resultSummaryCard}>
                <View style={styles.resultSummaryHeader}>
                  <View>
                    <Text style={styles.resultCodeLabel}>MÃ BIÊN NHẬN BÀN GIAO</Text>
                    <Text style={styles.resultCodeValue}>{trackingResult.public_code}</Text>
                    <TouchableOpacity
                      style={styles.copyReceiptCodeBtn}
                      onPress={() => copyDonationCode(trackingResult.public_code)}
                      activeOpacity={0.75}
                    >
                      <Copy size={14} color={THEME.colors.primary.main} />
                      <Text style={styles.copyReceiptCodeText}>Sao chép mã</Text>
                    </TouchableOpacity>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusBadge(trackingResult.status).bg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        { color: getStatusBadge(trackingResult.status).color },
                      ]}
                    >
                      {getStatusBadge(trackingResult.status).label}
                    </Text>
                  </View>
                </View>

                {trackingResult.receipt?.count_revision ? (
                  <View style={styles.revisionNotice}>
                    <CheckCircle2 size={16} color={THEME.colors.success.main} />
                    <Text style={styles.revisionNoticeText}>
                      Đã qua đợt kiểm đếm thực tế lần {trackingResult.receipt.count_revision} của thủ kho.
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* BẢNG ĐỐI CHIẾU KIỂM ĐẾM CHI TIẾT */}
              <View style={styles.linesCard}>
                <Text style={styles.linesSectionTitle}>CHI TIẾT KIỂM ĐẾM TỪNG LOẠI HIỆN VẬT</Text>

                {trackingResult.receipt && trackingResult.receipt.lines && trackingResult.receipt.lines.length > 0 ? (
                  trackingResult.receipt.lines.map((line, idx) => {
                    // Tìm tên hiện vật từ declaration nếu receipt line thiếu
                    const matchDec = trackingResult.declaration?.lines?.find(
                      (d) => d.item_id === line.item_id
                    );
                    const itemName = line.item_name || matchDec?.item_name || 'Hiện vật cứu trợ';
                    const unitName = line.unit_name || matchDec?.unit_name || 'đơn vị';

                    return (
                      <View key={idx} style={styles.lineRow}>
                        <View style={styles.lineHeader}>
                          <Package size={16} color={THEME.colors.primary.main} />
                          <Text style={styles.lineItemName}>
                            {itemName} ({unitName})
                          </Text>
                        </View>

                        <View style={styles.lineStatsGrid}>
                          <View style={styles.lineStatItem}>
                            <Text style={styles.lineStatLabel}>Khai báo:</Text>
                            <Text style={styles.lineStatVal}>{formatNumberVN(line.declared_quantity)}</Text>
                          </View>
                          <View style={styles.lineStatItem}>
                            <Text style={styles.lineStatLabel}>Kiểm đếm:</Text>
                            <Text style={styles.lineStatVal}>
                              {line.counted_quantity != null ? formatNumberVN(line.counted_quantity) : '--'}
                            </Text>
                          </View>
                          <View style={styles.lineStatItem}>
                            <Text style={styles.lineStatLabel}>Nhập kho:</Text>
                            <Text style={[styles.lineStatVal, { color: THEME.colors.success.main }]}>
                              {line.accepted_quantity != null ? formatNumberVN(line.accepted_quantity) : '--'}
                            </Text>
                          </View>
                          {line.rejected_quantity != null && compareQuantities(String(line.rejected_quantity), '0') > 0 ? (
                            <View style={styles.lineStatItem}>
                              <Text style={styles.lineStatLabel}>Từ chối:</Text>
                              <Text style={[styles.lineStatVal, { color: THEME.colors.emergency.main }]}>
                                {formatNumberVN(line.rejected_quantity)}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        {line.condition_note ? (
                          <View style={styles.conditionNoteBox}>
                            <Text style={styles.conditionNoteText}>
                              Ghi chú tình trạng: {line.condition_note}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                ) : (
                  /* Chưa kiểm đếm: Hiển thị danh sách khai báo ban đầu */
                  trackingResult.declaration?.lines?.map((line, idx) => (
                    <View key={idx} style={styles.lineRow}>
                      <View style={styles.lineHeader}>
                        <Package size={16} color={THEME.colors.primary.main} />
                        <Text style={styles.lineItemName}>
                          {line.item_name || 'Hiện vật'} ({line.unit_name || 'đơn vị'})
                        </Text>
                      </View>
                      <View style={styles.lineStatsGrid}>
                        <View style={styles.lineStatItem}>
                          <Text style={styles.lineStatLabel}>Khai báo:</Text>
                          <Text style={styles.lineStatVal}>{formatNumberVN(line.declared_quantity)}</Text>
                        </View>
                        <View style={styles.lineStatItem}>
                          <Text style={styles.lineStatLabel}>Tình trạng:</Text>
                          <Text style={[styles.lineStatVal, { color: THEME.colors.text.secondary }]}>
                            Chờ mở hòm kiểm đếm
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* DANH SÁCH KHIẾU NẠI KIỂM ĐẾM (NẾU CÓ) */}
              {trackingResult.disputes && trackingResult.disputes.length > 0 && (
                <View style={styles.disputeSectionCard}>
                  <View style={styles.disputeHeaderRow}>
                    <MessageSquareWarning size={18} color={THEME.colors.warning.main} />
                    <Text style={styles.disputeSectionTitle}>KHIẾU NẠI KIỂM ĐẾM ({trackingResult.disputes.length})</Text>
                  </View>
                  {trackingResult.disputes.map((disp) => (
                    <View key={disp.id} style={styles.disputeItem}>
                      <View style={styles.disputeStatusRow}>
                        <Text style={styles.disputeDate}>
                          {new Date(disp.opened_at).toLocaleString('vi-VN')}
                        </Text>
                        <Text
                          style={[
                            styles.disputeStatusBadge,
                            { color: disp.status === 'RESOLVED' ? THEME.colors.success.main : THEME.colors.warning.main },
                          ]}
                        >
                          {disp.status === 'RESOLVED' ? 'Đã đối soát' : 'Đang xử lý'}
                        </Text>
                      </View>
                      <Text style={styles.disputeReasonText}>Lý do: {disp.reason}</Text>
                      {disp.resolution_note ? (
                        <Text style={styles.disputeResolutionText}>
                          Kết quả xử lý: {disp.resolution_note}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              {/* HÀNG NÚT THAO TÁC BIÊN NHẬN */}
              <View style={styles.actionButtonsCol}>
                {isAuthenticated && trackingCapabilityAvailable && !claimedDonationIds.includes(trackingResult.id) && (
                  <TouchableOpacity
                    style={styles.claimBtn}
                    onPress={handleClaimDonation}
                    disabled={isClaiming}
                    activeOpacity={0.8}
                  >
                    {isClaiming ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <BookmarkCheck size={18} color="#FFFFFF" />
                        <Text style={styles.claimBtnText}>Lưu Biên Nhận Vào Tài Khoản</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.disputeBtn}
                onPress={() => {
                  setDisputeError(undefined);
                  setShowDisputeModal(true);
                }}
                  activeOpacity={0.8}
                >
                  <MessageSquareWarning size={18} color={THEME.colors.warning.main} />
                  <Text style={styles.disputeBtnText}>Khiếu Nại Kiểm Đếm Thiếu / Sai</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.recheckBtn}
                  onPress={() => handleTrackDonation(trackingResult.id)}
                  activeOpacity={0.8}
                >
                  <RefreshCw size={16} color={THEME.colors.primary.main} />
                  <Text style={styles.recheckBtnText}>Cập Nhật Lại Tiến Độ</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      )}

      {/* MODAL KHAI BÁO BÀN GIAO */}
      <Modal visible={!!selectedDrive} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>KHAI BÁO HÀNG ĐÃ BÀN GIAO</Text>
            <Text style={styles.modalSubtitle}>
              Khai báo số lượng thực tế bạn mang đến kho để đối chiếu kiểm đếm:
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Họ và tên người quyên góp <RequiredAsterisk /></Text>
              <TextInput
                style={styles.textInput}
                placeholder="Nguyễn Văn A"
                placeholderTextColor={THEME.colors.text.muted}
                value={donorName}
                onChangeText={(value) => {
                  setDonorName(value);
                  setDonationFormErrors((current) => ({
                    ...current,
                    donorName: value.length > 200 ? 'Họ tên không được vượt quá 200 ký tự.' : undefined,
                  }));
                }}
                onBlur={() => {
                  setDonationFormErrors((current) => ({
                    ...current,
                    donorName: !donorName.trim()
                      ? 'Họ tên người quyên góp là bắt buộc.'
                      : donorName.length > 200
                        ? 'Họ tên không được vượt quá 200 ký tự.'
                        : undefined,
                  }));
                }}
                maxLength={201}
              />
              <FormFieldError message={donationFormErrors.donorName} />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Số điện thoại <RequiredAsterisk /></Text>
              <TextInput
                style={styles.textInput}
                placeholder="0912 345 678"
                placeholderTextColor={THEME.colors.text.muted}
                value={donorPhone}
                onChangeText={(value) => {
                  setDonorPhone(value);
                  setDonationFormErrors((current) => ({
                    ...current,
                    donorPhone: value.length > 32
                      ? 'Số điện thoại không được vượt quá 32 ký tự.'
                      : !normalizePhone(value)
                        ? undefined
                        : !isValidPhone(value)
                          ? 'Số điện thoại cần có 8–15 chữ số; có thể bắt đầu bằng dấu +.'
                          : undefined,
                  }));
                }}
                onBlur={() => {
                  if (donorPhone.length > 32) setDonationFormErrors((current) => ({ ...current, donorPhone: 'Số điện thoại không được vượt quá 32 ký tự.' }));
                  else if (!normalizePhone(donorPhone)) setDonationFormErrors((current) => ({ ...current, donorPhone: 'Số điện thoại là bắt buộc.' }));
                  else if (!isValidPhone(donorPhone)) setDonationFormErrors((current) => ({ ...current, donorPhone: 'Số điện thoại cần có 8–15 chữ số; có thể bắt đầu bằng dấu +.' }));
                  else setDonationFormErrors((current) => ({ ...current, donorPhone: undefined }));
                }}
                keyboardType="phone-pad"
                maxLength={33}
              />
              <FormFieldError message={donationFormErrors.donorPhone} />
            </View>

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Số lượng từng loại hiện vật (nhập ít nhất một mục) <RequiredAsterisk /></Text>
            {selectedDrive?.items &&
              selectedDrive.items.map((it) => {
                const target = it.target_quantity || '0';
                const accepted = it.accepted_total || '0';
                const remaining = subtractQuantities(target, accepted);
                const unit = it.unit_name || 'đơn vị';

                return (
                  <View key={it.item_id}>
                    <View style={styles.modalItemRow}>
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <Text style={styles.modalItemName}>
                          {it.item_name || it.name} ({unit})
                        </Text>
                        <Text style={styles.modalItemRemaining}>
                          {compareQuantities(remaining, '0') > 0
                            ? `Đang cần thêm: ${formatNumberVN(remaining)} ${unit}`
                            : `Đã đủ mục tiêu (${formatNumberVN(target)} ${unit})`}
                        </Text>
                      </View>
                      <TextInput
                        style={styles.modalItemInput}
                        placeholder="0"
                        placeholderTextColor={THEME.colors.text.muted}
                        keyboardType="numeric"
                        value={quantities[it.item_id] || ''}
                        onChangeText={(value) => handleQuantityChange(it.item_id, value)}
                        onBlur={() => {
                          const value = quantities[it.item_id] || '';
                          const error = quantityError(value);
                          const anyPositive = Object.values(quantities).some(isPositiveQuantity);
                          setDonationFormErrors((current) => ({
                            ...current,
                            [it.item_id]: error,
                            quantities: anyPositive ? undefined : 'Nhập số lượng lớn hơn 0 cho ít nhất một loại hiện vật.',
                          }));
                        }}
                        maxLength={20}
                      />
                    </View>
                    <FormFieldError message={donationFormErrors[it.item_id]} />
                  </View>
                );
              })}
            <FormFieldError message={donationFormErrors.quantities} />

            {/* ĐÍNH KÈM ẢNH KIỆN HÀNG */}
            <View style={styles.donationPhotoSection}>
              <Text style={styles.inputLabel}>Ảnh kiện hàng / biên lai thực tế (khuyến khích):</Text>
              {donationPhoto ? (
                <View style={styles.photoPreviewWrapper}>
                  <Image source={{ uri: donationPhoto.uri }} style={styles.photoPreview} />
                  <TouchableOpacity
                    style={styles.removePhotoBtn}
                    onPress={() => setDonationPhoto(null)}
                    activeOpacity={0.8}
                  >
                    <X size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.photoBtnRow}>
                  <TouchableOpacity style={styles.photoActionBtn} onPress={takeDonationPhoto} activeOpacity={0.8}>
                    <Camera size={16} color={THEME.colors.primary.main} />
                    <Text style={styles.photoActionBtnText}>Chụp Ảnh</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.photoActionBtn} onPress={pickDonationPhoto} activeOpacity={0.8}>
                    <ImageIcon size={16} color={THEME.colors.primary.main} />
                    <Text style={styles.photoActionBtnText}>Chọn Từ Máy</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setSelectedDrive(null);
                  setDonationPhoto(null);
                }}
              >
                <Text style={styles.modalCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, declarationSubmitDisabled && { opacity: 0.5 }]}
                onPress={handleSubmitDeclaration}
                disabled={declarationSubmitDisabled}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Gửi Khai Báo</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL MỞ KHIẾU NẠI KIỂM ĐẾM */}
      <Modal visible={showDisputeModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: THEME.colors.warning.main }]}>
              KHIẾU NẠI KIỂM ĐẾM HIỆN VẬT
            </Text>
            <Text style={styles.modalSubtitle}>
              Nêu rõ chi tiết sai lệch số lượng kiểm đếm hoặc lý do từ chối để ban quản lý kho rà soát camera và hồ sơ:
            </Text>

            <Text style={styles.inputLabel}>Lý do khiếu nại <RequiredAsterisk /></Text>

            <TextInput
              style={styles.disputeInput}
              placeholder="Ví dụ: Tôi đã giao 20 thùng mì Hảo Hảo nhưng biên nhận kiểm đếm ghi 15 thùng..."
              placeholderTextColor={THEME.colors.text.muted}
              value={disputeReason}
              onChangeText={(value) => {
                setDisputeReason(value);
                setDisputeError(value.length > 2000 ? 'Lý do khiếu nại không được vượt quá 2.000 ký tự.' : undefined);
              }}
              onBlur={() => {
                if (!disputeReason.trim()) setDisputeError('Lý do khiếu nại là bắt buộc.');
                else if (disputeReason.length > 2000) setDisputeError('Lý do khiếu nại không được vượt quá 2.000 ký tự.');
              }}
              multiline={true}
              numberOfLines={4}
              maxLength={2001}
            />
            <FormFieldError message={disputeError} />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowDisputeModal(false);
                  setDisputeReason('');
                  setDisputeError(undefined);
                }}
              >
                <Text style={styles.modalCancelText}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: THEME.colors.warning.main }, disputeSubmitDisabled && { opacity: 0.5 }]}
                onPress={handleOpenDisputeSubmit}
                disabled={disputeSubmitDisabled}
              >
                {isSubmittingDispute ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Gửi Khiếu Nại</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL BÁO CÁO MINH BẠCH QUYÊN GÓP */}
      <Modal visible={!!selectedReportDrive} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%' }]}>
            <View style={styles.reportModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>BÁO CÁO MINH BẠCH TIẾP NHẬN</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {selectedReportDrive?.title}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeIconBtn}
                onPress={() => setSelectedReportDrive(null)}
              >
                <X size={20} color={THEME.colors.text.secondary} />
              </TouchableOpacity>
            </View>

            {reportLoading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={THEME.colors.primary.main} />
                <Text style={{ marginTop: 10, fontSize: 12, color: THEME.colors.text.secondary }}>
                  Đang tải dữ liệu minh bạch từ hệ thống kho...
                </Text>
              </View>
            ) : reportData?.items && reportData.items.length > 0 ? (
              <View style={{ marginVertical: 10 }}>
                {reportData.items.map((it, idx) => (
                  <View key={idx} style={styles.reportItemCard}>
                    <View style={styles.reportItemHeader}>
                      <Package size={15} color={THEME.colors.primary.main} />
                      <Text style={styles.reportItemName}>
                        {it.item?.name || 'Nhu yếu phẩm'} ({it.unit?.display_name || it.unit?.code || 'đơn vị'})
                      </Text>
                    </View>
                    <View style={styles.reportStatsRow}>
                      <View style={styles.reportStatBox}>
                        <Text style={styles.reportStatLabel}>Đã tiếp nhận vào kho</Text>
                        <Text style={[styles.reportStatValue, { color: THEME.colors.success.main }]}>
                          {formatNumberVN(it.accepted)} {it.unit?.display_name || ''}
                        </Text>
                      </View>
                      <View style={styles.reportStatBox}>
                        <Text style={styles.reportStatLabel}>Đã phân phối cứu trợ</Text>
                        <Text style={[styles.reportStatValue, { color: THEME.colors.primary.main }]}>
                          {formatNumberVN(it.distributed)} {it.unit?.display_name || ''}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}

                <Text style={styles.reportGeneratedAt}>
                  Cập nhật lúc: {reportData.generated_at ? new Date(reportData.generated_at).toLocaleString('vi-VN') : ''}
                </Text>
              </View>
            ) : (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: THEME.colors.text.muted }}>
                  Chưa có số liệu tiếp nhận hoặc phân phối chính thức cho đợt này.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.modalSubmitBtn, { marginTop: 12 }]}
              onPress={() => setSelectedReportDrive(null)}
            >
              <Text style={styles.modalSubmitText}>Đã Hiểu & Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL XEM ẢNH PHÓNG TO */}
      <Modal visible={!!previewPhotoUri} transparent={true} animationType="fade">
        <View style={styles.imageViewerOverlay}>
          <TouchableOpacity
            style={styles.closeImageBtn}
            onPress={() => setPreviewPhotoUri(null)}
            activeOpacity={0.8}
          >
            <X size={26} color="#FFFFFF" />
          </TouchableOpacity>
          {previewPhotoUri && (
            <Image
              source={{ uri: previewPhotoUri }}
              style={styles.fullPreviewImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {submissionReceipt ? (
        <CopyableInfoModal
          visible
          title="Đã khai báo bàn giao thành công"
          description={submissionReceipt.description}
          helperText="Lưu mã định danh và khóa bí mật để tra cứu trên thiết bị khác."
          credentials={[
            { key: 'donation-public-code', label: 'Mã biên nhận', value: submissionReceipt.publicCode },
            { key: 'donation-id', label: 'Mã định danh tra cứu', value: submissionReceipt.id },
            { key: 'donation-secret', label: 'Khóa bí mật', value: submissionReceipt.secret, sensitive: true },
          ]}
          onClose={() => setSubmissionReceipt(null)}
          primaryAction={{
            label: 'Tra cứu tiến độ ngay',
            onPress: () => {
              const { id, secret } = submissionReceipt;
              setSubmissionReceipt(null);
              setActiveTab('TRACKING');
              handleTrackDonation(id, secret);
            },
          }}
        />
      ) : null}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: THEME.colors.primary.bg,
  },
  tabText: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
    marginLeft: 6,
  },
  tabTextActive: {
    color: THEME.colors.primary.main,
    fontWeight: '800',
  },
  bannerBox: {
    backgroundColor: THEME.colors.primary.bg,
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
  },
  bannerTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.primary.main,
    letterSpacing: 0.5,
  },
  bannerDesc: {
    fontSize: 12,
    color: THEME.colors.text.secondary,
    marginTop: 4,
    lineHeight: 18,
  },
  driveCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  driveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  driveTitle: {
    fontSize: THEME.typography.fontSizes.sm + 1,
    fontWeight: '800',
    color: THEME.colors.text.primary,
  },
  driveStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.success.main,
    marginTop: 2,
  },
  driveDesc: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginBottom: 10,
    lineHeight: 18,
  },
  driveMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  driveMetaText: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginLeft: 6,
  },
  itemsSection: {
    backgroundColor: THEME.colors.surface.background,
    padding: 12,
    borderRadius: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  itemsHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  itemProgressCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemNameWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  itemName: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginLeft: 6,
    flex: 1,
  },
  itemPctBadge: {
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
  },
  itemPctBadgeSuccess: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  itemPctText: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.primary.main,
  },
  itemPctTextSuccess: {
    color: '#16A34A',
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    marginVertical: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: THEME.colors.primary.main,
    borderRadius: 3,
  },
  progressBarFillSuccess: {
    backgroundColor: '#16A34A',
  },
  itemStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  itemStatCol: {
    flex: 1,
  },
  itemStatLabel: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    fontWeight: '600',
    marginBottom: 2,
  },
  itemStatValue: {
    fontSize: 11,
    color: THEME.colors.text.primary,
    fontWeight: '700',
  },
  itemStatAccepted: {
    color: '#16A34A',
  },
  itemStatRemaining: {
    color: THEME.colors.emergency.main,
  },
  itemStatDone: {
    color: THEME.colors.text.muted,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  itemQuantity: {
    fontSize: 11,
    color: THEME.colors.primary.main,
    fontWeight: '700',
  },
  driveActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  donateActionBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donateActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.xs + 1,
    marginLeft: 6,
  },
  transparencyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  transparencyActionText: {
    color: THEME.colors.primary.main,
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 4,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
    marginTop: 10,
  },
  emptyCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 30,
    alignItems: 'center',
    marginTop: 30,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  emptyTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 4,
  },
  searchCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  searchTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.text.primary,
  },
  searchSubtitle: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginTop: 2,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 44,
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  secretInput: {
    flex: 0,
    width: '100%',
    marginTop: 8,
  },
  recoveryBox: {
    backgroundColor: THEME.colors.primary.bg,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  recoveryHint: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
    marginBottom: 8,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.main,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginLeft: 8,
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    marginLeft: 4,
  },
  recentSection: {
    marginBottom: 16,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  recentSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.text.muted,
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  recentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  recentCode: {
    fontSize: 14,
    fontWeight: '900',
    color: THEME.colors.primary.main,
  },
  recentTitle: {
    fontSize: 12,
    color: THEME.colors.text.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  recentDate: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    marginTop: 2,
  },
  errorBox: {
    backgroundColor: THEME.colors.emergency.bg,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginVertical: 16,
  },
  errorText: {
    fontSize: 12,
    color: THEME.colors.emergency.main,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  resultContainer: {
    marginBottom: 24,
  },
  resultSummaryCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  resultSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultCodeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.text.muted,
    letterSpacing: 0.5,
  },
  resultCodeValue: {
    fontSize: THEME.typography.fontSizes.lg,
    fontWeight: '900',
    color: THEME.colors.primary.main,
    marginTop: 2,
  },
  copyReceiptCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  copyReceiptCodeText: {
    color: THEME.colors.primary.main,
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 5,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  revisionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
  },
  revisionNoticeText: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginLeft: 6,
  },
  linesCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  linesSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  lineRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  lineItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginLeft: 6,
  },
  lineStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginLeft: 22,
  },
  lineStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lineStatLabel: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginRight: 4,
  },
  lineStatVal: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.text.primary,
  },
  conditionNoteBox: {
    backgroundColor: '#FEF2F2',
    padding: 6,
    borderRadius: 6,
    marginTop: 6,
    marginLeft: 22,
  },
  conditionNoteText: {
    fontSize: 11,
    color: THEME.colors.emergency.dark,
    fontWeight: '600',
  },
  recheckBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.bg,
    height: 42,
    borderRadius: 10,
    marginTop: 12,
  },
  recheckBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginLeft: 6,
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
    maxHeight: '85%',
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
  inputGroup: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '600',
    color: THEME.colors.text.primary,
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  modalItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
  },
  modalItemName: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    color: THEME.colors.text.primary,
    fontWeight: '700',
  },
  modalItemRemaining: {
    fontSize: 11,
    color: THEME.colors.emergency.main,
    marginTop: 2,
    fontWeight: '600',
  },
  modalItemInput: {
    width: 90,
    height: 38,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    backgroundColor: THEME.colors.surface.background,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
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
  disputeSectionCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#FED7AA',
    ...THEME.shadows.sm,
  },
  disputeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  disputeSectionTitle: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '800',
    color: THEME.colors.warning.main,
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  disputeItem: {
    backgroundColor: '#FFFBEB',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  disputeStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  disputeDate: {
    fontSize: 10,
    color: THEME.colors.text.secondary,
  },
  disputeStatusBadge: {
    fontSize: 11,
    fontWeight: '800',
  },
  disputeReasonText: {
    fontSize: 12,
    color: THEME.colors.text.primary,
    lineHeight: 18,
  },
  disputeResolutionText: {
    fontSize: 11,
    color: THEME.colors.success.main,
    fontWeight: '600',
    marginTop: 4,
  },
  actionButtonsCol: {
    marginTop: 12,
    gap: 8,
  },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.main,
    height: 44,
    borderRadius: 10,
    ...THEME.shadows.sm,
  },
  claimBtnText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '800',
    marginLeft: 8,
  },
  disputeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FED7AA',
    height: 42,
    borderRadius: 10,
  },
  disputeBtnText: {
    color: THEME.colors.warning.main,
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '800',
    marginLeft: 8,
  },
  donationPhotoSection: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
  },
  photoBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  photoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    paddingVertical: 10,
    borderRadius: 8,
  },
  photoActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginLeft: 6,
  },
  photoPreviewWrapper: {
    position: 'relative',
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  photoPreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  removePhotoBtn: {
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
  disputeInput: {
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
  reviseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 8,
  },
  reviseBtnText: {
    color: THEME.colors.primary.main,
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 6,
  },
  reportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  closeIconBtn: {
    padding: 4,
  },
  reportItemCard: {
    backgroundColor: THEME.colors.surface.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  reportItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  reportItemName: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginLeft: 6,
  },
  reportStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  reportStatBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  reportStatLabel: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    marginBottom: 2,
  },
  reportStatValue: {
    fontSize: 11,
    fontWeight: '800',
  },
  reportGeneratedAt: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    textAlign: 'center',
    marginTop: 4,
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
