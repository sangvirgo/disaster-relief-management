import Constants from 'expo-constants';
import { useCallback } from 'react';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import { Platform } from 'react-native';

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export type GoogleSignInResult =
  | { type: 'success'; idToken: string }
  | { type: 'cancelled' };

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export function useGoogleAuth() {
  // Keep browser sign-in on AuthSession. Android and iOS use the native SDK below.
  const [webRequest, , promptWebGoogle] = useIdTokenAuthRequest({
    webClientId: webClientId || 'google-client-id-not-configured',
    androidClientId: androidClientId || 'google-client-id-not-configured',
    iosClientId: iosClientId || 'google-client-id-not-configured',
    selectAccount: true,
  });

  const isExpoGo = Platform.OS !== 'web' && Constants.appOwnership === 'expo';
  const googleConfigured = Boolean(webClientId) && (Platform.OS !== 'ios' || Boolean(iosClientId));
  const googleReady = googleConfigured && (Platform.OS !== 'web' || Boolean(webRequest));

  const promptGoogle = useCallback(async (): Promise<GoogleSignInResult> => {
    if (!googleConfigured || !webClientId) {
      throw new Error('Google chưa được cấu hình cho ứng dụng này.');
    }

    if (Platform.OS === 'web') {
      if (!webRequest) {
        throw new Error('Yêu cầu đăng nhập Google trên trình duyệt chưa sẵn sàng.');
      }

      const response = await promptWebGoogle();
      if (response.type !== 'success') return { type: 'cancelled' };

      const idToken = response.params.id_token;
      if (!idToken) throw new Error('Google chưa trả về mã đăng nhập an toàn.');
      return { type: 'success', idToken };
    }

    if (isExpoGo) {
      throw new Error('Đăng nhập Google cần chạy bản ứng dụng phát triển.');
    }

    const { GoogleSignin, isErrorWithCode } = await import('@react-native-google-signin/google-signin');
    GoogleSignin.configure({
      webClientId,
      ...(Platform.OS === 'ios' && iosClientId ? { iosClientId } : {}),
      offlineAccess: false,
    });

    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // Explicit sign-in should let the user switch Google accounts each time.
      if (GoogleSignin.hasPreviousSignIn()) {
        await GoogleSignin.signOut();
      }
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success') return { type: 'cancelled' };

      const idToken = response.data.idToken;
      if (!idToken) throw new GoogleAuthError('Google không trả về mã đăng nhập. Hãy kiểm tra Web OAuth client ID trong cấu hình ứng dụng.');
      return { type: 'success', idToken };
    } catch (error: unknown) {
      if (error instanceof GoogleAuthError) throw error;
      if (isErrorWithCode(error) && (error.code === '10' || error.code === 'DEVELOPER_ERROR')) {
        throw new GoogleAuthError(
          Platform.OS === 'android'
            ? 'Google chưa nhận diện cấu hình Android của ứng dụng. Hãy kiểm tra package name và SHA-1 của APK trong Google Cloud Console.'
            : 'Google chưa nhận diện cấu hình ứng dụng. Hãy kiểm tra OAuth client ID và URL scheme đã cấu hình.',
        );
      }
      throw error;
    }
  }, [googleConfigured, isExpoGo, promptWebGoogle, webRequest]);

  return { googleReady, promptGoogle, googleConfigured, isExpoGo };
}
