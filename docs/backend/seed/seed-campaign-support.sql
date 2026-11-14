INSERT INTO organization (id, name, organization_kind) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Trung tâm điều phối C48 (demo)', 'COORDINATION'),
  ('00000000-0000-4000-8000-000000000002', 'Hội tình nguyện miền Nam (demo)', 'VOLUNTEER')
ON CONFLICT DO NOTHING;
