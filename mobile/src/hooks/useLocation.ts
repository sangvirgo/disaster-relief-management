import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { GeoLocation } from '../types/api';

export function useLocation() {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);

  const requestAndFetchLocation = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setErrorMsg('Quyền truy cập vị trí bị từ chối. Bạn có thể chọn vị trí thủ công trên bản đồ.');
        setLoading(false);
        return;
      }

      setPermissionDenied(false);

      // Thử lấy nhanh vị trí đã biết gần nhất trong bộ nhớ đệm
      try {
        const lastKnown = await Location.getLastKnownPositionAsync();
        const acc = lastKnown?.coords.accuracy;
        if (
          lastKnown?.coords &&
          typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 &&
          Number.isFinite(lastKnown.timestamp) && Number.isFinite(lastKnown.coords.longitude) &&
          Number.isFinite(lastKnown.coords.latitude)
        ) {
          setLocation({
            type: 'Point',
            coordinates: [lastKnown.coords.longitude, lastKnown.coords.latitude],
            source: 'GPS',
            accuracy_m: acc,
            captured_at: new Date(lastKnown.timestamp).toISOString(),
          });
        }
      } catch {
        // Tiếp tục lấy GPS tươi bên dưới
      }

      // Lấy vị trí GPS tươi với thời gian chờ tối đa 8 giây để tránh treo ứng dụng
      const locationPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 8000);
      });

      const currentLocation = await Promise.race([locationPromise, timeoutPromise]);

      if (currentLocation && currentLocation.coords) {
        const accuracy = currentLocation.coords.accuracy;
        if (
          typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 &&
          Number.isFinite(currentLocation.timestamp) && Number.isFinite(currentLocation.coords.longitude) &&
          Number.isFinite(currentLocation.coords.latitude)
        ) {
          setLocation({
            type: 'Point',
            coordinates: [currentLocation.coords.longitude, currentLocation.coords.latitude],
            source: 'GPS',
            accuracy_m: accuracy,
            captured_at: new Date(currentLocation.timestamp).toISOString(),
          });
        }
      } else {
        // Hết thời gian chờ 8s mà chưa có GPS mới: giữ vị trí đệm nếu có, hoặc báo để ghim bản đồ
        setLocation((prev) => {
          if (!prev) {
            setErrorMsg('Tín hiệu GPS yếu hoặc thiết bị đang trong nhà. Bạn có thể ghim vị trí ngay trên bản đồ.');
          }
          return prev;
        });
      }
    } catch (error: any) {
      console.warn('Lỗi lấy GPS:', error);
      setErrorMsg('Không thể bắt được vị trí GPS. Vui lòng bật định vị hoặc ghim thủ công.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    requestAndFetchLocation();
  }, [requestAndFetchLocation]);

  // Cho phép ghim thủ công trên bản đồ (MANUAL_PIN) khi GPS yếu hoặc người dùng chỉnh lại
  const setManualLocation = useCallback((longitude: number, latitude: number) => {
    setLocation({
      type: 'Point',
      coordinates: [longitude, latitude],
      source: 'MANUAL_PIN',
      captured_at: new Date().toISOString(),
    });
    setErrorMsg(null);
  }, []);

  const setLocationSnapshot = useCallback((snapshot: GeoLocation) => {
    setLocation(snapshot);
    setErrorMsg(null);
    setPermissionDenied(false);
  }, []);

  return {
    location,
    loading,
    errorMsg,
    permissionDenied,
    refreshLocation: requestAndFetchLocation,
    setManualLocation,
    setLocationSnapshot,
  };
}
