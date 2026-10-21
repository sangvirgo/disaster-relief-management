import React, { useState, useEffect, useRef } from "react";
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
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { THEME } from "../../constants/theme";
import {
  MapPin,
  Navigation,
  X,
  Check,
  Search,
  Compass,
  ArrowRight,
  RotateCcw,
} from "lucide-react-native";

interface LocationPickerModalProps {
  visible: boolean;
  initialCoordinates?: [number, number]; // [longitude, latitude]
  initialAddressNote?: string;
  title?: string;
  confirmButtonText?: string;
  onClose: () => void;
  onConfirm: (coordinates: [number, number], addressNote?: string) => void;
}

interface SearchPlaceItem {
  id: string;
  name: string;
  fullAddress: string;
  coordinates: [number, number]; // [longitude, latitude]
}

// Tọa độ mặc định (Khu vực Đông Nam Bộ / TP.HCM / Bình Dương)
const DEFAULT_LATITUDE = 10.9289;
const DEFAULT_LONGITUDE = 106.8595;

// Hàm định dạng địa chỉ tiếng Việt từ kết quả Photon/OSM
function formatPhotonProperties(properties: any): {
  name: string;
  fullAddress: string;
} {
  const name = properties.name || properties.street || "Vị trí được chọn";
  const parts: string[] = [];
  if (properties.name) parts.push(properties.name);
  if (properties.street && properties.street !== properties.name)
    parts.push(properties.street);
  if (properties.locality) parts.push(properties.locality);
  if (properties.district && properties.district !== properties.locality)
    parts.push(properties.district);
  if (properties.city) parts.push(properties.city);
  if (properties.country && parts.length === 0) parts.push(properties.country);

  return {
    name,
    fullAddress: parts.join(", "),
  };
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  visible,
  initialCoordinates,
  initialAddressNote = "",
  title = "Ghim Vị Trí Cứu Nạn",
  confirmButtonText = "Xác nhận vị trí này",
  onClose,
  onConfirm,
}) => {
  const webViewRef = useRef<WebView>(null);
  const reverseTimeoutRef = useRef<any>(null);

  const [longitude, setLongitude] = useState<number>(
    initialCoordinates ? initialCoordinates[0] : DEFAULT_LONGITUDE,
  );
  const [latitude, setLatitude] = useState<number>(
    initialCoordinates ? initialCoordinates[1] : DEFAULT_LATITUDE,
  );
  const [lngInput, setLngInput] = useState<string>(
    initialCoordinates
      ? initialCoordinates[0].toFixed(6)
      : DEFAULT_LONGITUDE.toFixed(6),
  );
  const [latInput, setLatInput] = useState<string>(
    initialCoordinates
      ? initialCoordinates[1].toFixed(6)
      : DEFAULT_LATITUDE.toFixed(6),
  );
  const [addressNote, setAddressNote] = useState<string>(initialAddressNote);
  const [detectedAddress, setDetectedAddress] = useState<string>("");
  const [isReverseGeocoding, setIsReverseGeocoding] = useState<boolean>(false);

  // Trạng thái tìm kiếm địa điểm
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<SearchPlaceItem[]>([]);
  const [searchError, setSearchError] = useState<string>("");

  const [locatingGPS, setLocatingGPS] = useState<boolean>(false);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);

  // Tự động Reverse Geocode khi tọa độ thay đổi
  const reverseGeocode = async (lat: number, lng: number) => {
    setIsReverseGeocoding(true);
    try {
      const response = await fetch(
        `https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`,
      );
      const data = await response.json();
      if (data && data.features && data.features.length > 0) {
        const { fullAddress } = formatPhotonProperties(
          data.features[0].properties,
        );
        if (fullAddress) {
          setDetectedAddress(fullAddress);
        }
      }
    } catch {
      // Bỏ qua lỗi mạng tra cứu địa chỉ nền
    } finally {
      setIsReverseGeocoding(false);
    }
  };

  // Cập nhật khi mở modal hoặc initialCoordinates thay đổi
  useEffect(() => {
    if (visible) {
      const initLng = initialCoordinates
        ? initialCoordinates[0]
        : DEFAULT_LONGITUDE;
      const initLat = initialCoordinates
        ? initialCoordinates[1]
        : DEFAULT_LATITUDE;
      setLongitude(initLng);
      setLatitude(initLat);
      setLngInput(initLng.toFixed(6));
      setLatInput(initLat.toFixed(6));
      setAddressNote(initialAddressNote || "");
      setSearchQuery("");
      setSearchResults([]);
      setSearchError("");

      // Tra cứu địa chỉ ban đầu
      reverseGeocode(initLat, initLng);

      if (isMapReady && webViewRef.current) {
        webViewRef.current.injectJavaScript(`
          if (typeof window.updateMapLocation === 'function') {
            window.updateMapLocation(${initLat}, ${initLng}, 16);
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
      if (data.type === "MAP_READY") {
        setIsMapReady(true);
        webViewRef.current?.injectJavaScript(`
          if (typeof window.updateMapLocation === 'function') {
            window.updateMapLocation(${latitude}, ${longitude}, 16);
          }
          true;
        `);
      } else if (data.type === "LOCATION_CHANGED") {
        const newLat = parseFloat(data.latitude);
        const newLng = parseFloat(data.longitude);
        if (!isNaN(newLat) && !isNaN(newLng)) {
          setLatitude(newLat);
          setLongitude(newLng);
          setLatInput(newLat.toFixed(6));
          setLngInput(newLng.toFixed(6));

          // Đợi 400ms sau khi ngừng chạm/kéo thì dịch địa chỉ
          if (reverseTimeoutRef.current)
            clearTimeout(reverseTimeoutRef.current);
          reverseTimeoutRef.current = setTimeout(() => {
            reverseGeocode(newLat, newLng);
          }, 400);
        }
      }
    } catch {
      // Bỏ qua lỗi parse
    }
  };

  // Xử lý tìm kiếm địa chỉ bằng Photon API
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;

    setIsSearching(true);
    setSearchError("");
    try {
      const response = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`,
      );
      const data = await response.json();
      if (data && data.features && data.features.length > 0) {
        const items: SearchPlaceItem[] = data.features.map(
          (f: any, idx: number) => {
            const { name, fullAddress } = formatPhotonProperties(f.properties);
            return {
              id: `${idx}_${f.geometry.coordinates.join("_")}`,
              name,
              fullAddress,
              coordinates: [
                f.geometry.coordinates[0],
                f.geometry.coordinates[1],
              ],
            };
          },
        );
        setSearchResults(items);
      } else {
        setSearchResults([]);
        setSearchError(
          "Không tìm thấy địa điểm phù hợp. Bạn có thể zoom và chạm trực tiếp trên bản đồ.",
        );
      }
    } catch {
      setSearchError(
        "Lỗi tra cứu địa điểm. Vui lòng kiểm tra mạng hoặc chạm trực tiếp trên bản đồ.",
      );
    } finally {
      setIsSearching(false);
    }
  };

  // Chọn địa điểm từ danh sách gợi ý
  const handleSelectSearchResult = (item: SearchPlaceItem) => {
    const [newLng, newLat] = item.coordinates;
    setLongitude(newLng);
    setLatitude(newLat);
    setLngInput(newLng.toFixed(6));
    setLatInput(newLat.toFixed(6));
    setDetectedAddress(item.fullAddress);
    setSearchResults([]);
    setSearchQuery(item.name);

    // Tự động điền vào ghi chú nếu người dùng chưa viết gì
    if (!addressNote.trim()) {
      setAddressNote(item.fullAddress);
    }

    // Di chuyển bản đồ đến điểm vừa chọn
    webViewRef.current?.injectJavaScript(`
      if (typeof window.updateMapLocation === 'function') {
        window.updateMapLocation(${newLat}, ${newLng}, 16);
      }
      true;
    `);
  };

  // Lấy vị trí GPS hiện tại của thiết bị
  const handleFetchCurrentGPS = async () => {
    setLocatingGPS(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Chưa cấp quyền vị trí",
          "Vui lòng cấp quyền truy cập vị trí cho ứng dụng để lấy tọa độ GPS tự động.",
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

      // Dịch địa chỉ GPS
      reverseGeocode(newLat, newLng);

      // Di chuyển bản đồ tới tọa độ GPS mới
      webViewRef.current?.injectJavaScript(`
        if (typeof window.updateMapLocation === 'function') {
          window.updateMapLocation(${newLat}, ${newLng}, 16);
        }
        true;
      `);
    } catch {
      Alert.alert(
        "Không thể lấy GPS",
        "Vui lòng kiểm tra dịch vụ định vị trên thiết bị.",
      );
    } finally {
      setLocatingGPS(false);
    }
  };

  // Áp dụng tọa độ nhập từ bàn phím
  const handleApplyManualInputs = () => {
    const parsedLng = parseFloat(lngInput);
    const parsedLat = parseFloat(latInput);
    if (isNaN(parsedLng) || isNaN(parsedLat)) {
      Alert.alert(
        "Tọa độ không hợp lệ",
        "Vui lòng kiểm tra lại kinh độ và vĩ độ.",
      );
      return;
    }
    setLongitude(parsedLng);
    setLatitude(parsedLat);
    reverseGeocode(parsedLat, parsedLng);
    webViewRef.current?.injectJavaScript(`
      if (typeof window.updateMapLocation === 'function') {
        window.updateMapLocation(${parsedLat}, ${parsedLng}, 16);
      }
      true;
    `);
  };

  // Áp dụng địa chỉ nhận diện vào ô ghi chú
  const handleApplyDetectedToNote = () => {
    if (detectedAddress) {
      setAddressNote(detectedAddress);
    }
  };

  // Xác nhận vị trí
  const handleConfirm = () => {
    const parsedLng = parseFloat(lngInput);
    const parsedLat = parseFloat(latInput);
    if (isNaN(parsedLng) || isNaN(parsedLat)) {
      Alert.alert("Tọa độ chưa đúng", "Vui lòng chọn hoặc nhập tọa độ hợp lệ.");
      return;
    }
    onConfirm([parsedLng, parsedLat], addressNote.trim() || undefined);
    onClose();
  };

  // Mã nguồn HTML Leaflet nhúng trong WebView
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
            width: 34px;
            height: 34px;
            background: #DC2626;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid #FFFFFF;
            box-shadow: 0 4px 10px rgba(220, 38, 38, 0.45);
            margin-top: -30px;
            margin-left: -17px;
          }
          .custom-pin::after {
            content: '';
            width: 12px;
            height: 12px;
            margin: 8px 0 0 8px;
            background: #FFFFFF;
            position: absolute;
            border-radius: 50%;
          }
          .leaflet-control-attribution {
            display: none !important;
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

          // Lớp bản đồ OpenStreetMap chính thức (tile.openstreetmap.de) không watermark, miễn phí 100%
          L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
            maxZoom: 19
          }).addTo(map);

          var pinIcon = L.divIcon({
            className: 'custom-pin-wrap',
            html: '<div class="custom-pin"></div>',
            iconSize: [34, 34],
            iconAnchor: [17, 34]
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
          window.updateMapLocation = function(lat, lng, zoomLevel) {
            marker.setLatLng([lat, lng]);
            map.setView([lat, lng], zoomLevel || 16);
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
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header Modal */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MapPin size={22} color={THEME.colors.emergency.main} />
            <Text style={styles.headerTitle}>{title}</Text>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={22} color={THEME.colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* Thanh Tìm Kiếm Địa Điểm Thông Minh (Search Bar) */}
        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <Search size={18} color={THEME.colors.text.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Tìm tên đường, xã, phường, địa điểm cứu nạn..."
              placeholderTextColor={THEME.colors.text.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setSearchError("");
                }}
                style={styles.clearSearchBtn}
              >
                <X size={16} color={THEME.colors.text.muted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.searchSubmitBtn}
              onPress={handleSearch}
              disabled={isSearching}
              activeOpacity={0.8}
            >
              {isSearching ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.searchSubmitText}>Tìm</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Danh sách kết quả gợi ý địa điểm (Accordion Dropdown) */}
          {searchResults.length > 0 && (
            <View style={styles.resultsContainer}>
              <View style={styles.resultsHeader}>
                <Text style={styles.resultsHeaderText}>
                  Chọn địa điểm phù hợp:
                </Text>
                <TouchableOpacity onPress={() => setSearchResults([])}>
                  <Text style={styles.resultsCloseText}>Đóng</Text>
                </TouchableOpacity>
              </View>
              {searchResults.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.resultItem}
                  onPress={() => handleSelectSearchResult(item)}
                  activeOpacity={0.7}
                >
                  <MapPin
                    size={16}
                    color={THEME.colors.emergency.main}
                    style={{ marginTop: 2 }}
                  />
                  <View style={styles.resultItemTextWrap}>
                    <Text style={styles.resultItemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.resultItemAddress} numberOfLines={2}>
                      {item.fullAddress}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {searchError ? (
            <Text style={styles.searchErrorText}>{searchError}</Text>
          ) : null}
        </View>

        {/* Khu vực Bản đồ Tương tác Leaflet / OpenStreetMap */}
        <View style={styles.mapContainer}>
          <WebView
            ref={webViewRef}
            originWhitelist={["*"]}
            source={{ html: leafletHtml }}
            style={styles.map}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onMessage={handleWebViewMessage}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.mapLoading}>
                <ActivityIndicator
                  size="large"
                  color={THEME.colors.emergency.main}
                />
                <Text style={styles.mapLoadingText}>
                  Đang tải bản đồ đường phố...
                </Text>
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
              <ActivityIndicator
                size="small"
                color={THEME.colors.primary.main}
              />
            ) : (
              <>
                <Navigation size={18} color={THEME.colors.primary.main} />
                <Text style={styles.fabGpsText}>GPS của tôi</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Khung Thông Tin Địa Chỉ Nhận Diện (Reverse Geocoded Address) */}
        <View style={styles.detectedAddressBox}>
          <View style={styles.detectedHeaderRow}>
            <Compass size={16} color={THEME.colors.primary.main} />
            <Text style={styles.detectedTitle}>ĐỊA CHỈ TẠI ĐIỂM GHIM:</Text>
            {isReverseGeocoding && (
              <ActivityIndicator
                size="small"
                color={THEME.colors.primary.main}
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          <Text style={styles.detectedContentText} numberOfLines={2}>
            {detectedAddress ||
              "Chạm hoặc kéo ghim đỏ để nhận diện địa chỉ cụ thể."}
          </Text>
          {detectedAddress ? (
            <TouchableOpacity
              style={styles.useAddressBtn}
              onPress={handleApplyDetectedToNote}
              activeOpacity={0.75}
            >
              <Text style={styles.useAddressBtnText}>Áp dụng vào ghi chú</Text>
              <ArrowRight size={13} color={THEME.colors.primary.main} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Khu vực Nhập / Chỉnh sửa Chi tiết Tọa độ */}
        <ScrollView
          style={styles.formContainer}
          keyboardShouldPersistTaps="handled"
        >
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
            <Text style={styles.fieldLabel}>
              Mô tả vị trí / Ghi chú nhận biết (nếu có):
            </Text>
            <TextInput
              style={styles.input}
              value={addressNote}
              onChangeText={setAddressNote}
              placeholder="VD: Cạnh trường tiểu học, nhà cấp 4 mái đỏ ngập sâu..."
              placeholderTextColor={THEME.colors.text.muted}
              multiline={false}
            />
          </View>
        </ScrollView>

        {/* Nút Hành Động Ở Đáy */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.cancelBtnText}>Hủy bỏ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={handleConfirm}
            activeOpacity={0.85}
          >
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 50 : 16,
    paddingBottom: 12,
    backgroundColor: THEME.colors.surface.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: THEME.typography.fontSizes.base,
    fontWeight: "800",
    color: THEME.colors.text.primary,
    marginLeft: 8,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: THEME.colors.surface.background,
  },
  searchSection: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: THEME.colors.surface.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    borderRadius: 10,
    paddingLeft: 10,
    paddingRight: 4,
    height: 44,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 8,
    fontSize: THEME.typography.fontSizes.sm,
    color: THEME.colors.text.primary,
  },
  clearSearchBtn: {
    padding: 6,
  },
  searchSubmitBtn: {
    backgroundColor: THEME.colors.primary.main,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  searchSubmitText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: THEME.typography.fontSizes.xs,
  },
  searchErrorText: {
    fontSize: 11,
    color: THEME.colors.emergency.main,
    marginTop: 6,
    marginLeft: 4,
  },
  resultsContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    maxHeight: 180,
    overflow: "hidden",
    ...THEME.shadows.md,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: THEME.colors.primary.bg,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.primary.border,
  },
  resultsHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.colors.primary.dark,
  },
  resultsCloseText: {
    fontSize: 11,
    fontWeight: "600",
    color: THEME.colors.text.secondary,
  },
  resultItem: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
    alignItems: "flex-start",
  },
  resultItemTextWrap: {
    marginLeft: 8,
    flex: 1,
  },
  resultItemName: {
    fontSize: THEME.typography.fontSizes.xs + 1,
    fontWeight: "700",
    color: THEME.colors.text.primary,
  },
  resultItemAddress: {
    fontSize: 11,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  mapContainer: {
    height: 300,
    width: "100%",
    position: "relative",
    backgroundColor: "#E2E8F0",
  },
  map: {
    width: "100%",
    height: "100%",
    backgroundColor: "#F1F5F9",
  },
  mapLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
  },
  mapLoadingText: {
    marginTop: 8,
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    fontWeight: "600",
  },
  fabGps: {
    position: "absolute",
    right: 14,
    bottom: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.colors.primary.border,
    ...THEME.shadows.md,
  },
  fabGpsText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: "700",
    color: THEME.colors.primary.main,
    marginLeft: 6,
  },
  detectedAddressBox: {
    backgroundColor: THEME.colors.primary.bg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.primary.border,
  },
  detectedHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  detectedTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: THEME.colors.primary.dark,
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  detectedContentText: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: "600",
    color: THEME.colors.text.primary,
    lineHeight: 16,
  },
  useAddressBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    alignSelf: "flex-start",
  },
  useAddressBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.colors.primary.main,
    marginRight: 4,
  },
  formContainer: {
    flex: 1,
    padding: 14,
  },
  coordInputsRow: {
    flexDirection: "row",
    gap: 12,
  },
  coordInputCol: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: "600",
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
    marginTop: 12,
  },
  footer: {
    flexDirection: "row",
    padding: 14,
    backgroundColor: THEME.colors.surface.card,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.surface.border,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.surface.background,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
  },
  cancelBtnText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: "700",
    color: THEME.colors.text.secondary,
  },
  confirmBtn: {
    flex: 2,
    flexDirection: "row",
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.emergency.main,
    ...THEME.shadows.sm,
  },
  confirmBtnText: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: "700",
    color: "#FFFFFF",
    marginLeft: 6,
  },
});
