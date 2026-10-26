import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

export type Point = { longitude: number; latitude: number };
type SearchPlace = { id: string; name: string; address: string; point: Point };

function photonPlaces(value: unknown): SearchPlace[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('features' in value) ||
    !Array.isArray(value.features)
  )
    return [];
  return value.features.flatMap((feature: unknown) => {
    if (
      !feature ||
      typeof feature !== 'object' ||
      !('geometry' in feature) ||
      !('properties' in feature)
    )
      return [];
    const { geometry, properties } = feature as {
      geometry?: { coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const [longitude, latitude] = coordinates;
    if (
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 ||
      Math.abs(latitude) > 90
    )
      return [];
    const field = (key: string) =>
      typeof properties?.[key] === 'string' ? String(properties[key]).trim() : '';
    if (field('countrycode').toUpperCase() !== 'VN') return [];
    const name = field('name') || field('street') || 'Địa điểm chưa có tên';
    const address = [
      ...new Set(
        [
          field('housenumber'),
          field('street'),
          field('locality'),
          field('district'),
          field('city'),
        ].filter(Boolean)
      ),
    ].join(', ');
    return [
      {
        id: `${field('osm_type')}-${String(properties?.osm_id ?? '')}-${longitude}-${latitude}`,
        name,
        address,
        point: { longitude, latitude },
      },
    ];
  });
}

const envApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || '';
const tileUrl = (import.meta.env.VITE_OSM_TILE_URL as string | undefined)?.trim() || '';
const mapStyleUrl =
  (import.meta.env.VITE_OPENFREEMAP_STYLE_URL as string | undefined)?.trim() ||
  'https://tiles.openfreemap.org/styles/liberty';
const tileAttribution =
  (import.meta.env.VITE_OSM_TILE_ATTRIBUTION as string | undefined)?.trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function pointLabel(point: Point) {
  return `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
}

function samePoint(a: Point, b: Point) {
  return (
    Math.abs(a.latitude - b.latitude) < 0.000001 && Math.abs(a.longitude - b.longitude) < 0.000001
  );
}

export function LocationPicker({
  value,
  onSelect,
}: {
  value: Point | null;
  onSelect: (point: Point | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeGoogleKey = envApiKey;
  const [mapEngine, setMapEngine] = useState<'osm' | 'google'>(() =>
    activeGoogleKey ? 'google' : 'osm'
  );

  // Leaflet refs
  const leafletContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const chosenSearchRef = useRef<{ point: Point; label: string } | null>(null);
  const confirmedPointRef = useRef<Point | null>(value);
  const reverseAbortRef = useRef<AbortController | null>(null);
  const suppressMoveRef = useRef(false);

  // Google Maps refs
  const googleContainerRef = useRef<HTMLDivElement>(null);
  const googleSearchRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // Photon uses the same OSM search index as the current Mobile picker.
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchPlace[]>([]);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchOnTypingRef = useRef(false);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [draftPoint, setDraftPoint] = useState<Point | null>(null);
  const [moving, setMoving] = useState(false);
  const [pinDropKey, setPinDropKey] = useState(0);
  const [tileError, setTileError] = useState(false);
  const [error, setError] = useState('');

  // The pin is fixed over the map center. Moving the map changes the draft point.
  useEffect(() => {
    if (!open || mapEngine !== 'osm' || !leafletContainerRef.current) return;

    const initialCenter: [number, number] = value
      ? [value.latitude, value.longitude]
      : [16.1, 107.7];
    const initialZoom = value ? 17 : 6;

    const map = L.map(leafletContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: true,
    });
    leafletMapRef.current = map;

    setTileError(false);
    if (tileUrl) {
      const tiles = L.tileLayer(tileUrl, {
        attribution: tileAttribution,
        maxZoom: 19,
      });
      tiles.on('tileerror', () => setTileError(true));
      tiles.on('tileload', () => setTileError(false));
      tiles.addTo(map);
    } else {
      const vectorLayer = maplibreGL({ style: mapStyleUrl }).addTo(map);
      const vectorMap = vectorLayer.getMaplibreMap();
      vectorMap.on('load', () => setTileError(false));
      vectorMap.on('error', () => setTileError(true));
    }

    if (value) {
      setDraftPoint(value);
      setSelectedAddress('Đã có vị trí. Kéo bản đồ nếu cần chỉnh lại.');
    }

    let frame = 0;
    const updateCenter = () => {
      if (suppressMoveRef.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const center = map.getCenter();
        const point = { latitude: center.lat, longitude: center.lng };
        setDraftPoint(point);
        setSelectedAddress('Đã chỉnh vị trí. Hãy xác nhận địa chỉ.');
        if (confirmedPointRef.current && !samePoint(point, confirmedPointRef.current)) {
          confirmedPointRef.current = null;
          selectRef.current(null);
        }
        reverseAbortRef.current?.abort();
      });
    };
    map.on('movestart', () => setMoving(true));
    map.on('move', updateCenter);
    map.on('moveend', () => {
      setMoving(false);
      updateCenter();
    });
    map.on('click', (event: L.LeafletMouseEvent) => {
      map.setView(event.latlng, map.getZoom(), { animate: false });
    });

    // Ép Leaflet render lại kích thước sau khi container xuất hiện
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      leafletMapRef.current = null;
    };
  }, [open, mapEngine]);

  // Recenter when coordinates are edited outside the picker.
  useEffect(() => {
    if (mapEngine === 'osm' && value && leafletMapRef.current) {
      const { latitude, longitude } = value;
      suppressMoveRef.current = true;
      leafletMapRef.current.setView(
        [latitude, longitude],
        Math.max(leafletMapRef.current.getZoom(), 17),
        { animate: false }
      );
      suppressMoveRef.current = false;
      setDraftPoint(value);
      confirmedPointRef.current = value;
    }
  }, [value?.latitude, value?.longitude, mapEngine]);

  // 2. Khởi tạo Google Maps (nếu có API Key và đang chọn Google Engine)
  useEffect(() => {
    if (!open || mapEngine !== 'google' || !activeGoogleKey || !googleContainerRef.current) return;

    let active = true;
    let clickListener: google.maps.MapsEventListener | undefined;
    let moveListener: google.maps.MapsEventListener | undefined;
    let moveStartListener: google.maps.MapsEventListener | undefined;
    let moveEndListener: google.maps.MapsEventListener | undefined;
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

        moveStartListener = map.addListener('dragstart', () => setMoving(true));
        moveListener = map.addListener('center_changed', () => {
          if (suppressMoveRef.current) return;
          const center = map.getCenter();
          if (!center) return;
          const point = { latitude: center.lat(), longitude: center.lng() };
          setDraftPoint(point);
          setSelectedAddress('Đã chỉnh vị trí. Hãy xác nhận địa chỉ.');
          if (confirmedPointRef.current && !samePoint(point, confirmedPointRef.current)) {
            confirmedPointRef.current = null;
            selectRef.current(null);
          }
          reverseAbortRef.current?.abort();
        });
        moveEndListener = map.addListener('idle', () => setMoving(false));
        clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          map.panTo(event.latLng);
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
              suppressMoveRef.current = true;
              map.setCenter(place.location);
              map.setZoom(17);
              suppressMoveRef.current = false;
              const lat = place.location.lat();
              const lng = place.location.lng();
              const point = { latitude: lat, longitude: lng };
              setSelectedAddress(
                place.formattedAddress || 'Đã chọn địa điểm. Hãy xác nhận địa chỉ.'
              );
              setDraftPoint(point);
              chosenSearchRef.current = {
                point,
                label: place.formattedAddress || pointLabel(point),
              };
              confirmedPointRef.current = null;
              selectRef.current(null);
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
      clickListener?.remove();
      moveListener?.remove();
      moveStartListener?.remove();
      moveEndListener?.remove();
      autocomplete?.remove();
      googleMapRef.current = null;
    };
  }, [open, mapEngine, activeGoogleKey]);

  // Debounce public Photon requests and ignore responses from superseded text.
  useEffect(() => {
    if (!open || mapEngine !== 'osm' || !searchOnTypingRef.current) return;
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(() => void searchPlaces(query), 450);
    return () => window.clearTimeout(timer);
  }, [searchQuery, open, mapEngine]);

  async function searchPlaces(query: string) {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setSuggestions([]);
    setError('');
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10&countrycode=VN`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error('PLACE_SEARCH_FAILED');
      const places = photonPlaces(await res.json());
      if (controller.signal.aborted) return;
      if (places.length > 0) {
        setSuggestions(places);
      } else {
        setSuggestions([]);
        setError(
          'Không tìm thấy địa điểm phù hợp. Hãy thử tên khác hoặc kéo bản đồ đến nơi cần hỗ trợ.'
        );
      }
    } catch {
      if (!controller.signal.aborted)
        setError('Không thể tìm địa điểm lúc này. Bạn có thể kéo bản đồ đến nơi cần hỗ trợ.');
    } finally {
      if (searchAbortRef.current === controller) {
        setSearching(false);
        searchAbortRef.current = null;
      }
    }
  }

  function chooseSuggestion(item: SearchPlace) {
    searchOnTypingRef.current = false;
    searchAbortRef.current?.abort();
    const { latitude: lat, longitude: lon } = item.point;
    if (leafletMapRef.current) {
      suppressMoveRef.current = true;
      leafletMapRef.current.setView([lat, lon], 17, { animate: false });
      suppressMoveRef.current = false;
    }
    const label = [item.name, item.address].filter(Boolean).join(' · ');
    chosenSearchRef.current = { point: item.point, label };
    setSelectedAddress(label);
    setDraftPoint(item.point);
    setSuggestions([]);
    confirmedPointRef.current = null;
    selectRef.current(null);
  }

  async function confirmCenter() {
    searchOnTypingRef.current = false;
    const center =
      mapEngine === 'osm' ? leafletMapRef.current?.getCenter() : googleMapRef.current?.getCenter();
    if (!center) return;
    const point =
      mapEngine === 'osm'
        ? { latitude: (center as L.LatLng).lat, longitude: (center as L.LatLng).lng }
        : {
            latitude: (center as google.maps.LatLng).lat(),
            longitude: (center as google.maps.LatLng).lng(),
          };
    confirmedPointRef.current = point;
    setDraftPoint(point);
    setPinDropKey((current) => current + 1);
    selectRef.current(point);

    const original = chosenSearchRef.current;
    if (original && samePoint(original.point, point)) {
      setSearchQuery(original.label);
      setSelectedAddress(`Đã xác nhận: ${original.label}`);
      return;
    }

    // One reverse lookup on confirmation, never for every map movement.
    reverseAbortRef.current?.abort();
    const controller = new AbortController();
    reverseAbortRef.current = controller;
    const fallback = 'Vị trí đã chọn trên bản đồ';
    setSearchQuery(fallback);
    setSelectedAddress(`Đã xác nhận: ${fallback}`);
    if (mapEngine !== 'osm') return;
    try {
      const result = await fetch(
        `https://photon.komoot.io/reverse?lat=${point.latitude}&lon=${point.longitude}&limit=1`,
        { signal: controller.signal }
      );
      if (!result.ok) return;
      const [nearest] = photonPlaces(await result.json());
      if (
        !nearest ||
        controller.signal.aborted ||
        !confirmedPointRef.current ||
        !samePoint(confirmedPointRef.current, point)
      )
        return;
      const label = [nearest.name, nearest.address].filter(Boolean).join(' · ');
      setSearchQuery(label);
      setSelectedAddress(`Đã xác nhận · Địa chỉ gần đúng: ${label}`);
      chosenSearchRef.current = { point, label };
    } catch {
      // Exact coordinates remain confirmed even when the address service is unavailable.
    }
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
                {mapEngine === 'google' ? 'Google Maps' : 'Bản đồ OpenStreetMap · OpenFreeMap'}
              </p>
              <small style={{ color: 'var(--color-text-secondary)' }}>
                Kéo bản đồ để đặt ghim đỏ đúng nơi cần hỗ trợ, rồi xác nhận địa chỉ
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
            </div>
          </div>

          {/* Tìm kiếm địa điểm bằng Photon trên dữ liệu OpenStreetMap */}
          {mapEngine === 'osm' && (
            <div className="location-search">
              <input
                type="search"
                placeholder="Nhập địa chỉ hoặc tên địa điểm"
                aria-label="Tìm địa chỉ hoặc địa điểm cần hỗ trợ"
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                value={searchQuery}
                onChange={(e) => {
                  searchOnTypingRef.current = true;
                  searchAbortRef.current?.abort();
                  searchAbortRef.current = null;
                  setSearching(false);
                  setSuggestions([]);
                  reverseAbortRef.current?.abort();
                  chosenSearchRef.current = null;
                  confirmedPointRef.current = null;
                  setSearchQuery(e.target.value);
                  setSelectedAddress('');
                  setDraftPoint(null);
                  selectRef.current(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
              />
              {searching && (
                <span className="location-search-status" role="status">
                  Đang tìm địa điểm…
                </span>
              )}

              {suggestions.length > 0 && (
                <div className="location-suggestions" role="listbox" aria-label="Địa điểm gợi ý">
                  {suggestions.map((item) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      key={item.id}
                      onClick={() => chooseSuggestion(item)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        background: '#FFFFFF',
                        border: 0,
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
                      📍 <strong>{item.name}</strong>
                      {item.address ? ` · ${item.address}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Container tìm kiếm của Google Maps */}
          {mapEngine === 'google' && <div ref={googleSearchRef} className="location-search" />}

          <div className="location-map-wrap">
            {mapEngine === 'osm' && (
              <div
                ref={leafletContainerRef}
                className="location-map"
                role="application"
                aria-label="Bản đồ OpenStreetMap chọn vị trí cần hỗ trợ"
                style={{ width: '100%', height: '100%', zIndex: 1 }}
              />
            )}
            {mapEngine === 'google' && (
              <div
                ref={googleContainerRef}
                className="location-map"
                role="application"
                aria-label="Bản đồ Google chọn vị trí cần hỗ trợ"
                style={{ width: '100%', height: '100%' }}
              />
            )}
            <div
              key={pinDropKey}
              className={`location-center-pin${moving ? ' is-moving' : ''}${pinDropKey ? ' is-confirmed' : ''}`}
              aria-hidden="true"
            >
              <span className="location-center-pin-head">
                <span />
              </span>
              <span className="location-center-pin-shadow" />
            </div>
            <button
              type="button"
              className="location-confirm-button"
              onClick={() => void confirmCenter()}
              disabled={!draftPoint}
            >
              Xác nhận địa chỉ
            </button>
          </div>

          {selectedAddress && (
            <p className="location-selection-status" role="status">
              {selectedAddress}
            </p>
          )}

          {mapEngine === 'osm' && tileError && (
            <p role="alert" className="notice warning">
              Nền bản đồ chưa tải được. Hãy kiểm tra kết nối mạng rồi mở lại bản đồ. Bạn vẫn có thể
              tìm địa điểm và xác nhận tọa độ.
            </p>
          )}

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
