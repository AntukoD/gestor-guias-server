-- ============================================================
-- MIGRACIÓN 5: foto de producto + ajustes de almacén
-- Ejecutar después de schema-almacen-v2.sql. Segura de correr más de una vez.
-- ============================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS foto_url TEXT;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS foto_r2_key TEXT;
