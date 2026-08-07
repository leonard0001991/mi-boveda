import crypto from 'node:crypto';

const sessions = new Map(); // token -> { user, expiresAt }

// Auth para endpoints de la billetera (header x-api-key).
export function apiKeyAuth(req, res, next) {
  const provided = req.get('x-api-key') || req.get('x-cerebro-api-key') || '';
  const expected = process.env.CEREBRO_API_KEY || '';
  if (!expected) {
    return res.status(500).json({ error: 'CEREBRO_API_KEY no configurada en el servidor' });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Auth para el dashboard web (sesion por cookie/token).
export function sessionAuth(req, res, next) {
  const token = req.get('x-session-token') || (req.query && req.query.token);
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  const s = sessions.get(token);
  if (!s || s.expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Sesion expirada' });
  }
  req.session = s;
  next();
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user: 'admin', expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  return token;
}
