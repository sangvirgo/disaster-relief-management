import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { RequiredAsterisk } from '../../../components/common/RequiredAsterisk';
import { IdentityApi } from '../../../api/identityApi';
import { getApiErrorMessage } from '../../../api/client';
import { useAuthStore } from '../../../store/authStore';
import { THEME } from '../../../constants/theme';
import { isCommonPassword } from '../../../utils/formValidation';
import { KeyRound, Lock, Eye, EyeOff, ShieldAlert, CheckCircle2, Link2 } from 'lucide-react-native';

export const ChangePasswordScreen: React.FC = () => {
  const router = useRouter();
  const { user, refreshMe } = useAuthStore();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string | undefined>>({});

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentPasswordError = (value: string) => value.length > 256
    ? 'Mật khẩu không được vượt quá 256 ký tự.'
    : undefined;
  const newPasswordError = (value: string, currentValue = currentPassword) => {
    if (!value) return undefined;
    if ([...value].length < 10) return 'Mật khẩu mới phải có ít nhất 10 ký tự.';
    if ([...value].length > 256) return 'Mật khẩu không được vượt quá 256 ký tự.';
    if (user?.username && value.toLowerCase() === user.username.toLowerCase()) return 'Mật khẩu không được trùng tên đăng nhập.';
    if (value === currentValue) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    if (isCommonPassword(value)) return 'Mật khẩu quá phổ biến. Hãy chọn mật khẩu khó đoán hơn.';
    return undefined;
  };
  const confirmPasswordError = (value: string, newValue = newPassword) => {
    if ([...value].length > 256) return 'Mật khẩu xác nhận không được vượt quá 256 ký tự.';
    return value && value !== newValue ? 'Mật khẩu xác nhận chưa khớp.' : undefined;
  };

  const [googleBusy, setGoogleBusy] = useState(false);
  const googleClients = {
    web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  };
  const googleConfigured = Boolean(Platform.select({
    ios: googleClients.ios,
    android: googleClients.android,
    default: googleClients.web,
  }));
  const [googleRequest, , promptGoogle] = useIdTokenAuthRequest({
    webClientId: googleClients.web || 'google-client-id-not-configured',
    iosClientId: googleClients.ios || 'google-client-id-not-configured',
    androidClientId: googleClients.android || 'google-client-id-not-configured',
    selectAccount: true,
  }, { scheme: 'com.disasterrelief.c48mobile' });

  const handleLinkGoogle = async () => {
    if (!googleConfigured) {
      Alert.alert('Chưa cấu hình Google', 'Cần khai báo Google OAuth Client ID cho nền tảng này trong biến môi trường EXPO_PUBLIC_GOOGLE_*_CLIENT_ID.');
      return;
    }
    setGoogleBusy(true);
    try {
      const result = await promptGoogle();
      if (result.type !== 'success') return;
      const idToken = result.params.id_token;
      if (!idToken) throw new Error('Google chưa trả về mã định danh an toàn.');
      await IdentityApi.linkGoogle(idToken);
      if (refreshMe) {
        await refreshMe();
      }
      Alert.alert('Thành công', 'Đã liên kết tài khoản Google an toàn với tài khoản tác chiến của bạn.');
    } catch (err: unknown) {
      Alert.alert('Liên kết thất bại', getApiErrorMessage(err, 'Không thể liên kết tài khoản Google. Tài khoản này có thể đã được sử dụng bởi người dùng khác.'));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleChangePassword = async () => {
    const errors: Record<string, string> = {};
    if (!currentPassword) errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.';
    else if ([...currentPassword].length > 256) errors.currentPassword = 'Mật khẩu không được vượt quá 256 ký tự.';
    if (!newPassword) errors.newPassword = 'Vui lòng nhập mật khẩu mới.';
    else if ([...newPassword].length < 10) errors.newPassword = 'Mật khẩu mới phải có ít nhất 10 ký tự.';
    else if ([...newPassword].length > 256) errors.newPassword = 'Mật khẩu không được vượt quá 256 ký tự.';
    else if (user?.username && newPassword.toLowerCase() === user.username.toLowerCase()) {
      errors.newPassword = 'Mật khẩu không được trùng tên đăng nhập.';
    } else if (newPassword === currentPassword) errors.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    else if (isCommonPassword(newPassword)) errors.newPassword = 'Mật khẩu quá phổ biến. Hãy chọn mật khẩu khó đoán hơn.';
    if (!confirmPassword) errors.confirmPassword = 'Vui lòng xác nhận mật khẩu mới.';
    else if (newPassword !== confirmPassword) errors.confirmPassword = 'Mật khẩu xác nhận chưa khớp.';

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
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

  const submitDisabled = isSubmitting || !currentPassword || !newPassword || [...newPassword].length < 10 ||
    !confirmPassword || newPassword !== confirmPassword || Boolean(currentPasswordError(currentPassword)) ||
    Boolean(newPasswordError(newPassword)) || Boolean(confirmPasswordError(confirmPassword));

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
          Mật khẩu phải có ít nhất 10 ký tự, không trùng tên đăng nhập và không thuộc danh sách mật khẩu phổ biến.
        </Text>

        {/* Mật khẩu hiện tại */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Mật khẩu hiện tại <RequiredAsterisk /></Text>
          <View style={styles.inputWrapper}>
            <Lock size={18} color={THEME.colors.text.secondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nhập mật khẩu đang dùng"
              placeholderTextColor={THEME.colors.text.muted}
              secureTextEntry={!showCurrentPassword}
              value={currentPassword}
              onChangeText={(value) => {
                setCurrentPassword(value);
                setFormErrors((current) => ({
                  ...current,
                  currentPassword: currentPasswordError(value),
                  newPassword: newPasswordError(newPassword, value),
                }));
              }}
              onBlur={() => {
                if (!currentPassword) setFormErrors((current) => ({ ...current, currentPassword: 'Mật khẩu hiện tại là bắt buộc.' }));
              }}
              maxLength={257}
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
          <FormFieldError message={formErrors.currentPassword} />
        </View>

        {/* Mật khẩu mới */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Mật khẩu mới <RequiredAsterisk /></Text>
          <View style={styles.inputWrapper}>
            <Lock size={18} color={THEME.colors.text.secondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Ít nhất 10 ký tự"
              placeholderTextColor={THEME.colors.text.muted}
              secureTextEntry={!showNewPassword}
              value={newPassword}
              onChangeText={(value) => {
                setNewPassword(value);
                setFormErrors((current) => ({
                  ...current,
                  newPassword: newPasswordError(value),
                  confirmPassword: confirmPasswordError(confirmPassword, value),
                }));
              }}
              onBlur={() => {
                if (!newPassword) setFormErrors((current) => ({ ...current, newPassword: 'Mật khẩu mới là bắt buộc.' }));
              }}
              maxLength={257}
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
          <FormFieldError message={formErrors.newPassword} />
        </View>

        {/* Xác nhận mật khẩu mới */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Xác nhận mật khẩu mới <RequiredAsterisk /></Text>
          <View style={styles.inputWrapper}>
            <Lock size={18} color={THEME.colors.text.secondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nhập lại mật khẩu mới"
              placeholderTextColor={THEME.colors.text.muted}
              secureTextEntry={!showConfirmPassword}
              value={confirmPassword}
              onChangeText={(value) => {
                setConfirmPassword(value);
                setFormErrors((current) => ({ ...current, confirmPassword: confirmPasswordError(value) }));
              }}
              onBlur={() => {
                if (!confirmPassword) setFormErrors((current) => ({ ...current, confirmPassword: 'Xác nhận mật khẩu mới là bắt buộc.' }));
              }}
              maxLength={257}
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
          <FormFieldError message={formErrors.confirmPassword} />
        </View>

        {/* Nút gửi */}
        <TouchableOpacity
          style={[styles.submitButton, submitDisabled && { opacity: 0.5 }]}
          onPress={handleChangePassword}
          disabled={submitDisabled}
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

      {/* LIÊN KẾT TÀI KHOẢN GOOGLE */}
      <View style={[styles.card, { marginTop: 16 }]}>
        <View style={styles.headerIconBox}>
          <Link2 size={28} color={THEME.colors.primary.main} />
        </View>
        <Text style={styles.cardTitle}>LIÊN KẾT TÀI KHOẢN GOOGLE</Text>
        <Text style={styles.cardSubtitle}>
          Liên kết tài khoản Google để có thể đăng nhập nhanh chóng bằng xác thực một chạm an toàn.
        </Text>

        <TouchableOpacity
          style={[styles.googleButton, (googleBusy || !googleRequest) && styles.submitButtonDisabled]}
          onPress={handleLinkGoogle}
          disabled={googleBusy || !googleRequest}
          activeOpacity={0.85}
        >
          {googleBusy ? (
            <ActivityIndicator size="small" color={THEME.colors.text.primary} />
          ) : (
            <Text style={styles.googleButtonText}>Liên kết với tài khoản Google</Text>
          )}
        </TouchableOpacity>
        {!googleConfigured && (
          <Text style={styles.googleHint}>Google chưa được cấu hình cho ứng dụng này.</Text>
        )}
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
  submitButtonDisabled: {
    opacity: 0.6,
  },
  googleButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  googleButtonText: {
    color: THEME.colors.text.primary,
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.base,
  },
  googleHint: {
    marginTop: 8,
    textAlign: 'center',
    color: THEME.colors.text.muted,
    fontSize: 11,
  },
});
