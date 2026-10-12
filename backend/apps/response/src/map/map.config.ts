export const MAP_CONFIG = Symbol('MAP_CONFIG');

export interface MapConfig {
  projectionEpsg: number;
}

export function loadMapConfig(env: Record<string, string | undefined> = process.env): MapConfig {
  const projectionEpsg = Number(env.MAP_PROJECTION_EPSG ?? 32648);
  if (!Number.isSafeInteger(projectionEpsg) || projectionEpsg < 1 || projectionEpsg > 999_999) {
    throw new Error('Invalid Response configuration: MAP_PROJECTION_EPSG');
  }
  return { projectionEpsg };
}
