const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireModulo } = require('../middleware/roles');
const { aplicarMovimiento } = require('../lib/almacen');
const { registrarAuditoria } = require('../lib/audit');

module.exports = (pool) => {
  const router = express.Router();
  router.use(authMiddleware);
  router.use(requireModulo(pool, 'almacen'));

  // ---- Almacenes ----
  router.get('/almacenes', async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM almacenes WHERE empresa_id = $1 ORDER BY nombre', [req.empresaId]);
      res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/almacenes', async (req, res) => {
    try {
      const { nombre, ubicacion, responsable } = req.body;
      if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
      const r = await pool.query(
        'INSERT INTO almacenes (empresa_id, nombre, ubicacion, responsable) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.empresaId, nombre, ubicacion || null, responsable || null]
      );
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'crear', entidad: 'almacen', entidadId: r.rows[0].id, detalle: { nombre } });
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.patch('/almacenes/:id', async (req, res) => {
    try {
      const { nombre, ubicacion, responsable, activo } = req.body;
      const fields = []; const values = []; let i = 1;
      if (nombre !== undefined) { fields.push(`nombre = $${i++}`); values.push(nombre); }
      if (ubicacion !== undefined) { fields.push(`ubicacion = $${i++}`); values.push(ubicacion); }
      if (responsable !== undefined) { fields.push(`responsable = $${i++}`); values.push(responsable); }
      if (activo !== undefined) { fields.push(`activo = $${i++}`); values.push(activo); }
      if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id, req.empresaId);
      await pool.query(`UPDATE almacenes SET ${fields.join(', ')} WHERE id = $${i++} AND empresa_id = $${i}`, values);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ---- Productos (catálogo) ----
  router.get('/productos', async (req, res) => {
    try {
      const { categoria, q } = req.query;
      const conds = ['empresa_id = $1']; const vals = [req.empresaId]; let i = 2;
      if (categoria) { conds.push(`categoria = $${i++}`); vals.push(categoria); }
      if (q) { conds.push(`(nombre ILIKE $${i} OR codigo ILIKE $${i})`); vals.push(`%${q}%`); i++; }
      const r = await pool.query(`SELECT * FROM productos WHERE ${conds.join(' AND ')} ORDER BY nombre`, vals);
      res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/productos', async (req, res) => {
    try {
      const { codigo, nombre, unidad, categoria, stockMinimoAlerta } = req.body;
      if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
      const r = await pool.query(
        `INSERT INTO productos (empresa_id, codigo, nombre, unidad, categoria, stock_minimo_alerta)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.empresaId, codigo || null, nombre, unidad || 'unid', categoria || 'material', stockMinimoAlerta || 0]
      );
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'crear', entidad: 'producto', entidadId: r.rows[0].id, detalle: { nombre } });
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.patch('/productos/:id', async (req, res) => {
    try {
      const { codigo, nombre, unidad, categoria, stockMinimoAlerta, activo } = req.body;
      const fields = []; const values = []; let i = 1;
      if (codigo !== undefined) { fields.push(`codigo = $${i++}`); values.push(codigo); }
      if (nombre !== undefined) { fields.push(`nombre = $${i++}`); values.push(nombre); }
      if (unidad !== undefined) { fields.push(`unidad = $${i++}`); values.push(unidad); }
      if (categoria !== undefined) { fields.push(`categoria = $${i++}`); values.push(categoria); }
      if (stockMinimoAlerta !== undefined) { fields.push(`stock_minimo_alerta = $${i++}`); values.push(stockMinimoAlerta); }
      if (activo !== undefined) { fields.push(`activo = $${i++}`); values.push(activo); }
      if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id, req.empresaId);
      await pool.query(`UPDATE productos SET ${fields.join(', ')} WHERE id = $${i++} AND empresa_id = $${i}`, values);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ---- Stock (vista combinada producto × almacén) ----
  router.get('/stock', async (req, res) => {
    try {
      const { almacen_id, categoria, bajo_minimo } = req.query;
      const conds = ['p.empresa_id = $1', 'p.activo = true', 'a.activo = true'];
      const vals = [req.empresaId]; let i = 2;
      if (almacen_id) { conds.push(`a.id = $${i++}`); vals.push(almacen_id); }
      if (categoria) { conds.push(`p.categoria = $${i++}`); vals.push(categoria); }
      const having = bajo_minimo === 'true' ? 'HAVING COALESCE(s.cantidad,0) < p.stock_minimo_alerta' : '';

      const r = await pool.query(`
        SELECT p.id as producto_id, p.codigo, p.nombre, p.unidad, p.categoria, p.stock_minimo_alerta,
               a.id as almacen_id, a.nombre as almacen_nombre,
               COALESCE(s.cantidad, 0) as cantidad
        FROM productos p
        CROSS JOIN almacenes a
        LEFT JOIN stock s ON s.producto_id = p.id AND s.almacen_id = a.id
        WHERE ${conds.join(' AND ')} AND a.empresa_id = p.empresa_id
        ${having}
        ORDER BY p.nombre, a.nombre
      `, vals);
      res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ---- Movimientos ----
  router.post('/movimientos', async (req, res) => {
    const client = await pool.connect();
    try {
      const { almacenId, productoId, tipoMovimiento, cantidad, costoUnitario, guiaId, tecnico, nota } = req.body;
      if (!almacenId || !productoId || !tipoMovimiento || cantidad === undefined) {
        return res.status(400).json({ error: 'almacenId, productoId, tipoMovimiento y cantidad son obligatorios' });
      }
      await client.query('BEGIN');
      const { movimiento, stockNuevo } = await aplicarMovimiento(client, {
        empresaId: req.empresaId, almacenId, productoId, tipoMovimiento,
        cantidad: Number(cantidad), costoUnitario, guiaId: guiaId || null, tecnico, nota, userId: req.userId
      });
      await client.query('COMMIT');
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'crear', entidad: 'movimiento_almacen', entidadId: movimiento.id, detalle: { tipoMovimiento, cantidad } });
      res.json({ movimiento, stockNuevo });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // Transferencia entre almacenes: registra las dos puntas (salida + entrada) de forma atómica
  router.post('/movimientos/transferencia', async (req, res) => {
    const client = await pool.connect();
    try {
      const { almacenOrigenId, almacenDestinoId, productoId, cantidad, tecnico, nota } = req.body;
      if (!almacenOrigenId || !almacenDestinoId || !productoId || !cantidad) {
        return res.status(400).json({ error: 'Faltan datos de la transferencia' });
      }
      if (String(almacenOrigenId) === String(almacenDestinoId)) {
        return res.status(400).json({ error: 'El almacén de origen y destino no pueden ser el mismo' });
      }

      await client.query('BEGIN');
      const salida = await aplicarMovimiento(client, {
        empresaId: req.empresaId, almacenId: almacenOrigenId, productoId,
        tipoMovimiento: 'transferencia_salida', cantidad: Number(cantidad), tecnico, nota, userId: req.userId
      });
      const entrada = await aplicarMovimiento(client, {
        empresaId: req.empresaId, almacenId: almacenDestinoId, productoId,
        tipoMovimiento: 'transferencia_entrada', cantidad: Number(cantidad), tecnico, nota, userId: req.userId
      });
      await client.query('COMMIT');
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'crear', entidad: 'transferencia_almacen', detalle: { almacenOrigenId, almacenDestinoId, productoId, cantidad } });
      res.json({ salida: salida.movimiento, entrada: entrada.movimiento });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  router.get('/movimientos', async (req, res) => {
    try {
      const { almacen_id, producto_id, tipo_movimiento, desde, hasta, guia_id } = req.query;
      const conds = ['m.empresa_id = $1']; const vals = [req.empresaId]; let i = 2;
      if (almacen_id) { conds.push(`m.almacen_id = $${i++}`); vals.push(almacen_id); }
      if (producto_id) { conds.push(`m.producto_id = $${i++}`); vals.push(producto_id); }
      if (tipo_movimiento) { conds.push(`m.tipo_movimiento = $${i++}`); vals.push(tipo_movimiento); }
      if (guia_id) { conds.push(`m.guia_id = $${i++}`); vals.push(guia_id); }
      if (desde) { conds.push(`m.created_at >= $${i++}`); vals.push(desde); }
      if (hasta) { conds.push(`m.created_at <= $${i++}`); vals.push(hasta); }

      const r = await pool.query(`
        SELECT m.*, p.nombre as producto_nombre, p.unidad, a.nombre as almacen_nombre, u.email as usuario_email
        FROM movimientos_almacen m
        JOIN productos p ON p.id = m.producto_id
        JOIN almacenes a ON a.id = m.almacen_id
        LEFT JOIN users u ON u.id = m.created_by
        WHERE ${conds.join(' AND ')}
        ORDER BY m.created_at DESC
        LIMIT 300
      `, vals);
      res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Materiales consumidos por una guía específica — para mostrar en el detalle de la guía
  router.get('/guias/:guiaId/materiales', async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT m.*, p.nombre as producto_nombre, p.unidad, a.nombre as almacen_nombre
        FROM movimientos_almacen m
        JOIN productos p ON p.id = m.producto_id
        JOIN almacenes a ON a.id = m.almacen_id
        WHERE m.empresa_id = $1 AND m.guia_id = $2 AND m.tipo_movimiento = 'salida_guia'
        ORDER BY m.created_at DESC
      `, [req.empresaId, req.params.guiaId]);
      const costoTotal = r.rows.reduce((sum, m) => sum + (Number(m.costo_unitario || 0) * Math.abs(Number(m.cantidad))), 0);
      res.json({ materiales: r.rows, costoTotal });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
