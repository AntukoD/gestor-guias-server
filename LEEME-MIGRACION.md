# Cómo aplicar esta actualización (multi-empresa + roles + auditoría)

## 1. Base de datos (Neon)
Abre el **SQL Editor** de tu proyecto en Neon y ejecuta todo el contenido de `schema.sql`.
Es seguro: usa `IF NOT EXISTS` y `ON CONFLICT`, así que no borra nada de lo que ya tienes.

Qué hace automáticamente:
- Crea la tabla `empresas` y mete una empresa por defecto: **"Maquindustrias Yafra S.A.C."**
- Todos tus usuarios y servicios actuales quedan asignados a esa empresa
- Los usuarios que ya existían quedan con rol `admin_empresa` (van a poder seguir usando el sistema igual que antes)
- Crea `empresa_stats` y `audit_log`

## 2. Backend
Reemplaza tu carpeta del repo `gestor-guias-server` con estos archivos (mantén el `.env` que ya tienes, no lo pises).

Estructura nueva:
```
gestor-guias-server/
├── index.js
├── db.js
├── package.json
├── middleware/
│   ├── auth.js
│   └── roles.js
├── lib/
│   ├── audit.js
│   └── stats.js
├── routes/
│   ├── auth.routes.js
│   ├── superadmin.routes.js
│   ├── usuarios.routes.js
│   └── services.routes.js
└── scripts/
    └── seed-superadmin.js
```

Sube esto a GitHub → Render redeploya solo. Render va a correr `npm install` y va a instalar la
nueva dependencia `express-rate-limit` automáticamente.

## 3. Crear tu usuario superadmin (una sola vez)
El registro público ya no existe — por seguridad, el primer superadmin se crea desde la terminal,
no desde un endpoint web. Dos formas:

**Opción A — desde tu computadora**, apuntando a la base de Neon (usa el mismo `DATABASE_URL` de tu `.env`):
```bash
cd gestor-guias-server
npm install
SUPERADMIN_EMAIL=tucorreo@yafra.com SUPERADMIN_PASSWORD=una-clave-fuerte node scripts/seed-superadmin.js
```

**Opción B — desde el Shell de Render** (pestaña "Shell" de tu servicio en el dashboard de Render):
```bash
SUPERADMIN_EMAIL=tucorreo@yafra.com SUPERADMIN_PASSWORD=una-clave-fuerte npm run seed:superadmin
```

## 4. (Opcional pero recomendado) Restringir CORS
En las variables de entorno de Render, agrega:
```
ALLOWED_ORIGINS=https://tu-dominio-del-frontend.com
```
Si lo dejas vacío, la API sigue aceptando peticiones de cualquier origen (como antes).

## 5. Cloudflare R2 (imágenes y archivos)

**a) Crea el bucket en Cloudflare:**
1. Dashboard de Cloudflare → R2 → "Create bucket" → nómbralo, por ejemplo, `gestor-guias-archivos`
2. En el bucket → Settings → "Public Access" → habilita el acceso público (te da un dominio tipo `pub-xxxxx.r2.dev`) o conecta tu propio dominio
3. Cloudflare → "Manage R2 API Tokens" → crea un token con permisos de lectura/escritura sobre ese bucket → copia el Account ID, Access Key ID y Secret Access Key

**b) Variables de entorno en Render** (usa `.env.example` como referencia):
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=gestor-guias-archivos
R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev
```

**c) Aplica la migración SQL de R2** en el SQL Editor de Neon:
```
schema-r2.sql
```
(agrega las columnas `url` y `r2_key` a la tabla `images`; segura de correr más de una vez)

**d) Migra las imágenes que ya tienes guardadas como base64** (opcional pero muy recomendable —
libera espacio en Neon de inmediato):
```bash
npm run migrate:images-r2
```
Puedes correrlo varias veces sin problema; solo procesa lo que aún no esté migrado. A partir de
este punto, toda imagen nueva se sube directo a R2 y ya no ocupa espacio en Neon.

## 6. Frontend actualizado
Reemplaza tu `gestor_guias.html` por el archivo nuevo. Ya incluye:
- Pantalla de login sin registro público
- Panel de **Usuarios** (visible solo para `admin_empresa`): crear/editar usuarios de su empresa,
  asignar rol y módulos
- Panel de **Superadministrador** (visible solo para tu usuario `superadmin`): crear empresas,
  activar/suspender, ver consumo de Neon y R2 con barras de progreso, y auditoría global
- El menú de navegación ahora se arma según el rol y los módulos que tiene cada usuario

No requiere ningún cambio en cómo lo despliegas — sigue siendo un archivo HTML único que puedes
subir a Netlify/Vercel/GitHub Pages o abrir localmente.

## 7. Qué cambia para ti al usar el sistema
- Ya no hay pestaña de "Crear cuenta" pública
- Inicias sesión con el usuario que ya tenías → sigues viendo tus guías normalmente,
  ahora bajo el rol `admin_empresa` de "Maquindustrias Yafra S.A.C."
- Con tu nuevo usuario **superadmin**, entras a un panel distinto (empresas, consumo, auditoría)
  en vez de la app de guías
- Como `admin_empresa`, ahora tienes una pestaña **👥 Usuarios** para crear cuentas a tu equipo
  y decidir qué módulos ve cada quien

## Siguiente paso
Con esto ya tienes la base completa (multi-empresa, roles, R2). Lo que sigue, cuando quieras
continuar, es construir los módulos nuevos (cotización, almacén, seguridad/EPP) sobre esta misma
base — cada uno como su propia carpeta de rutas, protegido por `requireModulo('nombre_del_modulo')`
igual que el módulo de guías.

