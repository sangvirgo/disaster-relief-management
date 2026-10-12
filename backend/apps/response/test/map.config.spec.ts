import { loadMapConfig } from '../src/map/map.config';

describe('Response map configuration', () => {
  it('defaults to EPSG 32648', () => {
    expect(loadMapConfig({})).toEqual({ projectionEpsg: 32648 });
  });

  it.each(['', '0', '-1', '32648.5', '1000000', 'invalid'])('rejects invalid MAP_PROJECTION_EPSG %s', (value) => {
    expect(() => loadMapConfig({ MAP_PROJECTION_EPSG: value })).toThrow('Invalid Response configuration: MAP_PROJECTION_EPSG');
  });

  it('accepts a positive EPSG integer from configuration', () => {
    expect(loadMapConfig({ MAP_PROJECTION_EPSG: '3857' })).toEqual({ projectionEpsg: 3857 });
  });
});
