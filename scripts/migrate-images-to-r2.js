// Sube a R2 todas las imágenes que todavía están en base64 dentro de Postgres,
// guarda su URL en la fila y borra el base64 para liberar espacio en Neon.
// Se puede correr varias veces sin problema: solo procesa lo que aún no está migrado.
//
// Uso:
//   node scripts/migrate-images-to-r2.js
//
require('dotenv').config();
const pool = require('../db');
const { subirImagen } = require('../lib/storage');

async function main() {
  const colExiste = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'images' AND column_name = 'data'`
  );
  if (colExiste.rows.length === 0) {
    console.log('La columna "data" ya no existe en la tabla images (fue eliminada). No hay nada que migrar: cualquier imagen que no tuviera "url" antes de eliminarla se perdió y no se puede recuperar desde aquí.');
    process.exit(0);
  }

  const pendientes = await pool.query(
    'SELECT id, service_id, empresa_id, name, data, type FROM images WHERE url IS NULL AND data IS NOT NULL'
  );

  console.log(`Imágenes por migrar: ${pendientes.rows.length}`);
  let ok = 0, fallidas = 0;

  for (const img of pendientes.rows) {
    try {
      const subida = await subirImagen({
        empresaId: img.empresa_id,
        serviceId: img.service_id,
        nombreArchivo: img.name,
        dataUri: img.data
      });
      await pool.query(
        'UPDATE images SET url = $1, r2_key = $2, size_bytes = $3, data = NULL WHERE id = $4',
        [subida.url, subida.key, subida.sizeBytes, img.id]
      );
      ok++;
      console.log(`OK  (${ok}/${pendientes.rows.length}) imagen ${img.id} → ${subida.url}`);
    } catch (err) {
      fallidas++;
      console.error(`FALLÓ imagen ${img.id}:`, err.message);
    }
  }

  console.log(`\nListo. Migradas: ${ok}. Fallidas: ${fallidas}.`);
  process.exit(fallidas > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
