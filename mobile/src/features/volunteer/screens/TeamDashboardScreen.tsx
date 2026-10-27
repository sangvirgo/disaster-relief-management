import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { RequiredAsterisk } from '../../../components/common/RequiredAsterisk';
import { CopyableInfoModal } from '../../../components/common/CopyableInfoModal';
import { LocationPickerModal } from '../../../components/common/LocationPickerModal';
import { useAuthStore } from '../../../store/authStore';
import { useLocation } from '../../../hooks/useLocation';
import { ResponseApi } from '../../../api/responseApi';
import { getApiErrorMessage, isApiErrorCode } from '../../../api/client';
import { GeoLocation, RescueTeamDetail, Mission, TeamSkillOption } from '../../../types/api';
import { THEME } from '../../../constants/theme';
import { isValidUuid } from '../../../utils/formValidation';
import { RESCUE_TEAM_KIND_LABELS, RESCUE_SKILL_LABELS } from '../../../constants/labels';
import {
  Shield,
  Radio,
  ListTodo,
  LogOut,
  MapPin,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  Award,
  HeartHandshake,
  UserCheck,
  Copy,
  Info,
  PackageCheck,
  Flag,
  Bell,
  UserPlus,
  UserMinus,
  X,
} from 'lucide-react-native';

type TeamMemberAction = 'ADD' | 'REMOVE';

