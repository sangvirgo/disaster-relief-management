import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { IdentityApi } from '../../../api/identityApi';
import { getApiErrorMessage } from '../../../api/client';
import { useAuthStore } from '../../../store/authStore';
import { THEME } from '../../../constants/theme';
import { KeyRound, Lock, Eye, EyeOff, ShieldAlert, CheckCircle2 } from 'lucide-react-native';

export const ChangePasswordScreen: React.FC = () => {
  const router = useRouter();
  const { user, refreshMe } = useAuthStore();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập đầy đủ các trường mật khẩu.');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Mật khẩu quá ngắn', 'Mật khẩu mới phải có ít nhất 8 ký tự.');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Mật khẩu không khớp', 'Mật khẩu mới và mật khẩu xác nhận không trùng khớp.');
      return;
    }

    if (newPassword === currentPassword) {
      Alert.alert('Mật khẩu trùng lặp', 'Mật khẩu mới không được trùng với mật khẩu hiện tại.');
      return;
    }

    setIsSubmitting(true);
    try {
      await IdentityApi.changePassword(currentPassword, newPassword);
      if (refreshMe) {
        await refreshMe();
      }
      Alert.alert('Thành công', 'Đã đổi mật khẩu an toàn! Vui lòng ghi nhớ mật khẩu mới của bạn.', [
        {
          text: 'Đồng ý',
          onPress: () => {
            goBackOrHome(router);
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert(
        'Lỗi đổi mật khẩu',
        getApiErrorMessage(err, 'Không thể đổi mật khẩu. Vui lòng kiểm tra lại mật khẩu hiện tại.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
      <ScreenContainer title="Đổi Mật Khẩu" onBack={() => goBackOrHome(router)} scrollable={true}>
      {/* CẢNH BÁO ĐỔI MẬT KHẨU MẶC ĐỊNH NẾU CÓ */}
      {user?.must_change_password && (
        <View style={styles.warningBanner}>
          <ShieldAlert size={22} color={THEME.colors.warning.main} />
          <View style={styles.warningTextContainer}>
            <Text style={styles.warningTitle}>YÊU CẦU BẢO MẬT BẮT BUỘC</Text>
            <Text style={styles.warningDesc}>
              Tài khoản của bạn đang sử dụng mật khẩu mặc định hoặc hệ thống yêu cầu đổi mật khẩu trước khi thực hiện các nhiệm vụ cứu nạn tiếp theo.
            </Text>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.headerIconBox}>
          <KeyRound size={28} color={THEME.colors.primary.main} />
        </View>
        <Text style={styles.cardTitle}>THIẾT LẬP MẬT KHẨU MỚI</Text>
        <Text style={styles.cardSubtitle}>
          Đảm bảo mật khẩu có tối thiểu 8 ký tự gồm chữ hoa, chữ thường và chữ số để bảo vệ an toàn tài khoản tác chiến.
        </Text>

        {/* Mật khẩu hiện tại */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Mật khẩu hiện tại:</Text>
          <View style={styles.inputWrapper}>
            <Lock size={18} color={THEME.colors.text.secondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nhập mật khẩu đang dùng"
              placeholderTextColor={THEME.colors.text.muted}
              secureTextEntry={!showCurrentPassword}
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowCurrentPassword((prev) => !prev)}
            >
              {showCurrentPassword ? (
                <EyeOff size={18} color={THEME.colors.text.secondary} />
              ) : (
                <Eye size={18} color={THEME.colors.text.secondary} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Mật khẩu mới */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Mật khẩu mới:</Text>
          <View style={styles.inputWrapper}>
            <Lock size={18} color={THEME.colors.text.secondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Ít nhất 8 ký tự"
              placeholderTextColor={THEME.colors.text.muted}
              secureTextEntry={!showNewPassword}
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowNewPassword((prev) => !prev)}
            >
              {showNewPassword ? (
                <EyeOff size={18} color={THEME.colors.text.secondary} />
              ) : (
                <Eye size={18} color={THEME.colors.text.secondary} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Xác nhận mật khẩu mới */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Xác nhận mật khẩu mới:</Text>
          <View style={styles.inputWrapper}>
            <Lock size={18} color={THEME.colors.text.secondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nhập lại mật khẩu mới"
              placeholderTextColor={THEME.colors.text.muted}
              secureTextEntry={!showConfirmPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowConfirmPassword((prev) => !prev)}
            >
              {showConfirmPassword ? (
                <EyeOff size={18} color={THEME.colors.text.secondary} />
              ) : (
                <Eye size={18} color={THEME.colors.text.secondary} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Nút gửi */}
        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && { opacity: 0.7 }]}
          onPress={handleChangePassword}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <CheckCircle2 size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.submitButtonText}>Cập Nhật Mật Khẩu</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  warningBanner: {
    flexDirection: 'row',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  warningTextContainer: {
    marginLeft: 10,
    flex: 1,
  },
  warningTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.warning.main,
    marginBottom: 4,
  },
  warningDesc: {
    fontSize: 12,
    color: THEME.colors.text.primary,
    lineHeight: 18,
  },
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.md,
  },
  headerIconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    letterSpacing: 0.5,
  },
  cardSubtitle: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 20,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 50,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  eyeBtn: {
    padding: 6,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    ...THEME.shadows.md,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.sm + 1,
    fontWeight: '800',
  },
});
