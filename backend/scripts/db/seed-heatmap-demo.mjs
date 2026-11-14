import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: new URL('../../.env', import.meta.url) });

if (process.env.NODE_ENV === 'production') {
  throw new Error('Heatmap demo seeding is disabled in production.');
}

// These are synthetic map fixtures, separate from the workflow demo seed.
// The same IDs and tracking codes are reused on every run.
const groups = [
  { region: 'DEMO_A', name: 'TP. Hồ Chí Minh', lat: 10.7769, lon: 106.7009, count: 70, radiusM: 600, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Cần Thơ', lat: 10.0452, lon: 105.7469, count: 38, radiusM: 1000, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Biên Hòa', lat: 10.9574, lon: 106.8427, count: 28, radiusM: 1500, category: 'STORM' },
  { region: 'DEMO_A', name: 'Vũng Tàu', lat: 10.4114, lon: 107.1362, count: 14, radiusM: 3000, category: 'OTHER' },
  { region: 'DEMO_B', name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022, count: 58, radiusM: 650, category: 'STORM' },
  { region: 'DEMO_B', name: 'Huế', lat: 16.4637, lon: 107.5909, count: 32, radiusM: 1100, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Hội An', lat: 15.8801, lon: 108.3380, count: 22, radiusM: 1800, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Quảng Ngãi', lat: 15.1214, lon: 108.8044, count: 12, radiusM: 3000, category: 'LANDSLIDE' },
  { region: 'DEMO_C', name: 'Hà Nội', lat: 21.0285, lon: 105.8542, count: 62, radiusM: 700, category: 'FLOOD' },
  { region: 'DEMO_C', name: 'Hải Phòng', lat: 20.8449, lon: 106.6881, count: 34, radiusM: 1100, category: 'STORM' },
  { region: 'DEMO_C', name: 'Hạ Long', lat: 20.9507, lon: 107.0734, count: 24, radiusM: 1800, category: 'STORM' },
  { region: 'DEMO_C', name: 'Thái Nguyên', lat: 21.5942, lon: 105.8482, count: 16, radiusM: 3000, category: 'LANDSLIDE' },
  // Public town-scale anchors only. These are fictional SOS records, not past or live incidents.
  // Append groups to preserve IDs of the 410 existing fixtures.
  { region: 'DEMO_C', name: 'Mường Tè, Lai Châu', lat: 22.373, lon: 102.822, count: 8, radiusM: 2400, category: 'LANDSLIDE' },
  { region: 'DEMO_C', name: 'Điện Biên', lat: 21.386, lon: 103.020, count: 10, radiusM: 2200, category: 'FLOOD' },
  { region: 'DEMO_C', name: 'Sa Pa, Lào Cai', lat: 22.337, lon: 103.844, count: 10, radiusM: 1800, category: 'LANDSLIDE' },
  { region: 'DEMO_C', name: 'Bắc Hà, Lào Cai', lat: 22.535, lon: 104.293, count: 8, radiusM: 1800, category: 'LANDSLIDE' },
  { region: 'DEMO_C', name: 'Mù Cang Chải, Yên Bái', lat: 21.855, lon: 104.092, count: 10, radiusM: 2200, category: 'LANDSLIDE' },
  { region: 'DEMO_C', name: 'Hà Giang', lat: 22.824, lon: 104.984, count: 9, radiusM: 2400, category: 'FLOOD' },
  { region: 'DEMO_C', name: 'Đồng Văn, Hà Giang', lat: 23.279, lon: 105.359, count: 7, radiusM: 1800, category: 'LANDSLIDE' },
  { region: 'DEMO_C', name: 'Cao Bằng', lat: 22.665, lon: 106.258, count: 8, radiusM: 2200, category: 'FLOOD' },
  { region: 'DEMO_C', name: 'Lạng Sơn', lat: 21.853, lon: 106.761, count: 8, radiusM: 2300, category: 'STORM' },
  { region: 'DEMO_C', name: 'Tuyên Quang', lat: 21.824, lon: 105.218, count: 8, radiusM: 2300, category: 'FLOOD' },
  { region: 'DEMO_C', name: 'Sơn La', lat: 21.326, lon: 103.915, count: 7, radiusM: 2100, category: 'LANDSLIDE' },
  { region: 'DEMO_C', name: 'Cẩm Phả, Quảng Ninh', lat: 21.000, lon: 107.280, count: 8, radiusM: 2400, category: 'STORM' },
  { region: 'DEMO_B', name: 'Vinh, Nghệ An', lat: 18.678, lon: 105.681, count: 8, radiusM: 2400, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Hương Khê, Hà Tĩnh', lat: 18.176, lon: 105.700, count: 8, radiusM: 2100, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Đồng Hới, Quảng Bình', lat: 17.468, lon: 106.622, count: 10, radiusM: 2500, category: 'STORM' },
  { region: 'DEMO_B', name: 'Đông Hà, Quảng Trị', lat: 16.816, lon: 107.100, count: 12, radiusM: 2200, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'A Lưới, Huế', lat: 16.225, lon: 107.270, count: 8, radiusM: 2000, category: 'LANDSLIDE' },
  { region: 'DEMO_B', name: 'Nam Trà My, Quảng Nam', lat: 15.186, lon: 108.116, count: 9, radiusM: 2000, category: 'LANDSLIDE' },
  { region: 'DEMO_B', name: 'Quảng Ngãi', lat: 15.121, lon: 108.804, count: 10, radiusM: 2400, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Kon Tum', lat: 14.354, lon: 108.000, count: 8, radiusM: 2300, category: 'LANDSLIDE' },
  { region: 'DEMO_B', name: 'Quy Nhơn, Bình Định', lat: 13.783, lon: 109.219, count: 10, radiusM: 2500, category: 'STORM' },
  { region: 'DEMO_B', name: 'Tuy Hòa, Phú Yên', lat: 13.089, lon: 109.308, count: 8, radiusM: 2400, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Nha Trang, Khánh Hòa', lat: 12.238, lon: 109.196, count: 8, radiusM: 2500, category: 'STORM' },
  { region: 'DEMO_B', name: 'Buôn Ma Thuột, Đắk Lắk', lat: 12.667, lon: 108.050, count: 8, radiusM: 2600, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Đồng Xoài, Bình Phước', lat: 11.535, lon: 106.883, count: 8, radiusM: 2400, category: 'STORM' },
  { region: 'DEMO_A', name: 'Châu Đốc, An Giang', lat: 10.705, lon: 105.116, count: 9, radiusM: 2300, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Cao Lãnh, Đồng Tháp', lat: 10.455, lon: 105.634, count: 9, radiusM: 2200, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Vĩnh Long', lat: 10.253, lon: 105.972, count: 8, radiusM: 2200, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Rạch Giá, Kiên Giang', lat: 10.012, lon: 105.080, count: 8, radiusM: 2400, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Cà Mau', lat: 9.176, lon: 105.150, count: 8, radiusM: 2400, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Bạc Liêu', lat: 9.295, lon: 105.724, count: 8, radiusM: 2300, category: 'STORM' },
  { region: 'DEMO_A', name: 'Sóc Trăng', lat: 9.603, lon: 105.973, count: 8, radiusM: 2300, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Trà Vinh', lat: 9.934, lon: 106.345, count: 8, radiusM: 2300, category: 'STORM' },
  { region: 'DEMO_A', name: 'Bến Tre', lat: 10.243, lon: 106.376, count: 8, radiusM: 2300, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Long Xuyên, An Giang', lat: 10.383, lon: 105.435, count: 8, radiusM: 2200, category: 'FLOOD' },
  // Dense, fictional flood and storm corridors for the central Vietnam map demo.
  // Keep these after the existing groups so previously seeded IDs remain stable.
  { region: 'DEMO_B', name: 'Lệ Thủy, Quảng Bình', lat: 17.218, lon: 106.800, count: 48, radiusM: 3500, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Ba Đồn, Quảng Bình', lat: 17.756, lon: 106.422, count: 22, radiusM: 2600, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Hải Lăng, Quảng Trị', lat: 16.694, lon: 107.300, count: 44, radiusM: 3200, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Phong Điền, Huế', lat: 16.586, lon: 107.367, count: 32, radiusM: 2900, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Phú Lộc, Huế', lat: 16.269, lon: 107.884, count: 30, radiusM: 2800, category: 'STORM' },
  { region: 'DEMO_B', name: 'Hòa Vang, Đà Nẵng', lat: 16.010, lon: 108.075, count: 32, radiusM: 3200, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Đại Lộc, Quảng Nam', lat: 15.887, lon: 108.119, count: 38, radiusM: 3300, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Duy Xuyên, Quảng Nam', lat: 15.830, lon: 108.294, count: 24, radiusM: 2600, category: 'STORM' },
  { region: 'DEMO_B', name: 'Sơn Tịnh, Quảng Ngãi', lat: 15.191, lon: 108.760, count: 24, radiusM: 2800, category: 'FLOOD' },
  { region: 'DEMO_B', name: 'Hương Sơn, Hà Tĩnh', lat: 18.511, lon: 105.399, count: 18, radiusM: 2800, category: 'LANDSLIDE' },
  { region: 'DEMO_B', name: 'Yên Thành, Nghệ An', lat: 18.988, lon: 105.484, count: 16, radiusM: 3000, category: 'FLOOD' },
  { region: 'DEMO_C', name: 'Nam Định', lat: 20.438, lon: 106.162, count: 18, radiusM: 2700, category: 'STORM' },
  { region: 'DEMO_C', name: 'Thái Bình', lat: 20.446, lon: 106.337, count: 16, radiusM: 2600, category: 'FLOOD' },
  { region: 'DEMO_C', name: 'Lào Cai', lat: 22.485, lon: 103.970, count: 14, radiusM: 2800, category: 'LANDSLIDE' },
  { region: 'DEMO_A', name: 'Mỹ Tho, Tiền Giang', lat: 10.360, lon: 106.359, count: 18, radiusM: 2700, category: 'FLOOD' },
  { region: 'DEMO_A', name: 'Bến Tre', lat: 10.243, lon: 106.376, count: 16, radiusM: 2700, category: 'STORM' },
  { region: 'DEMO_A', name: 'Cà Mau', lat: 9.176, lon: 105.150, count: 14, radiusM: 2700, category: 'FLOOD' },
];

function uuidFor(index, purpose) {
  const bytes = createHash('sha256').update(`reliva-heatmap-demo-v1:${purpose}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function unit(index, offset) {
  return createHash('sha256').update(`reliva-heatmap-demo-v1:point:${index}:${offset}`).digest().readUInt32BE(0) / 2 ** 32;
}

const rows = [];
let index = 0;
const baseTime = Date.now() - 60 * 60_000;
for (const [groupIndex, group] of groups.entries()) {
  const lobes = group.count >= 50
    ? [[-850, -350], [0, 600], [850, 250], [400, -750]]
    : group.count >= 25 ? [[-650, -300], [650, 400], [300, -550]]
      : [[0, 0]];
  const rotation = 2 * Math.PI * unit(groupIndex + 1, 'rotation');
  for (let inGroup = 0; inGroup < group.count; inGroup++) {
    index++;
    const angle = 2 * Math.PI * unit(index, 'angle');
    const distanceM = group.radiusM * (lobes.length > 1 ? 0.58 : 1) * Math.sqrt(unit(index, 'distance'));
    const [lobeEast, lobeNorth] = lobes[inGroup % lobes.length];
    const northM = distanceM * Math.cos(angle) + lobeNorth * Math.cos(rotation) + lobeEast * Math.sin(rotation);
    const eastM = distanceM * Math.sin(angle) + lobeEast * Math.cos(rotation) - lobeNorth * Math.sin(rotation);
    const lat = group.lat + northM / 111_320;
    const lon = group.lon + eastM / (111_320 * Math.cos(group.lat * Math.PI / 180));
    rows.push({
      id: uuidFor(index, 'request'),
      event_id: uuidFor(index, 'event'),
      tracking_code: `C48HM${String(index).padStart(7, '0')}`,
      region: group.region,
      category: group.category,
      description: `SOS mô phỏng tại ${group.name} — dữ liệu demo bản đồ nhiệt.`,
      received_at: new Date(baseTime - (index % 48) * 30 * 60_000).toISOString(),
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      people: 1 + index % 6,
    });
  }
}

const client = new pg.Client({
  host: '127.0.0.1',
  port: Number(process.env.POSTGRES_HOST_PORT || 55432),
  user: 'response_migrator',
  password: process.env.RESPONSE_MIGRATOR_PASSWORD,
  database: 'c48_response',
  connectionTimeoutMillis: 5000,
});

await client.connect();
try {
  const regions = await client.query("SELECT region_code FROM region_boundary WHERE region_code = ANY($1::text[])",
    [groups.map((group) => group.region)]);
  if (new Set(regions.rows.map((row) => row.region_code)).size !== 3) {
    throw new Error('The three demo regions must exist before heatmap seeding.');
  }
  if (process.argv.includes('--check')) {
    const result = await client.query(
      "SELECT region_code, count(*)::int AS count FROM assistance_request WHERE tracking_code LIKE 'C48HM%' GROUP BY region_code ORDER BY region_code",
    );
    process.stdout.write(JSON.stringify({ planned: rows.length, existing: result.rows }) + '\n');
  } else {
    await client.query('BEGIN');
    try {
      const payload = JSON.stringify(rows);
      const inserted = await client.query(`
        INSERT INTO assistance_request
          (id, tracking_code, incident_category_code, report_mode, description, organization_id, region_code, status, received_at)
        SELECT f.id::uuid, f.tracking_code, f.category, 'SELF', f.description,
               '00000000-0000-4000-8000-000000000001'::uuid, f.region, 'SUBMITTED', f.received_at::timestamptz
          FROM jsonb_to_recordset($1::jsonb) AS f(id text, tracking_code text, category text, description text, region text, received_at text)
        ON CONFLICT DO NOTHING`, [payload]);
      await client.query(`
        INSERT INTO request_subject (request_id, people_affected, location, location_source)
        SELECT f.id::uuid, f.people,
               ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326)::geography, 'MANUAL_PIN'
          FROM jsonb_to_recordset($1::jsonb) AS f(id text, tracking_code text, people int, lon float8, lat float8)
          JOIN assistance_request r ON r.id = f.id::uuid AND r.tracking_code = f.tracking_code
        ON CONFLICT DO NOTHING`, [payload]);
      if (process.argv.includes('--refresh-locations')) {
        await client.query(`
          UPDATE request_subject s
             SET location = ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326)::geography
            FROM jsonb_to_recordset($1::jsonb) AS f(id text, tracking_code text, lon float8, lat float8),
                 assistance_request r
           WHERE s.request_id = f.id::uuid AND r.id = s.request_id AND r.tracking_code = f.tracking_code`, [payload]);
      }
      await client.query(`
        INSERT INTO request_event
          (id, request_id, event_type, visibility, to_status, payload, occurred_at)
        SELECT f.event_id::uuid, f.id::uuid, 'REQUEST_SUBMITTED', 'REPORTER', 'SUBMITTED',
               '{"public_text_code":"RECEIVED","demo_heatmap":true}'::jsonb, f.received_at::timestamptz
          FROM jsonb_to_recordset($1::jsonb) AS f(id text, event_id text, tracking_code text, received_at text)
          JOIN assistance_request r ON r.id = f.id::uuid AND r.tracking_code = f.tracking_code
        ON CONFLICT DO NOTHING`, [payload]);
      const verified = await client.query(`
        SELECT count(*)::int AS count
          FROM assistance_request r
          JOIN request_subject s ON s.request_id = r.id
          JOIN request_event e ON e.request_id = r.id AND e.event_type = 'REQUEST_SUBMITTED'
         WHERE r.id = ANY($1::uuid[]) AND r.tracking_code LIKE 'C48HM%'`, [rows.map((row) => row.id)]);
      if (verified.rows[0].count !== rows.length) throw new Error('Heatmap demo requests are incomplete; rolling back.');
      await client.query('COMMIT');
      process.stdout.write(`Heatmap demo: ${rows.length} complete requests, ${inserted.rowCount} newly inserted.\n`);
      for (const region of ['DEMO_A', 'DEMO_B', 'DEMO_C']) {
        process.stdout.write(`${region}: ${rows.filter((row) => row.region === region).length} synthetic SOS.\n`);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.end();
}
