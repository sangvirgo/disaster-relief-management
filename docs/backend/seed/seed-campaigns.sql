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
     'Hỗ trợ khẩn cấp TP. Hồ Chí Minh',
     'Điều phối cứu hộ và nhu yếu phẩm cho các hộ dân tại TP. Hồ Chí Minh.',
     'ACTIVE', interval '3 days', interval '14 days', '{{campaign_creator_id}}'::uuid, interval '3 days', 106.7009::float8, 10.7769::float8, 25000),
    ('00000000-0000-4000-8000-0000000000c4'::uuid,
     'Tiếp tế vùng duyên hải Đà Nẵng',
     'Tiếp nhận nhu cầu sơ tán, nước sạch và lương thực tại Đà Nẵng.',
     'ACTIVE', interval '2 days', interval '21 days', '{{campaign_creator_id}}'::uuid, interval '2 days', 108.2022::float8, 16.0544::float8, 25000),
    ('00000000-0000-4000-8000-0000000000c5'::uuid,
     'Cứu trợ hộ dân Lào Cai',
     'Phối hợp tiếp nhận báo cáo và phân bổ nhu yếu phẩm tại Lào Cai.',
     'ACTIVE', interval '1 day', interval '18 days', '{{campaign_creator_id}}'::uuid, interval '1 day', 103.9710::float8, 22.4856::float8, 25000),
    ('00000000-0000-4000-8000-0000000000c6'::uuid,
     'Nước sạch và nhu yếu phẩm Huế',
     'Đợt tiếp nhận nước sạch đang tạm dừng để rà soát năng lực kho.',
     'PAUSED', interval '12 days', interval '10 days', '{{campaign_creator_id}}'::uuid, interval '12 days', 107.5909::float8, 16.4637::float8, 20000),
    ('00000000-0000-4000-8000-0000000000c7'::uuid,
     'Hỗ trợ sơ tán và an sinh Cần Thơ',
     'Theo dõi nhu cầu sơ tán và phân phối các mặt hàng thiết yếu.',
     'ACTIVE', interval '4 days', interval '24 days', '{{campaign_creator_id}}'::uuid, interval '4 days', 105.7469::float8, 10.0452::float8, 22000),
    ('00000000-0000-4000-8000-0000000000c8'::uuid,
     'Cứu trợ y tế Nghệ An',
     'Tiếp nhận vật tư y tế cho các điểm cứu trợ tại Nghệ An.',
     'PAUSED', interval '10 days', interval '7 days', '{{campaign_creator_id}}'::uuid, interval '10 days', 105.6923::float8, 18.6796::float8, 20000),
    ('00000000-0000-4000-8000-0000000000c9'::uuid,
     'Cứu trợ lũ lụt Quảng Bình',
     'Hỗ trợ sơ tán, nước sạch và lương thực cho các hộ dân vùng ngập tại Quảng Bình.',
     'ACTIVE', interval '5 days', interval '25 days', '{{campaign_creator_id}}'::uuid, interval '5 days', 106.6222::float8, 17.4689::float8, 28000),
    ('00000000-0000-4000-8000-0000000000ca'::uuid,
     'Hỗ trợ bão số Hà Tĩnh',
     'Tiếp nhận báo cáo thiệt hại, hỗ trợ sửa chữa nhà và nhu yếu phẩm tại Hà Tĩnh.',
     'ACTIVE', interval '6 days', interval '20 days', '{{campaign_creator_id}}'::uuid, interval '6 days', 105.9057::float8, 18.3428::float8, 25000),
    ('00000000-0000-4000-8000-0000000000cb'::uuid,
     'Cứu trợ thiên tai Quảng Ngãi',
     'Điều phối lực lượng cứu hộ và vật tư cho các xã bị ảnh hưởng tại Quảng Ngãi.',
     'ACTIVE', interval '3 days', interval '27 days', '{{campaign_creator_id}}'::uuid, interval '3 days', 108.8044::float8, 15.1205::float8, 26000),
    ('00000000-0000-4000-8000-0000000000cc'::uuid,
     'Ứng phó mưa bão Quy Nhơn',
     'Hỗ trợ người dân ven biển Quy Nhơn sơ tán và nhận nhu yếu phẩm thiết yếu.',
     'ACTIVE', interval '2 days', interval '19 days', '{{campaign_creator_id}}'::uuid, interval '2 days', 109.2196::float8, 13.7765::float8, 22000),
    ('00000000-0000-4000-8000-0000000000cd'::uuid,
     'Cứu trợ sạt lở Yên Bái',
     'Theo dõi điểm sạt lở và hỗ trợ các hộ dân vùng núi tại Yên Bái.',
     'PAUSED', interval '9 days', interval '12 days', '{{campaign_creator_id}}'::uuid, interval '9 days', 104.8985::float8, 21.7168::float8, 30000),
    ('00000000-0000-4000-8000-0000000000ce'::uuid,
     'Nước sạch và y tế Thanh Hóa',
     'Đợt tiếp nhận nước sạch và vật tư y tế đang tạm dừng để rà soát nhu cầu tại Thanh Hóa.',
     'PAUSED', interval '11 days', interval '9 days', '{{campaign_creator_id}}'::uuid, interval '11 days', 105.7745::float8, 19.8067::float8, 24000),
    ('00000000-0000-4000-8000-0000000000cf'::uuid,
     'Hỗ trợ sau bão Cà Mau',
     'Chiến dịch hỗ trợ khắc phục hậu quả bão tại Cà Mau đã hoàn tất.',
     'CLOSED', interval '40 days', interval '-5 days', '{{campaign_creator_id}}'::uuid, interval '40 days', 105.15::float8, 9.1769::float8, 25000)
  ) AS fixture(id, name, objective, status, starts_ago, ends_in, created_by_user_id, age, longitude, latitude, radius_m)
 WHERE NOT EXISTS (
   SELECT 1 FROM campaign existing
    WHERE existing.name = fixture.name AND existing.id <> fixture.id
 )
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name,objective=EXCLUDED.objective,status=EXCLUDED.status,
  starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,center=EXCLUDED.center,radius_m=EXCLUDED.radius_m;
