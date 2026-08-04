// Crea el primer usuario superadmin. Se corre UNA vez, desde tu máquina o desde
// el shell de Render, nunca vía HTTP (por seguridad no existe un endpoint para esto).
//
// Uso:
//   SUPERADMIN_EMAIL=tucorreo@yafra.com SUPERADMIN_PASSWORD=algo-fuerte node scripts/seed-superadmin.js
//
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db');

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  const name = process.env.SUPERADMIN_NAME || 'Super Admin';

  if (!email || !password) {
    console.error('Define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD como variables de entorno antes de correr este script.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Usa una contraseña de al menos 8 caracteres.');
    process.exit(1);
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    console.log('Ya existe un usuario con ese correo. No se creó nada.');
    process.exit(0);
  }

  const hashed = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (empresa_id, email, password_hash, name, rol, modulos_permitidos, estado)
     VALUES (NULL, $1, $2, $3, 'superadmin', '[]', 'activo')`,
    [email, hashed, name]
  );
  console.log(`Superadmin creado correctamente: ${email}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
