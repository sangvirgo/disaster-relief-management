-- These campaign rows are shared by the full fixture and the safe additive seed path.
INSERT INTO region_boundary (region_code, geom) VALUES
  ('DEMO_A', ST_Multi(ST_MakeEnvelope(106.60, 10.70, 106.80, 10.85, 4326))),
  ('DEMO_B', ST_Multi(ST_MakeEnvelope(107.50, 16.00, 107.70, 16.15, 4326)))
ON CONFLICT DO NOTHING;

-- Serialize the existence check because campaign has no natural-key unique constraint.
SELECT pg_advisory_xact_lock(48352026, 1);
INSERT INTO campaign (id, organization_id, region_code, name, objective, status, starts_at, ends_at, created_by_user_id, created_at)
SELECT fixture.id, fixture.organization_id, fixture.region_code, fixture.name, fixture.objective, 'ACTIVE',
       now() - interval '7 days', now() + interval '30 days', fixture.created_by_user_id, now() - fixture.age
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000c1'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_A',
     'Chiến dịch cứu trợ khẩn cấp mùa mưa lũ',
     'Tiếp nhận nhu cầu, điều phối cứu hộ và hỗ trợ nhu yếu phẩm cho người dân bị ảnh hưởng.',
     '{{campaign_creator_id}}'::uuid, interval '8 days'),
    ('00000000-0000-4000-8000-0000000000c2'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_B',
     'Chiến dịch hỗ trợ sơ tán và an sinh cộng đồng',
     'Hỗ trợ sơ tán an toàn, nước sạch và nhu yếu phẩm thiết yếu cho các hộ dân trong vùng ảnh hưởng.',
     '{{campaign_creator_id}}'::uuid, interval '2 days')
  ) AS fixture(id, organization_id, region_code, name, objective, created_by_user_id, age)
 WHERE NOT EXISTS (
   SELECT 1 FROM campaign existing
    WHERE existing.organization_id = fixture.organization_id AND existing.name = fixture.name
 )
ON CONFLICT (id) DO NOTHING;
