const express = require('express');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { recalcularStats } = require('../lib/stats');
const { registrarAuditoria } = require('../lib/audit');

module.exports = (pool) => {
  const router = express.Router();
  router.use(authMiddleware, requireRole('admin_empresa', 'superadmin'));

  // El superadmin puede pasar ?empresa_id= para ver usuarios de cualquier empresa;
  // el admin_empresa solo ve/gestiona la suya (viene del token, no del query).
  function empresaObjetivo(req) {
    return req.rol === 'superadmin' ? (req.query.empresa_id || req.body.empresaId) : req.empresaId;
  }

  router.get('/', async (req, res) => {
    try {
      const empresaId = empresaObjetivo(req);
      if (!empresaId) return res.status(400).json({ error: 'Falta empresa_id' });
      const result = await pool.query(
        'SELECT id, email, name, rol, modulos_permitidos, estado, created_at FROM users WHERE empresa_id = $1 ORDER BY created_at',
        [empresaId]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const empresaId = empresaObjetivo(req);
      if (!empresaId) return res.status(400).json({ error: 'Falta empresaId' });
      const { email, password, name, rol, modulosPermitidos } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'email y password son obligatorios' });

      // Un admin_empresa no puede crear otro superadmin
      const rolFinal = (req.rol === 'admin_empresa' && rol === 'superadmin') ? 'operador' : (rol || 'operador');
      const hashed = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO users (empresa_id, email, password_hash, name, rol, modulos_permitidos, estado)
         VALUES ($1, $2, $3, $4, $5, $6, 'activo')
         RETURNING id, email, name, rol, modulos_permitidos`,
        [empresaId, email, hashed, name, rolFinal, JSON.stringify(modulosPermitidos || [])]
      );
      await recalcularStats(pool, empresaId);
      await registrarAuditoria(pool, {
        empresaId, userId: req.userId, accion: 'crear', entidad: 'usuario',
        entidadId: result.rows[0].id, detalle: { email, rol: rolFinal }
      });
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(400).json({ error: 'Ese correo ya está registrado' });
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const empresaId = empresaObjetivo(req);
      const { name, rol, modulosPermitidos, estado, password } = req.body;
      const fields = []; const values = []; let i = 1;
      if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
      if (rol !== undefined && !(req.rol === 'admin_empresa' && rol === 'superadmin')) { fields.push(`rol = $${i++}`); values.push(rol); }
      if (modulosPermitidos !== undefined) { fields.push(`modulos_permitidos = $${i++}`); values.push(JSON.stringify(modulosPermitidos)); }
      if (estado !== undefined) { fields.push(`estado = $${i++}`); values.push(estado); }
      if (password) {
        if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        fields.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10));
      }
      if (fields.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

      values.push(req.params.id, empresaId);
      const result = await pool.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${i++} AND empresa_id = $${i} RETURNING id`,
        values
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado en tu empresa' });

      await registrarAuditoria(pool, {
        empresaId, userId: req.userId, accion: 'editar', entidad: 'usuario',
        entidadId: req.params.id, detalle: req.body
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
