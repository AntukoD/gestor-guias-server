const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireModulo } = require('../middleware/roles');
const { recalcularStats } = require('../lib/stats');
const { registrarAuditoria } = require('../lib/audit');

module.exports = (pool) => {
  const router = express.Router();
  router.use(authMiddleware);
  router.use(requireModulo(pool, 'guias'));

  // ---- Estados ----
  router.get('/statuses', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, icon, color, display_order as order FROM statuses WHERE empresa_id = $1 ORDER BY display_order',
        [req.empresaId]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/statuses', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { statuses } = req.body;
      await client.query('DELETE FROM statuses WHERE empresa_id = $1', [req.empresaId]);
      for (const st of statuses) {
        await client.query(
          'INSERT INTO statuses (id, name, icon, color, display_order, empresa_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [st.id, st.name, st.icon, st.color, st.order, req.empresaId]
        );
      }
      await client.query('COMMIT');
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'editar', entidad: 'estados' });
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ---- Servicios ----
  router.get('/services', async (req, res) => {
    try {
      const servicesResult = await pool.query(
        `SELECT s.*,
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity)) FILTER (WHERE i.id IS NOT NULL), '[]') as items,
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', im.id, 'name', im.name, 'data', im.data, 'type', im.type)) FILTER (WHERE im.id IS NOT NULL), '[]') as images
        FROM services s
        LEFT JOIN items i ON i.service_id = s.id
        LEFT JOIN images im ON im.service_id = s.id
        WHERE s.empresa_id = $1
        GROUP BY s.id
        ORDER BY s.updated_at DESC`,
        [req.empresaId]
      );

      const services = servicesResult.rows.map(row => ({
        ...row,
        status: row.status_id,
        hojas: row.images.filter(img => img.type === 'hoja'),
        fotos: row.images.filter(img => img.type === 'foto'),
        esMuestra: row.es_muestra,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime()
      }));

      res.json(services);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/services', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { id, name, client: clientName, status, ref, cotizacion, oc, notes, esMuestra, items, hojas, fotos } = req.body;

      await client.query(
        `INSERT INTO services (id, empresa_id, created_by, user_id, name, client, status_id, ref, cotizacion, oc, notes, es_muestra, created_at, updated_at)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
        [id, req.empresaId, req.userId, name, clientName, status, ref, cotizacion, oc, notes, esMuestra]
      );

      if (items && items.length) {
        for (const item of items) {
          await client.query(
            'INSERT INTO items (service_id, empresa_id, name, quantity) VALUES ($1,$2,$3,$4)',
            [id, req.empresaId, item.name, item.quantity]
          );
        }
      }

      const allImages = [...(hojas || []).map(h => ({ ...h, type: 'hoja' })), ...(fotos || []).map(f => ({ ...f, type: 'foto' }))];
      for (const img of allImages) {
        const sizeBytes = Buffer.byteLength(img.data || '', 'utf8');
        await client.query(
          'INSERT INTO images (service_id, empresa_id, name, data, type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, req.empresaId, img.name, img.data, img.type, sizeBytes]
        );
      }

      await client.query('COMMIT');
      await recalcularStats(pool, req.empresaId);
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'crear', entidad: 'servicio', entidadId: id, detalle: { name } });
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  router.put('/services/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { name, client: clientName, status, ref, cotizacion, oc, notes, esMuestra, items, hojas, fotos } = req.body;

      const upd = await client.query(
        `UPDATE services SET name=$1, client=$2, status_id=$3, ref=$4, cotizacion=$5, oc=$6, notes=$7, es_muestra=$8, updated_at=NOW()
         WHERE id=$9 AND empresa_id=$10`,
        [name, clientName, status, ref, cotizacion, oc, notes, esMuestra, req.params.id, req.empresaId]
      );
      if (upd.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Servicio no encontrado' }); }

      await client.query('DELETE FROM items WHERE service_id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
      if (items && items.length) {
        for (const item of items) {
          await client.query(
            'INSERT INTO items (service_id, empresa_id, name, quantity) VALUES ($1,$2,$3,$4)',
            [req.params.id, req.empresaId, item.name, item.quantity]
          );
        }
      }

      await client.query('DELETE FROM images WHERE service_id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
      const allImages = [...(hojas || []).map(h => ({ ...h, type: 'hoja' })), ...(fotos || []).map(f => ({ ...f, type: 'foto' }))];
      for (const img of allImages) {
        const sizeBytes = Buffer.byteLength(img.data || '', 'utf8');
        await client.query(
          'INSERT INTO images (service_id, empresa_id, name, data, type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.id, req.empresaId, img.name, img.data, img.type, sizeBytes]
        );
      }

      await client.query('COMMIT');
      await recalcularStats(pool, req.empresaId);
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'editar', entidad: 'servicio', entidadId: req.params.id, detalle: { name } });
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  router.delete('/services/:id', async (req, res) => {
    try {
      const del = await pool.query('DELETE FROM services WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
      if (del.rowCount === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
      await recalcularStats(pool, req.empresaId);
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'eliminar', entidad: 'servicio', entidadId: req.params.id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
