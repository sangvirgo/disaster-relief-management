INSERT INTO region (code, name) VALUES
  ('DEMO_A', 'Khu vực Nam (demo)'),
  ('DEMO_B', 'Khu vực Trung (demo)')
ON CONFLICT DO NOTHING;

INSERT INTO organization (id, name, organization_kind) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Trung tâm điều phối C48 (demo)', 'COORDINATION')
ON CONFLICT DO NOTHING;
