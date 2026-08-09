const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pool = require('./db');
require('dotenv').config();

const app = express();

// Render (y la mayoría de plataformas cloud) corren la app detrás de un proxy.
// Sin esto, express-rate-limit no puede confiar en la IP real del visitante.
app.set('trust proxy', 1);

// CORS: si defines ALLOWED_ORIGINS en el .env (separados por coma), solo esos
// orígenes podrán llamar a la API. Si lo dejas vacío, acepta cualquiera (como antes) —
// recomendado fijarlo en cuanto tengas el dominio final del frontend.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origen no permitido por CORS'));
  }
}));

app.use(express.json({ limit: '50mb' }));

// Limita intentos de login: máx 10 intentos cada 15 min por IP, para frenar fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth/login', loginLimiter);

app.use('/api/auth', require('./routes/auth.routes')(pool));
app.use('/api/superadmin', require('./routes/superadmin.routes')(pool));
app.use('/api/usuarios', require('./routes/usuarios.routes')(pool));
app.use('/api/almacen', require('./routes/almacen.routes')(pool));
app.use('/api', require('./routes/services.routes')(pool)); // expone /api/services y /api/statuses

app.get('/', (req, res) => res.json({ status: 'ok', servicio: 'gestor-guias-api' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API en puerto ${PORT}`));
