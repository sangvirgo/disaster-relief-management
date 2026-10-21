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
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../../components/common/ScreenContainer';
import { useAuthStore } from '../../../store/authStore';
import { THEME } from '../../../constants/theme';
import { UserPlus, User, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, UserCheck } from 'lucide-react-native';

export const RegisterScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { register, isLoading } = useAuthStore();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = async () => {
    const trimmedDisplayName = displayName.trim().normalize('NFC');
    const trimmedUsername = username.trim().toLowerCase();
    const cleanPassword = password;

    if (!trimmedDisplayName) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập họ và tên hoặc tên hiển thị của bạn.');
      return;
    }

    if (trimmedUsername.length < 3 || trimmedUsername.length > 64) {
      Alert.alert('Tên đăng nhập không hợp lệ', 'Tên đăng nhập phải có độ dài từ 3 đến 64 ký tự.');
      return;
    }

    const usernameRegex = /^[A-Za-z0-9._-]+$/;
    if (!usernameRegex.test(trimmedUsername)) {
      Alert.alert(
        'Tên đăng nhập không hợp lệ',
        'Tên đăng nhập chỉ được chứa chữ cái, chữ số, dấu gạch nối (-), gạch dưới (_) hoặc dấu chấm (.)'
      );
      return;
    }

    if (cleanPassword.length < 10) {
      Alert.alert(
        'Mật khẩu chưa đủ an toàn',
        'Theo quy chuẩn an toàn của hệ thống cứu hộ, mật khẩu phải có độ dài tối thiểu từ 10 ký tự trở lên.'
      );
      return;
    }

    if (cleanPassword.toLowerCase() === trimmedUsername) {
      Alert.alert('Mật khẩu chưa an toàn', 'Mật khẩu không được trùng với tên đăng nhập.');
      return;
    }

    if (cleanPassword !== confirmPassword) {
      Alert.alert('Mật khẩu không khớp', 'Mật khẩu xác nhận không trùng khớp với mật khẩu đã nhập.');
      return;
    }

    try {
      await register(trimmedUsername, cleanPassword, trimmedDisplayName);
      Alert.alert(
        'Đăng ký thành công',
        `Chào mừng công dân ${trimmedDisplayName}! Tài khoản của bạn đã được thiết lập thành công.`,
        [
          {
            text: 'Bắt đầu sử dụng',
            onPress: () => {
              // Chuyển về màn hình cứu hộ chính
              navigation.reset({
                index: 0,
                routes: [{ name: 'EmergencyHomeScreen' }],
              });
            },
          },
        ]
      );
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err?.message || 'Không thể tạo tài khoản. Vui lòng thử lại sau.';
      Alert.alert('Đăng ký thất bại', errorMsg);
    }
  };

  return (
    <ScreenContainer title="Đăng Ký Tài Khoản Công Dân" onBack={() => navigation.goBack()} scrollable={true}>
      <View style={styles.headerBox}>
        <View style={styles.iconCircle}>
          <UserPlus size={36} color={THEME.colors.primary.main} />
        </View>
        <Text style={styles.title}>TÀI KHOẢN CÔNG DÂN</Text>
        <Text style={styles.subtitle}>
          Đăng ký tài khoản để quản lý yêu cầu cứu trợ người thân (PROXY), theo dõi tiến độ cứu hộ và đồng bộ thông tin khẩn cấp.
        </Text>
      </View>

      <View style={styles.card}>
        {/* Họ và tên */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <UserCheck size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Họ và tên / Tên hiển thị *</Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="Ví dụ: Nguyễn Văn An"
            placeholderTextColor={THEME.colors.text.muted}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />
          <Text style={styles.helperText}>Tên sẽ hiển thị trên thông tin báo cứu trợ người thân</Text>
        </View>

        {/* Tên đăng nhập */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <User size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Tên đăng nhập *</Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="Ví dụ: nguyenvanan123"
            placeholderTextColor={THEME.colors.text.muted}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helperText}>Từ 3-64 ký tự (chữ cái không dấu, số, dấu chấm, gạch ngang)</Text>
        </View>

        {/* Mật khẩu */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Lock size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Mật khẩu bảo mật *</Text>
          </View>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Nhập tối thiểu 10 ký tự..."
              placeholderTextColor={THEME.colors.text.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
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
          <Text style={styles.helperText}>Tiêu chuẩn bảo mật: Tối thiểu 10 ký tự (không dùng mật khẩu dễ đoán)</Text>
        </View>

        {/* Xác nhận mật khẩu */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Lock size={16} color={THEME.colors.text.secondary} />
            <Text style={styles.inputLabel}>Xác nhận mật khẩu *</Text>
          </View>
          <TextInput
            style={styles.textInput}
            placeholder="Nhập lại mật khẩu..."
            placeholderTextColor={THEME.colors.text.muted}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
          />
        </View>

        {/* Cam kết */}
        <View style={styles.policyBox}>
          <ShieldCheck size={20} color={THEME.colors.success.main} style={{ marginRight: 8, marginTop: 2 }} />
          <Text style={styles.policyText}>
            Tài khoản công dân được tự động kích hoạt ngay sau khi đăng ký và cấp quyền khai báo cứu trợ khẩn cấp.
          </Text>
        </View>

        {/* Nút đăng ký */}
        <TouchableOpacity
          style={[styles.registerButton, isLoading && styles.registerButtonDisabled]}
          onPress={handleRegister}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.registerButtonText}>ĐĂNG KÝ TÀI KHOẢN NGAY</Text>
              <ArrowRight size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
            </>
          )}
        </TouchableOpacity>

        {/* Chuyển sang đăng nhập */}
        <View style={styles.switchAuthRow}>
          <Text style={styles.switchAuthText}>Bạn đã có tài khoản?</Text>
          <TouchableOpacity onPress={() => navigation.navigate('LoginScreen')} activeOpacity={0.7}>
            <Text style={styles.switchAuthLink}> Đăng nhập ngay</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  headerBox: {
    alignItems: 'center',
    marginVertical: 14,
    paddingHorizontal: 16,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: THEME.colors.primary.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
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
