-- These campaign rows are shared by the full fixture and the safe additive seed path.
INSERT INTO incident_category (code, display_name) VALUES ('UNKNOWN', 'Chưa rõ')
ON CONFLICT (code) DO NOTHING;

-- Serialize the existence check because campaign has no natural-key unique constraint.
SELECT pg_advisory_xact_lock(48352026, 1);
INSERT INTO campaign (id, name, objective, status, starts_at, ends_at, created_by_user_id, created_at, center, radius_m)
SELECT fixture.id, fixture.name, fixture.objective, fixture.status,
       now() - fixture.starts_ago, now() + fixture.ends_in, fixture.created_by_user_id, now() - fixture.age,
       CASE WHEN fixture.longitude IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(fixture.longitude,fixture.latitude),4326)::geography END,
       fixture.radius_m
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000c1'::uuid,
     'Chiến dịch cứu trợ khẩn cấp mùa mưa lũ',
     'Tiếp nhận nhu cầu, điều phối cứu hộ và hỗ trợ nhu yếu phẩm cho người dân bị ảnh hưởng.',
     'ACTIVE', interval '7 days', interval '30 days', '{{campaign_creator_id}}'::uuid, interval '8 days', 105.8500::float8, 21.0300::float8, 30000),
    ('00000000-0000-4000-8000-0000000000c2'::uuid,
     'Chiến dịch hỗ trợ sơ tán và an sinh cộng đồng',
     'Hỗ trợ sơ tán an toàn, nước sạch và nhu yếu phẩm thiết yếu cho các hộ dân trong vùng ảnh hưởng.',
     'ACTIVE', interval '7 days', interval '30 days', '{{campaign_creator_id}}'::uuid, interval '2 days', 105.9000::float8, 21.0300::float8, 18000),
    ('00000000-0000-4000-8000-0000000000c3'::uuid,
     'Hỗ trợ khẩn cấp Nam',
     'Điều phối cứu hộ và nhu yếu phẩm cho các hộ dân tại Demo A.',
     'ACTIVE', interval '3 days', interval '14 days', '{{campaign_creator_id}}'::uuid, interval '3 days', 106.7000::float8, 10.7800::float8, 25000),
    ('00000000-0000-4000-8000-0000000000c4'::uuid,
     'Tiếp tế vùng duyên hải Trung',
     'Tiếp nhận nhu cầu sơ tán, nước sạch và lương thực tại Demo B.',
     'ACTIVE', interval '2 days', interval '21 days', '{{campaign_creator_id}}'::uuid, interval '2 days', 108.2022::float8, 16.0544::float8, 25000),
    ('00000000-0000-4000-8000-0000000000c5'::uuid,
     'Cứu trợ hộ dân Bắc',
     'Phối hợp tiếp nhận báo cáo và phân bổ nhu yếu phẩm tại Demo C.',
     'ACTIVE', interval '1 day', interval '18 days', '{{campaign_creator_id}}'::uuid, interval '1 day', 103.4700::float8, 22.3964::float8, 25000),
    ('00000000-0000-4000-8000-0000000000c6'::uuid,
     'Nước sạch và nhu yếu phẩm Demo A',
     'Đợt tiếp nhận nước sạch đang tạm dừng để rà soát năng lực kho.',
     'PAUSED', interval '12 days', interval '10 days', '{{campaign_creator_id}}'::uuid, interval '12 days', NULL::float8, NULL::float8, NULL::integer),
    ('00000000-0000-4000-8000-0000000000c7'::uuid,
     'Hỗ trợ sơ tán và an sinh Demo B',
     'Theo dõi nhu cầu sơ tán và phân phối các mặt hàng thiết yếu.',
     'ACTIVE', interval '4 days', interval '24 days', '{{campaign_creator_id}}'::uuid, interval '4 days', 105.7469::float8, 10.0452::float8, 22000),
    ('00000000-0000-4000-8000-0000000000c8'::uuid,
     'Cứu trợ y tế Bắc',
     'Tiếp nhận vật tư y tế cho các điểm cứu trợ Demo C.',
     'PAUSED', interval '10 days', interval '7 days', '{{campaign_creator_id}}'::uuid, interval '10 days', NULL::float8, NULL::float8, NULL::integer)
  ) AS fixture(id, name, objective, status, starts_ago, ends_in, created_by_user_id, age, longitude, latitude, radius_m)
 WHERE NOT EXISTS (
   SELECT 1 FROM campaign existing
    WHERE existing.name = fixture.name AND existing.id <> fixture.id
 )
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name,objective=EXCLUDED.objective,status=EXCLUDED.status,
  starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,center=EXCLUDED.center,radius_m=EXCLUDED.radius_m;
