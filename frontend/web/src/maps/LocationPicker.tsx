import { useCallback, useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { WeatherLayers } from './WeatherLayers';

setWorkerUrl(workerUrl);

export type Point = { longitude: number; latitude: number };
type SearchPlace = { id: string; name: string; address: string; point?: Point; magicKey?: string };

const envApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || '';
const tileUrl = (import.meta.env.VITE_OSM_TILE_URL as string | undefined)?.trim() || '';
const mapStyleUrl =
  (import.meta.env.VITE_OPENFREEMAP_STYLE_URL as string | undefined)?.trim() ||
  'https://tiles.openfreemap.org/styles/liberty';
const tileAttribution =
  (import.meta.env.VITE_OSM_TILE_ATTRIBUTION as string | undefined)?.trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const PIN_PICK_ZOOM = 13;
const pinMarkup = '<span class="location-pin-head"><span></span></span><span class="location-pin-shadow"></span>';

const pinIcon = L.divIcon({
  className: 'location-pin-icon',
  html: `<span class="location-pin-marker">${pinMarkup}</span>`,
  iconSize: [36, 38],
  iconAnchor: [18, 38],
});

function pointLabel(point: Point) {
  return `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
}

function samePoint(a: Point, b: Point) {
  return (
    Math.abs(a.latitude - b.latitude) < 0.000001 && Math.abs(a.longitude - b.longitude) < 0.000001
  );
}

function nearbyAddress(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as { display_name?: unknown; address?: Record<string, unknown> };
  const address = result.address;
  if (!address || address.country_code !== 'vn') return null;
  const part = (key: string) => typeof address[key] === 'string' ? String(address[key]).trim() : '';
  const street = [part('house_number'), part('road') || part('pedestrian')].filter(Boolean).join(' ');
  const parts = [street, part('neighbourhood') || part('quarter') || part('suburb'),
    part('city') || part('town') || part('village') || part('county'), part('state')].filter(Boolean);
  return [...new Set(parts)].join(', ') ||
    (typeof result.display_name === 'string' ? result.display_name.trim() : null);
}

function arcgisNearbyAddress(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as { address?: { Match_addr?: unknown; CountryCode?: unknown }; error?: unknown };
  if (result.error || result.address?.CountryCode !== 'VNM') return null;
  return typeof result.address.Match_addr === 'string' ? result.address.Match_addr.trim() || null : null;
}

export type LocationOverlay = {
  /** Radius (m) of the area being configured; drawn around the chosen point. */
  radiusM?: number | null;
  /** Other existing areas shown for context so overlaps are visible before saving. */
  areas?: { id: string; label: string; latitude: number; longitude: number; radiusM: number }[];
};

export type LocationWeather = {
  rain24hMm: number;
  peakRain1hMm: number;
  maxGustKmh: number;
  stale: boolean;
};

export function LocationPicker({
  value,
  onSelect,
  onAddressResolved,
  initiallyOpen = false,
  selectOnPick = false,
  closeOnSelect = false,
  hideMap = false,
  hideToggle = false,
  toggleLabel,
  overlay,
  weather,
  onLocate,
  validatePoint,
}: {
  value: Point | null;
  onSelect: (point: Point | null, address?: string) => void;
  onAddressResolved?: (point: Point, address: string) => void;
  initiallyOpen?: boolean;
  /** Apply a picked or searched point immediately, without a separate confirmation button. */
  selectOnPick?: boolean;
  closeOnSelect?: boolean;
  /** Keep the address search panel while another map owns point selection. */
  hideMap?: boolean;
  hideToggle?: boolean;
  toggleLabel?: string;
  overlay?: LocationOverlay;
  /** Forecast at the confirmed SOS location, supplied by the form's weather request. */
  weather?: LocationWeather | null;
  /** Adds a "use my current location" icon button on the map. */
  onLocate?: () => void;
  validatePoint?: (point: Point) => string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const activeGoogleKey = envApiKey;
  const [mapEngine, setMapEngine] = useState<'osm' | 'google'>(() =>
    activeGoogleKey && !hideMap ? 'google' : 'osm'
  );

  // Leaflet refs
  const leafletContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const chosenSearchRef = useRef<{ point: Point; label: string } | null>(null);
  const confirmedPointRef = useRef<Point | null>(value);
  const draftPointRef = useRef<Point | null>(null);
  const googlePinRef = useRef<google.maps.OverlayView | null>(null);

  // Google Maps refs
  const googleContainerRef = useRef<HTMLDivElement>(null);
  const googleSearchRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const addressResolvedRef = useRef(onAddressResolved);
  addressResolvedRef.current = onAddressResolved;
  const selectionModeRef = useRef({ selectOnPick, closeOnSelect });
  selectionModeRef.current = { selectOnPick, closeOnSelect };

  const applyAutoSelection = useCallback((point: Point, address?: string) => {
    confirmedPointRef.current = point;
    setDraftPoint(point);
    if (address) {
      setSearchQuery(address);
      setSelectedAddress(`Đã chọn: ${address}`);
    }
    selectRef.current(point, address);
    if (selectionModeRef.current.closeOnSelect) setOpen(false);
  }, []);

  // ArcGIS provides live suggestions; Photon is a backup when that service is unavailable.
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchPlace[]>([]);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef(new Map<string, SearchPlace[]>());
  const lastNominatimRequestRef = useRef(0);
  const addressAbortRef = useRef<AbortController | null>(null);
  const addressTimerRef = useRef<number | null>(null);
  const addressCacheRef = useRef(new Map<string, string>());
  const searchOnTypingRef = useRef(false);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [draftPoint, setDraftPoint] = useState<Point | null>(null);
  draftPointRef.current = draftPoint;
  const pinMarkerRef = useRef<L.Marker | null>(null);
  const [tileError, setTileError] = useState(false);
  const [weatherMap, setWeatherMap] = useState<L.Map | null>(null);
  const [error, setError] = useState('');

  function lookupAddress(point: Point, confirmed = false) {
    searchOnTypingRef.current = false;
    searchAbortRef.current?.abort();
    addressAbortRef.current?.abort();
    addressAbortRef.current = null;
    if (addressTimerRef.current !== null) window.clearTimeout(addressTimerRef.current);
    const original = chosenSearchRef.current;
    if (original && samePoint(original.point, point)) {
      setSearchQuery(original.label);
      setSelectedAddress(`${confirmed ? 'Đã xác nhận' : 'Địa chỉ gần ghim'}: ${original.label}`);
      addressResolvedRef.current?.(point, original.label);
      return;
    }
    const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
    const cached = addressCacheRef.current.get(key);
    const prefix = confirmed ? 'Đã xác nhận · địa chỉ gần đúng' : 'Địa chỉ gần ghim';
    if (cached) {
      setSearchQuery(cached);
      setSelectedAddress(`${prefix}: ${cached}`);
      addressResolvedRef.current?.(point, cached);
      return;
    }
    const coordinateLabel = `Tọa độ ${pointLabel(point)}`;
    setSearchQuery(coordinateLabel);
    setSelectedAddress(`${confirmed ? 'Đã xác nhận vị trí' : 'Vị trí ghim'}: ${coordinateLabel}. Đang tìm địa chỉ gần đúng…`);
    const controller = new AbortController();
    addressAbortRef.current = controller;
    const wait = 150;
    addressTimerRef.current = window.setTimeout(async () => {
      const timeout = window.setTimeout(() => controller.abort(), 11000);
      try {
        let address: string | null = null;
        const arcgisController = new AbortController();
        const abortArcgis = () => arcgisController.abort();
        controller.signal.addEventListener('abort', abortArcgis, { once: true });
        const arcgisTimeout = window.setTimeout(abortArcgis, 3500);
        try {
          const response = await fetch(
            `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${encodeURIComponent(`${point.longitude},${point.latitude}`)}&langCode=VI&forStorage=false&f=json`,
            { signal: arcgisController.signal }
          );
          if (response.ok) address = arcgisNearbyAddress(await response.json());
        } catch {
          // Try OSM below when the primary reverse lookup is unavailable.
        } finally {
          window.clearTimeout(arcgisTimeout);
          controller.signal.removeEventListener('abort', abortArcgis);
        }
        if (!address && !controller.signal.aborted) {
          const delay = Math.max(0, 1100 - (Date.now() - lastNominatimRequestRef.current));
          if (delay) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
          if (controller.signal.aborted) return;
          lastNominatimRequestRef.current = Date.now();
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(point.latitude)}&lon=${encodeURIComponent(point.longitude)}&zoom=17&layer=address&addressdetails=1&accept-language=vi`,
            { signal: controller.signal }
          );
          if (response.ok) address = nearbyAddress(await response.json());
        }
        if (controller.signal.aborted) return;
        if (address) {
          addressCacheRef.current.set(key, address);
          addressResolvedRef.current?.(point, address);
        }
        setSearchQuery(address || coordinateLabel);
        setSelectedAddress(address ? `${prefix}: ${address}` : `Chưa tìm được địa chỉ gần ghim. Vị trí đã chọn: ${coordinateLabel}.`);
      } catch {
        if (addressAbortRef.current === controller) {
          setSearchQuery(coordinateLabel);
          setSelectedAddress(`Chưa tra được địa chỉ gần ghim. Vị trí đã chọn: ${coordinateLabel}.`);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }, wait);
  }

  function pickPoint(point: Point) {
    chosenSearchRef.current = null;
    if (selectionModeRef.current.selectOnPick) {
      applyAutoSelection(point);
      lookupAddress(point, true);
    } else {
      setDraftPoint(point);
      if (confirmedPointRef.current && !samePoint(point, confirmedPointRef.current)) {
        confirmedPointRef.current = null;
        selectRef.current(null);
      }
      lookupAddress(point);
    }
  }

  useEffect(() => { googlePinRef.current?.draw(); }, [draftPoint, open, mapEngine]);

  useEffect(() => () => {
    addressAbortRef.current?.abort();
    addressAbortRef.current = null;
    if (addressTimerRef.current !== null) window.clearTimeout(addressTimerRef.current);
  }, [open, mapEngine]);

  // OSM engine: click to place the pin.
  useEffect(() => {
    if (!open || mapEngine !== 'osm' || !leafletContainerRef.current) return;

    const initialCenter: [number, number] = value
      ? [value.latitude, value.longitude]
      : [16.1, 107.7];
    const initialZoom = value ? PIN_PICK_ZOOM : 6;

    const map = L.map(leafletContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
    });
    L.control.zoom({ zoomInTitle: 'Phóng to', zoomOutTitle: 'Thu nhỏ' }).addTo(map);
    leafletMapRef.current = map;
    setWeatherMap(map);

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
      const vectorLayer = maplibreGL({ style: mapStyleUrl, locale: { 'Map.Title': 'Bản đồ' } }).addTo(map);
      const vectorMap = vectorLayer.getMaplibreMap();
      vectorMap.on('load', () => setTileError(false));
      vectorMap.on('error', () => setTileError(true));
    }

    if (value) {
      setDraftPoint(value);
      lookupAddress(value, true);
    }

    // A click chooses a point. Native map dragging does not emit this selection action.
    map.on('click', (event: L.LeafletMouseEvent) => {
      const point = { latitude: event.latlng.lat, longitude: event.latlng.lng };
      map.setView(event.latlng, Math.max(map.getZoom(), PIN_PICK_ZOOM), { animate: false });
      pickPoint(point);
    });

    // Ép Leaflet render lại kích thước sau khi container xuất hiện
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      pinMarkerRef.current = null;
      map.remove();
      leafletMapRef.current = null;
      setWeatherMap(null);
    };
  }, [open, mapEngine, applyAutoSelection]);

  // The red pin follows the chosen point (clicked, searched or typed).
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!open || mapEngine !== 'osm' || !map) return;
    if (!draftPoint) {
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = null;
      return;
    }
    const position: L.LatLngTuple = [draftPoint.latitude, draftPoint.longitude];
    if (pinMarkerRef.current) pinMarkerRef.current.setLatLng(position);
    else pinMarkerRef.current = L.marker(position, { icon: pinIcon, interactive: false, keyboard: false }).addTo(map);
  }, [draftPoint, open, mapEngine]);

  // Area overlay: the configured radius around the chosen point, plus other areas as dashed context.
  const overlayKey = JSON.stringify(overlay ?? null);
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!open || mapEngine !== 'osm' || !map) return;
    const group = L.layerGroup();
    for (const area of overlay?.areas ?? []) {
      L.circle([area.latitude, area.longitude], {
        radius: area.radiusM, color: '#64748b', weight: 1, dashArray: '4 4', fillOpacity: 0.05, interactive: false,
      }).bindTooltip(area.label).addTo(group);
    }
    const center = draftPoint ?? value;
    if (center && overlay?.radiusM) {
      L.circle([center.latitude, center.longitude], {
        radius: overlay.radiusM, color: '#2563eb', weight: 2, fillOpacity: 0.12, interactive: false,
      }).addTo(group);
    }
    group.addTo(map);
    return () => { group.remove(); };
    // overlayKey stands in for overlay (new object each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapEngine, draftPoint, value?.latitude, value?.longitude, overlayKey]);

  // Recenter and refresh the search text when coordinates are supplied outside the picker (for example, GPS).
  useEffect(() => {
    if (!value || (confirmedPointRef.current && samePoint(confirmedPointRef.current, value))) return;
    const { latitude, longitude } = value;
    if (mapEngine === 'osm' && leafletMapRef.current) {
      leafletMapRef.current.setView([latitude, longitude], Math.max(leafletMapRef.current.getZoom(), PIN_PICK_ZOOM), { animate: false });
    } else if (mapEngine === 'google' && googleMapRef.current) {
      googleMapRef.current.setCenter({ lat: latitude, lng: longitude });
      googleMapRef.current.setZoom(Math.max(googleMapRef.current.getZoom() ?? 6, PIN_PICK_ZOOM));
    }
    setDraftPoint(value);
    confirmedPointRef.current = value;
    lookupAddress(value, true);
  }, [value?.latitude, value?.longitude, mapEngine]);

  // 2. Khởi tạo Google Maps (nếu có API Key và đang chọn Google Engine)
  useEffect(() => {
    if (!open || mapEngine !== 'google' || !activeGoogleKey || !googleContainerRef.current) return;

    let active = true;
    let clickListener: google.maps.MapsEventListener | undefined;
    let pinOverlay: google.maps.OverlayView | undefined;
    let autocomplete: google.maps.places.PlaceAutocompleteElement | undefined;

    async function initGoogle() {
      try {
        setOptions({ key: activeGoogleKey, v: 'weekly', language: 'vi', region: 'VN' });
        const [{ Map, OverlayView }, { PlaceAutocompleteElement }] = await Promise.all([
          importLibrary('maps'),
          importLibrary('places'),
        ]);
        if (!active || !googleContainerRef.current) return;

        const center = value
          ? { lat: value.latitude, lng: value.longitude }
          : { lat: 16.1, lng: 107.7 };
        const map = new Map(googleContainerRef.current, {
          center,
          zoom: value ? PIN_PICK_ZOOM : 6,
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: false,
        });
        googleMapRef.current = map;
        if (value) {
          setDraftPoint(value);
          lookupAddress(value, true);
        }

        // A geographic pin is projected into the map pane; it never follows the viewport center.
        pinOverlay = new OverlayView();
        let pin: HTMLDivElement | null = null;
        const overlay = pinOverlay;
        overlay.onAdd = () => {
          pin = document.createElement('div');
          pin.className = 'location-google-pin';
          pin.hidden = true;
          pin.setAttribute('aria-hidden', 'true');
          pin.innerHTML = pinMarkup;
          overlay.getPanes()?.markerLayer.appendChild(pin);
        };
        overlay.draw = () => {
          if (!pin) return;
          const point = draftPointRef.current;
          const pixel = point ? overlay.getProjection().fromLatLngToDivPixel({ lat: point.latitude, lng: point.longitude }) : null;
          pin.hidden = !pixel;
          if (pixel) { pin.style.left = pixel.x + 'px'; pin.style.top = pixel.y + 'px'; }
        };
        overlay.onRemove = () => { pin?.remove(); pin = null; };
        googlePinRef.current = overlay;
        overlay.setMap(map);
        clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          map.setCenter(event.latLng);
          map.setZoom(Math.max(map.getZoom() ?? 6, PIN_PICK_ZOOM));
          pickPoint({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
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
              map.setCenter(place.location);
              map.setZoom(PIN_PICK_ZOOM);
              const lat = place.location.lat();
              const lng = place.location.lng();
              const point = { latitude: lat, longitude: lng };
              addressAbortRef.current?.abort();
              addressAbortRef.current = null;
              if (addressTimerRef.current !== null) window.clearTimeout(addressTimerRef.current);
              setSelectedAddress(
                place.formattedAddress || 'Đã chọn địa điểm. Hãy xác nhận địa chỉ.'
              );
              setDraftPoint(point);
              chosenSearchRef.current = {
                point,
                label: place.formattedAddress || pointLabel(point),
              };
              if (selectionModeRef.current.selectOnPick) {
                applyAutoSelection(point, place.formattedAddress || pointLabel(point));
              } else if (confirmedPointRef.current) {
                confirmedPointRef.current = null;
                selectRef.current(null);
              }
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
      pinOverlay?.setMap(null);
      googlePinRef.current = null;
      autocomplete?.remove();
      googleMapRef.current = null;
    };
  }, [open, mapEngine, activeGoogleKey, applyAutoSelection]);

  // Debounce live suggestions and ignore responses from superseded text.
  useEffect(() => {
    if (!open || mapEngine !== 'osm' || !searchOnTypingRef.current) return;
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (searchOnTypingRef.current) void searchPlaces(query);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, open, mapEngine]);

  async function searchPlaces(query: string) {
    const cacheKey = query.toLocaleLowerCase('vi');
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearching(false);
      setSuggestions(cached);
      setError('');
      if (!cached.length) setError('Không tìm thấy địa điểm phù hợp. Hãy thử tên khác hoặc kéo bản đồ.');
      return;
    }
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8500);
    setSearching(true);
    setSuggestions([]);
    setError('');
    try {
      let places: SearchPlace[];
      try {
        const arcgisController = new AbortController();
        const abortArcgis = () => arcgisController.abort();
        controller.signal.addEventListener('abort', abortArcgis, { once: true });
        const arcgisTimeout = window.setTimeout(abortArcgis, 3500);
        try {
          const res = await fetch(
            `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?text=${encodeURIComponent(query)}&countryCode=VNM&maxSuggestions=8&f=json`,
            { signal: arcgisController.signal }
          );
          if (!res.ok) throw new Error('PLACE_SEARCH_FAILED');
          const payload = await res.json() as { suggestions?: Array<{ text?: string; magicKey?: string }> ; error?: unknown };
          if (payload.error) throw new Error('PLACE_SEARCH_FAILED');
          places = (payload.suggestions ?? []).flatMap((row) => {
            if (!row.text || !row.magicKey) return [];
            const [name, ...address] = row.text.split(',').map((part) => part.trim());
            return [{ id: row.magicKey, magicKey: row.magicKey, name, address: address.join(', ') }];
          });
        } finally {
          window.clearTimeout(arcgisTimeout);
          controller.signal.removeEventListener('abort', abortArcgis);
        }
      } catch {
        if (controller.signal.aborted) return;
        const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&countrycode=VN&limit=8`, { signal: controller.signal });
        if (!response.ok) throw new Error('PLACE_SEARCH_FAILED');
        const payload = await response.json() as { features?: Array<{ geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }> };
        places = (payload.features ?? []).flatMap((feature, index) => {
          const coordinates = feature.geometry?.coordinates;
          const properties = feature.properties ?? {};
          const name = typeof properties.name === 'string' ? properties.name.trim() : '';
          if (!name || !coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return [];
          const address = [properties.street, properties.district, properties.city, properties.county, properties.state]
            .filter((part): part is string => typeof part === 'string' && !!part.trim())
            .filter((part) => part !== name).join(', ');
          return [{ id: `photon-${index}-${coordinates.join('-')}`, name, address,
            point: { longitude: coordinates[0], latitude: coordinates[1] } }];
        });
      }
      if (controller.signal.aborted) return;
      const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
      const distinct = places.filter((place, index, all) => {
        const label = normalized([place.name, place.address].filter(Boolean).join(', '));
        return all.findIndex(candidate => normalized([candidate.name, candidate.address].filter(Boolean).join(', ')) === label) === index;
      });
      distinct.sort((a, b) => Number(normalized([b.name, b.address].filter(Boolean).join(', ')) === normalized(query)) - Number(normalized([a.name, a.address].filter(Boolean).join(', ')) === normalized(query)));
      places = distinct;
      searchCacheRef.current.set(cacheKey, places);
      if (places.length > 0) {
        setSuggestions(places);
      } else {
        setSuggestions([]);
        setError(
          'Không tìm thấy địa điểm phù hợp. Hãy thử tên khác hoặc kéo bản đồ đến vị trí cần chọn.'
        );
      }
    } catch {
      if (searchAbortRef.current === controller) {
        setError('Chưa tải được gợi ý địa chỉ. Hãy thử lại hoặc kéo bản đồ đến vị trí cần chọn.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (searchAbortRef.current === controller) {
        setSearching(false);
        searchAbortRef.current = null;
      }
    }
  }

  async function chooseSuggestion(item: SearchPlace) {
    searchOnTypingRef.current = false;
    searchAbortRef.current?.abort();
    addressAbortRef.current?.abort();
    addressAbortRef.current = null;
    if (addressTimerRef.current !== null) window.clearTimeout(addressTimerRef.current);
    let point = item.point;
    let resolvedLabel = '';
    if (!point) {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      setSearching(true);
      setError('');
      try {
        // Resolve only the suggestion the user selected; typing itself stays lightweight.
        const query = [item.name, item.address].filter(Boolean).join(', ');
        const response = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(query)}&magicKey=${encodeURIComponent(item.magicKey ?? '')}&countryCode=VNM&outFields=Match_addr&f=json`, { signal: controller.signal });
        if (!response.ok) throw new Error('PLACE_RESOLVE_FAILED');
        const payload = await response.json() as { candidates?: Array<{ location?: { x?: number; y?: number }; address?: string }> ; error?: unknown };
        if (controller.signal.aborted) return;
        if (payload.error) throw new Error('PLACE_RESOLVE_FAILED');
        const candidate = payload.candidates?.[0];
        const latitude = candidate?.location?.y;
        const longitude = candidate?.location?.x;
        if (typeof latitude !== 'number' || typeof longitude !== 'number') throw new Error('PLACE_RESOLVE_FAILED');
        point = { latitude, longitude };
        resolvedLabel = candidate?.address ?? '';
      } catch {
        if (searchAbortRef.current === controller) setError('Không lấy được vị trí địa chỉ này. Hãy chọn gợi ý khác hoặc kéo bản đồ.');
        return;
      } finally {
        window.clearTimeout(timeout);
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
          setSearching(false);
        }
      }
    }
    if (!point) return;
    const { latitude: lat, longitude: lon } = point;
    if (leafletMapRef.current) {
      leafletMapRef.current.setView([lat, lon], PIN_PICK_ZOOM, { animate: false });
    }
    const label = resolvedLabel || [item.name, item.address].filter(Boolean).join(' · ');
    chosenSearchRef.current = { point, label };
    setSearchQuery(label);
    setSelectedAddress(label);
    setDraftPoint(point);
    setSuggestions([]);
    if (selectionModeRef.current.selectOnPick) {
      applyAutoSelection(point, label);
    } else if (confirmedPointRef.current) {
      confirmedPointRef.current = null;
      selectRef.current(null);
    }
  }

  function confirmSelection() {
    searchOnTypingRef.current = false;
    const point = chosenSearchRef.current?.point ?? draftPoint;
    if (!point) return;
    if (validatePoint?.(point)) return;
    confirmedPointRef.current = point;
    setDraftPoint(point);
    const original = chosenSearchRef.current;
    selectRef.current(point, original && samePoint(original.point, point) ? original.label : undefined);
    if (selectionModeRef.current.closeOnSelect) setOpen(false);
    if (original && samePoint(original.point, point)) {
      setSearchQuery(original.label);
      setSelectedAddress(`Đã xác nhận: ${original.label}`);
      return;
    }

    lookupAddress(point, true);
  }

  return (
    <div className="location-picker">
      {!hideToggle && <button
        type="button"
        className="button secondary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {toggleLabel && !open ? toggleLabel : open
          ? hideMap ? 'Ẩn tìm địa chỉ' : 'Ẩn bản đồ chọn vị trí'
          : hideMap ? 'Tìm địa chỉ' : 'Tìm địa chỉ và chọn trên bản đồ'}
      </button>}

      {open && (
        <div className="location-map-panel">
          {activeGoogleKey && !hideMap && (
            <div className="map-engine-switch">
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className={`button secondary ${mapEngine === 'google' ? 'active' : ''}`}
                  style={{ minHeight: 34, padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setMapEngine('google')}
                >
                  Google Maps
                </button>
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
          )}

          {/* Gợi ý địa chỉ xuất hiện khi nhập */}
          {mapEngine === 'osm' && (
            <div className="location-search">
              <input
                type="search"
                placeholder="Nhập địa chỉ hoặc tên địa điểm"
                aria-label="Tìm địa chỉ hoặc địa điểm"
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                value={searchQuery}
                onChange={(e) => {
                  searchOnTypingRef.current = true;
                  addressAbortRef.current?.abort();
                  addressAbortRef.current = null;
                  if (addressTimerRef.current !== null) window.clearTimeout(addressTimerRef.current);
                  searchAbortRef.current?.abort();
                  searchAbortRef.current = null;
                  setSearching(false);
                  setSuggestions([]);
                  setError('');
                  chosenSearchRef.current = null;
                  setSearchQuery(e.target.value);
                  setSelectedAddress(confirmedPointRef.current
                    ? 'Vị trí đã xác nhận vẫn được giữ. Chọn địa điểm mới và xác nhận ghim để thay đổi.'
                    : '');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const first = suggestions[0];
                    if (first) void chooseSuggestion(first);
                  }
                }}
              />
              <small className="location-search-hint">
                {selectOnPick
                  ? hideMap
                    ? 'Nhập địa chỉ rồi chọn một gợi ý, hoặc chạm bản đồ bên dưới để chọn tâm vùng ngay.'
                    : 'Nhập địa chỉ rồi chọn một gợi ý, hoặc chạm bản đồ để chọn vị trí.'
                  : 'Nhập địa chỉ rồi chọn một gợi ý, hoặc nhấn thẳng lên bản đồ để đặt ghim, rồi bấm “Xác nhận vị trí”.'}
              </small>
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
                      onClick={() => void chooseSuggestion(item)}
                      className="location-suggestion"
                    >
                      <strong>{item.name}</strong>
                      <span className="location-suggestion__address">{item.address || 'Chưa có địa chỉ chi tiết'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Container tìm kiếm của Google Maps */}
          {mapEngine === 'google' && <div ref={googleSearchRef} className="location-search" />}

          {!hideMap && <div className="location-map-wrap">
            {value && weather && <div className="location-weather-overlay" role="status" aria-label="Dự báo thời tiết tại vị trí đã xác nhận">
              <div className="location-weather-overlay__item">
                <span className="location-weather-overlay__icon" aria-hidden="true">💨</span>
                <span><strong>{weather.maxGustKmh.toFixed(1)} km/h</strong><small>Gió giật tối đa</small></span>
              </div>
              <div className="location-weather-overlay__item">
                <span className="location-weather-overlay__icon" aria-hidden="true">🌧️</span>
                <span><strong>{weather.rain24hMm.toFixed(1)} mm</strong><small>Mưa dự báo 24 giờ</small></span>
              </div>
              <div className="location-weather-overlay__item">
                <span className="location-weather-overlay__icon" aria-hidden="true">☔</span>
                <span><strong>{weather.peakRain1hMm.toFixed(1)} mm/giờ</strong><small>Cường độ cao nhất</small></span>
              </div>
              {weather.stale && <small className="location-weather-overlay__stale">Dữ liệu có thể đã cũ</small>}
            </div>}
            {mapEngine === 'osm' && <WeatherLayers map={weatherMap} />}
            {onLocate && <button
              type="button"
              className="location-locate-button"
              onClick={onLocate}
              aria-label="Dùng vị trí hiện tại"
              title="Dùng vị trí hiện tại"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" />
              </svg>
            </button>}
            {mapEngine === 'osm' && (
              <div
                ref={leafletContainerRef}
                className="location-map"
                role="application"
                aria-label="Bản đồ OpenStreetMap chọn vị trí"
                style={{ width: '100%', height: '100%', zIndex: 1 }}
              />
            )}
            {mapEngine === 'google' && (
              <div
                ref={googleContainerRef}
                className="location-map"
                role="application"
                aria-label="Bản đồ Google chọn vị trí"
                style={{ width: '100%', height: '100%' }}
              />
            )}
            {!selectOnPick && <button
              type="button"
              className="location-confirm-button"
              onClick={() => void confirmSelection()}
              disabled={!draftPoint || Boolean(draftPoint && validatePoint?.(draftPoint))}
            >
              Xác nhận vị trí
            </button>}
          </div>}

          {draftPoint && validatePoint?.(draftPoint) && <p className="field-error" role="alert">{validatePoint(draftPoint)}</p>}
          {selectedAddress && !(draftPoint && validatePoint?.(draftPoint)) && (
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
