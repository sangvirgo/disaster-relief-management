import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const locations = readFileSync(resolve(root, 'backend/scripts/dev/flood-sos-locations-2026-11.tsv'), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((line) => {
    const [cluster, place, query] = line.split('\t');
    return { cluster: Number(cluster), place, query };
  });
const pins = readFileSync(resolve(root, 'docs/backend/seed/fixtures/flood-locality-pins-2026-11.csv'), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((line) => {
    const [seq, longitude, latitude, quality] = line.split(',');
    return { seq: Number(seq), longitude: Number(longitude), latitude: Number(latitude), quality };
  });
if (locations.length !== 107 || pins.length !== 107 ||
    pins.some((pin, index) => pin.seq !== index + 1 || !Number.isFinite(pin.longitude) || !Number.isFinite(pin.latitude))) {
  throw new Error('Expected 107 ordered locations and pins');
}
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const uuid = (value) => {
  const bytes = createHash('md5').update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const situations = [
  'Nước ngập lối ra vào khu dân cư, một số người chưa thể di chuyển đến nơi an toàn. Cần đội tiếp cận, kiểm tra mực nước và hỗ trợ sơ tán.',
  'Mưa lớn làm nước dâng nhanh ở khu vực thấp. Các hộ gần điểm ghim cần được xác minh tình trạng và hỗ trợ di chuyển nếu tuyến đường tiếp tục ngập.',
  'Đường vào khu vực bị nước chia cắt, người dân cần hỗ trợ tiếp cận và kiểm tra lối thoát an toàn. Đề nghị mang theo áo phao và phương tiện phù hợp.',
  'Nước tràn qua tuyến đường gần điểm ghim, việc đi lại gặp nguy hiểm. Cần đội cứu hộ kiểm tra hiện trường, hỗ trợ người mắc kẹt và hướng dẫn tránh đoạn ngập.',
  'Khu dân cư ven sông, suối có nguy cơ bị cô lập do nước dâng. Cần xác minh số người còn ở lại và chuẩn bị phương án đưa họ đến vị trí cao.',
];
const sql = [
  '-- Reconstructed flood SOS scenarios for the 107 user-supplied localities (11 clusters).',
  '-- These are plausible training records, not verified current incidents. Pins may be area-level approximations.',
  '-- Additive and idempotent; no campaign, priority or team assignment is inserted.',
  'BEGIN;',
  'SELECT pg_advisory_xact_lock(48352026, 18);',
  'CREATE TEMP TABLE flood_locality (seq int PRIMARY KEY, cluster int NOT NULL, place text NOT NULL, longitude float8 NOT NULL, latitude float8 NOT NULL, quality text NOT NULL, request_id uuid NOT NULL, event_id uuid NOT NULL, tracking_code text NOT NULL) ON COMMIT DROP;',
  'INSERT INTO flood_locality VALUES',
  locations.map((location, index) => {
    const pin = pins[index];
    return `  (${index + 1}, ${location.cluster}, ${quote(location.place)}, ${pin.longitude}, ${pin.latitude}, ${quote(pin.quality)}, ${quote(uuid(`c48-flood-locality-${index + 1}`))}, ${quote(uuid(`c48-flood-locality-event-${index + 1}`))}, ${quote(`C48F${String(index + 1).padStart(6, '0')}`)})`;
  }).join(',\n') + ';',
  'INSERT INTO assistance_request (id, tracking_code, incident_category_code, campaign_match_state, report_mode, description, status, needs_rescue, needs_relief_supplies, received_at)',
  'SELECT f.request_id, f.tracking_code, \'FLOOD\', \'UNMATCHED\', \'SELF\',',
  `       CASE (f.seq - 1) % 5 ${situations.map((s, i) => `WHEN ${i} THEN ${quote(s)}`).join(' ')} END || ' Khu vực báo: ' || f.place || '.',`,
  "       'SUBMITTED', true, true, now() - (f.seq % 13) * interval '1 minute'",
  'FROM flood_locality f ON CONFLICT (id) DO NOTHING;',
  'INSERT INTO request_subject (request_id, people_affected, children_count, elderly_count, location, location_source, information_source, household_reference_note)',
  "SELECT f.request_id, 2 + f.seq % 5, CASE WHEN f.seq % 4 = 0 THEN 1 ELSE 0 END, CASE WHEN f.seq % 7 = 0 THEN 1 ELSE 0 END,",
  "       ST_SetSRID(ST_MakePoint(f.longitude, f.latitude), 4326)::geography, 'MANUAL_PIN',",
  "       'Tình huống tái dựng từ địa điểm người dùng cung cấp; cần xác minh thực địa trước khi điều phối.',",
  "       CASE WHEN f.quality = 'locality' THEN 'Ghim theo địa danh; cần xác nhận vị trí cụ thể.' ELSE 'Ghim gần khu vực được nêu; cần xác nhận vị trí cụ thể.' END",
  'FROM flood_locality f JOIN assistance_request r ON r.id = f.request_id AND r.tracking_code = f.tracking_code',
  'ON CONFLICT (request_id) DO NOTHING;',
  'INSERT INTO request_event (id, request_id, event_type, visibility, from_status, to_status, payload, occurred_at)',
  "SELECT f.event_id, r.id, 'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED',",
  "       jsonb_build_object('public_text_code', 'RECEIVED', 'source', 'reconstructed_flood_locality'), r.received_at",
  'FROM flood_locality f JOIN assistance_request r ON r.id = f.request_id AND r.tracking_code = f.tracking_code',
  'ON CONFLICT (id) DO NOTHING;',
  'DO $$ BEGIN',
  "  IF (SELECT count(*) FROM assistance_request WHERE tracking_code LIKE 'C48F%') < 107 THEN RAISE EXCEPTION 'Flood locality seed incomplete'; END IF;",
  'END $$;',
  'COMMIT;',
  '',
].join('\n');
const output = resolve(root, 'docs/backend/seed/seed-flood-localities-2026-11.sql');
writeFileSync(output, sql, 'utf8');
console.log(`Generated ${locations.length} flood SOS records`);
