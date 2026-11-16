import type { EntityManager } from 'typeorm';
import { applyAutomaticCampaignMatch } from '../operations/request-campaign-attribution';

// Request statuses that still need coordination (mirrors the open-status list used by campaign triage).
export const OPEN_REQUEST_STATUSES = "'SUBMITTED','VERIFYING','VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING'";

export const CLUSTER_LINK_M = 2_000;
export const AREA_MIN_M = 500;
export const AREA_MAX_M = 300_000;

export interface GeoPoint { latitude: number; longitude: number }

export interface OpenRequestPoint extends GeoPoint {
  id: string;
  tracking_code: string;
  priority: string | null;
  status: string;
  version: number;
  campaign_match_state: string;
}

export interface AreaCampaign extends GeoPoint {
  id: string;
  name: string;
  status: string;
  version: number;
  radius_m: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Radius that covers a point at `distance` metres from the centre, with a small margin, within campaign limits. */
export function areaRadiusFor(distance: number): number {
  return Math.min(AREA_MAX_M, Math.max(AREA_MIN_M, Math.ceil(distance + 300)));
}

/** Single-linkage grouping: requests closer than CLUSTER_LINK_M chain into one group. */
export function clusterRequests<T extends GeoPoint>(points: T[]): T[][] {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    let current = index;
    while (parent[current] !== root) {
      const next = parent[current]!;
      parent[current] = root;
      current = next;
    }
    return root;
  };
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (distanceM(points[i]!, points[j]!) <= CLUSTER_LINK_M) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, T[]>();
  points.forEach((point, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), point]);
  });
  return [...groups.values()];
}

const PRIORITY_ORDER = ['P1', 'P2', 'P3', 'P4'];
function highestPriority(items: OpenRequestPoint[]): string | null {
  const ranked = items.map((item) => item.priority).filter((value): value is string => Boolean(value))
    .sort((a, b) => (PRIORITY_ORDER.indexOf(a) + 1 || 9) - (PRIORITY_ORDER.indexOf(b) + 1 || 9));
  return ranked[0] ?? null;
}

export function buildCommonQueueSuggestions(requests: OpenRequestPoint[], campaigns: AreaCampaign[]) {
  const requestItems = requests.map((request) => {
    const nearest = campaigns
      .map((campaign) => ({ campaign, distance: distanceM(request, campaign) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return {
      id: request.id,
      tracking_code: request.tracking_code,
      priority: request.priority,
      status: request.status,
      version: request.version,
      campaign_match_state: request.campaign_match_state,
      location: { latitude: request.latitude, longitude: request.longitude },
      nearest_campaign: nearest ? {
        id: nearest.campaign.id,
        name: nearest.campaign.name,
        status: nearest.campaign.status,
        version: nearest.campaign.version,
        radius_m: nearest.campaign.radius_m,
        distance_m: Math.round(nearest.distance),
        inside_area: nearest.distance <= nearest.campaign.radius_m,
        suggested_radius_m: areaRadiusFor(nearest.distance),
      } : null,
    };
  });

  const clusters = clusterRequests(requests).filter((group) => group.length >= 2).map((group) => {
    const center = {
      latitude: group.reduce((sum, item) => sum + item.latitude, 0) / group.length,
      longitude: group.reduce((sum, item) => sum + item.longitude, 0) / group.length,
    };
    const farthest = Math.max(...group.map((item) => distanceM(center, item)));
    return {
      id: `cluster-${group.map((item) => item.id).sort()[0]}`,
      request_ids: group.map((item) => item.id),
      count: group.length,
      center,
      suggested_radius_m: areaRadiusFor(farthest),
      highest_priority: highestPriority(group),
    };
  });

  return {
    requests: requestItems,
    clusters,
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id, name: campaign.name, status: campaign.status, version: campaign.version,
      center: { lat: campaign.latitude, lng: campaign.longitude }, radius_m: campaign.radius_m,
    })),
  };
}

/**
 * Attaches open, unmatched SOS inside an ACTIVE campaign's area. Used when a campaign is activated,
 * resumed, or its area is changed; only UNMATCHED requests are touched, never CONFLICT or MANUAL ones.
 */
export async function attachUnmatchedInArea(
  manager: Pick<EntityManager, 'query'>,
  campaign: { id: string; status: string; center_latitude?: unknown; center_longitude?: unknown; radius_m?: number | null },
  _actorId: string,
  _reason: string,
): Promise<number> {
  if (campaign.status !== 'ACTIVE' || campaign.radius_m == null ||
      campaign.center_latitude == null || campaign.center_longitude == null) return 0;
  const candidates = await manager.query(
    `SELECT r.id,r.tracking_code,r.status,r.version
       FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
      WHERE r.campaign_id IS NULL AND r.campaign_match_state='UNMATCHED' AND r.canonical_request_id IS NULL
        AND r.status IN (${OPEN_REQUEST_STATUSES})
        AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1::double precision,$2::double precision),4326)::geography, $3::double precision)
      ORDER BY r.received_at,r.id
        FOR UPDATE OF r`,
    [Number(campaign.center_longitude), Number(campaign.center_latitude), Number(campaign.radius_m)],
  ) as Array<{ id: string; tracking_code: string; status: string; version: number }>;
  // Same rule as intake: one ACTIVE campaign in range => auto-attach; several => CONFLICT for manual choice.
  for (const row of candidates) {
    await applyAutomaticCampaignMatch(manager, {
      requestId: row.id, trackingCode: row.tracking_code, status: row.status, version: Number(row.version),
    });
  }
  return candidates.length;
}
