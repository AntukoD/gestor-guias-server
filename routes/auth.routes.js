const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth');
const { registrarAuditoria } = require('../lib/audit');

module.exports = (pool) => {
  const router = express.Router();

  // NOTA: ya no existe /api/auth/register público. Crear cuentas es responsabilidad
  // del superadmin (POST /api/superadmin/empresas) o del admin de cada empresa
  // (POST /api/usuarios). Esto cierra el hueco de "cualquiera se registra y entra".

  // Devuelve los datos actualizados del usuario actual (rol, módulos)
  // El frontend lo llama al arrancar para asegurarse de que los módulos estén al día
  // aunque no haya hecho logout desde el último cambio del admin.
  router.get('/me', authMiddleware, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, email, name, rol, modulos_permitidos, empresa_id FROM users WHERE id = $1 AND estado = $2',
        [req.userId, 'activo']
      );
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
      res.json({
        id: user.id, email: user.email, name: user.name,
        rol: user.rol, modulosPermitidos: user.modulos_permitidos
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña requeridos' });

      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0];
      if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });
      if (user.estado !== 'activo') return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta a tu administrador.' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(400).json({ error: 'Contraseña incorrecta' });

      let empresa = null;
      if (user.empresa_id) {
        const empresaRes = await pool.query(
          'SELECT id, nombre, estado, modulos_habilitados FROM empresas WHERE id = $1',
          [user.empresa_id]
        );
        empresa = empresaRes.rows[0];
        if (!empresa) return res.status(403).json({ error: 'Tu empresa ya no existe' });
        if (empresa.estado !== 'activa') return res.status(403).json({ error: 'Tu empresa está suspendida. Contacta al administrador.' });
      }

      const token = jwt.sign(
        { userId: user.id, empresaId: user.empresa_id, rol: user.rol },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      await registrarAuditoria(pool, {
        empresaId: user.empresa_id, userId: user.id, accion: 'login', entidad: 'usuario', entidadId: user.id
      });

      res.json({
        token,
        user: {
          id: user.id, email: user.email, name: user.name,
          rol: user.rol, modulosPermitidos: user.modulos_permitidos
        },
        empresa: empresa ? { id: empresa.id, nombre: empresa.nombre, modulosHabilitados: empresa.modulos_habilitados } : null
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
