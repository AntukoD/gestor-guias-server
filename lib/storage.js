const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// R2 es compatible con la API de S3, por eso usamos el SDK de S3 apuntando al endpoint de Cloudflare.
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''); // sin "/" final

function tipoDeContenido(dataUri) {
  const match = /^data:(.+);base64,/.exec(dataUri || '');
  return match ? match[1] : 'application/octet-stream';
}

function payloadBase64(dataUri) {
  const idx = (dataUri || '').indexOf('base64,');
  return idx >= 0 ? dataUri.slice(idx + 7) : dataUri;
}

function limpiarNombre(nombre) {
  return (nombre || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

// Sube una imagen (viene como data URI base64 desde el navegador) y devuelve su URL pública + key
async function subirImagen({ empresaId, serviceId, nombreArchivo, dataUri }) {
  if (!BUCKET || !PUBLIC_URL) throw new Error('Cloudflare R2 no está configurado (faltan variables de entorno)');
  const contentType = tipoDeContenido(dataUri);
  const buffer = Buffer.from(payloadBase64(dataUri), 'base64');
  const key = `empresa_${empresaId}/servicio_${serviceId}/${Date.now()}_${limpiarNombre(nombreArchivo)}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));

  return { url: `${PUBLIC_URL}/${key}`, key, sizeBytes: buffer.length };
}

async function borrarImagen(key) {
  if (!key || !BUCKET) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error('No se pudo borrar de R2:', key, err.message);
  }
}

module.exports = { subirImagen, borrarImagen };
