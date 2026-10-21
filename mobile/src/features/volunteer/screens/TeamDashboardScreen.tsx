import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { useAuthStore } from '../../../store/authStore';
import { useLocation } from '../../../hooks/useLocation';
import { ResponseApi } from '../../../api/responseApi';
import { RescueTeam, RescueTeamDetail, Mission } from '../../../types/api';
import { THEME } from '../../../constants/theme';
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
  Sparkles,
  Award,
} from 'lucide-react-native';

export const TeamDashboardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, logout, getUserRoleName } = useAuthStore();
  const { location, loading: locationLoading, refreshLocation } = useLocation();

  const [team, setTeam] = useState<RescueTeamDetail | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isUpdatingPosition, setIsUpdatingPosition] = useState<boolean>(false);
  const [isAvailable, setIsAvailable] = useState<boolean>(true);

  const loadTeamData = async () => {
    setLoading(true);
    try {
      const [teamsData, missionsData] = await Promise.all([
        ResponseApi.getMyTeams().catch(() => []),
        ResponseApi.getMyMissions().catch(() => []),
      ]);

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
          // Dùng firstTeam cơ bản nếu API chi tiết không hỗ trợ
        }
      }
      setMissions(missionsData);
    } catch (e) {
      console.warn('Lỗi tải dữ liệu đội cứu hộ:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeamData();
  }, []);

  // Cập nhật trạng thái sẵn sàng của đội lên Backend
  const handleToggleAvailability = async (nextValue: boolean) => {
    if (!team) return;
    const prevValue = isAvailable;
    setIsAvailable(nextValue);
    try {
      await ResponseApi.updateTeamAvailability(
        team.id,
        team.version || 1,
        nextValue ? 'AVAILABLE' : 'UNAVAILABLE'
      );
      setTeam((prev) =>
        prev
          ? {
              ...prev,
              availability: nextValue ? 'AVAILABLE' : 'UNAVAILABLE',
              version: (prev.version || 1) + 1,
            }
          : null
      );
    } catch (err: any) {
      setIsAvailable(prevValue);
      Alert.alert(
        'Lỗi cập nhật trạng thái',
        typeof err === 'string' ? err : 'Không thể cập nhật trạng thái sẵn sàng của đội.'
      );
    }
  };

  // Cập nhật vị trí di quân hiện tại của Đội
  const handleBroadcastPosition = async () => {
    if (!team || !location) {
      Alert.alert('Chưa có vị trí GPS', 'Đang cập nhật GPS, vui lòng thử lại.');
      refreshLocation();
      return;
    }

    setIsUpdatingPosition(true);
    try {
      await ResponseApi.updateTeamPosition(team.id, location);
      Alert.alert('Thành công', 'Đã phát tín hiệu tọa độ hiện tại của đội cứu trợ lên bản đồ điều phối.');
    } catch (err: any) {
      Alert.alert('Lỗi cập nhật', typeof err === 'string' ? err : 'Không thể cập nhật vị trí.');
    } finally {
      setIsUpdatingPosition(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Xác nhận đăng xuất', 'Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?', [
      { text: 'Hủy' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: async () => {
          await logout();
          navigation.replace('EmergencyHomeScreen');
        },
      },
    ]);
  };

  const offeredCount = missions.filter((m) => m.status === 'OFFERED').length;
  const activeCount = missions.filter((m) => ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(m.status)).length;
  const completedCount = missions.filter((m) => m.status === 'COMPLETED').length;

  return (
    <ScreenContainer
      title="Bảng Điều Khiển Đội Cứu Hộ"
      subtitle={`Xin chào, ${user?.display_name || user?.username || 'Đồng chí'}`}
      headerRight={
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <LogOut size={20} color={THEME.colors.emergency.main} />
        </TouchableOpacity>
      }
    >
      {/* 1. THÔNG TIN ĐỘI & TRẠNG THÁI SẴN SÀNG */}
      <View style={styles.teamCard}>
        <View style={styles.teamHeaderRow}>
          <View style={styles.teamIconBox}>
            <Shield size={26} color={THEME.colors.primary.main} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.teamName} numberOfLines={1}>
                {team?.name || 'Đội Cứu Nạn Cơ Động'}
              </Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{getUserRoleName()}</Text>
              </View>
            </View>
            <Text style={styles.teamKind}>
              Lực lượng: {RESCUE_TEAM_KIND_LABELS[team?.team_kind || 'VOLUNTEER']}
            </Text>
          </View>
        </View>

        {/* Danh sách kỹ năng chuyên môn của đội */}
        {team?.skills && team.skills.length > 0 && (
          <View style={styles.skillsSection}>
            <View style={styles.skillsHeaderRow}>
              <Award size={14} color={THEME.colors.primary.main} />
              <Text style={styles.skillsTitle}>KỸ NĂNG TÁC CHIẾN CHUYÊN MÔN</Text>
            </View>
            <View style={styles.skillsList}>
              {team.skills.map((skillItem, idx) => {
                const code = typeof skillItem === 'string' ? skillItem : skillItem.code;
                const label =
                  typeof skillItem === 'string'
                    ? RESCUE_SKILL_LABELS[code] || code
                    : skillItem.name || RESCUE_SKILL_LABELS[code] || code;
                return (
                  <View key={idx} style={styles.skillChip}>
                    <Text style={styles.skillChipText}>{label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.availabilityRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.availTitle}>Sẵn sàng nhận nhiệm vụ cứu nạn</Text>
            <Text style={styles.availSubtitle}>
              {isAvailable ? 'Hệ thống có thể phân công nhiệm vụ mới' : 'Đang tạm dừng nhận nhiệm vụ'}
            </Text>
          </View>
          <Switch
            value={isAvailable}
            onValueChange={handleToggleAvailability}
            trackColor={{ false: '#CBD5E1', true: THEME.colors.success.light }}
            thumbColor={isAvailable ? THEME.colors.success.main : '#FFFFFF'}
          />
        </View>
      </View>

      {/* 2. PHÁT TÍN HIỆU VỊ TRÍ ĐỘI */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <MapPin size={20} color={THEME.colors.primary.main} />
          <Text style={styles.cardTitle}>TỌA ĐỘ VỊ TRÍ DI QUÂN CỦA ĐỘI</Text>
        </View>
        <Text style={styles.cardDesc}>
          Cập nhật tọa độ GPS định kỳ để trung tâm điều phối tìm kiếm và phân công các ca cứu nạn gần đội nhất.
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
              <Text style={styles.beaconButtonText}>Phát Tín Hiệu Vị Trí Hiện Tại</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* 3. THỐNG KÊ NHIỆM VỤ ĐƯỢC GIAO */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <ListTodo size={20} color={THEME.colors.primary.main} />
          <Text style={styles.cardTitle}>NHIỆM VỤ CỨU TRỢ CỦA ĐỘI</Text>
        </View>

        <View style={styles.statsGrid}>
          <View style={[styles.statBox, { backgroundColor: THEME.colors.warning.bg }]}>
            <AlertTriangle size={20} color={THEME.colors.warning.main} />
            <Text style={[styles.statNumber, { color: THEME.colors.warning.dark }]}>{offeredCount}</Text>
            <Text style={styles.statLabel}>Mới nhận</Text>
          </View>

          <View style={[styles.statBox, { backgroundColor: THEME.colors.primary.bg }]}>
            <Clock size={20} color={THEME.colors.primary.main} />
            <Text style={[styles.statNumber, { color: THEME.colors.primary.dark }]}>{activeCount}</Text>
            <Text style={styles.statLabel}>Đang cứu</Text>
          </View>

          <View style={[styles.statBox, { backgroundColor: THEME.colors.success.bg }]}>
            <CheckCircle2 size={20} color={THEME.colors.success.main} />
            <Text style={[styles.statNumber, { color: THEME.colors.success.dark }]}>{completedCount}</Text>
            <Text style={styles.statLabel}>Hoàn thành</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.viewMissionsBtn}
          onPress={() => navigation.navigate('MissionListScreen')}
          activeOpacity={0.85}
        >
          <Text style={styles.viewMissionsText}>Mở Danh Sách Nhiệm Vụ Chi Tiết</Text>
          <ChevronRight size={18} color={THEME.colors.primary.main} />
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  logoutBtn: {
    padding: 6,
  },
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
  },
  teamKind: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  roleBadge: {
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.colors.primary.main,
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
});
