import { Platform } from "react-native";
import * as Location from "expo-location";

export interface PhotonPlaceProperties {
  name?: string | null;
  housenumber?: string | null;
  street?: string | null;
  postcode?: string | null;
  locality?: string | null;
  district?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  country?: string | null;
}

interface PhotonReverseResponse {
  features?: {
    properties?: PhotonPlaceProperties;
  }[];
}

const addressCache = new Map<string, string>();
const addressLookups = new Map<string, Promise<string | null>>();

function formatAddressParts(parts: (string | null | undefined)[]): string | null {
  const seenValues = new Set<string>();
  const addressParts: string[] = [];

  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;

    const key = value.toLocaleLowerCase();
    if (seenValues.has(key)) continue;
    seenValues.add(key);
    addressParts.push(value);
  }

  return addressParts.length > 0 ? addressParts.join(", ") : null;
}

function normalizeAdministrativeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^(?:tỉnh|thành phố|tp\.?|province|city)\s+/u, "");
}

function sameAdministrativeArea(left?: string | null, right?: string | null): boolean {
  return Boolean(
    left && right && normalizeAdministrativeName(left) === normalizeAdministrativeName(right),
  );
}

function coordinatesKey(longitude: number, latitude: number): string {
  // Precision to roughly one meter avoids duplicate lookups for tiny GPS jitter.
  return `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
}

function formatNativeAddress(address: Location.LocationGeocodedAddress): string | null {
  const street = [address.streetNumber, address.street].filter(Boolean).join(" ");
  const structuredAddress = formatAddressParts([
    street,
    street ? null : address.name,
    address.subregion,
    address.district,
    address.city,
    sameAdministrativeArea(address.region, address.city) ? null : address.region,
    address.postalCode,
    address.country,
  ]);
  const formattedAddress = address.formattedAddress?.trim();
  if (!formattedAddress) return structuredAddress;
  if (!structuredAddress) return formattedAddress;
  return countAddressParts(formattedAddress) >= countAddressParts(structuredAddress)
    ? formattedAddress
    : structuredAddress;
}

async function reverseGeocodeWithDevice(
  longitude: number,
  latitude: number,
): Promise<string | null> {
  if (Platform.OS === "web") return null;

  // Android's native geocoder requires foreground location permission.
  if (Platform.OS === "android") {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
  }

  const results = await Location.reverseGeocodeAsync({ latitude, longitude });
  const firstAddress = results[0];
  return firstAddress ? formatNativeAddress(firstAddress) : null;
}

async function lookupAddress(longitude: number, latitude: number): Promise<string | null> {
  const deviceAddress = await reverseGeocodeWithDevice(longitude, latitude).catch(() => null);
  if (deviceAddress && countAddressParts(deviceAddress) >= 4) return deviceAddress;

  const photonAddress = await reverseGeocodeWithPhoton(longitude, latitude).catch(() => null);
  if (!photonAddress) return deviceAddress;
  if (!deviceAddress) return photonAddress;

  const photonParts = countAddressParts(photonAddress);
  const deviceParts = countAddressParts(deviceAddress);
  if (deviceParts !== photonParts) {
    return deviceParts > photonParts ? deviceAddress : photonAddress;
  }
  return deviceAddress.length >= photonAddress.length ? deviceAddress : photonAddress;
}

function countAddressParts(address: string): number {
  return address.split(",").filter((part) => part.trim()).length;
}

export function formatPhotonProperties(properties: PhotonPlaceProperties): {
  name: string;
  fullAddress: string;
} {
  const name = properties.name || properties.street || "Vị trí được chọn";
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const fullAddress = formatAddressParts([
    street,
    street ? null : properties.name,
    properties.locality,
    properties.district,
    properties.city,
    sameAdministrativeArea(properties.county, properties.district) ? null : properties.county,
    sameAdministrativeArea(properties.state, properties.city) ? null : properties.state,
    properties.postcode,
    properties.country,
  ]) || name;

  return { name, fullAddress };
}

export async function reverseGeocodeCoordinates(
  longitude: number,
  latitude: number,
): Promise<string | null> {
  if (
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90
  ) return null;

  const key = coordinatesKey(longitude, latitude);
  const cachedAddress = addressCache.get(key);
  if (cachedAddress) return cachedAddress;

  const existingLookup = addressLookups.get(key);
  if (existingLookup) return existingLookup;

  const lookup = lookupAddress(longitude, latitude).then((address) => {
    if (address) addressCache.set(key, address);
    return address;
  }).finally(() => {
    addressLookups.delete(key);
  });
  addressLookups.set(key, lookup);
  return lookup;
}

async function reverseGeocodeWithPhoton(
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
