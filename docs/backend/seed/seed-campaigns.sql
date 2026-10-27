-- These campaign rows are shared by the full fixture and the safe additive seed path.
INSERT INTO incident_category (code, display_name) VALUES ('UNKNOWN', 'Chưa rõ')
ON CONFLICT (code) DO NOTHING;

INSERT INTO region_boundary (region_code, geom) VALUES
  ('DEMO_A', ST_Multi(ST_MakeEnvelope(106.60, 10.70, 106.80, 10.85, 4326))),
  ('DEMO_B', ST_Multi(ST_MakeEnvelope(107.50, 16.00, 107.70, 16.15, 4326))),
  ('DEMO_C', ST_Multi(ST_MakeEnvelope(105.75, 20.90, 106.00, 21.15, 4326)))
ON CONFLICT DO NOTHING;

-- Serialize the existence check because campaign has no natural-key unique constraint.
SELECT pg_advisory_xact_lock(48352026, 1);
INSERT INTO campaign (id, organization_id, region_code, name, objective, status, starts_at, ends_at, created_by_user_id, created_at)
SELECT fixture.id, fixture.organization_id, fixture.region_code, fixture.name, fixture.objective, fixture.status,
       now() - fixture.starts_ago, now() + fixture.ends_in, fixture.created_by_user_id, now() - fixture.age
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000c1'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_A',
     'Chiến dịch cứu trợ khẩn cấp mùa mưa lũ',
     'Tiếp nhận nhu cầu, điều phối cứu hộ và hỗ trợ nhu yếu phẩm cho người dân bị ảnh hưởng.',
     'ACTIVE', interval '7 days', interval '30 days', '{{campaign_creator_id}}'::uuid, interval '8 days'),
    ('00000000-0000-4000-8000-0000000000c2'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_B',
     'Chiến dịch hỗ trợ sơ tán và an sinh cộng đồng',
     'Hỗ trợ sơ tán an toàn, nước sạch và nhu yếu phẩm thiết yếu cho các hộ dân trong vùng ảnh hưởng.',
     'ACTIVE', interval '7 days', interval '30 days', '{{campaign_creator_id}}'::uuid, interval '2 days'),
    ('00000000-0000-4000-8000-0000000000c3'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_A',
     'Hỗ trợ khẩn cấp khu vực Nam',
     'Điều phối cứu hộ và nhu yếu phẩm cho các hộ dân tại khu vực Demo A.',
     'ACTIVE', interval '3 days', interval '14 days', '{{campaign_creator_id}}'::uuid, interval '3 days'),
    ('00000000-0000-4000-8000-0000000000c4'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_B',
     'Tiếp tế vùng duyên hải Trung',
     'Tiếp nhận nhu cầu sơ tán, nước sạch và lương thực tại khu vực Demo B.',
     'ACTIVE', interval '2 days', interval '21 days', '{{campaign_creator_id}}'::uuid, interval '2 days'),
    ('00000000-0000-4000-8000-0000000000c5'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C',
     'Cứu trợ hộ dân khu vực Bắc',
     'Phối hợp tiếp nhận báo cáo và phân bổ nhu yếu phẩm tại khu vực Demo C.',
     'ACTIVE', interval '1 day', interval '18 days', '{{campaign_creator_id}}'::uuid, interval '1 day'),
    ('00000000-0000-4000-8000-0000000000c6'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_A',
     'Nước sạch và nhu yếu phẩm Demo A',
     'Đợt tiếp nhận nước sạch đang tạm dừng để rà soát năng lực kho.',
     'PAUSED', interval '12 days', interval '10 days', '{{campaign_creator_id}}'::uuid, interval '12 days'),
    ('00000000-0000-4000-8000-0000000000c7'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_B',
     'Hỗ trợ sơ tán và an sinh Demo B',
     'Theo dõi nhu cầu sơ tán và phân phối các mặt hàng thiết yếu.',
     'ACTIVE', interval '4 days', interval '24 days', '{{campaign_creator_id}}'::uuid, interval '4 days'),
    ('00000000-0000-4000-8000-0000000000c8'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C',
     'Cứu trợ y tế khu vực Bắc',
     'Tiếp nhận vật tư y tế cho các điểm cứu trợ Demo C.',
     'PAUSED', interval '10 days', interval '7 days', '{{campaign_creator_id}}'::uuid, interval '10 days')
  ) AS fixture(id, organization_id, region_code, name, objective, status, starts_ago, ends_in, created_by_user_id, age)
 WHERE NOT EXISTS (
   SELECT 1 FROM campaign existing
    WHERE existing.organization_id = fixture.organization_id AND existing.name = fixture.name
 )
ON CONFLICT (id) DO NOTHING;
