import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { ResponseApi } from '../../../api/responseApi';
import { getApiErrorMessage } from '../../../api/client';
import { MyRequestItem } from '../../../types/api';
import { THEME } from '../../../constants/theme';
import {
  ClipboardList,
  ChevronRight,
  Clock,
  Link2,
  AlertCircle,
  FileSearch,
} from 'lucide-react-native';

export const MyRequestsScreen: React.FC = () => {
  const router = useRouter();
  const [items, setItems] = useState<MyRequestItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal gắn yêu cầu ẩn danh vào tài khoản
  const [showClaimModal, setShowClaimModal] = useState<boolean>(false);
  const [claimTrackingCode, setClaimTrackingCode] = useState<string>('');
  const [claimSecret, setClaimSecret] = useState<string>('');
  const [isClaiming, setIsClaiming] = useState<boolean>(false);

  const fetchMyRequests = useCallback(async () => {
    setErrorMsg(null);
    try {
      const result = await ResponseApi.getMyRequests();
      setItems(result.items || []);
    } catch (err: any) {
      setErrorMsg(getApiErrorMessage(err, 'Không thể tải danh sách yêu cầu. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Initial loading is already true; this starts the initial request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMyRequests();
  }, [fetchMyRequests]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchMyRequests();
  };

  const handleClaim = async () => {
    const code = claimTrackingCode.trim().toUpperCase();
    const secret = claimSecret.trim();

    if (!code || !secret) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập cả mã tra cứu và chuỗi bí mật.');
      return;
    }

    setIsClaiming(true);
    try {
      await ResponseApi.claimRequest(code, secret);
      Alert.alert(
        'Gắn yêu cầu thành công',
        `Yêu cầu cứu hộ ${code} đã được gắn chính thức vào tài khoản của bạn.`
      );
      setClaimTrackingCode('');
      setClaimSecret('');
      setShowClaimModal(false);
      fetchMyRequests();
    } catch (err: any) {
      Alert.alert('Lỗi', getApiErrorMessage(err, 'Không thể gắn yêu cầu. Vui lòng kiểm tra lại mã và bí mật.'));
    } finally {
      setIsClaiming(false);
    }
  };

  const renderItem = ({ item }: { item: MyRequestItem }) => {
    const formattedDate = new Date(item.received_at).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          router.push({ pathname: '/tracking', params: {
            trackingCode: item.tracking_code,
          } })
        }
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          <View style={styles.codeRow}>
            <FileSearch size={18} color={THEME.colors.primary.main} />
            <Text style={styles.codeText}>{item.tracking_code}</Text>
          </View>
          <StatusBadge status={item.status} />
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.timeRow}>
            <Clock size={14} color={THEME.colors.text.muted} />
            <Text style={styles.timeText}>Đã gửi lúc: {formattedDate}</Text>
          </View>
          <View style={styles.actionRow}>
            <Text style={styles.viewDetailText}>Xem tiến độ</Text>
            <ChevronRight size={16} color={THEME.colors.primary.main} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer
      title="Yêu Cầu Cứu Trợ Của Tôi"
      subtitle="Danh sách các tin báo cứu nạn gắn với tài khoản của bạn"
      scrollable={false}
      onBack={() => goBackOrHome(router)}
    >
      {/* Nút gắn yêu cầu ẩn danh vào tài khoản */}
      <TouchableOpacity
        style={styles.claimButton}
        onPress={() => setShowClaimModal(true)}
        activeOpacity={0.8}
      >
        <Link2 size={18} color={THEME.colors.primary.main} style={{ marginRight: 8 }} />
        <Text style={styles.claimButtonText}>Gắn yêu cầu cứu trợ ẩn danh vào tài khoản</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang tải danh sách yêu cầu...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.centerContainer}>
          <AlertCircle size={44} color={THEME.colors.emergency.main} />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchMyRequests}>
            <Text style={styles.retryText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ClipboardList size={56} color={THEME.colors.text.muted} />
          <Text style={styles.emptyTitle}>Chưa có yêu cầu cứu trợ nào</Text>
          <Text style={styles.emptyDesc}>
            Các yêu cầu cứu nạn bản thân hoặc báo hộ người thân khi đăng nhập sẽ hiển thị tại đây để bạn tiện theo dõi.
          </Text>
          <TouchableOpacity
            style={styles.createSOSButton}
            onPress={() => router.replace('/')}
            activeOpacity={0.85}
          >
            <Text style={styles.createSOSText}>GỬI YÊU CẦU CỨU NẠN NGAY</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[THEME.colors.primary.main]}
            />
          }
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal gắn yêu cầu */}
      <Modal visible={showClaimModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>GẮN YÊU CẦU ẨN DANH</Text>
            <Text style={styles.modalSubtitle}>
              Nếu bạn đã từng gửi yêu cầu cứu nạn khi chưa đăng nhập, hãy nhập mã tra cứu và chuỗi bí mật để liên kết vào tài khoản.
            </Text>

            <View style={styles.modalInputGroup}>
              <Text style={styles.modalInputLabel}>Mã tra cứu (Tracking Code):</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="Ví dụ: 9K8J7H6G5F"
                placeholderTextColor={THEME.colors.text.muted}
                value={claimTrackingCode}
                onChangeText={setClaimTrackingCode}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.modalInputGroup}>
              <Text style={styles.modalInputLabel}>Chuỗi bí mật (Tracking Secret):</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="Nhập chuỗi bí mật gồm 43 ký tự..."
                placeholderTextColor={THEME.colors.text.muted}
                value={claimSecret}
                onChangeText={setClaimSecret}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowClaimModal(false)}
                disabled={isClaiming}
              >
                <Text style={styles.modalCancelText}>HỦY BỎ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitButton, isClaiming && { opacity: 0.6 }]}
                onPress={handleClaim}
                disabled={isClaiming}
              >
                {isClaiming ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>LIÊN KẾT NGAY</Text>
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
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 14,
  },
  claimButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary.main,
  },
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    marginBottom: 10,
    ...THEME.shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  codeText: {
    fontSize: 14,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 11,
    color: THEME.colors.text.muted,
    marginLeft: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewDetailText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginRight: 2,
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
  },
  errorText: {
    marginTop: 12,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.emergency.main,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: THEME.colors.primary.main,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginTop: 16,
  },
  emptyDesc: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  createSOSButton: {
    marginTop: 20,
    backgroundColor: THEME.colors.emergency.main,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  createSOSText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    ...THEME.shadows.md,
  },
  modalTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    letterSpacing: 0.5,
  },
  modalSubtitle: {
    fontSize: 12,
    color: THEME.colors.text.secondary,
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 17,
  },
  modalInputGroup: {
    marginBottom: 12,
  },
  modalInputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginBottom: 6,
  },
  modalTextInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: THEME.colors.text.primary,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.text.secondary,
  },
  modalSubmitButton: {
    backgroundColor: THEME.colors.primary.main,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalSubmitText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
