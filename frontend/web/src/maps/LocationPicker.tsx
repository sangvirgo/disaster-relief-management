import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

export type Point = { longitude: number; latitude: number };

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
if (apiKey) setOptions({ key: apiKey, v: 'weekly', language: 'vi', region: 'VN' });

export function LocationPicker({ value, onSelect }: { value: Point | null; onSelect: (point: Point | null) => void }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const searchContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const selectRef = useRef(onSelect);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  selectRef.current = onSelect;

  useEffect(() => {
    if (!open || !apiKey || !mapContainer.current || !searchContainer.current) return;
    let active = true;
    let listener: google.maps.MapsEventListener | undefined;
    let autocomplete: google.maps.places.PlaceAutocompleteElement | undefined;
    async function initialize() {
      try {
        const [{ Map }, { PlaceAutocompleteElement }] = await Promise.all([importLibrary('maps'), importLibrary('places')]);
        if (!active || !mapContainer.current || !searchContainer.current) return;
        const center = value ? { lat: value.latitude, lng: value.longitude } : { lat: 16.1, lng: 107.7 };
        const map = new Map(mapContainer.current, { center, zoom: value ? 16 : 6, clickableIcons: false, streetViewControl: false, mapTypeControl: false });
        mapInstance.current = map;
        listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          const point = { latitude: event.latLng.lat(), longitude: event.latLng.lng() };
          map.panTo(event.latLng);
          setSelectedAddress('Điểm đã chọn trên bản đồ');
          selectRef.current(point);
        });
        autocomplete = new PlaceAutocompleteElement();
        autocomplete.includedRegionCodes = ['vn'];
        autocomplete.placeholder = 'Tìm tỉnh, thành phố, đường hoặc địa điểm';
        autocomplete.setAttribute('aria-label', 'Tìm địa điểm tại Việt Nam');
        autocomplete.addEventListener('gmp-select', async (event) => {
          try {
            const place = (event as google.maps.places.PlacePredictionSelectEvent).placePrediction.toPlace();
            await place.fetchFields({ fields: ['formattedAddress', 'location', 'viewport'] });
            if (!active || !place.location) return;
            if (place.viewport) map.fitBounds(place.viewport);
            else { map.setCenter(place.location); map.setZoom(17); }
            setSelectedAddress(`Đã tìm thấy ${place.formattedAddress || 'địa điểm'}. Hãy chạm điểm cụ thể trên bản đồ để xác nhận.`);
            selectRef.current(null);
          } catch { if (active) setError('Không thể lấy tọa độ địa điểm này. Hãy chọn điểm trực tiếp trên bản đồ.'); }
        });
        searchContainer.current.append(autocomplete);
        setError('');
      } catch { if (active) setError('Không tải được Google Maps. Bạn vẫn có thể dùng GPS hoặc nhập tọa độ bên dưới.'); }
    }
    void initialize();
    return () => { active = false; listener?.remove(); autocomplete?.remove(); mapInstance.current = null; };
  }, [open]);

  useEffect(() => {
    if (value && mapInstance.current) mapInstance.current.setCenter({ lat: value.latitude, lng: value.longitude });
  }, [value?.latitude, value?.longitude]);

  return <div className="location-picker">
    <button type="button" className="button secondary" onClick={() => setOpen((current) => !current)} disabled={!apiKey} aria-expanded={open}>
      {open ? 'Ẩn bản đồ chọn vị trí' : 'Tìm địa chỉ và chọn trên Google Maps'}
    </button>
    {!apiKey && <p className="muted">Bản đồ Google chưa được cấu hình. Bạn có thể dùng GPS hoặc nhập tọa độ.</p>}
    {open && <div className="location-map-panel"><p>Tìm địa điểm ở Việt Nam, rồi chạm bản đồ để chỉnh đúng vị trí cần hỗ trợ.</p>
      <div ref={searchContainer} className="location-search" />
      <div className="location-map-wrap"><div ref={mapContainer} className="location-map" role="application" aria-label="Bản đồ chọn vị trí cần hỗ trợ" /><span className="location-map-pin" aria-hidden="true">●</span></div>
      <button type="button" className="button secondary" onClick={() => { const center = mapInstance.current?.getCenter(); if (!center) return; selectRef.current({ latitude: center.lat(), longitude: center.lng() }); setSelectedAddress('Đã chọn tâm bản đồ'); }}>Chọn điểm tại tâm bản đồ</button>
      {selectedAddress && <p role="status">{selectedAddress}</p>}
      {error && <p role="alert" className="notice error">{error}</p>}
    </div>}
  </div>;
}
