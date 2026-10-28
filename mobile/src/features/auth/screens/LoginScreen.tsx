import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { RequiredAsterisk } from '../../../components/common/RequiredAsterisk';
import { useAuthStore } from '../../../store/authStore';
import { getApiErrorMessage } from '../../../api/client';
import { THEME } from '../../../constants/theme';
import { User, Lock, ArrowRight, Eye, EyeOff, UserPlus } from 'lucide-react-native';

export const LoginScreen: React.FC = () => {
  const router = useRouter();
  const { login, loginWithGoogle, logout, isLoading, isVolunteerOrLeader } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string | undefined>>({});
  const [showPassword, setShowPassword] = useState(false);
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
      if (!authState.isVolunteerOrLeader() && !authState.isCitizen()) {
        try {
          await logout();
        } catch {
          // The local session is cleared even when the server logout request fails.
        }
        Alert.alert(
          'Vai trò chưa được hỗ trợ trên ứng dụng',
          'Ứng dụng di động dành cho Công dân và Tình nguyện viên. Vui lòng sử dụng cổng điều phối trên Web cho vai trò này.'
        );
        router.replace('/login');
        return;
      }
      const isVolunteer = isVolunteerOrLeader();
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
      await loginWithGoogle(idToken);
      const authState = useAuthStore.getState();
      if (authState.user?.must_change_password) {
        router.replace('/change-password');
      } else if (authState.isVolunteerOrLeader()) router.replace('/team');
      else if (authState.isCitizen()) goBackOrHome(router);
      else {
        try {
          await logout();
        } catch {
          // The local session is cleared even when the server logout request fails.
        }
        Alert.alert(
          'Vai trò chưa được hỗ trợ trên ứng dụng',
          'Ứng dụng di động dành cho Công dân và Tình nguyện viên. Vui lòng sử dụng cổng điều phối trên Web cho vai trò này.'
        );
        router.replace('/login');
      }
    } catch (err: unknown) {
      Alert.alert('Đăng nhập Google thất bại', getApiErrorMessage(err, 'Không thể đăng nhập bằng Google. Vui lòng thử lại.'));
    } finally {
      setGoogleBusy(false);
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
        <Text style={styles.title}>ĐĂNG NHẬP HỆ THỐNG</Text>
        <Text style={styles.subtitle}>
          Dành cho Công dân quản lý tin báo cứu trợ & Đội cứu hộ / Tình nguyện viên tiếp nhận nhiệm vụ.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <User size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Tên đăng nhập <RequiredAsterisk /></Text>
          </View>
          <TextInput
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
          <View style={styles.labelRow}>
            <Lock size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Mật khẩu <RequiredAsterisk /></Text>
          </View>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
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
          style={[styles.googleButton, (isLoading || googleBusy || !googleRequest) && styles.loginButtonDisabled]}
          onPress={handleGoogleLogin}
          disabled={isLoading || googleBusy || !googleRequest}
          activeOpacity={0.85}
        >
          {googleBusy ? <ActivityIndicator size="small" color={THEME.colors.text.primary} /> : <Text style={styles.googleButtonText}>Tiếp tục bằng Google</Text>}
        </TouchableOpacity>
        {!googleConfigured && <Text style={styles.googleHint}>Google chưa được cấu hình cho ứng dụng này.</Text>}

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
      </View>

      <View style={styles.tipBox}>
        <Text style={styles.tipHeader}>Gợi ý tài khoản kiểm thử (máy chủ thật):</Text>
        <Text style={styles.tipText}>
          • <Text style={{ fontWeight: '700' }}>Đội trưởng cứu hộ:</Text> <Text style={{ fontWeight: '700' }}>vol_leader1</Text> / Mật khẩu: <Text style={{ fontWeight: '700' }}>Password123!</Text>{'\n'}
          • <Text style={{ fontWeight: '700' }}>Thành viên cứu hộ:</Text> <Text style={{ fontWeight: '700' }}>vol_member1</Text> / Mật khẩu: <Text style={{ fontWeight: '700' }}>Password123!</Text>{'\n'}
          • <Text style={{ fontWeight: '700' }}>Công dân mẫu:</Text> <Text style={{ fontWeight: '700' }}>citizen1</Text> / Mật khẩu: <Text style={{ fontWeight: '700' }}>Password123!</Text> (hoặc bấm Đăng ký phía trên)
        </Text>
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
  title: {
    fontSize: THEME.typography.fontSizes.lg,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    letterSpacing: 0.5,
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
  tipBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    borderRadius: 12,
    marginTop: 18,
    marginBottom: 24,
  },
  tipHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text.primary,
    marginBottom: 4,
  },
  tipText: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    lineHeight: 18,
  },
});
