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
} from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOrHome } from '../../../navigation/back';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { FormFieldError } from '../../../components/common/FormFieldError';
import { RequiredAsterisk } from '../../../components/common/RequiredAsterisk';
import { useAuthStore } from '../../../store/authStore';
import { IdentityApi } from '../../../api/identityApi';
import { getApiErrorMessage } from '../../../api/client';
import { THEME } from '../../../constants/theme';
import { isCommonPassword, isValidEmail } from '../../../utils/formValidation';
import { User, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, UserCheck } from 'lucide-react-native';

export const RegisterScreen: React.FC = () => {
  const router = useRouter();
  const { register, login, isLoading } = useAuthStore();

  const [email, setEmail] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string | undefined>>({});
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const finishLogin = () => router.replace('/');

  const emailError = (value: string) => {
    if (value.length > 254) return 'Email không được vượt quá 254 ký tự.';
    if (!value.trim()) return undefined;
    return isValidEmail(value) ? undefined : 'Email chưa đúng định dạng.';
  };
  const displayNameError = (value: string) => value.length > 200
    ? 'Tên hiển thị không được vượt quá 200 ký tự.'
    : undefined;
  const usernameError = (value: string) => {
    if (value.length > 64) return 'Tên đăng nhập không được vượt quá 64 ký tự.';
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.length < 3) return 'Tên đăng nhập phải có ít nhất 3 ký tự.';
    if (normalized.length > 64) return 'Tên đăng nhập không được vượt quá 64 ký tự.';
    if (!/^[A-Za-z0-9._-]+$/.test(normalized)) return 'Tên đăng nhập chỉ được gồm chữ không dấu, chữ số, dấu chấm, gạch dưới hoặc gạch ngang.';
    return undefined;
  };
  const passwordError = (value: string, accountName = username) => {
    if (!value) return undefined;
    if ([...value].length < 10) return 'Mật khẩu phải có ít nhất 10 ký tự.';
    if ([...value].length > 256) return 'Mật khẩu không được vượt quá 256 ký tự.';
    if (accountName.trim() && value.toLowerCase() === accountName.trim().toLowerCase()) return 'Mật khẩu không được trùng tên đăng nhập.';
    if (isCommonPassword(value)) return 'Mật khẩu quá phổ biến. Hãy chọn mật khẩu khó đoán hơn.';
    return undefined;
  };
  const confirmationError = (value: string, passwordValue = password) => value && value !== passwordValue
    ? 'Mật khẩu xác nhận chưa khớp.'
    : undefined;

  const handleRegister = async () => {
    const emailValue = email.trim();
    const trimmedDisplayName = displayName.trim().normalize('NFC');
    const trimmedUsername = username.trim().toLowerCase();
    const cleanPassword = password;
    const errors: Record<string, string> = {};

    if (!emailValue) errors.email = 'Vui lòng nhập email để nhận mã xác minh.';
    else if (!isValidEmail(emailValue)) errors.email = 'Email không đúng định dạng hoặc vượt quá 254 ký tự.';
    if (!trimmedDisplayName) errors.displayName = 'Vui lòng nhập họ tên hoặc tên hiển thị.';
    else if (trimmedDisplayName.length > 200) errors.displayName = 'Tên hiển thị không được vượt quá 200 ký tự.';

    if (!trimmedUsername) errors.username = 'Vui lòng nhập tên đăng nhập.';
    else if (trimmedUsername.length < 3 || trimmedUsername.length > 64) errors.username = 'Tên đăng nhập phải có từ 3 đến 64 ký tự.';

    const usernameRegex = /^[A-Za-z0-9._-]+$/;
    if (trimmedUsername && !usernameRegex.test(trimmedUsername)) errors.username = 'Chỉ dùng chữ không dấu, chữ số, dấu chấm, gạch dưới hoặc gạch ngang.';

    if (!cleanPassword) errors.password = 'Vui lòng nhập mật khẩu.';
    else if ([...cleanPassword].length < 10) errors.password = 'Mật khẩu phải có ít nhất 10 ký tự.';
    else if ([...cleanPassword].length > 256) errors.password = 'Mật khẩu không được vượt quá 256 ký tự.';
    else if (trimmedUsername && cleanPassword.toLowerCase() === trimmedUsername) errors.password = 'Mật khẩu không được trùng tên đăng nhập.';
    else if (isCommonPassword(cleanPassword)) errors.password = 'Mật khẩu quá phổ biến. Hãy chọn mật khẩu khó đoán hơn.';

    if (!confirmPassword) errors.confirmPassword = 'Vui lòng nhập lại mật khẩu.';
    else if (cleanPassword !== confirmPassword) errors.confirmPassword = 'Mật khẩu xác nhận chưa khớp.';

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      const result = await register(emailValue.toLowerCase(), trimmedUsername, cleanPassword, trimmedDisplayName);
      setChallengeId(result.verification.challenge_id);
      setEmailSent(result.email_sent);
      Alert.alert('Đã tạo tài khoản chờ xác minh', result.email_sent
        ? `Mã xác minh đã được gửi đến ${email.trim()}.`
        : 'Chưa gửi được email. Hãy kiểm tra cấu hình email hoặc thử gửi lại sau.');
    } catch (err: any) {
      const errorMsg = getApiErrorMessage(err, 'Không thể tạo tài khoản. Vui lòng thử lại sau.');
      Alert.alert('Đăng ký thất bại', errorMsg);
    }
  };

  const handleVerifyEmail = async () => {
    if (!/^\d{6}$/.test(verificationCode.trim())) {
      setFormErrors((current) => ({ ...current, verificationCode: 'Nhập mã gồm đúng 6 chữ số trong email.' }));
      return;
    }
    setFormErrors((current) => ({ ...current, verificationCode: undefined }));
    setIsVerifying(true);
    try {
      await IdentityApi.verifyEmail(challengeId, verificationCode.trim());
      await login(username.trim().toLowerCase(), password);
      Alert.alert('Xác minh thành công', 'Email đã được xác minh và tài khoản đã kích hoạt.', [
        { text: 'Tiếp tục', onPress: finishLogin },
      ]);
    } catch (err: unknown) {
      Alert.alert('Xác minh thất bại', getApiErrorMessage(err, 'Không thể xác minh email. Vui lòng thử lại.'));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      const result = await IdentityApi.resendEmailOtp(challengeId);
      if (result.challenge_id) setChallengeId(result.challenge_id);
      setEmailSent(result.email_sent);
      Alert.alert('Gửi mã xác minh', result.email_sent
        ? `Mã mới đã được gửi đến ${email.trim()}.`
        : 'Chưa gửi được email. Vui lòng kiểm tra cấu hình email hoặc thử lại sau.');
    } catch (err: unknown) {
      Alert.alert('Chưa gửi được mã', getApiErrorMessage(err, 'Chưa thể gửi lại mã xác minh.'));
    } finally {
      setIsResending(false);
    }
  };

  const registerDisabled = isLoading || !email.trim() || email.length > 254 || !isValidEmail(email) || !displayName.trim() ||
    displayName.length > 200 || !username.trim() || username.length > 64 || Boolean(usernameError(username)) || !password ||
    Boolean(passwordError(password)) || !confirmPassword || Boolean(confirmationError(confirmPassword)) ||
    [...confirmPassword].length > 256;
  const verifyDisabled = isVerifying || !/^\d{6}$/.test(verificationCode.trim());

  return (
    <ScreenContainer title={challengeId ? 'Xác Minh Email' : 'Đăng Ký Tài Khoản Công Dân'} onBack={() => goBackOrHome(router)} scrollable={true}>
      <View style={styles.headerBox}>
        <View style={styles.logoFrame}>
          <Image
            source={require('../../../../assets/reliva-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.brandTitle}>Reliva</Text>
        <Text style={styles.title}>{challengeId ? 'XÁC MINH ĐỊA CHỈ EMAIL' : 'TÀI KHOẢN CÔNG DÂN'}</Text>
        <Text style={styles.subtitle}>
          {challengeId
            ? `Nhập mã 6 chữ số được gửi đến ${email.trim()} để kích hoạt tài khoản.`
            : 'Đăng ký tài khoản để quản lý yêu cầu cứu trợ người thân, theo dõi tiến độ cứu hộ và đồng bộ thông tin khẩn cấp.'}
        </Text>
      </View>

      {!challengeId ? <View style={styles.card}>
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <User size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Email nhận mã xác minh <RequiredAsterisk /></Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="ban@example.com"
            placeholderTextColor={THEME.colors.text.muted}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setFormErrors((current) => ({ ...current, email: emailError(value) }));
            }}
            onBlur={() => {
              setFormErrors((current) => ({ ...current, email: !email.trim() ? 'Email là bắt buộc.' : emailError(email) }));
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={255}
          />
          <FormFieldError message={formErrors.email} />
          <Text style={styles.helperText}>Tài khoản chỉ được kích hoạt sau khi xác minh email</Text>
        </View>

        {/* Họ và tên */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <UserCheck size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Họ và tên / Tên hiển thị <RequiredAsterisk /></Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="Ví dụ: Nguyễn Văn An"
            placeholderTextColor={THEME.colors.text.muted}
            value={displayName}
            onChangeText={(value) => {
              setDisplayName(value);
              setFormErrors((current) => ({ ...current, displayName: displayNameError(value) }));
            }}
            onBlur={() => {
              if (!displayName.trim()) setFormErrors((current) => ({ ...current, displayName: 'Họ và tên / tên hiển thị là bắt buộc.' }));
            }}
            autoCapitalize="words"
            maxLength={201}
          />
          <FormFieldError message={formErrors.displayName} />
          <Text style={styles.helperText}>Tên sẽ hiển thị trên thông tin báo cứu trợ người thân</Text>
        </View>

        {/* Tên đăng nhập */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <User size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Tên đăng nhập <RequiredAsterisk /></Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="Ví dụ: nguyenvanan123"
            placeholderTextColor={THEME.colors.text.muted}
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setFormErrors((current) => ({
                ...current,
                username: usernameError(value),
                password: passwordError(password, value),
              }));
            }}
            onBlur={() => {
              setFormErrors((current) => ({
                ...current,
                username: !username.trim() ? 'Tên đăng nhập là bắt buộc.' : usernameError(username),
              }));
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={65}
          />
          <FormFieldError message={formErrors.username} />
          <Text style={styles.helperText}>Từ 3-64 ký tự (chữ cái không dấu, số, dấu chấm, gạch ngang)</Text>
        </View>

        {/* Mật khẩu */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Lock size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Mật khẩu bảo mật <RequiredAsterisk /></Text>
          </View>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Nhập tối thiểu 10 ký tự..."
              placeholderTextColor={THEME.colors.text.muted}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setFormErrors((current) => ({
                  ...current,
                  password: passwordError(value),
                  confirmPassword: confirmationError(confirmPassword, value),
                }));
              }}
              onBlur={() => {
                setFormErrors((current) => ({
                  ...current,
                  password: !password ? 'Mật khẩu là bắt buộc.' : passwordError(password),
                }));
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
          <Text style={styles.helperText}>Tiêu chuẩn bảo mật: Tối thiểu 10 ký tự (không dùng mật khẩu dễ đoán)</Text>
        </View>

        {/* Xác nhận mật khẩu */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Lock size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Xác nhận mật khẩu <RequiredAsterisk /></Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="Nhập lại mật khẩu..."
            placeholderTextColor={THEME.colors.text.muted}
            value={confirmPassword}
            onChangeText={(value) => {
              setConfirmPassword(value);
              setFormErrors((current) => ({
                ...current,
                confirmPassword: value.length > 256
                  ? 'Mật khẩu xác nhận không được vượt quá 256 ký tự.'
                  : confirmationError(value),
              }));
            }}
            onBlur={() => {
              setFormErrors((current) => ({
                ...current,
                confirmPassword: !confirmPassword ? 'Xác nhận mật khẩu là bắt buộc.' : confirmationError(confirmPassword),
              }));
            }}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            maxLength={257}
          />
          <FormFieldError message={formErrors.confirmPassword} />
        </View>

        {/* Cam kết */}
        <View style={styles.policyBox}>
          <ShieldCheck size={20} color={THEME.colors.success.main} style={{ marginRight: 8, marginTop: 2 }} />
          <Text style={styles.policyText}>
            Tài khoản công dân được kích hoạt sau khi xác minh email và cấp quyền khai báo cứu trợ khẩn cấp.
          </Text>
        </View>

        {/* Nút đăng ký */}
        <TouchableOpacity
          style={[styles.registerButton, registerDisabled && styles.registerButtonDisabled]}
          onPress={handleRegister}
          disabled={registerDisabled}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.registerButtonText}>GỬI MÃ XÁC MINH</Text>
              <ArrowRight size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
            </>
          )}
        </TouchableOpacity>

        {/* Chuyển sang đăng nhập */}
        <View style={styles.switchAuthRow}>
          <Text style={styles.switchAuthText}>Bạn đã có tài khoản?</Text>
          <TouchableOpacity onPress={() => router.push('/login')} activeOpacity={0.7}>
            <Text style={styles.switchAuthLink}> Đăng nhập ngay</Text>
          </TouchableOpacity>
        </View>
      </View> : <View style={styles.card}>
        <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Mã xác minh email <RequiredAsterisk /></Text>
          <TextInput
            style={styles.textInput}
            placeholder="Nhập mã 6 chữ số"
            placeholderTextColor={THEME.colors.text.muted}
            value={verificationCode}
            onChangeText={(value) => {
              setVerificationCode(value);
              setFormErrors((current) => ({
                ...current,
                verificationCode: value.length > 6
                  ? 'Mã xác minh không được vượt quá 6 ký tự.'
                  : value && !/^\d{6}$/.test(value)
                    ? 'Mã xác minh phải gồm đúng 6 chữ số.'
                    : undefined,
              }));
            }}
            onBlur={() => {
              const code = verificationCode.trim();
              if (!code) setFormErrors((current) => ({ ...current, verificationCode: 'Mã xác minh email là bắt buộc.' }));
              else if (code.length > 6) setFormErrors((current) => ({ ...current, verificationCode: 'Mã xác minh không được vượt quá 6 ký tự.' }));
              else if (!/^\d{6}$/.test(code)) setFormErrors((current) => ({ ...current, verificationCode: 'Mã xác minh phải gồm đúng 6 chữ số.' }));
            }}
            keyboardType="number-pad"
            maxLength={7}
          />
          <FormFieldError message={formErrors.verificationCode} />
          <Text style={styles.helperText}>{emailSent ? 'Kiểm tra hộp thư đến và thư rác.' : 'Email chưa được gửi; bạn có thể thử gửi lại khi dịch vụ email sẵn sàng.'}</Text>
        </View>
        <TouchableOpacity
          style={[styles.registerButton, verifyDisabled && styles.registerButtonDisabled]}
          onPress={handleVerifyEmail}
          disabled={verifyDisabled}
          activeOpacity={0.85}
        >
          {isVerifying ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.registerButtonText}>XÁC MINH VÀ KÍCH HOẠT</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.resendButton}
          onPress={handleResend}
          disabled={isResending}
          activeOpacity={0.7}
        >
          {isResending ? <ActivityIndicator size="small" color={THEME.colors.primary.main} /> : <Text style={styles.switchAuthLink}>Gửi lại mã xác minh</Text>}
        </TouchableOpacity>
      </View>}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  headerBox: {
    alignItems: 'center',
    marginVertical: 14,
    paddingHorizontal: 16,
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
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  card: {
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.sm,
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
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
    paddingVertical: 10,
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
    paddingVertical: 10,
    fontSize: THEME.typography.fontSizes.base,
    color: THEME.colors.text.primary,
  },
  eyeButton: {
    padding: 10,
  },
  helperText: {
    fontSize: 11,
    color: THEME.colors.text.muted,
    marginTop: 4,
    marginLeft: 2,
  },
  policyBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: THEME.colors.success.bg,
    borderWidth: 1,
    borderColor: THEME.colors.success.border,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  policyText: {
    flex: 1,
    fontSize: 12,
    color: THEME.colors.success.dark,
    lineHeight: 16,
  },
  registerButton: {
    backgroundColor: THEME.colors.primary.main,
    paddingVertical: 13,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...THEME.shadows.md,
  },
  resendButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  registerButtonDisabled: {
    opacity: 0.6,
  },
  registerButtonText: {
    color: '#FFFFFF',
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
  },
  switchAuthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  switchAuthText: {
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.secondary,
  },
  switchAuthLink: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '800',
    color: THEME.colors.primary.main,
  },
});
