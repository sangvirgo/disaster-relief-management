import { describe, expect, it } from '@jest/globals';
import {
  areaRadiusFor, buildCommonQueueSuggestions, clusterRequests, distanceM, OpenRequestPoint, AreaCampaign,
} from '../src/campaigns/campaign-area';

const base = { latitude: 22.3964, longitude: 103.47 };
const request = (id: string, latitude: number, longitude: number, priority: string | null = 'P3'): OpenRequestPoint => ({
  id, tracking_code: `C48-${id}`, priority, status: 'SUBMITTED', version: 1, campaign_match_state: 'UNMATCHED', latitude, longitude,
});
const campaign = (id: string, latitude: number, longitude: number, radius_m: number, status = 'ACTIVE'): AreaCampaign => ({
  id, name: `Chiến dịch ${id}`, status, version: 1, latitude, longitude, radius_m,
});

describe('campaign area suggestions', () => {
  it('measures great-circle distance in metres', () => {
    // ~0.01 degree of latitude is about 1.11 km.
    expect(distanceM(base, { latitude: base.latitude + 0.01, longitude: base.longitude })).toBeGreaterThan(1_100);
    expect(distanceM(base, base)).toBe(0);
  });

  it('keeps suggested radius within campaign limits with a margin', () => {
    expect(areaRadiusFor(10)).toBe(500);
    expect(areaRadiusFor(1_000)).toBe(1_300);
    expect(areaRadiusFor(900_000)).toBe(300_000);
  });

  it('chains nearby requests into one cluster and keeps far ones apart', () => {
    const near = request('a', base.latitude, base.longitude);
    const chained = request('b', base.latitude + 0.012, base.longitude); // ~1.3 km from a
    const far = request('c', base.latitude + 0.2, base.longitude); // ~22 km away
    const groups = clusterRequests([near, chained, far]).map((group) => group.map((item) => item.id).sort());
    expect(groups).toHaveLength(2);
    expect(groups).toContainEqual(['a', 'b']);
    expect(groups).toContainEqual(['c']);
  });

  it('reports nearest campaign, whether the SOS is inside it, and the radius needed to include it', () => {
    const outside = request('x', base.latitude + 0.02, base.longitude); // ~2.2 km north
    const result = buildCommonQueueSuggestions([outside], [campaign('c1', base.latitude, base.longitude, 1_000)]);
    const nearest = result.requests[0]!.nearest_campaign!;
    expect(nearest.id).toBe('c1');
    expect(nearest.inside_area).toBe(false);
    expect(nearest.distance_m).toBeGreaterThan(2_000);
    expect(nearest.suggested_radius_m).toBeGreaterThan(nearest.distance_m);
  });

  it('suggests one area per cluster with its centre, covering radius and highest priority', () => {
    const items = [
      request('p', base.latitude, base.longitude, 'P3'),
      request('q', base.latitude + 0.01, base.longitude, 'P1'),
    ];
    const result = buildCommonQueueSuggestions(items, []);
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0]!;
    expect(cluster.count).toBe(2);
    expect(cluster.highest_priority).toBe('P1');
    expect(cluster.suggested_radius_m).toBeGreaterThanOrEqual(500);
    expect(cluster.center.latitude).toBeCloseTo(base.latitude + 0.005, 6);
    expect(result.requests[0]!.nearest_campaign).toBeNull();
  });
});
