import { useRouter } from 'expo-router';

export function goBackOrHome(router: ReturnType<typeof useRouter>): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
