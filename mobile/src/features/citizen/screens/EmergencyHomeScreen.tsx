import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Modal, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { SOSButton } from '../../../components/common/SOSButton';
import { THEME } from '../../../constants/theme';
import { getTrackingCodeError, isValidTrackingCode } from '../../../utils/formValidation';
import { useAuthStore } from '../../../store/authStore';
import { ResponseApi } from '../../../api/responseApi';
import { NoticeItem } from '../../../types/api';
import { formatNoticeDisplay } from '../../../constants/labels';
import {
  PhoneCall,
  Search,
  Users,
  MapPin,
  HeartHandshake,
  ShieldAlert,
  ChevronRight,
  UserCheck,
  User,
  LogIn,
  LogOut,
  ShieldCheck,
  ClipboardList,
  Bell,
  AlertCircle,
  KeyRound,
  Flag,
} from 'lucide-react-native';

export const EmergencyHomeScreen: React.FC = () => {
  const router = useRouter();
  const [trackingCode, setTrackingCode] = useState('');
  const [trackingCodeError, setTrackingCodeError] = useState<string | undefined>();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);
  const { user, isAuthenticated, logout, getUserRoleName, isVolunteerOrLeader } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      ResponseApi.getNotices()
        .then((res) => {
          if (res?.items) {
            setNotices(res.items);
          }
        })
        .catch(() => {});
    }
  }, [isAuthenticated]);

  const handleOpenNotice = async (notice: NoticeItem) => {
    setSelectedNotice(notice);
    if (!notice.read_at) {
      try {
        await ResponseApi.markNoticeRead(notice.id);
        setNotices((prev) =>
          prev.map((n) => (n.id === notice.id ? { ...n, read_at: new Date().toISOString() } : n))
        );
      } catch {
        // bỏ qua lỗi nếu không đánh dấu được
      }
    }
  };

  const handleTrackSubmit = () => {
    const code = trackingCode.trim().toUpperCase();
    if (!code) {
      setTrackingCodeError('Vui lòng nhập mã tra cứu cứu trợ.');
      return;
    }
    if (!isValidTrackingCode(code)) {
      setTrackingCodeError('Mã tra cứu phải gồm đúng 10 ký tự hợp lệ.');
      return;
    }
    setTrackingCodeError(undefined);
    router.push({ pathname: '/tracking', params: { trackingCode: code } });
  };

  const handleLogout = () => {
    Alert.alert(
      'Xác nhận đăng xuất',
      'Bạn có chắc chắn muốn đăng xuất khỏi tài khoản trên thiết bị này?',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Đăng xuất',
          style: 'destructive',
          onPress: async () => {
            await logout();
            Alert.alert('Đã đăng xuất', 'Bạn đã đăng xuất tài khoản an toàn.');
          },
        },
      ]
    );
  };

  return (
    <ScreenContainer scrollable={true}>
      {/* Thương hiệu Cứu Trợ Reliva */}
      <View style={styles.brandHeader}>
        <Image
          source={require('../../../../assets/reliva-logo.png')}
          style={styles.brandLogo}
          resizeMode="contain"
        />
        <View style={styles.brandTextContainer}>
          <Text style={styles.brandName}>Reliva</Text>
          <Text style={styles.brandTagline}>CỨU HỘ & CỨU TRỢ THIÊN TAI</Text>
        </View>
      </View>

      {/* Cảnh báo đường dây nóng cứu trợ */}
      <View style={styles.emergencyBanner}>
        <View style={styles.bannerIcon}>
          <PhoneCall size={20} color={THEME.colors.emergency.main} />
        </View>
        <View style={styles.bannerTextContainer}>
          <Text style={styles.bannerTitle}>ĐƯỜNG DÂY NÓNG CỨU NẠN QUỐC GIA</Text>
          <Text style={styles.bannerSubtitle}>
            Nguy kịch tức thời hãy gọi ngay:{' '}
            <Text style={styles.highlightPhone}>113 (Công an)</Text> ·{' '}
            <Text style={styles.highlightPhone}>114 (Cứu nạn)</Text> ·{' '}
            <Text style={styles.highlightPhone}>115 (Y tế)</Text>
          </Text>
        </View>
      </View>

      {/* Cảnh báo bắt buộc đổi mật khẩu tạm thời */}
      {isAuthenticated && user?.must_change_password && (
        <TouchableOpacity
          style={styles.mustChangePassBanner}
          onPress={() => router.push('/change-password')}
          activeOpacity={0.85}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <KeyRound size={20} color={THEME.colors.warning.main} style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.mustChangePassTitle}>CẢNH BÁO: BẠN CẦN ĐỔI MẬT KHẨU</Text>
              <Text style={styles.mustChangePassDesc}>
                Tài khoản đang dùng mật khẩu tạm thời. Chạm vào đây để đổi mật khẩu ngay.
              </Text>
            </View>
          </View>
          <ChevronRight size={18} color={THEME.colors.warning.main} />
        </TouchableOpacity>
      )}

      {/* Thanh định danh tài khoản Người dân / Cứu hộ */}
      {isAuthenticated && user ? (
        <View style={styles.userSessionContainer}>
          <View style={styles.userSessionCard}>
            <View style={styles.userSessionLeft}>
              <View style={styles.userAvatarBox}>
                <UserCheck size={22} color={THEME.colors.primary.main} />
              </View>
              <View style={styles.userSessionInfo}>
                <View style={styles.userNameRow}>
                  <Text style={styles.userSessionName} numberOfLines={1}>
                    {user.display_name || user.username}
                  </Text>
                  <View style={styles.userRoleTag}>
                    <Text style={styles.userRoleTagText}>{getUserRoleName()}</Text>
                  </View>
                </View>
                <Text style={styles.userSessionHint}>Đã sẵn sàng báo cứu trợ người thân</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
              activeOpacity={0.7}
            >
              <LogOut size={16} color={THEME.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.userActionsRow}>
            <TouchableOpacity
              style={styles.myRequestsBar}
              onPress={() => router.push('/my-requests')}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ClipboardList size={15} color={THEME.colors.primary.main} style={{ marginRight: 6 }} />
                <Text style={styles.myRequestsBarText}>Yêu cầu của tôi</Text>
              </View>
              <ChevronRight size={15} color={THEME.colors.primary.main} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.changePassBar}
              onPress={() => router.push('/change-password')}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <KeyRound size={15} color={THEME.colors.text.secondary} style={{ marginRight: 6 }} />
                <Text style={styles.changePassBarText}>Đổi mật khẩu & Bảo mật</Text>
              </View>
              <ChevronRight size={15} color={THEME.colors.text.muted} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.guestBar}>
          <View style={styles.guestInfo}>
            <User size={18} color={THEME.colors.text.secondary} style={{ marginRight: 6 }} />
            <Text style={styles.guestText}>Tài khoản: Khách vãng lai</Text>
          </View>
          <TouchableOpacity
            style={styles.loginQuickButton}
            onPress={() => router.push('/login')}
            activeOpacity={0.8}
          >
            <LogIn size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
            <Text style={styles.loginQuickButtonText}>Đăng Nhập / Đăng Ký</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Thông báo khẩn cấp từ Ban Chỉ Huy Cứu Trợ (Notices) */}
      {isAuthenticated && notices.length > 0 && (
        <View style={styles.noticesCard}>
          <View style={styles.noticesHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Bell size={18} color={THEME.colors.primary.main} style={{ marginRight: 6 }} />
              <Text style={styles.noticesHeaderTitle}>THÔNG BÁO TỪ BAN CHỈ HUY</Text>
            </View>
            <TouchableOpacity
              style={styles.viewAllNoticesBtn}
              onPress={() => router.push('/notices')}
              activeOpacity={0.7}
            >
              <Text style={styles.viewAllNoticesText}>
                Xem tất cả ({notices.filter((n) => !n.read_at).length} mới)
              </Text>
              <ChevronRight size={14} color={THEME.colors.primary.main} />
            </TouchableOpacity>
          </View>
          {notices.slice(0, 3).map((n) => {
            const formatted = formatNoticeDisplay(n);
            const title = formatted.title;
            const isUnread = !n.read_at;
            return (
              <TouchableOpacity
                key={n.id}
                style={[styles.noticeItemRow, isUnread && styles.noticeItemUnread]}
                onPress={() => handleOpenNotice(n)}
                activeOpacity={0.7}
              >
                <AlertCircle
                  size={16}
                  color={isUnread ? THEME.colors.emergency.main : THEME.colors.text.secondary}
                  style={{ marginRight: 8, marginTop: 2 }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.noticeItemTitle, isUnread && styles.noticeItemTitleBold]}
                    numberOfLines={1}
                  >
                    {title}
                  </Text>
                  <Text style={styles.noticeItemTime}>
                    {new Date(n.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {isUnread ? 'Chưa đọc' : 'Đã xem'}
                  </Text>
                </View>
                <ChevronRight size={16} color={THEME.colors.text.muted} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Nút SOS khẩn cấp trung tâm */}
      <SOSButton
        onPress={() => router.push('/create-sos')}
        title="GỬI YÊU CẦU CỨU NẠN"
        subTitle="CHẠM ĐỂ BÁO VỊ TRÍ & SỐ NGƯỜI CẦN CỨU"
      />

      {/* Chọn phương thức báo cứu trợ */}
      <View style={styles.sectionContainer}>
        <Text style={styles.sectionTitle}>CHỌN PHƯƠNG THỨC BÁO CỨU TRỢ</Text>

        {/* 1. Báo cứu nạn tại chỗ */}
        <TouchableOpacity
          style={styles.modeCard}
          onPress={() => router.push('/create-sos')}
          activeOpacity={0.8}
        >
          <View style={[styles.modeIconBox, { backgroundColor: THEME.colors.emergency.bg }]}>
            <MapPin size={24} color={THEME.colors.emergency.main} />
          </View>
          <View style={styles.modeInfo}>
            <Text style={styles.modeTitle}>Báo cứu nạn cho bản thân / tại chỗ</Text>
            <Text style={styles.modeDesc}>Tự động bắt tọa độ GPS hiện tại. Không bắt buộc phải có tài khoản.</Text>
          </View>
          <ChevronRight size={20} color={THEME.colors.text.muted} />
        </TouchableOpacity>

        {/* 2. Báo cứu trợ cho người thân từ xa (PROXY) */}
        <TouchableOpacity
          style={styles.modeCard}
          onPress={() => router.push('/proxy-sos')}
          activeOpacity={0.8}
        >
          <View style={[styles.modeIconBox, { backgroundColor: THEME.colors.primary.bg }]}>
            <Users size={24} color={THEME.colors.primary.main} />
          </View>
          <View style={styles.modeInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.modeTitle}>Báo cứu trợ cho người thân ở xa</Text>
              {isAuthenticated && (
                <View style={styles.verifiedBadge}>
                  <ShieldCheck size={12} color={THEME.colors.success.main} />
                  <Text style={styles.verifiedBadgeText}>Đã xác thực</Text>
                </View>
              )}
            </View>
            <Text style={styles.modeDesc}>Dành cho người ở ngoài vùng lũ báo vị trí cho gia đình gặp nạn (PROXY).</Text>
          </View>
          <ChevronRight size={20} color={THEME.colors.text.muted} />
        </TouchableOpacity>
      </View>

      {/* Tra cứu tiến độ cứu hộ nhanh bằng mã */}
      <View style={styles.trackingCard}>
        <Text style={styles.trackingTitle}>TRA CỨU TIẾN ĐỘ CỨU TRỢ</Text>
        <Text style={styles.trackingDesc}>Nhập mã tra cứu 10 ký tự được cấp khi gửi yêu cầu:</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Ví dụ: AB12CD34EF"
            placeholderTextColor={THEME.colors.text.muted}
            value={trackingCode}
            onChangeText={(value) => {
              const normalized = value.toUpperCase();
              setTrackingCode(normalized);
              setTrackingCodeError(getTrackingCodeError(normalized));
            }}
            onBlur={() => {
              setTrackingCodeError(!trackingCode.trim()
                ? 'Mã tra cứu là bắt buộc.'
                : getTrackingCodeError(trackingCode));
            }}
            autoCapitalize="characters"
            maxLength={11}
          />
          <TouchableOpacity
            style={[styles.searchButton, (trackingCode.length > 10 || !isValidTrackingCode(trackingCode)) && { opacity: 0.5 }]}
            onPress={handleTrackSubmit}
            disabled={trackingCode.length > 10 || !isValidTrackingCode(trackingCode)}
            activeOpacity={0.8}
          >
            <Search size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <FormFieldError message={trackingCodeError} />
      </View>

      {/* Truy cập nhanh các tính năng khác */}
      <View style={styles.quickAccessRow}>
        <TouchableOpacity
          style={styles.quickAccessCard}
          onPress={() => router.push('/donations')}
          activeOpacity={0.8}
        >
          <HeartHandshake size={26} color={THEME.colors.primary.main} />
          <Text style={styles.quickAccessTitle}>Quyên góp hiện vật</Text>
          <Text style={styles.quickAccessDesc}>Ủng hộ mì, nước, áo phao</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickAccessCard}
          onPress={() => router.push('/campaigns')}
          activeOpacity={0.8}
        >
          <Flag size={26} color={THEME.colors.success.main} />
          <Text style={styles.quickAccessTitle}>Chiến dịch cứu trợ</Text>
          <Text style={styles.quickAccessDesc}>Tiếp tế các điểm lũ</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickAccessCard}
          onPress={() => {
            if (isAuthenticated && isVolunteerOrLeader()) {
              router.push('/team');
            } else {
              router.push('/login');
            }
          }}
          activeOpacity={0.8}
        >
          <ShieldAlert size={26} color={THEME.colors.warning.main} />
          <Text style={styles.quickAccessTitle}>
            {isAuthenticated && isVolunteerOrLeader() ? 'Cứu Hộ & TNV' : 'Đội cứu hộ'}
          </Text>
          <Text style={styles.quickAccessDesc}>
            {isAuthenticated && isVolunteerOrLeader() ? 'Tác chiến & Hậu cần' : 'Đăng nhập tác chiến'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Modal chi tiết thông báo điều phối */}
      <Modal visible={!!selectedNotice} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.noticeModalContent}>
            {(() => {
              const formatted = formatNoticeDisplay(selectedNotice);
              return (
                <>
                  <View style={styles.noticeModalHeader}>
                    <Bell size={22} color={THEME.colors.primary.main} />
                    <Text style={styles.noticeModalTitle}>{formatted.title}</Text>
                  </View>
                  <Text style={styles.noticeModalTime}>
                    Thời gian:{' '}
                    {selectedNotice?.created_at
                      ? new Date(selectedNotice.created_at).toLocaleString('vi-VN')
                      : ''}
                  </Text>
                  <View style={styles.noticeModalBody}>
                    <Text style={styles.noticeModalText}>{formatted.message}</Text>
                  </View>
                </>
              );
            })()}
            <TouchableOpacity
              style={styles.noticeModalCloseBtn}
              onPress={() => setSelectedNotice(null)}
              activeOpacity={0.8}
            >
              <Text style={styles.noticeModalCloseText}>Đã Hiểu & Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  brandTextContainer: {
    marginLeft: 12,
  },
  brandName: {
    fontSize: 20,
    fontWeight: '900',
    color: THEME.colors.emergency.main,
    letterSpacing: 0.5,
  },
  brandTagline: {
    fontSize: 9.5,
    fontWeight: '700',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.6,
    marginTop: 1,
  },
  mockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#CCFBF1',
    borderWidth: 1,
    borderColor: '#99F6E4',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  mockBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
  },
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.emergency.bg,
    borderWidth: 1,
    borderColor: THEME.colors.emergency.border,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  bannerIcon: {
    marginRight: 10,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.emergency.main,
    letterSpacing: 0.5,
  },
  bannerSubtitle: {
    fontSize: 12,
    color: THEME.colors.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
  highlightPhone: {
    fontWeight: '800',
    color: THEME.colors.emergency.dark,
  },
  userSessionContainer: {
    marginBottom: 10,
  },
  mustChangePassBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  mustChangePassTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.warning.main,
    marginBottom: 2,
  },
  mustChangePassDesc: {
    fontSize: 11,
    color: THEME.colors.text.primary,
    lineHeight: 15,
  },
  userSessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    ...THEME.shadows.sm,
  },
  userActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  myRequestsBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  myRequestsBarText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },
  changePassBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  changePassBarText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.text.secondary,
  },
  userSessionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  userAvatarBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  userSessionInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userSessionName: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginRight: 6,
  },
  userRoleTag: {
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  userRoleTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },
  userSessionHint: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  logoutButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  guestBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  guestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  guestText: {
    fontSize: 12,
    color: THEME.colors.text.secondary,
  },
  loginQuickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.main,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  loginQuickButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.success.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.colors.success.dark,
    marginLeft: 3,
  },
  sectionContainer: {
    marginTop: 10,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface.card,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    marginBottom: 10,
    ...THEME.shadows.sm,
  },
  modeIconBox: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  modeInfo: {
    flex: 1,
  },
  modeTitle: {
    fontSize: THEME.typography.fontSizes.sm + 1,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  modeDesc: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 3,
    lineHeight: 16,
  },
  trackingCard: {
    backgroundColor: THEME.colors.surface.card,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    marginBottom: 16,
    ...THEME.shadows.sm,
  },
  trackingTitle: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
  },
  trackingDesc: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.muted,
    marginVertical: 6,
  },
  searchRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  searchInput: {
    flex: 1,
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
    fontWeight: '600',
  },
  searchButton: {
    backgroundColor: THEME.colors.primary.main,
    width: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  quickAccessRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  quickAccessCard: {
    flex: 1,
    backgroundColor: THEME.colors.surface.card,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    marginHorizontal: 4,
    alignItems: 'center',
    textAlign: 'center',
    ...THEME.shadows.sm,
  },
  quickAccessTitle: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginTop: 8,
    textAlign: 'center',
  },
  quickAccessDesc: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  noticesCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 16,
  },
  noticesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FEE2E2',
    paddingBottom: 6,
  },
  noticesHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.emergency.dark,
    letterSpacing: 0.5,
  },
  viewAllNoticesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  viewAllNoticesText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginRight: 2,
  },
  noticesCountBadge: {
    backgroundColor: THEME.colors.emergency.main,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  noticesCountText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  noticeItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FEE2E2',
  },
  noticeItemUnread: {
    backgroundColor: 'rgba(254, 226, 226, 0.4)',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  noticeItemTitle: {
    fontSize: 13,
    color: THEME.colors.text.primary,
  },
  noticeItemTitleBold: {
    fontWeight: '700',
    color: THEME.colors.emergency.dark,
  },
  noticeItemTime: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noticeModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    ...THEME.shadows.md,
  },
  noticeModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  noticeModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginLeft: 8,
    flex: 1,
  },
  noticeModalTime: {
    fontSize: 11,
    color: THEME.colors.text.muted,
    marginBottom: 12,
  },
  noticeModalBody: {
    backgroundColor: THEME.colors.surface.background,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  noticeModalText: {
    fontSize: 14,
    color: THEME.colors.text.primary,
    lineHeight: 22,
  },
  noticeModalCloseBtn: {
    backgroundColor: THEME.colors.primary.main,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  noticeModalCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
