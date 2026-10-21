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
      // Lấy vị trí với độ chính xác cao
      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        type: 'Point',
        coordinates: [currentLocation.coords.longitude, currentLocation.coords.latitude],
        source: 'GPS',
        accuracy_m: Math.round(currentLocation.coords.accuracy || 10),
        captured_at: new Date(currentLocation.timestamp).toISOString(),
      });
    } catch (error: any) {
      console.warn('Lỗi lấy GPS:', error);
      setErrorMsg('Không thể bắt được vị trí GPS. Vui lòng bật định vị hoặc ghim thủ công.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    requestAndFetchLocation();
  }, [requestAndFetchLocation]);

  // Cho phép ghim thủ công trên bản đồ (MANUAL_PIN) khi GPS yếu hoặc người dùng chỉnh lại
  const setManualLocation = (longitude: number, latitude: number) => {
    setLocation({
      type: 'Point',
      coordinates: [longitude, latitude],
      source: 'MANUAL_PIN',
      captured_at: new Date().toISOString(),
    });
    setErrorMsg(null);
  };

  return {
    location,
    loading,
    errorMsg,
    permissionDenied,
    refreshLocation: requestAndFetchLocation,
    setManualLocation,
  };
}
