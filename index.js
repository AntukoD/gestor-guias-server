const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Auth
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hashed, name]
    );
    const user = result.rows[0];
    
    const defaultStatuses = [
      { id: `status_pendiente_${user.id}`, name: 'Pendiente', icon: '⏳', color: '#ea580c', order: 0 },
      { id: `status_en_proceso_${user.id}`, name: 'En Proceso', icon: '🔄', color: '#2563eb', order: 1 },
      { id: `status_completado_${user.id}`, name: 'Completado', icon: '✅', color: '#16a34a', order: 2 },
      { id: `status_cancelado_${user.id}`, name: 'Cancelado', icon: '❌', color: '#dc2626', order: 3 }
    ];
    
    for (const st of defaultStatuses) {
      await pool.query(
        'INSERT INTO statuses (id, name, icon, color, display_order, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [st.id, st.name, st.icon, st.color, st.order, user.id]
      );
    }
    
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email ya registrado' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Contraseña incorrecta' });
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Middleware auth
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Statuses
app.get('/api/statuses', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, icon, color, display_order as order FROM statuses WHERE user_id = $1 ORDER BY display_order',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/statuses', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { statuses } = req.body;
    await client.query('DELETE FROM statuses WHERE user_id = $1', [req.userId]);
    for (const st of statuses) {
      await client.query(
        'INSERT INTO statuses (id, name, icon, color, display_order, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [st.id, st.name, st.icon, st.color, st.order, req.userId]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Services
app.get('/api/services', authMiddleware, async (req, res) => {
  try {
    const servicesResult = await pool.query(
      `SELECT s.*, 
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity)) FILTER (WHERE i.id IS NOT NULL), '[]') as items,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', im.id, 'name', im.name, 'data', im.data, 'type', im.type)) FILTER (WHERE im.id IS NOT NULL), '[]') as images
      FROM services s
      LEFT JOIN items i ON i.service_id = s.id
      LEFT JOIN images im ON im.service_id = s.id
      WHERE s.user_id = $1
      GROUP BY s.id
      ORDER BY s.updated_at DESC`,
      [req.userId]
    );
    
    const services = servicesResult.rows.map(row => ({
      ...row,
      hojas: row.images.filter(img => img.type === 'hoja'),
      fotos: row.images.filter(img => img.type === 'foto'),
      esMuestra: row.es_muestra,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime()
    }));
    
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id, name, client: clientName, status, ref, cotizacion, oc, notes, esMuestra, items, hojas, fotos } = req.body;
    
    await client.query(
      `INSERT INTO services (id, user_id, name, client, status_id, ref, cotizacion, oc, notes, es_muestra, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [id, req.userId, name, clientName, status, ref, cotizacion, oc, notes, esMuestra]
    );
    
    if (items && items.length) {
      for (const item of items) {
        await client.query('INSERT INTO items (service_id, name, quantity) VALUES ($1, $2, $3)', [id, item.name, item.quantity]);
      }
    }
    
    const allImages = [...(hojas||[]).map(h=>({...h,type:'hoja'})), ...(fotos||[]).map(f=>({...f,type:'foto'}))];
    for (const img of allImages) {
      await client.query('INSERT INTO images (service_id, name, data, type) VALUES ($1, $2, $3, $4)', [id, img.name, img.data, img.type]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/services/:id', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { name, client: clientName, status, ref, cotizacion, oc, notes, esMuestra, items, hojas, fotos } = req.body;
    
    await client.query(
      `UPDATE services SET name=$1, client=$2, status_id=$3, ref=$4, cotizacion=$5, oc=$6, notes=$7, es_muestra=$8, updated_at=NOW()
       WHERE id=$9 AND user_id=$10`,
      [name, clientName, status, ref, cotizacion, oc, notes, esMuestra, req.params.id, req.userId]
    );
    
    await client.query('DELETE FROM items WHERE service_id = $1', [req.params.id]);
    if (items && items.length) {
      for (const item of items) {
        await client.query('INSERT INTO items (service_id, name, quantity) VALUES ($1, $2, $3)', [req.params.id, item.name, item.quantity]);
      }
    }
    
    await client.query('DELETE FROM images WHERE service_id = $1', [req.params.id]);
    const allImages = [...(hojas||[]).map(h=>({...h,type:'hoja'})), ...(fotos||[]).map(f=>({...f,type:'foto'}))];
    for (const img of allImages) {
      await client.query('INSERT INTO images (service_id, name, data, type) VALUES ($1, $2, $3, $4)', [req.params.id, img.name, img.data, img.type]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/services/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM services WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API en puerto ${PORT}`));