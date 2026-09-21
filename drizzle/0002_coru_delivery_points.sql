-- Seed the current Personal delivery points. The legacy placeholder is
-- replaced only when it still has its original address.
INSERT INTO personal_delivery_points (id, name, address, short_description, latitude, longitude, schedule_text, is_active, sort_order, created_at, updated_at)
VALUES ('coru-punto-central', 'C.C. El Gran Ruby', 'M9QP+73M C.C El Gran Ruby, Maracaibo 4002, Zulia, Venezuela', 'Entrega personal · confirma por WhatsApp.', 10.6882025, -71.614846875, NULL, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address, short_description = excluded.short_description, latitude = excluded.latitude, longitude = excluded.longitude, schedule_text = excluded.schedule_text, is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = excluded.updated_at
WHERE personal_delivery_points.address = 'Punto coordinado por CORU';

INSERT INTO personal_delivery_points (id, name, address, short_description, latitude, longitude, schedule_text, is_active, sort_order, created_at, updated_at)
VALUES ('coru-la-paragua', 'Centro Comercial La Paragua', 'M9VG+2W4, Maracaibo 4002, Zulia, Venezuela', 'Entrega personal · confirma por WhatsApp.', 10.6925025, -71.622696875, NULL, 1, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

INSERT INTO personal_delivery_points (id, name, address, short_description, latitude, longitude, schedule_text, is_active, sort_order, created_at, updated_at)
VALUES ('coru-la-campana', 'C.C. La Campana', 'C.C La Campana, Av. 12, Maracaibo 4002, Zulia, Venezuela', 'Entrega personal · confirma por WhatsApp.', 10.6900659, -71.618214, NULL, 1, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;
