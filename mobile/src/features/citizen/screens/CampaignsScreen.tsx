import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { ResponseApi } from '../../../api/responseApi';
import { PublicCampaign } from '../../../types/api';
import { THEME } from '../../../constants/theme';
import {
  Flag,
  MapPin,
  Calendar,
  HeartHandshake,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
} from 'lucide-react-native';

export const CampaignsScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [campaigns, setCampaigns] = useState<PublicCampaign[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await ResponseApi.getPublicCampaigns();
      setCampaigns(res.items || []);
    } catch (e) {
      console.warn('Lỗi tải danh sách chiến dịch cứu trợ:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchCampaigns();
  }, [fetchCampaigns]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCampaigns();
  };

  const getCampaignStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
      case 'ACTIVE':
        return { label: 'Đang triển khai', color: '#16A34A', bg: '#DCFCE7' };
      case 'PAUSED':
        return { label: 'Tạm dừng', color: '#D97706', bg: '#FEF3C7' };
      case 'CLOSED':
        return { label: 'Đã hoàn thành', color: '#475569', bg: '#F1F5F9' };
      default:
        return { label: status, color: THEME.colors.primary.main, bg: THEME.colors.primary.bg };
    }
  };

  return (
    <ScreenContainer
      title="Chiến Dịch Cứu Trợ"
      subtitle="Các chiến dịch cứu trợ quy mô lớn đang triển khai"
      onBack={() => navigation.goBack()}
      scrollable={false}
      headerRight={
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <RefreshCw size={20} color={THEME.colors.primary.main} />
        </TouchableOpacity>
      }
    >
      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang cập nhật chiến dịch cứu trợ...</Text>
        </View>
      ) : campaigns.length === 0 ? (
        <View style={styles.emptyCard}>
          <Flag size={48} color={THEME.colors.text.muted} />
          <Text style={styles.emptyTitle}>Chưa có chiến dịch nào được mở</Text>
          <Text style={styles.emptySubtitle}>
            Ban chỉ huy sẽ phát động các chiến dịch cứu trợ khi thiên tai diễn biến phức tạp.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.bannerBox}>
            <Text style={styles.bannerTitle}>CHIẾN DỊCH CỨU NẠN & TIẾP TẾ TOÀN DÂN</Text>
            <Text style={styles.bannerDesc}>
              Mỗi chiến dịch điều phối tập trung nguồn lực cứu nạn, nhu yếu phẩm và phương tiện cano cho các vùng lũ trọng điểm.
            </Text>
          </View>

          {campaigns.map((camp) => {
            const badge = getCampaignStatusBadge(camp.status);
            return (
              <View key={camp.id} style={styles.campaignCard}>
                <View style={styles.campaignHeader}>
                  <View style={styles.iconCircle}>
                    <Flag size={20} color={THEME.colors.primary.main} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.campaignTitle}>{camp.title}</Text>
                    {camp.region_code ? (
                      <View style={styles.regionRow}>
                        <MapPin size={14} color={THEME.colors.text.secondary} />
                        <Text style={styles.regionText}>Khu vực: {camp.region_code}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                </View>

                {camp.description ? (
                  <Text style={styles.campaignDesc}>{camp.description}</Text>
                ) : null}

                <View style={styles.metaRow}>
                  <Calendar size={14} color={THEME.colors.text.muted} />
                  <Text style={styles.dateText}>
                    Ngày phát động: {new Date(camp.created_at).toLocaleDateString('vi-VN')}
                  </Text>
                </View>

                {/* HÀNG NÚT TÁC VỤ */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.donateActionBtn}
                    onPress={() => navigation.navigate('DonationScreen')}
                    activeOpacity={0.8}
                  >
                    <HeartHandshake size={16} color={THEME.colors.primary.main} />
                    <Text style={styles.donateActionText}>Ủng Hộ Nhu Yếu Phẩm</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.sosActionBtn}
                    onPress={() => navigation.navigate('CreateSOSScreen')}
                    activeOpacity={0.8}
                  >
                    <AlertTriangle size={16} color="#FFFFFF" />
                    <Text style={styles.sosActionText}>Báo Cứu Nạn</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  refreshBtn: {
    padding: 6,
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
  emptyCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
    marginTop: 4,
  },
  bannerBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  bannerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.primary.dark,
    marginBottom: 4,
  },
  bannerDesc: {
    fontSize: 12,
    color: THEME.colors.text.primary,
    lineHeight: 18,
  },
  campaignCard: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  campaignHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campaignTitle: {
    fontSize: THEME.typography.fontSizes.sm + 1,
    fontWeight: '800',
    color: THEME.colors.text.primary,
  },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  regionText: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginLeft: 4,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  campaignDesc: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    color: THEME.colors.text.secondary,
    lineHeight: 20,
    marginTop: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
  },
  dateText: {
    fontSize: 11,
    color: THEME.colors.text.muted,
    marginLeft: 6,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },
  donateActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    height: 40,
    borderRadius: 10,
  },
  donateActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginLeft: 6,
  },
  sosActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.emergency.main,
    height: 40,
    borderRadius: 10,
  },
  sosActionText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    marginLeft: 6,
  },
});
