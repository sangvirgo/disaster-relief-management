import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { CompactTextInput } from '../../../components/common/CompactTextInput';
import { useAuthStore } from '../../../store/authStore';
import { getApiErrorMessage, isApiErrorCode } from '../../../api/client';
import { IdentityApi } from '../../../api/identityApi';
import { ResponseApi } from '../../../api/responseApi';
import { THEME } from '../../../constants/theme';
import { GoogleAuthError, useGoogleAuth } from '../googleAuth';
import { ArrowRight, Eye, EyeOff, UserPlus } from 'lucide-react-native';

type MobileActor = 'citizen' | 'team' | 'unsupported' | 'unavailable';

async function resolveMobileActor(): Promise<MobileActor> {
  const auth = useAuthStore.getState();
  if (auth.isVolunteerOrLeader()) return 'team';
  if (auth.isCitizen()) return 'citizen';

  // Team membership is an authorization relationship in Response. Members do
  // not need a VOLUNTEER grant just to read their assigned missions.
  try {
    await ResponseApi.getMyMissions(1);
    return 'team';
  } catch (error) {
    if (isApiErrorCode(error, 'FORBIDDEN')) return 'unsupported';
    Alert.alert(
      'Chưa thể xác minh quyền thành viên đội',
      getApiErrorMessage(error, 'Vui lòng kiểm tra kết nối rồi thử lại.'),
    );
    return 'unavailable';
  }
}

