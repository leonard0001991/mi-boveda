import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';
import { getSetting, setSetting } from './db/index.js';
import { cerebroApiKey, setCerebroApiKey } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

const app = express();
app.use(express.json({ limit: '100kb' }));

// Proteccion basica contra fuerza bruta en el login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados intentos, intente mas tarde' },
});
app.post('/api/v1/admin/login', loginLimiter);

app.use('/api/v1', apiRouter);

// Dashboard web estatico.
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// Primer arranque: generar claves si no existen (persistidas en DB).
// ============================================================
if (!cerebroApiKey()) {
  const key = 'cerebro_' + crypto.randomBytes(24).toString('hex');
  setCerebroApiKey(key);
  console.log('[Cerebro] CEREBRO_API_KEY generada: ' + key);
  console.log('[Cerebro] Se muestra UNA SOLA VEZ en el panel (pestana Intercambios Erleo).');
}
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = 'admin_' + crypto.randomBytes(4).toString('hex');
  console.log('[Cerebro] ADMIN_PASSWORD generada: ' + process.env.ADMIN_PASSWORD);
}
if (!getSetting('generated')) {
  setSetting('generated', '1');
}

app.listen(PORT, () => {
  console.log(`[Cerebro] Mi Boveda Cerebro server en http://localhost:${PORT}`);
  console.log(`[Cerebro] Dashboard: http://localhost:${PORT}/`);
  console.log(`[Cerebro] API:       http://localhost:${PORT}/api/v1`);
});