export const TeamDashboardScreen: React.FC = () => {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { location, refreshLocation } = useLocation();

  const [team, setTeam] = useState<RescueTeamDetail | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUpdatingPosition, setIsUpdatingPosition] = useState<boolean>(false);
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [showUserIdModal, setShowUserIdModal] = useState<boolean>(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState<boolean>(false);
  const [memberAction, setMemberAction] = useState<TeamMemberAction>('ADD');
  const [newMemberUserId, setNewMemberUserId] = useState<string>('');
  const [memberIdError, setMemberIdError] = useState<string | undefined>();
  const [isAddingMember, setIsAddingMember] = useState<boolean>(false);
  const [teamSkills, setTeamSkills] = useState<TeamSkillOption[]>([]);
  const [showTeamProfileModal, setShowTeamProfileModal] = useState(false);
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [teamSkillDraft, setTeamSkillDraft] = useState<string[]>([]);
  const [teamSkillsChanged, setTeamSkillsChanged] = useState(false);
  const [teamProfileError, setTeamProfileError] = useState<string | undefined>();
  const [isSavingTeamProfile, setIsSavingTeamProfile] = useState(false);
  const [showPositionPicker, setShowPositionPicker] = useState(false);

  const loadTeamData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [teamsPage, missionsPage, skillsResult] = await Promise.all([
        ResponseApi.getMyTeams(),
        ResponseApi.getMyMissions(),
        ResponseApi.getTeamSkills().catch(() => ({ items: [] as TeamSkillOption[] })),
      ]);
      setTeamSkills(skillsResult.items);
      const teamsData = teamsPage.items;
      const missionsData = missionsPage.items;

      if (teamsData.length > 0) {
        const firstTeam = teamsData[0];
        setTeam(firstTeam);
        setIsAvailable(firstTeam.availability === 'AVAILABLE');

        // Lấy chi tiết kỹ năng và cấu hình đội từ GET /response/teams/:id
        try {
          const detail = await ResponseApi.getTeamDetail(firstTeam.id);
          if (detail) {
            setTeam(detail);
          }
        } catch {
          // Giữ nguyên firstTeam nếu API chi tiết không hỗ trợ
        }
      } else {
        setTeam(null);
      }
      setMissions(missionsData);
    } catch (e) {
      setLoadError(getApiErrorMessage(e, 'Không thể tải thông tin đội và nhiệm vụ. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial loading is already true; this starts the initial request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTeamData();
  }, []);

  // Đội trưởng cập nhật trạng thái sẵn sàng của đội lên Backend
  const handleToggleAvailability = async (nextValue: boolean) => {
    if (!team) return;
    const prevValue = isAvailable;
    setIsAvailable(nextValue);
    try {
      const updated = await ResponseApi.updateTeamAvailability(
        team.id,
        team.version,
        nextValue ? 'AVAILABLE' : 'UNAVAILABLE'
      );
      setTeam(updated);
      setIsAvailable(updated.availability === 'AVAILABLE');
    } catch (err: any) {
      setIsAvailable(prevValue);
      if (isApiErrorCode(err, 'FORBIDDEN')) {
        Alert.alert(
          'Chưa được phép cập nhật',
          'Backend chỉ cho phép đội trưởng đang hoạt động hoặc điều phối viên có thẩm quyền cập nhật trạng thái đội.'
        );
      } else {
        Alert.alert(
          'Lỗi cập nhật trạng thái',
          getApiErrorMessage(err, 'Không thể cập nhật trạng thái sẵn sàng của đội.')
        );
      }
    }
  };

  // Đội trưởng phát tín hiệu vị trí GPS di quân hiện tại của Đội
  const handleBroadcastPosition = async () => {
    if (!team || !location) {
      Alert.alert('Chưa có vị trí GPS', 'Đang cập nhật GPS, vui lòng thử lại sau vài giây.');
      refreshLocation();
      return;
    }

    setIsUpdatingPosition(true);
    try {
      await ResponseApi.updateTeamPosition(team.id, location);
      Alert.alert('Thành công', 'Đã phát tín hiệu tọa độ hiện tại của đội cứu trợ lên bản đồ điều phối.');
    } catch (err: any) {
      if (isApiErrorCode(err, 'FORBIDDEN')) {
        Alert.alert(
          'Chưa được phép cập nhật',
          'Backend chỉ cho phép đội trưởng đang hoạt động hoặc điều phối viên có thẩm quyền cập nhật vị trí đội.'
        );
      } else {
        Alert.alert('Lỗi cập nhật', getApiErrorMessage(err, 'Không thể cập nhật vị trí.'));
      }
    } finally {
      setIsUpdatingPosition(false);
    }
  };

  const handleManualPositionConfirm = async (coordinates: [number, number], addressNote?: string) => {
    if (!team) return;
    setShowPositionPicker(false);
    setIsUpdatingPosition(true);
    const manualLocation: GeoLocation = {
      type: 'Point',
      coordinates,
      source: 'MANUAL_PIN',
      captured_at: new Date().toISOString(),
    };
    try {
      await ResponseApi.updateTeamPosition(team.id, manualLocation, addressNote);
      Alert.alert('Đã cập nhật vị trí', 'Vị trí ghim thủ công của đội đã được ghi nhận.');
      await loadTeamData();
    } catch (err: any) {
      Alert.alert('Lỗi cập nhật', getApiErrorMessage(err, 'Không thể cập nhật vị trí đội.'));
    } finally {
      setIsUpdatingPosition(false);
    }
  };

  const openTeamProfileEditor = () => {
    if (!team) return;
    setTeamNameDraft(team.name);
    setTeamSkillDraft([...team.skills]);
    setTeamSkillsChanged(false);
    setTeamProfileError(undefined);
    setShowTeamProfileModal(true);
  };

  const toggleTeamSkill = (code: string) => {
    setTeamSkillsChanged(true);
    setTeamSkillDraft((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code]);
  };

  const handleSaveTeamProfile = async () => {
    if (!team) return;
    const name = teamNameDraft.trim();
    if (!name) {
      setTeamProfileError('Vui lòng nhập tên đội cứu hộ.');
      return;
    }
    if (name.length > 200) {
      setTeamProfileError('Tên đội không được vượt quá 200 ký tự.');
      return;
    }
    setTeamProfileError(undefined);
    setIsSavingTeamProfile(true);
    try {
      const updated = await ResponseApi.updateTeamProfile(team.id, team.version, {
        name,
        ...(teamSkillsChanged ? { skill_codes: teamSkillDraft } : {}),
      });
      setTeam(updated);
      setTeamNameDraft(updated.name);
      setTeamSkillDraft([...updated.skills]);
      setTeamSkillsChanged(false);
      setShowTeamProfileModal(false);
      Alert.alert('Đã lưu hồ sơ đội', 'Tên đội và kỹ năng chuyên môn đã được cập nhật.');
    } catch (err: any) {
      if (isApiErrorCode(err, 'VERSION_CONFLICT')) {
        await loadTeamData();
        setShowTeamProfileModal(false);
        Alert.alert('Hồ sơ đội đã thay đổi', 'Dữ liệu mới đã được tải. Hãy mở lại phần chỉnh sửa trước khi lưu.');
      } else {
        setTeamProfileError(getApiErrorMessage(err, 'Không thể cập nhật hồ sơ đội.'));
      }
    } finally {
      setIsSavingTeamProfile(false);
    }
  };

  const handleCopyUserId = () => {
    if (!user?.id) return;
    setShowUserIdModal(true);
  };

  const executeMemberAction = async (userId: string) => {
    if (!team) return;
    setIsAddingMember(true);
    try {
      if (memberAction === 'ADD') {
        await ResponseApi.addTeamMember(team.id, userId);
        Alert.alert('Thành công', 'Đã thêm thành viên mới vào đội cứu hộ.');
      } else {
        await ResponseApi.removeTeamMember(team.id, userId);
        Alert.alert('Đã gỡ thành viên', 'Tài khoản đã được gỡ khỏi đội cứu hộ.');
      }
      setNewMemberUserId('');
      setMemberIdError(undefined);
      setShowAddMemberModal(false);
      await loadTeamData();
    } catch (err: unknown) {
      if (isApiErrorCode(err, 'USER_IN_OTHER_TEAM')) {
        Alert.alert('Không thể thêm', 'Tài khoản này hiện đang thuộc một đội cứu hộ khác.');
      } else if (isApiErrorCode(err, 'NOT_FOUND')) {
        Alert.alert('Không tìm thấy', 'Không tìm thấy tài khoản phù hợp. Hãy kiểm tra mã ID và vai trò thành viên.');
      } else if (isApiErrorCode(err, 'FORBIDDEN', 'MISSION_NOT_LEADER')) {
        Alert.alert('Chưa có quyền', 'Chỉ đội trưởng đang hoạt động mới có quyền quản lý thành viên của đội.');
      } else if (isApiErrorCode(err, 'LEADER_REQUIRED')) {
        Alert.alert('Không thể gỡ thành viên', 'Đội phải luôn có đội trưởng. Không thể gỡ đội trưởng hiện tại.');
      } else if (isApiErrorCode(err, 'VERSION_CONFLICT')) {
        Alert.alert('Dữ liệu đã thay đổi', 'Hãy tải lại thông tin đội trước khi tiếp tục.');
        await loadTeamData();
      } else {
        Alert.alert('Không thể cập nhật thành viên', getApiErrorMessage(err, 'Vui lòng thử lại.'));
      }
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleMemberActionSubmit = () => {
    const trimmedId = newMemberUserId.trim();
    if (!team) return;
    if (!trimmedId) {
      setMemberIdError('Vui lòng nhập mã ID tài khoản tình nguyện viên.');
      return;
    }
    if (!isValidUuid(trimmedId)) {
      setMemberIdError('Mã ID phải đúng định dạng UUID, ví dụ 123e4567-e89b-12d3-a456-426614174000.');
      return;
    }
    setMemberIdError(undefined);
    const copy = {
      ADD: { title: 'Xác nhận thêm thành viên', message: 'Thêm tài khoản này vào đội cứu hộ?', action: 'Thêm thành viên' },
      REMOVE: { title: 'Xác nhận gỡ thành viên', message: 'Gỡ tài khoản này khỏi đội cứu hộ?', action: 'Gỡ thành viên' },
    }[memberAction];
    if (memberAction === 'ADD') {
      void executeMemberAction(trimmedId);
      return;
    }
    Alert.alert(copy.title, copy.message, [
      { text: 'Hủy', style: 'cancel' },
      { text: copy.action, style: memberAction === 'REMOVE' ? 'destructive' : 'default', onPress: () => void executeMemberAction(trimmedId) },
    ]);
  };

  const memberActionCopy = {
    ADD: { title: 'Thêm thành viên vào đội', help: 'Nhập mã ID do tình nguyện viên cung cấp để ghi danh vào đội.', button: 'Ghi danh vào đội', placeholder: 'Mã ID tình nguyện viên (UUID)' },
    REMOVE: { title: 'Gỡ thành viên khỏi đội', help: 'Nhập mã ID của thành viên cần gỡ. Đội trưởng hiện tại không thể tự gỡ.', button: 'Gỡ khỏi đội', placeholder: 'Mã ID thành viên (UUID)' },
  }[memberAction];

  const openMemberAction = (action: TeamMemberAction) => {
    setMemberAction(action);
    setNewMemberUserId('');
    setMemberIdError(undefined);
    setShowAddMemberModal(true);
  };

  const memberActionDisabled = isAddingMember || newMemberUserId.length > 36 || !isValidUuid(newMemberUserId);

  const handleLogout = async () => {
    Alert.alert('Xác nhận đăng xuất', 'Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?', [
      { text: 'Hủy' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/');
        },
      },
    ]);
  };

  if (loading) {
    return (
      <ScreenContainer title="Không Gian Tác Chiến">
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang tải thông tin lực lượng cứu trợ...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (loadError) {
    return (
      <ScreenContainer title="Bảng Tác Chiến Đội Cứu Hộ">
        <View style={styles.centerLoading}>
          <Text style={styles.loadingText}>{loadError}</Text>
          <TouchableOpacity style={styles.viewMissionsBtn} onPress={loadTeamData}>
            <Text style={styles.viewMissionsText}>Thử tải lại</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  // =========================================================================
  // TRƯỜNG HỢP 1: TÌNH NGUYỆN VIÊN TỰ DO (CHƯA ĐƯỢC BIÊN CHẾ VÀO ĐỘI CỨU HỘ)
  // =========================================================================
  if (!team) {
    return (
      <ScreenContainer
        title="Khu Vực Đội Cứu Hộ"
        subtitle={`Xin chào, ${user?.display_name || user?.username || 'Bạn'}`}
        headerRight={
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <LogOut size={20} color={THEME.colors.emergency.main} />
          </TouchableOpacity>
        }
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Thẻ định danh Tình nguyện viên */}
          <View style={styles.volunteerCard}>
            <View style={styles.volunteerHeaderRow}>
              <View style={styles.volunteerIconBox}>
                <HeartHandshake size={28} color={THEME.colors.primary.main} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.volunteerName} numberOfLines={1}>
                  {user?.display_name || user?.username || 'Người dùng'}
                </Text>
                <View style={styles.freeBadgeRow}>
                  <View style={styles.freeVolunteerBadge}>
                  <Text style={styles.freeVolunteerBadgeText}>🤝 Chưa tham gia đội cứu hộ</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Mã ID tài khoản cá nhân */}
            <View style={styles.userIdSection}>
              <View style={styles.userIdRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userIdLabel}>MÃ ID TÀI KHOẢN (ĐỊNH DANH HỆ THỐNG):</Text>
                  <Text style={styles.userIdValue} selectable={true}>
                    {user?.id || 'Chưa xác định'}
                  </Text>
                </View>
                <TouchableOpacity style={styles.copyBtn} onPress={handleCopyUserId} activeOpacity={0.8}>
                  <Copy size={16} color={THEME.colors.primary.main} />
                  <Text style={styles.copyBtnText}>Xem / Sao chép</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Thông báo trạng thái biên chế thực địa */}
          <View style={styles.noticeBox}>
            <View style={styles.noticeHeaderRow}>
              <Info size={20} color={THEME.colors.warning.dark} />
              <Text style={styles.noticeTitle}>CHƯA ĐƯỢC GHI DANH VÀO ĐỘI CỨU HỘ</Text>
            </View>
            <Text style={styles.noticeDesc}>
              Tài khoản của bạn chưa được ghi danh vào Đội cứu hộ nào.
            </Text>
            <Text style={styles.noticeGuidance}>
              • Để tham gia tác chiến cứu nạn thực địa: Hãy gửi <Text style={{ fontWeight: '700' }}>Mã ID tài khoản</Text> ở trên cho Đội trưởng đội cứu nạn tại địa bàn của bạn hoặc Ban chỉ huy PCTT địa phương để được ghi danh vào đội.
            </Text>
          </View>

          {/* Các hoạt động tình nguyện viên có thể tham gia ngay */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <UserCheck size={20} color={THEME.colors.primary.main} />
              <Text style={styles.cardTitle}>HOẠT ĐỘNG TÌNH NGUYỆN CỨU TRỢ</Text>
            </View>
            <Text style={styles.cardDesc}>
              Trong thời gian chờ phân công đội cơ động, bạn có thể tham gia các hoạt động hậu cần và tiếp tế cứu trợ:
            </Text>

            {/* Mục 1: Khai báo quyên góp & Hỗ trợ nhu yếu phẩm */}
            <TouchableOpacity
              style={styles.activityItem}
              onPress={() => router.push('/donations')}
              activeOpacity={0.85}
            >
              <View style={[styles.activityIconBox, { backgroundColor: '#ECFDF5' }]}>
                <PackageCheck size={22} color={THEME.colors.success.main} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.activityTitle}>Quyên Góp & Tiếp Nhận Cứu Trợ</Text>
                <Text style={styles.activityDesc}>
                  Khai báo hàng tiếp tế, bàn giao nhu yếu phẩm cứu trợ tại kho và xem báo cáo minh bạch.
                </Text>
              </View>
              <ChevronRight size={18} color={THEME.colors.text.muted} />
            </TouchableOpacity>

            {/* Mục 2: Tra cứu chiến dịch cứu trợ mở */}
            <TouchableOpacity
              style={styles.activityItem}
              onPress={() => router.push('/campaigns')}
              activeOpacity={0.85}
            >
              <View style={[styles.activityIconBox, { backgroundColor: '#EFF6FF' }]}>
                <Flag size={22} color={THEME.colors.primary.main} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.activityTitle}>Chiến Dịch Cứu Trợ Vùng Lũ</Text>
                <Text style={styles.activityDesc}>
                  Theo dõi danh sách các chiến dịch cứu trợ đang mở tiếp tế lương thực trên địa bàn.
                </Text>
              </View>
              <ChevronRight size={18} color={THEME.colors.text.muted} />
            </TouchableOpacity>

            {/* Mục 3: Bản tin điều phối & Cảnh báo khẩn */}
            <TouchableOpacity
              style={styles.activityItem}
              onPress={() => router.push('/notices')}
              activeOpacity={0.85}
            >
              <View style={[styles.activityIconBox, { backgroundColor: '#FEF3C7' }]}>
                <Bell size={22} color={THEME.colors.warning.main} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.activityTitle}>Bản Tin Chỉ Đạo Điều Phối</Text>
                <Text style={styles.activityDesc}>
                  Cập nhật các chỉ đạo khẩn cấp từ Ban chỉ huy Phòng chống thiên tai địa phương.
                </Text>
              </View>
              <ChevronRight size={18} color={THEME.colors.text.muted} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // =========================================================================
  // TRƯỜNG HỢP 2 & 3: ĐÃ GIA NHẬP ĐỘI (ĐỘI TRƯỞNG HOẶC THÀNH VIÊN ĐỘI)
  // =========================================================================
  const offeredCount = missions.filter((m) => m.status === 'OFFERED').length;
  const activeCount = missions.filter((m) => ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(m.status)).length;
  const completedCount = missions.filter((m) => m.status === 'COMPLETED').length;

  return (
    <ScreenContainer
      title="Bảng Tác Chiến Đội Cứu Hộ"
      subtitle={`Xin chào, ${user?.display_name || user?.username || 'Đồng chí'}`}
      headerRight={
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <LogOut size={20} color={THEME.colors.emergency.main} />
        </TouchableOpacity>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 1. THÔNG TIN ĐỘI & VAI TRÒ TÁC CHIẾN */}
        <View style={styles.teamCard}>
          <View style={styles.teamHeaderRow}>
            <View style={styles.teamIconBox}>
              <Shield size={26} color={THEME.colors.primary.main} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.teamName} numberOfLines={1}>
                  {team.name}
                </Text>
                <View
                  style={[
                    styles.roleBadge,
                    styles.roleBadgeMember,
                  ]}
                >
                  <Text
                    style={[
                      styles.roleBadgeText,
                      styles.roleBadgeTextMember,
                    ]}
                  >
                    Đội cứu hộ
                  </Text>
                </View>
              </View>
              <Text style={styles.teamKind}>
                Lực lượng: {RESCUE_TEAM_KIND_LABELS[team.kind] || 'Lực lượng cứu hộ'}
              </Text>
            </View>
          </View>

          {/* Danh sách kỹ năng chuyên môn của đội */}
          {team.skills && team.skills.length > 0 && (
            <View style={styles.skillsSection}>
              <View style={styles.skillsHeaderRow}>
                <Award size={14} color={THEME.colors.primary.main} />
                <Text style={styles.skillsTitle}>KỸ NĂNG TÁC CHIẾN CHUYÊN MÔN</Text>
              </View>
              <View style={styles.skillsList}>
                {team.skills.map((skillItem, idx) => {
                  const label = teamSkills.find((skill) => skill.code === skillItem)?.display_name
                    || RESCUE_SKILL_LABELS[skillItem]
                    || 'Kỹ năng chuyên môn khác';
                  return (
                    <View key={`${skillItem}-${idx}`} style={styles.skillChip}>
                      <Text style={styles.skillChipText}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={styles.profileEditButton}
            onPress={openTeamProfileEditor}
            activeOpacity={0.8}
          >
            <Text style={styles.profileEditButtonText}>Chỉnh sửa tên đội và kỹ năng</Text>
          </TouchableOpacity>

          {/* Trạng thái sẵn sàng nhận lệnh của đội */}
          <View style={styles.availabilityRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.availTitle}>Trực chiến nhận nhiệm vụ cứu nạn</Text>
              <Text style={styles.availSubtitle}>
                {isAvailable ? 'Đội đang sẵn sàng nhận phân công nhiệm vụ mới' : 'Đội đang tạm dừng nhận nhiệm vụ'}
              </Text>
            </View>

            <Switch
              value={isAvailable}
              onValueChange={handleToggleAvailability}
              trackColor={{ false: '#CBD5E1', true: THEME.colors.success.light }}
              thumbColor={isAvailable ? THEME.colors.success.main : '#FFFFFF'}
            />
          </View>

          <Text style={styles.memberNote}>
            Quyền thay đổi trạng thái được kiểm tra theo vai trò và trạng thái thành viên hiện tại.
          </Text>
        </View>

        {/* 2. TỌA ĐỘ VỊ TRÍ DI QUÂN CỦA ĐỘI */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <MapPin size={20} color={THEME.colors.primary.main} />
            <Text style={styles.cardTitle}>TỌA ĐỘ VỊ TRÍ DI QUÂN CỦA ĐỘI</Text>
          </View>
          <Text style={styles.cardDesc}>
            Cập nhật vị trí khi đội di chuyển. Bạn có thể gửi GPS hiện tại hoặc ghim vị trí thủ công; không bật theo dõi nền.
          </Text>

          <TouchableOpacity
            style={[styles.beaconButton, isUpdatingPosition && { opacity: 0.7 }]}
            onPress={handleBroadcastPosition}
            disabled={isUpdatingPosition}
            activeOpacity={0.85}
          >
            {isUpdatingPosition ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Radio size={20} color="#FFFFFF" />
                <Text style={styles.beaconButtonText}>Phát tín hiệu GPS hiện tại</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.manualPositionButton, isUpdatingPosition && { opacity: 0.7 }]}
            onPress={() => setShowPositionPicker(true)}
            disabled={isUpdatingPosition}
            activeOpacity={0.85}
          >
            <MapPin size={18} color={THEME.colors.primary.main} />
            <Text style={styles.manualPositionButtonText}>Ghim vị trí đội trên bản đồ</Text>
          </TouchableOpacity>
          {team.position?.age_s != null ? (
            <Text style={styles.memberNote}>
              Lần cập nhật gần nhất: {team.position.age_s} giây trước · {
                team.position.source === 'MANUAL_PIN'
                  ? 'ghim thủ công'
                  : team.position.source === 'COORDINATOR_REPORTED'
                    ? 'điều phối viên ghi nhận'
                    : 'GPS'
              }
            </Text>
          ) : null}
        </View>

        {/* 3. THỐNG KÊ NHIỆM VỤ ĐƯỢC GIAO */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ListTodo size={20} color={THEME.colors.primary.main} />
            <Text style={styles.cardTitle}>NHIỆM VỤ CỨU TRỢ CỦA ĐỘI</Text>
          </View>

          <View style={styles.statsGrid}>
            <TouchableOpacity
              style={[styles.statBox, { backgroundColor: THEME.colors.warning.bg }]}
              onPress={() => router.push({ pathname: '/missions', params: { tab: 'OFFERED' } })}
              activeOpacity={0.8}
            >
              <AlertTriangle size={20} color={THEME.colors.warning.main} />
              <Text style={[styles.statNumber, { color: THEME.colors.warning.dark }]}>{offeredCount}</Text>
              <Text style={styles.statLabel}>Mới nhận</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.statBox, { backgroundColor: THEME.colors.primary.bg }]}
              onPress={() => router.push({ pathname: '/missions', params: { tab: 'ACTIVE' } })}
              activeOpacity={0.8}
            >
              <Clock size={20} color={THEME.colors.primary.main} />
              <Text style={[styles.statNumber, { color: THEME.colors.primary.dark }]}>{activeCount}</Text>
              <Text style={styles.statLabel}>Đang cứu</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.statBox, { backgroundColor: THEME.colors.success.bg }]}
              onPress={() => router.push({ pathname: '/missions', params: { tab: 'COMPLETED' } })}
              activeOpacity={0.8}
            >
              <CheckCircle2 size={20} color={THEME.colors.success.main} />
              <Text style={[styles.statNumber, { color: THEME.colors.success.dark }]}>{completedCount}</Text>
              <Text style={styles.statLabel}>Hoàn thành</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.viewMissionsBtn}
            onPress={() => router.push('/missions')}
            activeOpacity={0.85}
          >
            <Text style={styles.viewMissionsText}>Mở Danh Sách Nhiệm Vụ Phối Hợp</Text>
            <ChevronRight size={18} color={THEME.colors.primary.main} />
          </TouchableOpacity>
        </View>

        {/* 4. QUẢN LÝ THÀNH VIÊN ĐỘI CỨU HỘ */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <UserCheck size={20} color={THEME.colors.primary.main} />
            <Text style={styles.cardTitle}>QUẢN LÝ THÀNH VIÊN ĐỘI</Text>
          </View>
          <Text style={styles.cardDesc}>
            Đội trưởng đang hoạt động có thể thêm hoặc gỡ thành viên bằng mã ID tài khoản. Máy chủ kiểm tra quyền và tư cách thành viên trước khi lưu.
          </Text>
          <View style={styles.memberActionsRow}>
            <TouchableOpacity style={styles.memberActionButton} onPress={() => openMemberAction('ADD')} activeOpacity={0.85}>
              <UserPlus size={16} color="#FFFFFF" />
              <Text style={styles.memberActionButtonText}>Thêm</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.memberActionButton, styles.memberActionSecondary]} onPress={() => openMemberAction('REMOVE')} activeOpacity={0.85}>
              <UserMinus size={16} color={THEME.colors.emergency.main} />
              <Text style={styles.memberActionSecondaryText}>Gỡ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* MODAL THÊM THÀNH VIÊN VÀO ĐỘI */}
      <Modal visible={showAddMemberModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{memberActionCopy.title}</Text>
              <TouchableOpacity onPress={() => setShowAddMemberModal(false)} disabled={isAddingMember}>
                <X size={20} color={THEME.colors.text.muted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {memberActionCopy.help}
            </Text>
            <Text style={styles.modalSubtitle}>Mã tài khoản (UUID) <RequiredAsterisk /></Text>
            <TextInput
              style={styles.modalInput}
              placeholder={memberActionCopy.placeholder}
              placeholderTextColor={THEME.colors.text.muted}
              value={newMemberUserId}
              onChangeText={(value) => {
                setNewMemberUserId(value);
                setMemberIdError(value.length > 36
                  ? 'Mã tài khoản không được vượt quá 36 ký tự.'
                  : value && !isValidUuid(value)
                    ? 'Mã ID phải đúng định dạng UUID, ví dụ 123e4567-e89b-12d3-a456-426614174000.'
                    : undefined);
              }}
              onBlur={() => {
                if (!newMemberUserId.trim()) setMemberIdError('Mã tài khoản là bắt buộc.');
                else if (newMemberUserId.length > 36) setMemberIdError('Mã tài khoản không được vượt quá 36 ký tự.');
                else if (!isValidUuid(newMemberUserId)) setMemberIdError('Mã ID phải đúng định dạng UUID, ví dụ 123e4567-e89b-12d3-a456-426614174000.');
                else setMemberIdError(undefined);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={37}
              editable={!isAddingMember}
            />
            <FormFieldError message={memberIdError} />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAddMemberModal(false)}
                disabled={isAddingMember}
              >
                <Text style={styles.modalCancelText}>Hủy bỏ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, memberActionDisabled && { opacity: 0.5 }]}
                onPress={handleMemberActionSubmit}
                disabled={memberActionDisabled}
              >
                {isAddingMember ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>{memberActionCopy.button}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={showTeamProfileModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.profileModalBox}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Chỉnh sửa hồ sơ đội</Text>
              <TouchableOpacity onPress={() => setShowTeamProfileModal(false)} disabled={isSavingTeamProfile}>
                <X size={20} color={THEME.colors.text.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalSubtitle}>Tên đội cứu hộ <RequiredAsterisk /></Text>
              <TextInput
                style={styles.modalInput}
                value={teamNameDraft}
                onChangeText={(value) => {
                  setTeamNameDraft(value);
                  setTeamProfileError(undefined);
                }}
                placeholder="Nhập tên đội"
                placeholderTextColor={THEME.colors.text.muted}
                maxLength={200}
                editable={!isSavingTeamProfile}
              />
              <Text style={styles.skillPickerHeading}>KỸ NĂNG CHUYÊN MÔN</Text>
              {teamSkills.length > 0 ? teamSkills.map((skill) => {
                const selected = teamSkillDraft.includes(skill.code);
                return (
                  <TouchableOpacity
                    key={skill.code}
                    style={[styles.skillOption, selected && styles.skillOptionSelected]}
                    onPress={() => toggleTeamSkill(skill.code)}
                    disabled={isSavingTeamProfile}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.skillCheckbox, selected && styles.skillCheckboxSelected]}>
                      {selected ? <Text style={styles.skillCheckboxMark}>✓</Text> : null}
                    </View>
                    <Text style={[styles.skillOptionText, selected && styles.skillOptionTextSelected]}>
                      {skill.display_name || RESCUE_SKILL_LABELS[skill.code] || skill.code}
                    </Text>
                  </TouchableOpacity>
                );
              }) : (
                <Text style={styles.skillLoadHint}>
                  Chưa tải được danh mục kỹ năng. Bạn vẫn có thể lưu tên đội; danh sách kỹ năng sẽ được giữ nguyên.
                </Text>
              )}
              <FormFieldError message={teamProfileError} />
              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowTeamProfileModal(false)}
                  disabled={isSavingTeamProfile}
                >
                  <Text style={styles.modalCancelText}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalSubmitBtn, (isSavingTeamProfile || !teamNameDraft.trim()) && { opacity: 0.5 }]}
                  onPress={handleSaveTeamProfile}
                  disabled={isSavingTeamProfile || !teamNameDraft.trim()}
                >
                  {isSavingTeamProfile
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <Text style={styles.modalSubmitText}>Lưu hồ sơ đội</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <LocationPickerModal
        visible={showPositionPicker}
        initialCoordinates={location?.coordinates}
        disableExternalGeocoding
        title="Ghim vị trí đội cứu hộ"
        confirmButtonText="Cập nhật vị trí đội"
        onClose={() => setShowPositionPicker(false)}
        onConfirm={handleManualPositionConfirm}
      />
      {showUserIdModal && user?.id ? (
        <CopyableInfoModal
          visible
          title="Mã ID tình nguyện viên"
          description="Dùng mã tài khoản này để Đội trưởng đội cứu nạn hoặc Ban chỉ huy PCTT ghi danh bạn vào đội cứu hộ cơ động."
          helperText="Chỉ chia sẻ mã này với đơn vị có thẩm quyền ghi danh tình nguyện viên."
          credentials={[
            { key: 'volunteer-account-id', label: 'Mã tài khoản', value: user.id },
          ]}
          onClose={() => setShowUserIdModal(false)}
        />
      ) : null}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
  },
  logoutBtn: {
    padding: 6,
  },

  // THẺ TÌNH NGUYỆN VIÊN TỰ DO
  volunteerCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  volunteerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
    paddingBottom: 14,
  },
  volunteerIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
  },
  volunteerName: {
    fontSize: THEME.typography.fontSizes.base + 1,
    fontWeight: '800',
    color: THEME.colors.text.primary,
  },
  freeBadgeRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  freeVolunteerBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  freeVolunteerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  userIdSection: {
    paddingTop: 12,
  },
  userIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userIdLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.text.muted,
    letterSpacing: 0.5,
  },
  userIdValue: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.text.primary,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    marginLeft: 8,
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginLeft: 4,
  },

  // THÔNG BÁO BIÊN CHẾ
  noticeBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  noticeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  noticeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  noticeDesc: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    color: '#78350F',
    lineHeight: 19,
    marginBottom: 8,
  },
  noticeGuidance: {
    fontSize: THEME.typography.fontSizes.xs,
    color: '#92400E',
    lineHeight: 18,
  },

  // DANH SÁCH HOẠT ĐỘNG
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
  },
  activityIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitle: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  activityDesc: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },

  // THẺ ĐỘI CỨU HỘ
  teamCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  teamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
    paddingBottom: 12,
  },
  teamIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    flex: 1,
    marginRight: 6,
  },
  teamKind: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  roleBadgeLeader: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  roleBadgeMember: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  roleBadgeTextLeader: {
    color: '#B45309',
  },
  roleBadgeTextMember: {
    color: '#1D4ED8',
  },
  skillsSection: {
    marginTop: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
  },
  skillsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  skillsTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.text.muted,
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  skillsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  skillChip: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  skillChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1D4ED8',
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  availTitle: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  availSubtitle: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  statusTagReadonly: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusTagTextReadonly: {
    fontSize: 11,
    fontWeight: '700',
  },
  memberNote: {
    fontSize: 10,
    color: THEME.colors.text.muted,
    fontStyle: 'italic',
    marginTop: 6,
  },
  profileEditButton: {
    alignSelf: 'flex-start',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: THEME.colors.primary.main,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
  },
  profileEditButtonText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },

  // THẺ CHUNG
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '800',
    color: THEME.colors.text.secondary,
    letterSpacing: 0.5,
    marginLeft: 6,
  },
  cardDesc: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  beaconButton: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...THEME.shadows.md,
  },
  beaconButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.sm,
    marginLeft: 8,
  },
  manualPositionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.primary.main,
    marginTop: 10,
  },
  manualPositionButtonText: {
    color: THEME.colors.primary.main,
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.sm,
    marginLeft: 8,
  },
  teamPositionSyncedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  teamPositionSyncedText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
    marginLeft: 8,
    flex: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 14,
  },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statNumber: {
    fontSize: THEME.typography.fontSizes.xl,
    fontWeight: '900',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  viewMissionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: THEME.colors.primary.bg,
    borderRadius: 10,
  },
  viewMissionsText: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginRight: 4,
  },
  memberActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  memberActionButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: THEME.colors.primary.main,
  },
  memberActionSecondary: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  memberActionButtonText: {
    marginLeft: 5,
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  memberActionSecondaryText: {
    marginLeft: 5,
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 20,
    ...THEME.shadows.md,
  },
  profileModalBox: {
    width: '100%',
    maxHeight: '88%',
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 20,
    ...THEME.shadows.md,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  modalSubtitle: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
    marginBottom: 16,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: THEME.colors.surface.border,
  },
  modalCancelText: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
  },
  modalSubmitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: THEME.colors.primary.main,
  },
  modalSubmitText: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  skillPickerHeading: {
    color: THEME.colors.text.secondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  skillOption: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  skillOptionSelected: {
    backgroundColor: THEME.colors.primary.bg,
    borderColor: THEME.colors.primary.main,
  },
  skillCheckbox: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: THEME.colors.text.muted,
    marginRight: 10,
  },
  skillCheckboxSelected: {
    backgroundColor: THEME.colors.primary.main,
    borderColor: THEME.colors.primary.main,
  },
  skillCheckboxMark: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  skillOptionText: {
    flex: 1,
    fontSize: THEME.typography.fontSizes.xs + 1,
    color: THEME.colors.text.primary,
  },
  skillOptionTextSelected: {
    fontWeight: '700',
    color: THEME.colors.primary.dark,
  },
  skillLoadHint: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
    lineHeight: 18,
    paddingVertical: 8,
  },
});
