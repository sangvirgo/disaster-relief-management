import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronDown, Plus, RefreshCw, Search, Users, X } from 'lucide-react-native';
import { ResponseApi } from '../../../api/responseApi';
import { getApiErrorMessage, isApiErrorCode } from '../../../api/client';
import type { TeamMember, TeamMemberCandidate, TeamMembersPage } from '../../../types/api';
import { THEME } from '../../../constants/theme';

const roleLabels = { LEADER: 'Đội trưởng', MEMBER: 'Thành viên' } as const;

export const TeamMembersSection: React.FC<{ teamId: string }> = ({ teamId }) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [membersMore, setMembersMore] = useState(false);
  const [membersCursor, setMembersCursor] = useState<string>();
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [searchRetry, setSearchRetry] = useState(0);
  const [candidates, setCandidates] = useState<TeamMemberCandidate[]>([]);
  const [candidateCursor, setCandidateCursor] = useState<string>();
  const [candidatesMore, setCandidatesMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMoreCandidates, setLoadingMoreCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeamMemberCandidate | null>(null);
  const [adding, setAdding] = useState(false);
  const searchSequence = useRef(0);

  const loadMembers = useCallback(async (cursor?: string, append = false) => {
    if (append) setLoadingMoreMembers(true);
    else {
      setLoadingMembers(true);
      setMembersError(null);
    }
    try {
      const page: TeamMembersPage = await ResponseApi.getTeamMembers(teamId, 50, cursor);
      setMembers((current) => append
        ? [...current, ...page.items.filter((item) => !current.some((old) => old.user_id === item.user_id))]
        : page.items);
      setCanManage(page.can_manage_members);
      setMembersMore(page.more);
      setMembersCursor(page.cursor);
    } catch (error) {
      if (!append) setMembersError(getApiErrorMessage(error, 'Không thể tải danh sách thành viên.'));
    } finally {
      setLoadingMembers(false);
      setLoadingMoreMembers(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    const term = query.trim();
    const sequence = ++searchSequence.current;
    setCandidates([]);
    setCandidateCursor(undefined);
    setCandidatesMore(false);
    setLoadingMoreCandidates(false);
    setSelected(null);
    setCandidateError(null);
    if (!pickerVisible || term.length < 2) {
      setSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      setSearching(true);
      ResponseApi.searchTeamMemberCandidates(teamId, term, 50)
        .then((page) => {
          if (sequence !== searchSequence.current) return;
          setCandidates(page.items);
          setCandidateCursor(page.cursor);
          setCandidatesMore(page.more);
        })
        .catch((error) => {
          if (sequence === searchSequence.current) {
            setCandidateError(getApiErrorMessage(error, 'Không thể tìm tài khoản. Vui lòng thử lại.'));
          }
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearching(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [pickerVisible, query, searchRetry, teamId]);

  const loadMoreCandidates = async () => {
    if (!candidateCursor || !candidatesMore || searching || loadingMoreCandidates) return;
    const sequence = searchSequence.current;
    setLoadingMoreCandidates(true);
    setCandidateError(null);
    try {
      const page = await ResponseApi.searchTeamMemberCandidates(teamId, query.trim(), 50, candidateCursor);
      if (sequence !== searchSequence.current) return;
      setCandidates((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((old) => old.user_id === item.user_id)),
      ]);
      setCandidateCursor(page.cursor);
      setCandidatesMore(page.more);
    } catch (error) {
      if (sequence === searchSequence.current) {
        setCandidateError(getApiErrorMessage(error, 'Không thể tải thêm kết quả. Vui lòng thử lại.'));
      }
    } finally {
      if (sequence === searchSequence.current) setLoadingMoreCandidates(false);
    }
  };

  const closePicker = () => {
    searchSequence.current += 1;
    setPickerVisible(false);
    setQuery('');
    setCandidates([]);
    setCandidateCursor(undefined);
    setCandidatesMore(false);
    setCandidateError(null);
    setSelected(null);
  };

  const addSelectedMember = async () => {
    if (!selected || adding) return;
    setAdding(true);
    try {
      await ResponseApi.addTeamMember(teamId, selected.user_id);
      const name = selected.display_name;
      closePicker();
      await loadMembers();
      Alert.alert('Đã thêm thành viên', `${name} đã được thêm vào đội.`);
    } catch (error) {
      if (isApiErrorCode(error, 'USER_IN_OTHER_TEAM')) {
        setCandidateError('Tài khoản này vừa tham gia đội khác. Hãy tìm lại danh sách thành viên.');
      } else if (isApiErrorCode(error, 'STATE_TRANSITION_INVALID')) {
        setCandidateError('Tài khoản này hiện không hoạt động. Hãy tìm lại danh sách thành viên.');
      } else {
        setCandidateError(getApiErrorMessage(error, 'Không thể thêm thành viên. Vui lòng thử lại.'));
      }
      await loadMembers();
    } finally {
      setAdding(false);
    }
  };

  const openPicker = () => {
    setQuery('');
    setCandidates([]);
    setCandidateCursor(undefined);
    setCandidatesMore(false);
    setCandidateError(null);
    setSelected(null);
    setPickerVisible(true);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Users size={20} color={THEME.colors.primary.main} />
          <Text style={styles.title}>THÀNH VIÊN ĐỘI</Text>
        </View>
        <TouchableOpacity
          onPress={() => void loadMembers()}
          disabled={loadingMembers}
          accessibilityRole="button"
          accessibilityLabel="Tải lại danh sách thành viên"
          style={styles.iconButton}
        >
          <RefreshCw size={17} color={THEME.colors.primary.main} />
        </TouchableOpacity>
      </View>

      {loadingMembers ? (
        <View style={styles.stateRow}>
          <ActivityIndicator size="small" color={THEME.colors.primary.main} />
          <Text style={styles.stateText}>Đang tải danh sách thành viên…</Text>
        </View>
      ) : membersError ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>{membersError}</Text>
          <TouchableOpacity style={styles.smallAction} onPress={() => void loadMembers()} accessibilityRole="button">
            <Text style={styles.smallActionText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {members.length === 0 ? (
            <Text style={styles.stateText}>Đội hiện chưa có thành viên.</Text>
          ) : members.map((member) => (
            <View key={member.user_id} style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{member.display_name.slice(0, 1).toLocaleUpperCase('vi')}</Text>
              </View>
              <View style={styles.memberIdentity}>
                <Text style={styles.memberName} numberOfLines={1}>{member.display_name}</Text>
                <Text style={styles.memberDate}>Tham gia {new Date(member.joined_at).toLocaleDateString('vi-VN')}</Text>
              </View>
              <Text style={[styles.role, member.member_role === 'LEADER' && styles.leaderRole]}>
                {roleLabels[member.member_role]}
              </Text>
            </View>
          ))}

          {membersMore && membersCursor ? (
            <TouchableOpacity
              style={styles.moreButton}
              onPress={() => void loadMembers(membersCursor, true)}
              disabled={loadingMoreMembers}
              accessibilityRole="button"
            >
              {loadingMoreMembers ? <ActivityIndicator size="small" color={THEME.colors.primary.main} /> : <ChevronDown size={16} color={THEME.colors.primary.main} />}
              <Text style={styles.moreText}>{loadingMoreMembers ? 'Đang tải…' : 'Tải thêm thành viên'}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}

      {canManage ? (
        <TouchableOpacity style={styles.addButton} onPress={openPicker} accessibilityRole="button">
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Thêm thành viên</Text>
        </TouchableOpacity>
      ) : null}

      <Modal visible={pickerVisible} animationType="slide" onRequestClose={closePicker}>
        <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Thêm thành viên vào đội</Text>
              <Text style={styles.modalSubtitle}>Tìm tài khoản đang hoạt động theo tên hoặc tên đăng nhập.</Text>
            </View>
            <TouchableOpacity onPress={closePicker} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Đóng danh sách chọn">
              <X size={20} color={THEME.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBox}>
            <Search size={18} color={THEME.colors.text.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Nhập ít nhất 2 ký tự"
              placeholderTextColor={THEME.colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Tìm tài khoản theo tên hoặc tên đăng nhập"
              style={styles.searchInput}
            />
          </View>

          {query.trim().length < 2 ? (
            <Text style={styles.stateText}>Nhập ít nhất 2 ký tự để tìm tài khoản đang hoạt động.</Text>
          ) : null}

          {candidateError ? (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{candidateError}</Text>
              <TouchableOpacity onPress={() => setSearchRetry((value) => value + 1)} accessibilityRole="button">
                <Text style={styles.smallActionText}>Thử lại</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {searching && candidates.length === 0 ? (
            <View style={styles.stateRow}>
              <ActivityIndicator size="small" color={THEME.colors.primary.main} />
              <Text style={styles.stateText}>Đang tìm tài khoản…</Text>
            </View>
          ) : null}

          <FlatList
            style={styles.candidateList}
            data={candidates}
            keyExtractor={(item) => item.user_id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSelected = selected?.user_id === item.user_id;
              return (
                <TouchableOpacity
                  style={[styles.candidateRow, isSelected && styles.selectedCandidate]}
                  onPress={() => setSelected(isSelected ? null : item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.memberIdentity}>
                    <Text style={styles.memberName} numberOfLines={1}>{item.display_name}</Text>
                    <Text style={styles.memberDate}>@{item.username}</Text>
                  </View>
                  <View style={[styles.radio, isSelected && styles.radioSelected]}>
                    {isSelected ? <View style={styles.radioDot} /> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              !searching && query.trim().length >= 2 && !candidateError ? (
                <Text style={styles.stateText}>
                  {candidatesMore
                    ? 'Trang này chưa có tài khoản phù hợp. Tải thêm kết quả để xem tiếp.'
                    : 'Không tìm thấy tài khoản phù hợp.'}
                </Text>
              ) : null
            }
            ListFooterComponent={candidatesMore ? (
              <TouchableOpacity style={styles.moreButton} onPress={() => void loadMoreCandidates()} disabled={loadingMoreCandidates || searching} accessibilityRole="button">
                {loadingMoreCandidates ? <ActivityIndicator size="small" color={THEME.colors.primary.main} /> : <ChevronDown size={16} color={THEME.colors.primary.main} />}
                <Text style={styles.moreText}>{loadingMoreCandidates ? 'Đang tải…' : 'Tải thêm kết quả'}</Text>
              </TouchableOpacity>
            ) : null}
          />

          {selected ? (
            <TouchableOpacity style={[styles.addButton, adding && styles.disabledButton]} onPress={() => void addSelectedMember()} disabled={adding} accessibilityRole="button">
              {adding ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Plus size={18} color="#FFFFFF" />}
              <Text style={styles.addButtonText}>{adding ? 'Đang thêm…' : `Thêm ${selected.display_name}`}</Text>
            </TouchableOpacity>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: THEME.colors.text.primary, fontSize: 14, fontWeight: '800' },
  iconButton: { padding: 8, borderRadius: 8, backgroundColor: THEME.colors.primary.bg },
  stateRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stateBlock: { alignItems: 'flex-start', paddingVertical: 8 },
  stateText: { color: THEME.colors.text.secondary, fontSize: 14, paddingVertical: 10 },
  errorText: { color: THEME.colors.emergency.dark, fontSize: 14, flex: 1 },
  smallAction: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: THEME.colors.primary.bg },
  smallActionText: { color: THEME.colors.primary.dark, fontSize: 13, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderTopWidth: 1, borderTopColor: THEME.colors.surface.border, gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: THEME.colors.primary.bg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: THEME.colors.primary.dark, fontWeight: '800' },
  memberIdentity: { flex: 1, minWidth: 0 },
  memberName: { color: THEME.colors.text.primary, fontSize: 14, fontWeight: '700' },
  memberDate: { color: THEME.colors.text.muted, fontSize: 12, marginTop: 3 },
  role: { color: THEME.colors.text.secondary, backgroundColor: THEME.colors.surface.background, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, fontSize: 11, fontWeight: '700' },
  leaderRole: { color: THEME.colors.primary.dark, backgroundColor: THEME.colors.primary.bg },
  moreButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  moreText: { color: THEME.colors.primary.dark, fontSize: 13, fontWeight: '700' },
  addButton: { minHeight: 46, marginTop: 12, borderRadius: 10, backgroundColor: THEME.colors.primary.main, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  addButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.65 },
  modal: { flex: 1, paddingTop: 50, paddingHorizontal: 18, paddingBottom: 22, backgroundColor: THEME.colors.surface.background },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 18 },
  modalTitle: { fontSize: 20, color: THEME.colors.text.primary, fontWeight: '800' },
  modalSubtitle: { fontSize: 13, color: THEME.colors.text.secondary, marginTop: 5 },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: THEME.colors.surface.border, marginBottom: 10 },
  searchInput: { flex: 1, minHeight: 44, color: THEME.colors.text.primary, fontSize: 15 },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, backgroundColor: THEME.colors.emergency.bg, marginBottom: 8 },
  candidateRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderRadius: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.surface.border },
  candidateList: { flex: 1 },
  selectedCandidate: { backgroundColor: THEME.colors.primary.bg },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: THEME.colors.surface.divider, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: THEME.colors.primary.main },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: THEME.colors.primary.main },
});
