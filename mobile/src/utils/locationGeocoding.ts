export interface PhotonPlaceProperties {
  name?: string | null;
  street?: string | null;
  locality?: string | null;
  district?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  country?: string | null;
}

interface PhotonReverseResponse {
  features?: Array<{
    properties?: PhotonPlaceProperties;
  }>;
}

export function formatPhotonProperties(properties: PhotonPlaceProperties): {
  name: string;
  fullAddress: string;
} {
  const name = properties.name || properties.street || "Vị trí được chọn";
  const parts = [
    properties.name,
    properties.street,
    properties.locality,
    properties.district,
    properties.city,
    properties.county,
    properties.state,
  ].filter((part, index, allParts) => part && allParts.indexOf(part) === index);

  if (properties.country && parts.length === 0) parts.push(properties.country);

  return { name, fullAddress: parts.join(", ") };
}

export async function reverseGeocodeCoordinates(
  longitude: number,
  latitude: number,
): Promise<string | null> {
  const response = await fetch(
    `https://photon.komoot.io/reverse?lon=${encodeURIComponent(longitude)}&lat=${encodeURIComponent(latitude)}&limit=1`,
  );
  if (!response.ok) throw new Error("Address lookup failed");

  const data = (await response.json()) as PhotonReverseResponse;
  const properties = data.features?.[0]?.properties;
  if (!properties) return null;

  const { name, fullAddress } = formatPhotonProperties(properties);
  const address = fullAddress || name;
  return address && address !== "Vị trí được chọn" ? address : null;
}
