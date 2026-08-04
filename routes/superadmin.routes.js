const express = require('express');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/auth');
const { requireSuperadmin } = require('../middleware/roles');
const { recalcularStats } = require('../lib/stats');
const { registrarAuditoria } = require('../lib/audit');

const DEFAULT_STATUSES = [
  { name: 'Pendiente', icon: '⏳', color: '#ea580c', order: 0 },
  { name: 'En Proceso', icon: '🔄', color: '#2563eb', order: 1 },
  { name: 'Completado', icon: '✅', color: '#16a34a', order: 2 },
  { name: 'Cancelado', icon: '❌', color: '#dc2626', order: 3 }
];

module.exports = (pool) => {
  const router = express.Router();
  router.use(authMiddleware, requireSuperadmin);

  // Listado de empresas con su consumo actual
  router.get('/empresas', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT e.*,
          COALESCE(s.bytes_db_estimados, 0) as bytes_db_estimados,
          COALESCE(s.bytes_r2_usados, 0) as bytes_r2_usados,
          COALESCE(s.cantidad_servicios, 0) as cantidad_servicios,
          COALESCE(s.cantidad_usuarios, 0) as cantidad_usuarios,
          COALESCE(s.cantidad_imagenes, 0) as cantidad_imagenes,
          s.actualizado_en
        FROM empresas e
        LEFT JOIN empresa_stats s ON s.empresa_id = e.id
        ORDER BY e.created_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Crear empresa nueva + su primer usuario admin
  router.post('/empresas', async (req, res) => {
    const client = await pool.connect();
    try {
      const { nombre, ruc, modulosHabilitados, adminEmail, adminPassword, adminName } = req.body;
      if (!nombre || !adminEmail || !adminPassword) {
        return res.status(400).json({ error: 'nombre, adminEmail y adminPassword son obligatorios' });
      }
      const modulos = modulosHabilitados && modulosHabilitados.length ? modulosHabilitados : ['guias'];

      await client.query('BEGIN');
      const empresaRes = await client.query(
        `INSERT INTO empresas (nombre, ruc, modulos_habilitados) VALUES ($1, $2, $3) RETURNING *`,
        [nombre, ruc || null, JSON.stringify(modulos)]
      );
      const empresa = empresaRes.rows[0];

      const hashed = await bcrypt.hash(adminPassword, 10);
      const userRes = await client.query(
        `INSERT INTO users (empresa_id, email, password_hash, name, rol, modulos_permitidos, estado)
         VALUES ($1, $2, $3, $4, 'admin_empresa', $5, 'activo') RETURNING id, email, name`,
        [empresa.id, adminEmail, hashed, adminName || 'Administrador', JSON.stringify(modulos)]
      );

      // Estados por defecto del módulo de guías, ya listos para la nueva empresa
      for (const st of DEFAULT_STATUSES) {
        const id = `status_${st.name.toLowerCase().replace(/\s+/g, '_')}_${empresa.id}`;
        await client.query(
          'INSERT INTO statuses (id, name, icon, color, display_order, empresa_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, st.name, st.icon, st.color, st.order, empresa.id]
        );
      }

      await client.query('COMMIT');
      await recalcularStats(pool, empresa.id);
      await registrarAuditoria(pool, {
        empresaId: empresa.id, userId: req.userId, accion: 'crear', entidad: 'empresa',
        entidadId: empresa.id, detalle: { nombre, adminEmail: userRes.rows[0].email }
      });

      res.json({ empresa, admin: userRes.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(400).json({ error: 'Ese correo de administrador ya está registrado' });
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // Activar/suspender, cambiar plan, límite de almacenamiento o módulos habilitados
  router.patch('/empresas/:id', async (req, res) => {
    try {
      const { estado, plan, limiteAlmacenamientoMb, modulosHabilitados } = req.body;
      const fields = []; const values = []; let i = 1;
      if (estado !== undefined) { fields.push(`estado = $${i++}`); values.push(estado); }
      if (plan !== undefined) { fields.push(`plan = $${i++}`); values.push(plan); }
      if (limiteAlmacenamientoMb !== undefined) { fields.push(`limite_almacenamiento_mb = $${i++}`); values.push(limiteAlmacenamientoMb); }
      if (modulosHabilitados !== undefined) { fields.push(`modulos_habilitados = $${i++}`); values.push(JSON.stringify(modulosHabilitados)); }
      if (fields.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id);

      await pool.query(`UPDATE empresas SET ${fields.join(', ')} WHERE id = $${i}`, values);
      await registrarAuditoria(pool, {
        empresaId: req.params.id, userId: req.userId, accion: 'editar', entidad: 'empresa',
        entidadId: req.params.id, detalle: req.body
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Forzar recálculo de estadísticas de una empresa (útil tras una migración o import)
  router.post('/empresas/:id/recalcular-stats', async (req, res) => {
    try {
      await recalcularStats(pool, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Resumen global: para vigilar cuánto te falta para los límites gratuitos de Neon/R2
  router.get('/resumen', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(e.id) as total_empresas,
          COALESCE(SUM(s.bytes_db_estimados), 0) as total_bytes_db,
          COALESCE(SUM(s.bytes_r2_usados), 0) as total_bytes_r2,
          COALESCE(SUM(s.cantidad_usuarios), 0) as total_usuarios,
          COALESCE(SUM(s.cantidad_servicios), 0) as total_servicios
        FROM empresas e LEFT JOIN empresa_stats s ON s.empresa_id = e.id
      `);
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auditoría global (todas las empresas) — filtrable por empresa con ?empresa_id=
  router.get('/auditoria', async (req, res) => {
    try {
      const { empresa_id } = req.query;
      const params = [];
      let where = '';
      if (empresa_id) { params.push(empresa_id); where = 'WHERE a.empresa_id = $1'; }
      const result = await pool.query(
        `SELECT a.*, u.email as usuario_email, e.nombre as empresa_nombre
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN empresas e ON e.id = a.empresa_id
         ${where}
         ORDER BY a.created_at DESC LIMIT 200`,
        params
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
