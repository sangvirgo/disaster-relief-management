// Mission locations are GeoJSON points: [longitude, latitude]. Maps URLs use latitude,longitude.
export function googleMapsDirectionsUrl(location: unknown): string | null {
  if (!location || typeof location !== 'object') return null;
  const point = location as { type?: unknown; coordinates?: unknown };
  if (point.type !== 'Point' || !Array.isArray(point.coordinates) || point.coordinates.length !== 2) return null;
  const [longitude, latitude] = point.coordinates;
  if (typeof longitude !== 'number' || typeof latitude !== 'number' ||
      !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${latitude},${longitude}`);
  return url.toString();
}
