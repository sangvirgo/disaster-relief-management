import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { ResponseApi } from '../../../api/responseApi';
import { Mission, MissionStatus } from '../../../types/api';
import { INCIDENT_CATEGORIES } from '../../../constants/labels';
import { THEME } from '../../../constants/theme';
import { AlertTriangle, Users, MapPin, ChevronRight, Inbox } from 'lucide-react-native';

export const MissionListScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'OFFERED' | 'ACTIVE' | 'COMPLETED'>('OFFERED');

  const fetchMissions = async () => {
    setLoading(true);
    try {
      const data = await ResponseApi.getMyMissions();
      setMissions(data);
    } catch (e) {
      console.warn('Lỗi lấy danh sách nhiệm vụ:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMissions();
  }, []);

  const filteredMissions = missions.filter((m) => {
    if (activeTab === 'OFFERED') return m.status === 'OFFERED';
    if (activeTab === 'ACTIVE') return ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(m.status);
    return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(m.status);
  });

  const renderMissionItem = ({ item }: { item: Mission }) => {
    const categoryInfo = INCIDENT_CATEGORIES[item.category] || { label: 'Sự cố cứu hộ' };

    return (
      <TouchableOpacity
        style={styles.missionCard}
        onPress={() => navigation.navigate('MissionDetailScreen', { missionId: item.id })}
        activeOpacity={0.85}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{categoryInfo.label}</Text>
          </View>
          <StatusBadge missionStatus={item.status} />
        </View>

        {item.declared_danger && (
          <View style={styles.dangerAlertBox}>
            <AlertTriangle size={16} color={THEME.colors.emergency.main} />
            <Text style={styles.dangerAlertText}>Cảnh báo: Có nguy cơ đe dọa tính mạng tức thời!</Text>
          </View>
        )}

        <Text style={styles.missionDesc} numberOfLines={2}>
          {item.description || 'Nạn nhân cần hỗ trợ khẩn cấp, chưa có mô tả chi tiết.'}
        </Text>

        <View style={styles.cardBottomRow}>
          <View style={styles.metaItem}>
            <Users size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.metaText}>{item.people_affected || 1} người</Text>
          </View>

          <View style={styles.metaItem}>
            <MapPin size={16} color={THEME.colors.primary.main} />
            <Text style={styles.metaText}>
              {item.distance_m ? `${(item.distance_m / 1000).toFixed(1)} km` : 'Cách ~1.2 km'}
            </Text>
          </View>

          <View style={styles.actionPrompt}>
            <Text style={styles.actionPromptText}>Xem chi tiết</Text>
            <ChevronRight size={16} color={THEME.colors.primary.main} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer
      title="Danh Sách Nhiệm Vụ"
      subtitle="Nhiệm vụ cứu hộ được chỉ định"
      scrollable={false}
      onBack={() => navigation.goBack()}
    >
      {/* CÁC TAB PHÂN LOẠI */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'OFFERED' && styles.tabButtonActive]}
          onPress={() => setActiveTab('OFFERED')}
        >
          <Text style={[styles.tabText, activeTab === 'OFFERED' && styles.tabTextActive]}>Mới nhận</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'ACTIVE' && styles.tabButtonActive]}
          onPress={() => setActiveTab('ACTIVE')}
        >
          <Text style={[styles.tabText, activeTab === 'ACTIVE' && styles.tabTextActive]}>Đang cứu</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'COMPLETED' && styles.tabButtonActive]}
          onPress={() => setActiveTab('COMPLETED')}
        >
          <Text style={[styles.tabText, activeTab === 'COMPLETED' && styles.tabTextActive]}>Lịch sử</Text>
        </TouchableOpacity>
      </View>

      {/* DANH SÁCH NHIỆM VỤ */}
      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang tải danh sách nhiệm vụ...</Text>
        </View>
      ) : filteredMissions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Inbox size={48} color={THEME.colors.text.muted} />
          <Text style={styles.emptyTitle}>Chưa có nhiệm vụ nào</Text>
          <Text style={styles.emptySubtitle}>
            {activeTab === 'OFFERED'
              ? 'Hiện tại không có nhiệm vụ mới đang chờ tiếp nhận.'
              : 'Không có nhiệm vụ trong mục này.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredMissions}
          keyExtractor={(item) => item.id}
          renderItem={renderMissionItem}
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchMissions} />}
        />
      )}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.surface.border,
    padding: 4,
    borderRadius: 12,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 9,
  },
  tabButtonActive: {
    backgroundColor: THEME.colors.surface.card,
    ...THEME.shadows.sm,
  },
  tabText: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
  },
  tabTextActive: {
    color: THEME.colors.primary.main,
    fontWeight: '800',
  },
  missionCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryBadge: {
    backgroundColor: THEME.colors.surface.background,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
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
    padding: 8,
    borderRadius: 8,
    marginVertical: 6,
  },
  dangerAlertText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.emergency.dark,
    marginLeft: 6,
  },
  missionDesc: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 12,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
    paddingTop: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    fontWeight: '600',
    marginLeft: 6,
  },
  actionPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionPromptText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.primary.main,
    fontWeight: '700',
    marginRight: 2,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
    marginTop: 10,
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
});
