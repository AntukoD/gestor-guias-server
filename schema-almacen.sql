-- ============================================================
-- MIGRACIÓN 3: módulo de Almacén
-- Ejecutar en el SQL Editor de Neon (modo "Run", no "Explain").
-- Segura de correr más de una vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS almacenes (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre VARCHAR(150) NOT NULL,
  ubicacion VARCHAR(200),
  responsable VARCHAR(150),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo VARCHAR(50),
  nombre VARCHAR(200) NOT NULL,
  unidad VARCHAR(20) NOT NULL DEFAULT 'unid',       -- unid | m | kg | l | caja...
  categoria VARCHAR(30) NOT NULL DEFAULT 'material', -- material | herramienta | epp | consumible
  stock_minimo_alerta NUMERIC(12,2) NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Stock actual por almacén. Es una "caché" que se actualiza con cada movimiento;
-- la fuente de verdad real es la suma del historial en movimientos_almacen.
CREATE TABLE IF NOT EXISTS stock (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE(almacen_id, producto_id)
);

-- El historial real. Nunca se edita ni se borra una fila de aquí — los errores
-- se corrigen con un movimiento nuevo de tipo "ajuste" con nota explicando el motivo.
CREATE TABLE IF NOT EXISTS movimientos_almacen (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tipo_movimiento VARCHAR(30) NOT NULL,
  -- entrada_compra | salida_guia | salida_epp | baja_dano |
  -- transferencia_salida | transferencia_entrada | ajuste
  cantidad NUMERIC(14,2) NOT NULL,        -- guardado con signo: negativo = salida, positivo = entrada
  cantidad_anterior NUMERIC(14,2) NOT NULL, -- foto del stock justo antes de este movimiento
  costo_unitario NUMERIC(12,2),
  guia_id VARCHAR(80) REFERENCES services(id) ON DELETE SET NULL,  -- nexo con la guía/servicio
  tecnico VARCHAR(150),
  nota TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_almacenes_empresa ON almacenes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_productos_empresa ON productos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_stock_empresa ON stock(empresa_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_empresa ON movimientos_almacen(empresa_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_guia ON movimientos_almacen(guia_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_almacen(created_at);
