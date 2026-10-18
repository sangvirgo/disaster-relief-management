import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { THEME } from '../../constants/theme';
import { MapPin, Navigation, X, Check, Info } from 'lucide-react-native';

interface LocationPickerModalProps {
  visible: boolean;
  initialCoordinates?: [number, number]; // [longitude, latitude]
  initialAddressNote?: string;
  title?: string;
  confirmButtonText?: string;
  onClose: () => void;
  onConfirm: (coordinates: [number, number], addressNote?: string) => void;
}

// Tọa độ mặc định (Khu vực Đông Nam Bộ / TP.HCM / Bình Dương)
const DEFAULT_LATITUDE = 10.9289;
const DEFAULT_LONGITUDE = 106.8595;

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  visible,
  initialCoordinates,
  initialAddressNote = '',
  title = 'Ghim Vị Trí Cứu Nạn',
  confirmButtonText = 'Xác nhận vị trí này',
  onClose,
  onConfirm,
}) => {
  const webViewRef = useRef<WebView>(null);

  const [longitude, setLongitude] = useState<number>(
    initialCoordinates ? initialCoordinates[0] : DEFAULT_LONGITUDE
  );
  const [latitude, setLatitude] = useState<number>(
    initialCoordinates ? initialCoordinates[1] : DEFAULT_LATITUDE
  );
  const [lngInput, setLngInput] = useState<string>(
    initialCoordinates ? initialCoordinates[0].toFixed(6) : DEFAULT_LONGITUDE.toFixed(6)
  );
  const [latInput, setLatInput] = useState<string>(
    initialCoordinates ? initialCoordinates[1].toFixed(6) : DEFAULT_LATITUDE.toFixed(6)
  );
  const [addressNote, setAddressNote] = useState<string>(initialAddressNote);
  const [locatingGPS, setLocatingGPS] = useState<boolean>(false);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);

  // Cập nhật khi mở modal hoặc initialCoordinates thay đổi
  useEffect(() => {
    if (visible) {
      const initLng = initialCoordinates ? initialCoordinates[0] : DEFAULT_LONGITUDE;
      const initLat = initialCoordinates ? initialCoordinates[1] : DEFAULT_LATITUDE;
      setLongitude(initLng);
      setLatitude(initLat);
      setLngInput(initLng.toFixed(6));
      setLatInput(initLat.toFixed(6));
      setAddressNote(initialAddressNote || '');

      if (isMapReady && webViewRef.current) {
        webViewRef.current.injectJavaScript(`
          if (typeof window.updateMapLocation === 'function') {
            window.updateMapLocation(${initLat}, ${initLng});
          }
          true;
        `);
      }
    }
  }, [visible, initialCoordinates, initialAddressNote, isMapReady]);

  // Xử lý message từ Leaflet Map trong WebView
  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setIsMapReady(true);
        // Gửi tọa độ hiện tại vào bản đồ
        webViewRef.current?.injectJavaScript(`
          if (typeof window.updateMapLocation === 'function') {
            window.updateMapLocation(${latitude}, ${longitude});
          }
          true;
        `);
      } else if (data.type === 'LOCATION_CHANGED') {
        const newLat = parseFloat(data.latitude);
        const newLng = parseFloat(data.longitude);
        if (!isNaN(newLat) && !isNaN(newLng)) {
          setLatitude(newLat);
          setLongitude(newLng);
          setLatInput(newLat.toFixed(6));
          setLngInput(newLng.toFixed(6));
        }
      }
    } catch (e) {
      // Bỏ qua lỗi parse
    }
  };

  // Lấy vị trí GPS hiện tại của thiết bị
  const handleFetchCurrentGPS = async () => {
    setLocatingGPS(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Chưa cấp quyền vị trí',
          'Vui lòng cấp quyền truy cập vị trí cho ứng dụng để lấy tọa độ GPS tự động.'
        );
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const newLat = current.coords.latitude;
      const newLng = current.coords.longitude;
      setLatitude(newLat);
      setLongitude(newLng);
      setLatInput(newLat.toFixed(6));
      setLngInput(newLng.toFixed(6));

      // Di chuyển bản đồ tới tọa độ GPS mới
      webViewRef.current?.injectJavaScript(`
        if (typeof window.updateMapLocation === 'function') {
          window.updateMapLocation(${newLat}, ${newLng});
        }
        true;
      `);
    } catch (err: any) {
      Alert.alert('Không thể lấy GPS', 'Vui lòng kiểm tra dịch vụ định vị trên thiết bị.');
    } finally {
      setLocatingGPS(false);
    }
  };

  // Áp dụng tọa độ nhập từ bàn phím
  const handleApplyManualInputs = () => {
    const parsedLng = parseFloat(lngInput);
    const parsedLat = parseFloat(latInput);
    if (isNaN(parsedLng) || isNaN(parsedLat)) {
      Alert.alert('Tọa độ không hợp lệ', 'Vui lòng kiểm tra lại kinh độ và vĩ độ.');
      return;
    }
    setLongitude(parsedLng);
    setLatitude(parsedLat);
    webViewRef.current?.injectJavaScript(`
      if (typeof window.updateMapLocation === 'function') {
        window.updateMapLocation(${parsedLat}, ${parsedLng});
      }
      true;
    `);
  };

  // Xác nhận vị trí
  const handleConfirm = () => {
    const parsedLng = parseFloat(lngInput);
    const parsedLat = parseFloat(latInput);
    if (isNaN(parsedLng) || isNaN(parsedLat)) {
      Alert.alert('Tọa độ chưa đúng', 'Vui lòng chọn hoặc nhập tọa độ hợp lệ.');
      return;
    }
    onConfirm([parsedLng, parsedLat], addressNote.trim() || undefined);
    onClose();
  };

  // Mã nguồn HTML Leaflet nhúng trong WebView (hoàn toàn miễn phí 100%, không cần Google API Key)
  const leafletHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            background-color: #f1f5f9;
          }
          .custom-pin {
            width: 32px;
            height: 32px;
            background: #DC2626;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid #FFFFFF;
            box-shadow: 0 4px 8px rgba(220, 38, 38, 0.4);
            margin-top: -28px;
            margin-left: -16px;
          }
          .custom-pin::after {
            content: '';
            width: 12px;
            height: 12px;
            margin: 7px 0 0 7px;
            background: #FFFFFF;
            position: absolute;
            border-radius: 50%;
          }
          .leaflet-control-attribution {
            font-size: 8px !important;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', {
            zoomControl: true,
            attributionControl: false
          }).setView([${latitude}, ${longitude}], 15);

          // Lớp bản đồ OpenStreetMap miễn phí 100%, không watermark, không cần API key
          L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
          }).addTo(map);

          var pinIcon = L.divIcon({
            className: 'custom-pin-wrap',
            html: '<div class="custom-pin"></div>',
            iconSize: [32, 32],
            iconAnchor: [16, 32]
          });

          var marker = L.marker([${latitude}, ${longitude}], {
            icon: pinIcon,
            draggable: true
          }).addTo(map);

          function notifyApp(lat, lng) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'LOCATION_CHANGED',
                latitude: lat,
                longitude: lng
              }));
            }
          }

          // Chạm vào bất kỳ điểm nào trên bản đồ để di chuyển ghim
          map.on('click', function(e) {
            marker.setLatLng(e.latlng);
            notifyApp(e.latlng.lat, e.latlng.lng);
          });

          // Kéo thả ghim
          marker.on('dragend', function(e) {
            var pos = marker.getLatLng();
            notifyApp(pos.lat, pos.lng);
          });

          // Hàm cập nhật từ React Native
          window.updateMapLocation = function(lat, lng) {
            marker.setLatLng([lat, lng]);
            map.setView([lat, lng], 16);
          };

          // Báo cho React Native biết map đã sẵn sàng
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
          }
        </script>
      </body>
    </html>
  `;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header Modal */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MapPin size={22} color={THEME.colors.emergency.main} />
            <Text style={styles.headerTitle}>{title}</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={THEME.colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* Hướng dẫn nhanh */}
        <View style={styles.guidanceBanner}>
          <Info size={15} color={THEME.colors.primary.main} />
          <Text style={styles.guidanceText}>
            Chạm vào bản đồ hoặc kéo ghim đỏ để định vị chính xác vị trí cần cứu hộ.
          </Text>
        </View>

        {/* Khu vực Bản đồ Tương tác Leaflet / OpenStreetMap */}
        <View style={styles.mapContainer}>
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: leafletHtml }}
            style={styles.map}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onMessage={handleWebViewMessage}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.mapLoading}>
                <ActivityIndicator size="large" color={THEME.colors.emergency.main} />
                <Text style={styles.mapLoadingText}>Đang tải bản đồ đường phố...</Text>
              </View>
            )}
          />

          {/* Nút bấm nổi lấy GPS tức thì */}
          <TouchableOpacity
            style={styles.fabGps}
            onPress={handleFetchCurrentGPS}
            disabled={locatingGPS}
            activeOpacity={0.85}
          >
            {locatingGPS ? (
              <ActivityIndicator size="small" color={THEME.colors.primary.main} />
            ) : (
              <>
                <Navigation size={18} color={THEME.colors.primary.main} />
                <Text style={styles.fabGpsText}>GPS của tôi</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Khu vực Nhập / Chỉnh sửa Chi tiết Tọa độ */}
        <ScrollView style={styles.formContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.coordInputsRow}>
            <View style={styles.coordInputCol}>
              <Text style={styles.fieldLabel}>Kinh độ (Longitude):</Text>
              <TextInput
                style={styles.input}
                value={lngInput}
                onChangeText={setLngInput}
                onBlur={handleApplyManualInputs}
                keyboardType="numeric"
                placeholder="106.859509"
                placeholderTextColor={THEME.colors.text.muted}
              />
            </View>
            <View style={styles.coordInputCol}>
              <Text style={styles.fieldLabel}>Vĩ độ (Latitude):</Text>
              <TextInput
                style={styles.input}
                value={latInput}
                onChangeText={setLatInput}
                onBlur={handleApplyManualInputs}
                keyboardType="numeric"
                placeholder="10.928944"
                placeholderTextColor={THEME.colors.text.muted}
              />
            </View>
          </View>

          <View style={styles.noteInputGroup}>
            <Text style={styles.fieldLabel}>Mô tả vị trí / Địa chỉ nhận biết (nếu có):</Text>
            <TextInput
              style={styles.input}
              value={addressNote}
              onChangeText={setAddressNote}
              placeholder="VD: Cạnh trường tiểu học, nhà cấp 4 mái đỏ ngập sâu..."
              placeholderTextColor={THEME.colors.text.muted}
            />
          </View>
        </ScrollView>

        {/* Nút Hành Động Ở Đáy */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.cancelBtnText}>Hủy bỏ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.85}>
            <Check size={18} color="#FFFFFF" />
            <Text style={styles.confirmBtnText}>{confirmButtonText}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.surface.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 14,
    backgroundColor: THEME.colors.surface.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: '800',
    color: THEME.colors.text.primary,
    marginLeft: 8,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: THEME.colors.surface.background,
  },
  guidanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.primary.border,
  },
  guidanceText: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.primary.dark,
    marginLeft: 8,
    flex: 1,
  },
  mapContainer: {
    height: 330,
    width: '100%',
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  map: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F1F5F9',
  },
  mapLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLoadingText: {
    marginTop: 8,
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    fontWeight: '600',
  },
  fabGps: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    ...THEME.shadows.md,
  },
  fabGpsText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
    color: THEME.colors.primary.main,
    marginLeft: 6,
  },
  formContainer: {
    flex: 1,
    padding: 16,
  },
  coordInputsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  coordInputCol: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: THEME.colors.surface.card,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  noteInputGroup: {
    marginTop: 14,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: THEME.colors.surface.card,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  cancelBtnText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: THEME.colors.text.secondary,
  },
  confirmBtn: {
    flex: 2,
    flexDirection: 'row',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.emergency.main,
    ...THEME.shadows.sm,
  },
  confirmBtnText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 6,
  },
});
