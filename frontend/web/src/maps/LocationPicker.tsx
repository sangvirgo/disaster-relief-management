import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type Point = { longitude: number; latitude: number };

const envApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || '';

// Biểu tượng ghim đỏ khẩn cấp chuẩn C48 (không phụ thuộc vào ảnh tĩnh để tránh lỗi 404 trên Vite)
const redPinIcon = L.divIcon({
  className: 'c48-leaflet-marker',
  html: `
    <div style="
      background-color: #DC2626;
      width: 26px;
      height: 26px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid #FFFFFF;
      box-shadow: 0 4px 10px rgba(220, 38, 38, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        width: 8px;
        height: 8px;
        background-color: #FFFFFF;
        border-radius: 50%;
      "></div>
    </div>
  `,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

export function LocationPicker({
  value,
  onSelect,
}: {
  value: Point | null;
  onSelect: (point: Point | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customKey, setCustomKey] = useState(
    () => localStorage.getItem('C48_GOOGLE_MAPS_API_KEY') || ''
  );
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  const activeGoogleKey = customKey || envApiKey;
  const [mapEngine, setMapEngine] = useState<'osm' | 'google'>(() =>
    activeGoogleKey ? 'google' : 'osm'
  );

  // Leaflet refs
  const leafletContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const leafletMarkerRef = useRef<L.Marker | null>(null);

  // Google Maps refs
  const googleContainerRef = useRef<HTMLDivElement>(null);
  const googleSearchRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // Search state for OpenStreetMap / Nominatim
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{ display_name: string; lat: string; lon: string }>
  >([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [error, setError] = useState('');

  // 1. Khởi tạo / cập nhật bản đồ OpenStreetMap (Leaflet)
  useEffect(() => {
    if (!open || mapEngine !== 'osm' || !leafletContainerRef.current) return;

    const initialCenter: [number, number] = value
      ? [value.latitude, value.longitude]
      : [16.1, 107.7];
    const initialZoom = value ? 16 : 6;

    const map = L.map(leafletContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: true,
    });
    leafletMapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    let marker: L.Marker | null = null;
    if (value) {
      marker = L.marker([value.latitude, value.longitude], { icon: redPinIcon }).addTo(map);
      leafletMarkerRef.current = marker;
      setSelectedAddress(`Đã ghim: ${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`);
    }

    map.on('click', (event: L.LeafletMouseEvent) => {
      const { lat, lng } = event.latlng;
      if (leafletMarkerRef.current) {
        leafletMarkerRef.current.setLatLng([lat, lng]);
      } else {
        leafletMarkerRef.current = L.marker([lat, lng], { icon: redPinIcon }).addTo(map);
      }
      setSelectedAddress(`Đã chọn điểm trên bản đồ (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
      selectRef.current({ latitude: lat, longitude: lng });
    });

    // Ép Leaflet render lại kích thước sau khi container xuất hiện
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      leafletMapRef.current = null;
      leafletMarkerRef.current = null;
    };
  }, [open, mapEngine]);

  // Cập nhật vị trí marker khi value từ ngoài đổi
  useEffect(() => {
    if (mapEngine === 'osm' && value && leafletMapRef.current) {
      const { latitude, longitude } = value;
      leafletMapRef.current.panTo([latitude, longitude]);
      if (leafletMarkerRef.current) {
        leafletMarkerRef.current.setLatLng([latitude, longitude]);
      } else {
        leafletMarkerRef.current = L.marker([latitude, longitude], { icon: redPinIcon }).addTo(
          leafletMapRef.current
        );
      }
    }
  }, [value?.latitude, value?.longitude, mapEngine]);

  // 2. Khởi tạo Google Maps (nếu có API Key và đang chọn Google Engine)
  useEffect(() => {
    if (!open || mapEngine !== 'google' || !activeGoogleKey || !googleContainerRef.current) return;

    let active = true;
    let listener: google.maps.MapsEventListener | undefined;
    let autocomplete: google.maps.places.PlaceAutocompleteElement | undefined;

    async function initGoogle() {
      try {
        setOptions({ key: activeGoogleKey, v: 'weekly', language: 'vi', region: 'VN' });
        const [{ Map }, { PlaceAutocompleteElement }] = await Promise.all([
          importLibrary('maps'),
          importLibrary('places'),
        ]);
        if (!active || !googleContainerRef.current) return;

        const center = value
          ? { lat: value.latitude, lng: value.longitude }
          : { lat: 16.1, lng: 107.7 };
        const map = new Map(googleContainerRef.current, {
          center,
          zoom: value ? 16 : 6,
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: false,
        });
        googleMapRef.current = map;

        listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          const point = { latitude: event.latLng.lat(), longitude: event.latLng.lng() };
          map.panTo(event.latLng);
          setSelectedAddress(
            `Đã chọn điểm trên Google Maps (${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)})`
          );
          selectRef.current(point);
        });

        if (googleSearchRef.current) {
          googleSearchRef.current.innerHTML = '';
          autocomplete = new PlaceAutocompleteElement();
          autocomplete.includedRegionCodes = ['vn'];
          autocomplete.placeholder = 'Tìm tỉnh, thành phố, đường hoặc địa điểm';
          autocomplete.setAttribute('aria-label', 'Tìm địa điểm tại Việt Nam');
          autocomplete.addEventListener('gmp-select', async (event) => {
            try {
              const place = (
                event as google.maps.places.PlacePredictionSelectEvent
              ).placePrediction.toPlace();
              await place.fetchFields({ fields: ['formattedAddress', 'location', 'viewport'] });
              if (!active || !place.location) return;
              if (place.viewport) map.fitBounds(place.viewport);
              else {
                map.setCenter(place.location);
                map.setZoom(17);
              }
              const lat = place.location.lat();
              const lng = place.location.lng();
              setSelectedAddress(`Đã tìm thấy ${place.formattedAddress || 'địa điểm'}`);
              selectRef.current({ latitude: lat, longitude: lng });
            } catch {
              if (active)
                setError('Không thể lấy tọa độ địa điểm này. Hãy chạm điểm trực tiếp trên bản đồ.');
            }
          });
          googleSearchRef.current.append(autocomplete);
        }
        setError('');
      } catch {
        if (active) {
          setError(
            'Không tải được Google Maps với khóa này. Hệ thống tự động chuyển sang Bản đồ Mở OpenStreetMap.'
          );
          setMapEngine('osm');
        }
      }
    }

    void initGoogle();

    return () => {
      active = false;
      listener?.remove();
      autocomplete?.remove();
      googleMapRef.current = null;
    };
  }, [open, mapEngine, activeGoogleKey]);

  // Tìm kiếm địa chỉ với OpenStreetMap (Nominatim API miễn phí tiếng Việt)
  async function searchOsm(e?: React.SyntheticEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}&countrycodes=vn&limit=5`,
        {
          headers: { 'Accept-Language': 'vi' },
        }
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setSuggestions(data);
      } else {
        setSuggestions([]);
        setError(
          'Không tìm thấy địa điểm phù hợp tại Việt Nam. Bạn có thể zoom và chạm trực tiếp trên bản đồ.'
        );
      }
    } catch {
      setError('Lỗi kết nối tra cứu địa chỉ. Bạn có thể kéo bản đồ và chạm điểm cần chọn.');
    } finally {
      setSearching(false);
    }
  }

  function chooseSuggestion(item: { display_name: string; lat: string; lon: string }) {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (leafletMapRef.current) {
      leafletMapRef.current.flyTo([lat, lon], 16);
      if (leafletMarkerRef.current) {
        leafletMarkerRef.current.setLatLng([lat, lon]);
      } else {
        leafletMarkerRef.current = L.marker([lat, lon], { icon: redPinIcon }).addTo(
          leafletMapRef.current
        );
      }
    }
    setSelectedAddress(item.display_name);
    setSuggestions([]);
    selectRef.current({ latitude: lat, longitude: lon });
  }

  function pickMapCenter() {
    if (mapEngine === 'osm' && leafletMapRef.current) {
      const center = leafletMapRef.current.getCenter();
      if (leafletMarkerRef.current) {
        leafletMarkerRef.current.setLatLng(center);
      } else {
        leafletMarkerRef.current = L.marker(center, { icon: redPinIcon }).addTo(
          leafletMapRef.current
        );
      }
      setSelectedAddress(`Đã chọn tâm bản đồ (${center.lat.toFixed(6)}, ${center.lng.toFixed(6)})`);
      selectRef.current({ latitude: center.lat, longitude: center.lng });
    } else if (mapEngine === 'google' && googleMapRef.current) {
      const center = googleMapRef.current.getCenter();
      if (center) {
        setSelectedAddress(
          `Đã chọn tâm bản đồ (${center.lat().toFixed(6)}, ${center.lng().toFixed(6)})`
        );
        selectRef.current({ latitude: center.lat(), longitude: center.lng() });
      }
    }
  }

  function saveCustomGoogleKey(e?: React.SyntheticEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const key = keyDraft.trim();
    localStorage.setItem('C48_GOOGLE_MAPS_API_KEY', key);
    setCustomKey(key);
    setShowKeyInput(false);
    if (key) setMapEngine('google');
    else setMapEngine('osm');
  }

  return (
    <div className="location-picker">
      <button
        type="button"
        className="button secondary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {open ? 'Ẩn bản đồ chọn vị trí' : '📍 Tìm địa chỉ và chọn trên bản đồ'}
      </button>

      {open && (
        <div className="location-map-panel">
          <div className="map-engine-switch">
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-primary-dark)' }}>
                {mapEngine === 'google'
                  ? 'Đang dùng Google Maps'
                  : 'Đang dùng Bản đồ Mở (OpenStreetMap) sẵn sàng 100%'}
              </p>
              <small style={{ color: 'var(--color-text-secondary)' }}>
                Chạm hoặc click bất kỳ điểm nào trên bản đồ để ghim đúng nơi cần hỗ trợ
              </small>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {activeGoogleKey && (
                <button
                  type="button"
                  className={`button secondary ${mapEngine === 'google' ? 'active' : ''}`}
                  style={{ minHeight: 34, padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setMapEngine('google')}
                >
                  Google Maps
                </button>
              )}
              <button
                type="button"
                className={`button secondary ${mapEngine === 'osm' ? 'active' : ''}`}
                style={{ minHeight: 34, padding: '4px 10px', fontSize: 12 }}
                onClick={() => setMapEngine('osm')}
              >
                Bản đồ Mở (OSM)
              </button>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: 11, padding: '4px 6px' }}
                onClick={() => setShowKeyInput(!showKeyInput)}
              >
                {activeGoogleKey ? 'Đổi khóa Google' : 'Thêm khóa Google'}
              </button>
            </div>
          </div>

          {showKeyInput && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Dán Google Maps API Key tại đây..."
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    saveCustomGoogleKey(e);
                  }
                }}
                style={{
                  flex: 1,
                  border: '1px solid var(--color-surface-divider)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                className="button"
                style={{ minHeight: 34, padding: '6px 12px', fontSize: 13 }}
                onClick={(e) => saveCustomGoogleKey(e)}
              >
                Lưu khóa
              </button>
              {customKey && (
                <button
                  type="button"
                  className="button secondary"
                  style={{ minHeight: 34, padding: '6px 10px', fontSize: 13 }}
                  onClick={() => {
                    localStorage.removeItem('C48_GOOGLE_MAPS_API_KEY');
                    setCustomKey('');
                    setKeyDraft('');
                    setMapEngine('osm');
                  }}
                >
                  Xóa
                </button>
              )}
            </div>
          )}

          {/* Ô tìm kiếm cho OpenStreetMap (Nominatim) */}
          {mapEngine === 'osm' && (
            <div className="location-search">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Gõ tên tỉnh, thành phố, quận huyện hoặc đường (VD: Ba Đình Hà Nội, Quận 1 TP.HCM)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      searchOsm(e);
                    }
                  }}
                  style={{
                    flex: 1,
                    border: '1px solid var(--color-surface-divider)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    fontSize: 14,
                    background: '#FFFFFF',
                  }}
                />
                <button
                  type="button"
                  className="button"
                  disabled={searching}
                  style={{ minHeight: 40, padding: '8px 16px' }}
                  onClick={(e) => searchOsm(e)}
                >
                  {searching ? 'Đang tìm…' : 'Tìm địa điểm'}
                </button>
              </div>

              {suggestions.length > 0 && (
                <div
                  style={{
                    marginTop: 6,
                    background: '#FFFFFF',
                    border: '1px solid var(--color-surface-border)',
                    borderRadius: 'var(--radius-sm)',
                    maxHeight: 180,
                    overflowY: 'auto',
                    boxShadow: 'var(--shadow-md)',
                  }}
                >
                  {suggestions.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => chooseSuggestion(item)}
                      style={{
                        padding: '8px 12px',
                        fontSize: 13,
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--color-surface-border)',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = 'var(--color-primary-bg)')
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
                    >
                      📍 {item.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Container tìm kiếm của Google Maps */}
          {mapEngine === 'google' && <div ref={googleSearchRef} className="location-search" />}

          {/* Khung bản đồ */}
          <div className="location-map-wrap">
            {mapEngine === 'osm' && (
              <div
                ref={leafletContainerRef}
                className="location-map"
                role="application"
                aria-label="Bản đồ OpenStreetMap chọn vị trí cần hỗ trợ"
                style={{ width: '100%', height: 340, zIndex: 1 }}
              />
            )}
            {mapEngine === 'google' && (
              <>
                <div
                  ref={googleContainerRef}
                  className="location-map"
                  role="application"
                  aria-label="Bản đồ Google chọn vị trí cần hỗ trợ"
                  style={{ width: '100%', height: 340 }}
                />
                <span className="location-map-pin" aria-hidden="true">
                  ●
                </span>
              </>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 10,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <button type="button" className="button secondary" onClick={pickMapCenter}>
              📍 Ghim điểm tại tâm bản đồ
            </button>
            {selectedAddress && (
              <span style={{ fontSize: 13, color: 'var(--color-primary-dark)', fontWeight: 600 }}>
                {selectedAddress}
              </span>
            )}
          </div>

          {error && (
            <p role="alert" className="notice error" style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
