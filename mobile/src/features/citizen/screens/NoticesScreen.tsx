import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { ResponseApi } from '../../../api/responseApi';
import { NoticeItem } from '../../../types/api';
import { formatNoticeDisplay } from '../../../constants/labels';
import { THEME } from '../../../constants/theme';
import { Bell, AlertCircle, CheckCircle2, ChevronRight, RefreshCw, X } from 'lucide-react-native';

export const NoticesScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [filterUnread, setFilterUnread] = useState<boolean>(false);
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);

  const fetchNotices = useCallback(async () => {
    try {
      const res = await ResponseApi.getNotices(filterUnread ? true : undefined);
      setNotices(res.items || []);
    } catch (e) {
      console.warn('Lỗi tải danh sách thông báo điều phối:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterUnread]);

  useEffect(() => {
    setLoading(true);
    fetchNotices();
  }, [fetchNotices]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchNotices();
  };

  const handleOpenNotice = async (notice: NoticeItem) => {
    setSelectedNotice(notice);
    if (!notice.read_at) {
      try {
        await ResponseApi.markNoticeRead(notice.id);
        setNotices((prev) =>
          prev.map((n) => (n.id === notice.id ? { ...n, read_at: new Date().toISOString() } : n))
        );
      } catch (e) {
        console.warn('Lỗi đánh dấu đã đọc thông báo:', e);
      }
    }
  };

  const unreadCount = notices.filter((n) => !n.read_at).length;

  return (
    <ScreenContainer
      title="Thông Báo Khẩn"
      subtitle="Từ Ban Chỉ Huy Điều Phối Cứu Trợ"
      onBack={() => navigation.goBack()}
      scrollable={false}
      headerRight={
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <RefreshCw size={20} color={THEME.colors.primary.main} />
        </TouchableOpacity>
      }
    >
      {/* THANH LỌC THÔNG BÁO */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, !filterUnread && styles.filterChipActive]}
          onPress={() => setFilterUnread(false)}
        >
          <Text style={[styles.filterText, !filterUnread && styles.filterTextActive]}>
            Tất Cả ({notices.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, filterUnread && styles.filterChipActive]}
          onPress={() => setFilterUnread(true)}
        >
          <Text style={[styles.filterText, filterUnread && styles.filterTextActive]}>
            Chưa Đọc {unreadCount > 0 ? `(${unreadCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* DANH SÁCH THÔNG BÁO */}
      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary.main} />
          <Text style={styles.loadingText}>Đang tải thông báo từ ban chỉ huy...</Text>
        </View>
      ) : notices.length === 0 ? (
        <View style={styles.emptyCard}>
          <Bell size={48} color={THEME.colors.text.muted} />
          <Text style={styles.emptyTitle}>Chưa có thông báo nào</Text>
          <Text style={styles.emptySubtitle}>
            Các lệnh điều động và cảnh báo thời tiết khẩn cấp sẽ hiển thị tại đây.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {notices.map((item) => {
            const isUnread = !item.read_at;
            const formatted = formatNoticeDisplay(item);
            const title = formatted.title;
            const message = formatted.message;

            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.noticeCard, isUnread && styles.noticeCardUnread]}
                onPress={() => handleOpenNotice(item)}
                activeOpacity={0.8}
              >
                <View style={styles.noticeIconBox}>
                  {isUnread ? (
                    <AlertCircle size={22} color={THEME.colors.emergency.main} />
                  ) : (
                    <CheckCircle2 size={22} color={THEME.colors.text.muted} />
                  )}
                </View>

                <View style={styles.noticeContent}>
                  <View style={styles.noticeTitleRow}>
                    <Text
                      style={[styles.noticeTitle, isUnread && styles.noticeTitleBold]}
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    {isUnread && <View style={styles.unreadDot} />}
                  </View>

                  {message ? (
                    <Text style={styles.noticeSnippet} numberOfLines={2}>
                      {message}
                    </Text>
                  ) : null}

                  <Text style={styles.noticeTime}>
                    {new Date(item.created_at).toLocaleDateString('vi-VN')}{' '}
                    {new Date(item.created_at).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>

                <ChevronRight size={18} color={THEME.colors.text.muted} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* MODAL CHI TIẾT THÔNG BÁO */}
      <Modal visible={!!selectedNotice} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          {(() => {
            const formatted = selectedNotice ? formatNoticeDisplay(selectedNotice) : null;
            return (
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalHeaderLeft}>
                    <Bell size={22} color={THEME.colors.primary.main} />
                    <Text style={styles.modalTitle} numberOfLines={1}>
                      {formatted?.title || 'Chi Tiết Thông Báo'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.closeBtn}
                    onPress={() => setSelectedNotice(null)}
                  >
                    <X size={20} color={THEME.colors.text.secondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalTime}>
                  Thời gian:{' '}
                  {selectedNotice?.created_at
                    ? new Date(selectedNotice.created_at).toLocaleString('vi-VN')
                    : ''}
                </Text>

                <ScrollView style={styles.modalBody}>
                  <Text style={styles.modalMessageText}>
                    {formatted?.message || 'Không có nội dung chi tiết.'}
                  </Text>
                </ScrollView>

                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => setSelectedNotice(null)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.modalCloseButtonText}>Đã Hiểu</Text>
                </TouchableOpacity>
              </View>
            );
          })()}
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  refreshBtn: {
    padding: 6,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 14,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: THEME.colors.surface.card,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  filterChipActive: {
    backgroundColor: THEME.colors.primary.main,
    borderColor: THEME.colors.primary.main,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text.secondary,
  },
  filterTextActive: {
    color: '#FFFFFF',
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
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  noticeCardUnread: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  noticeIconBox: {
    marginRight: 12,
  },
  noticeContent: {
    flex: 1,
    marginRight: 8,
  },
  noticeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  noticeTitle: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
    fontWeight: '600',
    flex: 1,
  },
  noticeTitleBold: {
    fontWeight: '800',
    color: THEME.colors.emergency.dark,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.colors.emergency.main,
    marginLeft: 6,
  },
  noticeSnippet: {
    fontSize: 12,
    color: THEME.colors.text.secondary,
    lineHeight: 18,
    marginBottom: 4,
  },
  noticeTime: {
    fontSize: 10,
    color: THEME.colors.text.muted,
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
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  modalTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginLeft: 8,
    flex: 1,
  },
  closeBtn: {
    padding: 4,
  },
  modalTime: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginTop: 8,
    marginBottom: 12,
  },
  modalBody: {
    maxHeight: 250,
    backgroundColor: THEME.colors.surface.background,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  modalMessageText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
    lineHeight: 22,
  },
  modalCloseButton: {
    backgroundColor: THEME.colors.primary.main,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    ...THEME.shadows.sm,
  },
  modalCloseButtonText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '800',
  },
});
