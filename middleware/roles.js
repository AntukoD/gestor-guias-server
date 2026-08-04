// Restringe una ruta a una lista de roles permitidos
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

function requireSuperadmin(req, res, next) {
  if (req.rol !== 'superadmin') return res.status(403).json({ error: 'Solo el superadministrador puede hacer esto' });
  next();
}

// Verifica en tiempo real (no solo en el token) que:
// 1. La empresa esté activa y tenga el módulo habilitado
// 2. El usuario tenga acceso a ese módulo específico
// Así, si un admin le quita acceso a alguien, se aplica en su siguiente petición,
// sin esperar a que expire el token de 7 días.
function requireModulo(pool, modulo) {
  return async (req, res, next) => {
    if (req.rol === 'superadmin') return next();
    try {
      const empresaRes = await pool.query(
        'SELECT modulos_habilitados, estado FROM empresas WHERE id = $1',
        [req.empresaId]
      );
      const empresa = empresaRes.rows[0];
      if (!empresa) return res.status(403).json({ error: 'Empresa no encontrada' });
      if (empresa.estado !== 'activa') return res.status(403).json({ error: 'Tu empresa está suspendida' });
      if (!empresa.modulos_habilitados.includes(modulo)) {
        return res.status(403).json({ error: `Tu empresa no tiene habilitado el módulo "${modulo}"` });
      }

      const userRes = await pool.query('SELECT modulos_permitidos, estado FROM users WHERE id = $1', [req.userId]);
      const user = userRes.rows[0];
      if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
      if (user.estado !== 'activo') return res.status(403).json({ error: 'Tu cuenta está desactivada' });
      if (!user.modulos_permitidos.includes(modulo)) {
        return res.status(403).json({ error: `No tienes acceso al módulo "${modulo}"` });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requireRole, requireSuperadmin, requireModulo };
