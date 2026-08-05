const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireModulo } = require('../middleware/roles');
const { recalcularStats } = require('../lib/stats');
const { registrarAuditoria } = require('../lib/audit');
const { subirImagen, borrarImagen } = require('../lib/storage');

// Compara las imágenes que llegan del formulario contra las que ya existen en la BD:
// - las que traen una URL (empiezan con "http") ya están en R2 → se conservan tal cual
// - las que traen un data URI (empiezan con "data:") son nuevas → se suben a R2
// - las que existían en la BD pero ya no vienen en el payload → se borran (BD + R2)
async function sincronizarImagenes(client, { empresaId, serviceId, payloadImages }) {
  const existentesRes = await client.query(
    'SELECT id, r2_key FROM images WHERE service_id = $1 AND empresa_id = $2',
    [serviceId, empresaId]
  );
  const existentes = existentesRes.rows;
  const idsAConservar = new Set(
    payloadImages.filter(img => typeof img.data === 'string' && img.data.startsWith('http')).map(img => img.id)
  );

  const aBorrar = existentes.filter(e => !idsAConservar.has(e.id));
  for (const img of aBorrar) {
    await client.query('DELETE FROM images WHERE id = $1', [img.id]);
  }

  const aSubir = payloadImages.filter(img => typeof img.data === 'string' && img.data.startsWith('data:'));
  for (const img of aSubir) {
    const subida = await subirImagen({ empresaId, serviceId, nombreArchivo: img.name, dataUri: img.data });
    await client.query(
      'INSERT INTO images (service_id, empresa_id, name, url, r2_key, type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [serviceId, empresaId, img.name, subida.url, subida.key, img.type, subida.sizeBytes]
    );
  }

  return { keysABorrarDeR2: aBorrar.map(e => e.r2_key).filter(Boolean) };
}

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
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', im.id, 'name', im.name, 'data', COALESCE(im.url, im.data), 'type', im.type)) FILTER (WHERE im.id IS NOT NULL), '[]') as images
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
      await sincronizarImagenes(client, { empresaId: req.empresaId, serviceId: id, payloadImages: allImages });

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

      const allImages = [...(hojas || []).map(h => ({ ...h, type: 'hoja' })), ...(fotos || []).map(f => ({ ...f, type: 'foto' }))];
      const { keysABorrarDeR2 } = await sincronizarImagenes(client, { empresaId: req.empresaId, serviceId: req.params.id, payloadImages: allImages });

      await client.query('COMMIT');
      for (const key of keysABorrarDeR2) await borrarImagen(key); // best-effort, fuera de la transacción
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
      const imgsRes = await pool.query('SELECT r2_key FROM images WHERE service_id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
      await pool.query('DELETE FROM items WHERE service_id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
      await pool.query('DELETE FROM images WHERE service_id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
      const del = await pool.query('DELETE FROM services WHERE id = $1 AND empresa_id = $2', [req.params.id, req.empresaId]);
      if (del.rowCount === 0) return res.status(404).json({ error: 'Servicio no encontrado' });

      for (const row of imgsRes.rows) await borrarImagen(row.r2_key); // best-effort
      await recalcularStats(pool, req.empresaId);
      await registrarAuditoria(pool, { empresaId: req.empresaId, userId: req.userId, accion: 'eliminar', entidad: 'servicio', entidadId: req.params.id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