export const LoginScreen: React.FC = () => {
  const router = useRouter();
  const { login, loginWithGoogle, logout, isLoading } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string | undefined>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<'request' | 'confirm' | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryChallengeId, setRecoveryChallengeId] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const { googleReady, promptGoogle, googleConfigured, isExpoGo } = useGoogleAuth();

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    const errors: Record<string, string> = {};
    if (!trimmedUsername) errors.username = 'Vui lòng nhập tên đăng nhập.';
    else if (trimmedUsername.length > 64) errors.username = 'Tên đăng nhập không được vượt quá 64 ký tự.';
    if (!password) errors.password = 'Vui lòng nhập mật khẩu.';
    else if (password.length > 256) errors.password = 'Mật khẩu không được vượt quá 256 ký tự.';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      await login(trimmedUsername, password);
      const authState = useAuthStore.getState();
      if (authState.user?.must_change_password) {
        router.replace('/change-password');
        return;
      }
      const mobileActor = await resolveMobileActor();
      if (mobileActor === 'unavailable') return;
      if (mobileActor === 'unsupported') {
        try {
          await logout();
        } catch {
          // The local session is cleared even when the server logout request fails.
        }
        Alert.alert(
          'Vai trò chưa được hỗ trợ trên ứng dụng',
          'Ứng dụng di động dành cho Công dân và thành viên đội cứu hộ. Vui lòng sử dụng cổng điều phối trên Web cho vai trò quản lý.'
        );
        router.replace('/login');
        return;
      }
      const isVolunteer = mobileActor === 'team';
      const currentUser = useAuthStore.getState().user;
      const displayName = currentUser?.display_name || trimmedUsername;

      if (isVolunteer) {
        Alert.alert(
          'Đăng nhập thành công',
          `Chào mừng thành viên đội cứu hộ: ${displayName}!`,
          [
            {
              text: 'Vào Bảng Điều Khiển Cứu Hộ',
              onPress: () => router.replace('/team'),
            },
          ]
        );
      } else {
        Alert.alert(
          'Đăng nhập thành công',
          `Chào mừng công dân: ${displayName}! Bạn đã có thể báo tin cứu hộ cho người thân và theo dõi các yêu cầu khẩn cấp.`,
          [
            {
              text: 'Tiếp tục',
              onPress: () => {
                goBackOrHome(router);
              },
            },
          ]
        );
      }
    } catch (err: any) {
      const errorMsg = getApiErrorMessage(err, 'Tên đăng nhập hoặc mật khẩu không chính xác.');
      Alert.alert('Đăng nhập thất bại', errorMsg);
    }
  };

  const handleGoogleLogin = async () => {
    if (isExpoGo) {
      Alert.alert(
        'Đăng nhập Google cần bản phát triển',
        'Hãy cài bản ứng dụng phát triển lên điện thoại rồi thử lại.',
      );
      return;
    }
    if (!googleConfigured) {
      Alert.alert('Chưa cấu hình Google', 'Cần khai báo mã ứng dụng Google phù hợp với nền tảng trong mobile/.env.');
      return;
    }
    setGoogleBusy(true);
    try {
      const result = await promptGoogle();
      if (result.type !== 'success') return;
      await loginWithGoogle(result.idToken);
      const authState = useAuthStore.getState();
      if (authState.user?.must_change_password) {
        router.replace('/change-password');
        return;
      }
      const mobileActor = await resolveMobileActor();
      if (mobileActor === 'unavailable') return;
      if (mobileActor === 'team') router.replace('/team');
      else if (mobileActor === 'citizen') goBackOrHome(router);
      else {
        try {
          await logout();
        } catch {
          // The local session is cleared even when the server logout request fails.
        }
        Alert.alert(
          'Vai trò chưa được hỗ trợ trên ứng dụng',
          'Ứng dụng di động dành cho Công dân và thành viên đội cứu hộ. Vui lòng sử dụng cổng điều phối trên Web cho vai trò quản lý.'
        );
        router.replace('/login');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof GoogleAuthError
        ? err.message
        : getApiErrorMessage(err, 'Không thể đăng nhập bằng Google. Vui lòng thử lại.');
      if (isApiErrorCode(err, 'GOOGLE_ACCOUNT_LINK_REQUIRED')) {
        Alert.alert('Tài khoản Google chưa được liên kết', errorMessage, [
          { text: 'Đóng', style: 'cancel' },
          { text: 'Chọn tài khoản khác', onPress: () => { void handleGoogleLogin(); } },
        ]);
      } else {
        Alert.alert('Đăng nhập Google thất bại', errorMessage);
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    const normalizedEmail = recoveryEmail.trim();
    if (!normalizedEmail || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setRecoveryError('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    setRecoveryMessage('');
    try {
      const result = await IdentityApi.requestPasswordReset(normalizedEmail);
      setRecoveryChallengeId(result.challenge_id);
      setRecoveryStep('confirm');
      setRecoveryMessage('Nếu email này khớp với tài khoản Reliva đã xác thực và có mật khẩu Reliva, mã xác nhận sẽ được gửi đến hộp thư. Nếu tài khoản chỉ dùng Google để đăng nhập, hãy tiếp tục bằng Google. Mã có hiệu lực trong 5 phút.');
    } catch (error: unknown) {
      setRecoveryError(getApiErrorMessage(error, 'Chưa thể gửi yêu cầu. Vui lòng thử lại sau.'));
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleConfirmPasswordReset = async () => {
    if (!/^\d{6}$/.test(recoveryCode.trim())) {
      setRecoveryError('Vui lòng nhập mã xác nhận gồm 6 chữ số.');
      return;
    }
    if (!recoveryPassword || recoveryPassword.length < 10 || recoveryPassword.length > 256) {
      setRecoveryError('Mật khẩu mới cần có từ 10 đến 256 ký tự.');
      return;
    }
    if (recoveryPassword !== recoveryPasswordConfirm) {
      setRecoveryError('Mật khẩu xác nhận chưa khớp.');
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      await IdentityApi.confirmPasswordReset(recoveryChallengeId, recoveryCode.trim(), recoveryPassword);
      setRecoveryStep(null);
      setRecoveryCode('');
      setRecoveryPassword('');
      setRecoveryPasswordConfirm('');
      setRecoveryMessage('');
      Alert.alert('Đặt lại mật khẩu thành công', 'Vui lòng đăng nhập bằng mật khẩu mới. Các phiên đăng nhập trước đó đã được đăng xuất.');
    } catch (error: unknown) {
      setRecoveryError(getApiErrorMessage(error, 'Chưa thể đặt lại mật khẩu. Vui lòng kiểm tra mã và thử lại.'));
    } finally {
      setRecoveryBusy(false);
    }
  };

  const loginDisabled = isLoading || !username.trim() || !password || username.length > 64 || password.length > 256;

  return (
    <ScreenContainer title="Đăng Nhập Hệ Thống" onBack={() => goBackOrHome(router)} scrollable={true}>
      <View style={styles.headerBox}>
        <View style={styles.logoFrame}>
          <Image
            source={require('../../../../assets/reliva-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.brandTitle}>Reliva</Text>
        <Text style={styles.subtitle}>
          Đăng nhập với tài khoản công dân hoặc thành viên đội cứu hộ.
        </Text>
      </View>

      <View style={styles.card}>
        {recoveryStep ? (
          <View>
            <Text style={styles.recoveryTitle}>{recoveryStep === 'request' ? 'Quên mật khẩu?' : 'Xác nhận mã đặt lại'}</Text>
            {recoveryStep === 'request' ? (
              <View style={styles.inputGroup}>
                <CompactTextInput
                  label="Email tài khoản"
                  required
                  style={styles.textInput}
                  placeholder="ten@example.com"
                  placeholderTextColor={THEME.colors.text.muted}
                  value={recoveryEmail}
                  onChangeText={(value) => { setRecoveryEmail(value); setRecoveryError(''); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={254}
                />
              </View>
            ) : (
              <>
                <Text style={styles.recoveryHint}>Nhập mã đã gửi đến email để tạo mật khẩu Reliva. Nếu tài khoản chỉ đăng nhập Google, hãy quay lại và chọn đăng nhập Google. Mã có hiệu lực trong 5 phút.</Text>
                <View style={styles.inputGroup}>
                  <CompactTextInput
                    label="Mã xác nhận"
                    required
                    style={styles.textInput}
                    placeholder="Nhập mã 6 chữ số"
                    placeholderTextColor={THEME.colors.text.muted}
                    value={recoveryCode}
                    onChangeText={(value) => { setRecoveryCode(value.replace(/\D/g, '').slice(0, 6)); setRecoveryError(''); }}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoComplete="one-time-code"
                  />
                </View>
                <View style={styles.inputGroup}>
                  <CompactTextInput
                    label="Mật khẩu mới"
                    required
                    style={styles.textInput}
                    placeholder="Tối thiểu 10 ký tự"
                    placeholderTextColor={THEME.colors.text.muted}
                    value={recoveryPassword}
                    onChangeText={(value) => { setRecoveryPassword(value); setRecoveryError(''); }}
                    secureTextEntry
                    autoCapitalize="none"
                    maxLength={256}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <CompactTextInput
                    label="Nhập lại mật khẩu mới"
                    required
                    style={styles.textInput}
                    placeholder="Nhập lại mật khẩu mới"
                    placeholderTextColor={THEME.colors.text.muted}
                    value={recoveryPasswordConfirm}
                    onChangeText={(value) => { setRecoveryPasswordConfirm(value); setRecoveryError(''); }}
                    secureTextEntry
                    autoCapitalize="none"
                    maxLength={256}
                  />
                </View>
              </>
            )}
            {recoveryMessage ? <Text accessibilityLiveRegion="polite" style={styles.recoveryMessage}>{recoveryMessage}</Text> : null}
            {recoveryError ? <FormFieldError message={recoveryError} /> : null}
            <TouchableOpacity
              style={[styles.loginButton, recoveryBusy && styles.loginButtonDisabled]}
              onPress={recoveryStep === 'request' ? handleRequestPasswordReset : handleConfirmPasswordReset}
              disabled={recoveryBusy}
              activeOpacity={0.85}
            >
              {recoveryBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                <Text style={styles.loginButtonText}>{recoveryStep === 'request' ? 'GỬI MÃ XÁC NHẬN' : 'ĐẶT LẠI MẬT KHẨU'}</Text>
              )}
            </TouchableOpacity>
            {recoveryStep === 'confirm' ? (
              <TouchableOpacity
                style={styles.recoveryLinkButton}
                onPress={() => { setRecoveryStep('request'); setRecoveryCode(''); setRecoveryMessage(''); setRecoveryError(''); }}
                disabled={recoveryBusy}
              >
                <Text style={styles.registerPromptLink}>Nhập email khác hoặc yêu cầu mã mới</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.recoveryLinkButton}
              onPress={() => { setRecoveryStep(null); setRecoveryError(''); setRecoveryMessage(''); }}
              disabled={recoveryBusy}
            >
              <Text style={styles.registerPromptLink}>Quay lại đăng nhập</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
        <View style={styles.inputGroup}>
          <CompactTextInput
            label="Tên đăng nhập"
            required
            style={styles.textInput}
            placeholder="Nhập tên đăng nhập..."
            placeholderTextColor={THEME.colors.text.muted}
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setFormErrors((current) => ({
                ...current,
                username: value.length > 64 ? 'Tên đăng nhập không được vượt quá 64 ký tự.' : undefined,
              }));
            }}
            onBlur={() => {
              if (!username.trim()) setFormErrors((current) => ({ ...current, username: 'Tên đăng nhập là bắt buộc.' }));
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={65}
          />
          <FormFieldError message={formErrors.username} />
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.passwordContainer}>
            <CompactTextInput
              label="Mật khẩu"
              required
              containerStyle={{ flex: 1, justifyContent: 'center' }}
              outlined={false}
              style={[styles.passwordInput, { flex: 0 }]}
              placeholder="Nhập mật khẩu..."
              placeholderTextColor={THEME.colors.text.muted}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setFormErrors((current) => ({
                  ...current,
                  password: value.length > 256 ? 'Mật khẩu không được vượt quá 256 ký tự.' : undefined,
                }));
              }}
              onBlur={() => {
                if (!password) setFormErrors((current) => ({ ...current, password: 'Mật khẩu là bắt buộc.' }));
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              maxLength={257}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
              activeOpacity={0.7}
            >
              {showPassword ? (
                <EyeOff size={18} color={THEME.colors.text.muted} />
              ) : (
                <Eye size={18} color={THEME.colors.text.muted} />
              )}
            </TouchableOpacity>
          </View>
          <FormFieldError message={formErrors.password} />
        </View>

        <TouchableOpacity
          style={[styles.loginButton, loginDisabled && styles.loginButtonDisabled]}
          onPress={handleLogin}
          disabled={loginDisabled}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.loginButtonText}>ĐĂNG NHẬP NGAY</Text>
              <ArrowRight size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotPasswordButton}
          onPress={() => {
            setRecoveryStep('request');
            setRecoveryError('');
            setRecoveryMessage('');
            setRecoveryEmail('');
            setPassword('');
            setShowPassword(false);
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.registerPromptLink}>Quên mật khẩu?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.googleButton, (isLoading || googleBusy || !googleReady) && styles.loginButtonDisabled]}
          onPress={handleGoogleLogin}
          disabled={isLoading || googleBusy || !googleReady}
          activeOpacity={0.85}
        >
          {googleBusy ? <ActivityIndicator size="small" color={THEME.colors.text.primary} /> : <Text style={styles.googleButtonText}>Tiếp tục bằng Google</Text>}
        </TouchableOpacity>
        {isExpoGo ? (
          <Text style={styles.googleHint}>Đăng nhập Google cần bản ứng dụng phát triển; các chức năng khác vẫn dùng được trong Expo Go.</Text>
        ) : !googleConfigured ? (
          <Text style={styles.googleHint}>Google chưa được cấu hình cho ứng dụng này.</Text>
        ) : null}

        {/* Nút đăng ký tài khoản công dân */}
        <View style={styles.registerPromptBox}>
          <Text style={styles.registerPromptText}>Chưa có tài khoản công dân?</Text>
          <TouchableOpacity
            style={styles.registerPromptButton}
            onPress={() => router.push('/register')}
            activeOpacity={0.7}
          >
            <UserPlus size={16} color={THEME.colors.primary.main} style={{ marginRight: 4 }} />
            <Text style={styles.registerPromptLink}>Đăng ký tài khoản Công dân ngay</Text>
          </TouchableOpacity>
        </View>
          </>
        )}
      </View>

    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  headerBox: {
    alignItems: 'center',
    marginVertical: 18,
    paddingHorizontal: 12,
  },
  logoFrame: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.md,
  },
  logoImage: {
    width: 68,
    height: 68,
    borderRadius: 14,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: THEME.colors.emergency.main,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 16,
    lineHeight: 18,
  },
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
  },
  inputGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginLeft: 6,
  },
  textInput: {
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: THEME.typography.fontSizes.base,
    color: THEME.colors.text.primary,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: THEME.typography.fontSizes.base,
    color: THEME.colors.text.primary,
  },
  eyeButton: {
    padding: 10,
  },
  loginButton: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary.main,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    ...THEME.shadows.md,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: THEME.typography.fontSizes.base,
    letterSpacing: 0.5,
  },
  googleButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  googleButtonText: {
    color: THEME.colors.text.primary,
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.base,
  },
  googleHint: {
    marginTop: 6,
    textAlign: 'center',
    color: THEME.colors.text.muted,
    fontSize: 11,
  },
  registerPromptBox: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
    alignItems: 'center',
  },
  registerPromptText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
    marginBottom: 6,
  },
  registerPromptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  registerPromptLink: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '800',
    color: THEME.colors.primary.main,
  },
  forgotPasswordButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  recoveryLinkButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  recoveryTitle: {
    fontSize: THEME.typography.fontSizes.lg,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginBottom: 12,
  },
  recoveryHint: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.sm,
    lineHeight: 20,
    marginBottom: 14,
  },
  recoveryMessage: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.sm,
    lineHeight: 20,
    marginBottom: 12,
  },
});
