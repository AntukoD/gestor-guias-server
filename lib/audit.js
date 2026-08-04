// Registra una línea de auditoría. Nunca debe tumbar la petición principal si falla,
// por eso solo loguea el error en vez de propagarlo.
async function registrarAuditoria(pool, { empresaId, userId, accion, entidad, entidadId, detalle }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (empresa_id, user_id, accion, entidad, entidad_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [empresaId || null, userId || null, accion, entidad, entidadId ? String(entidadId) : null, detalle ? JSON.stringify(detalle) : null]
    );
  } catch (err) {
    console.error('No se pudo registrar auditoría:', err.message);
  }
}

module.exports = { registrarAuditoria };
