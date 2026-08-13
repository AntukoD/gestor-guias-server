-- ============================================================
-- MIGRACIÓN 4: extiende Almacén con conceptos del sistema anterior
-- (personal, tipo de control, ubicación física, almacenes móviles)
-- Ejecutar después de schema-almacen.sql. Segura de correr más de una vez.
-- ============================================================

-- 1) Personal: técnicos/colaboradores que reciben material o EPP.
--    No siempre tienen cuenta en el sistema — por eso es tabla aparte,
--    con vínculo opcional a un usuario si esa persona sí tiene login.
CREATE TABLE IF NOT EXISTS personal (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre VARCHAR(150) NOT NULL,
  costo_hora NUMERIC(10,2),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2) Tipo de control por producto: define el comportamiento de la salida
--    consumo    → sale y no vuelve (material, consumibles)
--    asignacion → se entrega a una persona y queda a su cargo (EPP)
--    devolucion → se presta y se espera que regrese (herramienta eléctrica)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tipo_control VARCHAR(20) NOT NULL DEFAULT 'consumo';

-- 3) Ubicación física por almacén (fila/columna/código tipo "2-B")
--    Va en stock, no en productos, porque el mismo producto puede estar
--    en un lugar distinto según en qué almacén esté.
ALTER TABLE stock ADD COLUMN IF NOT EXISTS fila VARCHAR(10);
ALTER TABLE stock ADD COLUMN IF NOT EXISTS columna VARCHAR(10);
ALTER TABLE stock ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(20);

-- 4) Almacenes fijos vs móviles (cajas de herramientas/EPP que viajan con una persona)
ALTER TABLE almacenes ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) NOT NULL DEFAULT 'fijo'; -- fijo | movil
ALTER TABLE almacenes ADD COLUMN IF NOT EXISTS asignado_a_personal_id INTEGER REFERENCES personal(id) ON DELETE SET NULL;

-- 5) Movimientos: a quién del personal se le entregó, y número de factura (entradas)
ALTER TABLE movimientos_almacen ADD COLUMN IF NOT EXISTS personal_id INTEGER REFERENCES personal(id) ON DELETE SET NULL;
ALTER TABLE movimientos_almacen ADD COLUMN IF NOT EXISTS numero_factura VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_personal_empresa ON personal(empresa_id);
CREATE INDEX IF NOT EXISTS idx_almacenes_tipo ON almacenes(tipo);
CREATE INDEX IF NOT EXISTS idx_movimientos_personal ON movimientos_almacen(personal_id);
