// Recalcula y guarda el consumo de una empresa. Se llama después de crear/editar/borrar
// datos, no en cada lectura del panel (así el panel de superadmin solo lee un número ya calculado).
async function recalcularStats(pool, empresaId) {
  const servicios = await pool.query('SELECT COUNT(*) FROM services WHERE empresa_id = $1', [empresaId]);
  const usuarios = await pool.query('SELECT COUNT(*) FROM users WHERE empresa_id = $1', [empresaId]);
  const imagenes = await pool.query(
    'SELECT COUNT(*) as cantidad, COALESCE(SUM(size_bytes), 0) as bytes FROM images WHERE empresa_id = $1',
    [empresaId]
  );
  // Estimado del tamaño real que ocupan los registros de esta empresa en Postgres
  const textoBytes = await pool.query(
    `SELECT COALESCE(SUM(pg_column_size(s.*)), 0) as bytes FROM services s WHERE s.empresa_id = $1`,
    [empresaId]
  );

  await pool.query(
    `INSERT INTO empresa_stats (empresa_id, bytes_db_estimados, bytes_r2_usados, cantidad_servicios, cantidad_usuarios, cantidad_imagenes, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (empresa_id) DO UPDATE SET
       bytes_db_estimados = EXCLUDED.bytes_db_estimados,
       bytes_r2_usados = EXCLUDED.bytes_r2_usados,
       cantidad_servicios = EXCLUDED.cantidad_servicios,
       cantidad_usuarios = EXCLUDED.cantidad_usuarios,
       cantidad_imagenes = EXCLUDED.cantidad_imagenes,
       actualizado_en = NOW()`,
    [
      empresaId,
      Number(textoBytes.rows[0].bytes) + Number(imagenes.rows[0].bytes), // mientras las imágenes vivan en Postgres, cuentan aquí
      0, // se llenará cuando migremos las imágenes a Cloudflare R2
      Number(servicios.rows[0].count),
      Number(usuarios.rows[0].count),
      Number(imagenes.rows[0].cantidad)
    ]
  );
}

module.exports = { recalcularStats };
