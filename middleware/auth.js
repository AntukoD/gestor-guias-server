const jwt = require('jsonwebtoken');

// Verifica el JWT y adjunta userId, empresaId (null para superadmin) y rol a la request
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.empresaId = decoded.empresaId;
    req.rol = decoded.rol;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = authMiddleware;
