import { Router } from 'express';
import crypto from 'node:crypto';
import { db, nowIso, getSetting, setSetting } from '../db/index.js';
import { apiKeyAuth, sessionAuth, createSession, cerebroApiKey, setCerebroApiKey } from '../middleware/auth.js';
import * as ordersService from '../services/orders.js';
import * as reportsService from '../services/reports.js';
import { NORMAL_COMMISSION, commissionUsdFor, specialCommissionFor } from '../services/commission.js';

const router = Router();

// ============================================================
// Auth del dashboard
// ============================================================
router.post('/admin/login', (req, res) => {
  const password = req.body && req.body.password;
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada' });
  if (password === expected) {
    return res.json({ token: createSession() });
  }
  res.status(401).json({ error: 'Contrasena incorrecta' });
});

// ============================================================
// Config consumida por la app (compatible con cerebro_service.dart)
// ============================================================
function buildConfig() {
  const coins = {};
  const reserveRows = db.prepare('SELECT * FROM reserves').all();
  for (const r of reserveRows) {
    coins[r.symbol] = { enabled: r.enabled === 1, feeAddress: r.address };
  }
  // Monedas soportadas sin reserva configurada -> presentes pero deshabilitadas para este flujo.
  for (const s of ordersService.SUPPORTED_SYMBOLS) {
    if (!coins[s]) coins[s] = { enabled: false, feeAddress: '' };
  }
  const globalEnabledRaw = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('globalEnabled');
  const globalEnabled = globalEnabledRaw ? globalEnabledRaw.value === '1' : true;

  const erleoEnabledRaw = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('erleoExchangeEnabled');
  // Por defecto el sistema Erleo está ACTIVADO; el panel puede detenerlo con un clic.
  const erleoExchangeEnabled = erleoEnabledRaw ? erleoEnabledRaw.value === '1' : true;

  const specials = db.prepare('SELECT * FROM small_order_commission').all();
  const specialCommissions = {};
  for (const sp of specials) specialCommissions[sp.symbol] = sp.specialUsd;

  return {
    name: 'Cerebro Mi Boveda',
    globalEnabled,
    commissionSlowUsd: NORMAL_COMMISSION.slow,
    commissionMediumUsd: NORMAL_COMMISSION.medium,
    commissionFastUsd: NORMAL_COMMISSION.fast,
    adminCommissionExemption: true,
    minAppVersion: 0,
    coins,
    specialCommissions,
    nodes: {},
    announcements: [],
    erleoExchangeEnabled,
  };
}

router.get('/config', apiKeyAuth, (req, res) => {
  res.json(buildConfig());
});

// ============================================================
// Ordenes (usadas por la app y por el dashboard)
// ============================================================
// POST /api/v1/orders - la app envia una orden de intercambio pequeno.
router.post('/orders', apiKeyAuth, (req, res) => {
  const result = ordersService.createOrder(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result.order);
});

// GET /api/v1/orders/:id - la app consulta estado (pending/approved/rejected/completed).
router.get('/orders/:id', (req, res) => {
  const order = ordersService.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'orden no encontrada' });
  res.json(order);
});

// GET /api/v1/orders - listado (dashboard).
router.get('/orders', sessionAuth, (req, res) => {
  res.json(ordersService.listOrders({ status: req.query.status, limit: req.query.limit }));
});

// POST /api/v1/orders/:id/approve - admin aprueba (calcula comision + monto neto).
router.post('/orders/:id/approve', sessionAuth, async (req, res) => {
  const result = await ordersService.approveOrder(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result.order);
});

// POST /api/v1/orders/:id/reject - admin rechaza.
router.post('/orders/:id/reject', sessionAuth, (req, res) => {
  const result = ordersService.rejectOrder(req.params.id, req.body && req.body.reason);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result.order);
});

// POST /api/v1/orders/:id/complete - admin confirma envio manual.
router.post('/orders/:id/complete', sessionAuth, async (req, res) => {
  const result = await ordersService.completeOrder(req.params.id, req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result.order);
});

// ============================================================
// Toggle Erleo (sistema de intercambios propios)
// ============================================================
// GET /api/v1/settings/erleo-enabled - lee el estado actual (permite el dashboard).
router.get('/settings/erleo-enabled', (req, res) => {
  res.json(buildConfig().erleoExchangeEnabled);
});

// POST /api/v1/settings/erleo-enabled - admin enciende/apaga con un clic (persistente).
router.post('/settings/erleo-enabled', sessionAuth, (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('erleoExchangeEnabled', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(enabled ? '1' : '0');
  res.json({ enabled });
});

// ============================================================
// API key de la app (se muestra UNA SOLA VEZ en el panel)
// ============================================================
// GET /api/v1/settings/api-key - devuelve la key la primera vez; despues solo
// la ultima parte para confirmar que es la misma.
router.get('/settings/api-key', sessionAuth, (req, res) => {
  const key = cerebroApiKey();
  const shown = getSetting('apiKeyShown') === '1';
  res.json({
    apiKey: key,
    revealedOnce: shown,
  });
});

// POST /api/v1/settings/api-key/reveal - marca como vista (ya no se vuelve a mostrar completa).
router.post('/settings/api-key/reveal', sessionAuth, (req, res) => {
  setSetting('apiKeyShown', '1');
  res.json({ ok: true });
});

// POST /api/v1/settings/api-key/regenerate - genera una key nueva (la app debe actualizarse).
router.post('/settings/api-key/regenerate', sessionAuth, (req, res) => {
  const key = 'cerebro_' + crypto.randomBytes(24).toString('hex');
  setCerebroApiKey(key);
  setSetting('apiKeyShown', '1');
  res.json({ apiKey: key });
});

// ============================================================
// Direcciones de reserva (config del admin)
// ============================================================
router.get('/reserves', sessionAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM reserves ORDER BY symbol').all());
});

router.post('/reserves', sessionAuth, (req, res) => {
  const { symbol, network = '', address, receiveAddress = '', payoutAddress = '', enabled = true } = req.body || {};
  if (!symbol || !address || String(address).trim().length < 4)
    return res.status(400).json({ error: 'symbol y address requeridos' });
  db.prepare(`
    INSERT INTO reserves (symbol, network, address, receiveAddress, payoutAddress, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      network=excluded.network, address=excluded.address,
      receiveAddress=excluded.receiveAddress, payoutAddress=excluded.payoutAddress,
      enabled=excluded.enabled
  `).run(
    symbol.toUpperCase(), network, address.trim(),
    String(receiveAddress || '').trim(), String(payoutAddress || '').trim(),
    enabled ? 1 : 0
  );
  res.json(db.prepare('SELECT * FROM reserves WHERE symbol = ?').get(symbol.toUpperCase()));
});

router.delete('/reserves/:symbol', sessionAuth, (req, res) => {
  db.prepare('DELETE FROM reserves WHERE symbol = ?').run(req.params.symbol.toUpperCase());
  res.json({ ok: true });
});

// ============================================================
// Comision especial opcional para ordenes pequenas
// ============================================================
router.get('/small-commissions', sessionAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM small_order_commission').all());
});

router.post('/small-commissions', sessionAuth, (req, res) => {
  const { symbol, specialUsd } = req.body || {};
  if (!symbol) return res.status(400).json({ error: 'symbol requerido' });
  db.prepare(`
    INSERT INTO small_order_commission (symbol, specialUsd) VALUES (?, ?)
    ON CONFLICT(symbol) DO UPDATE SET specialUsd = excluded.specialUsd
  `).run(symbol.toUpperCase(), Number(specialUsd) || 0);
  res.json({ ok: true });
});

// ============================================================
// Reportes / contabilidad separada
// ============================================================
router.get('/report/commissions', sessionAuth, (req, res) => {
  res.json(reportsService.commissionReport(req.query));
});

router.get('/report/dashboard', sessionAuth, (req, res) => {
  res.json(reportsService.dashboardSummary());
});

router.get('/report/export', sessionAuth, (req, res) => {
  const { events } = reportsService.commissionReport({ ...req.query, limit: 5000 });
  const header = ['orderId','fromSymbol','toSymbol','speed','commissionUsd','commissionSymbol','commissionAmount','grossFromAmount','netToAmount','providerFeeSavedUsd','networkFeeUsd','createdAt'];
  const rows = events.map((e) => header.map((h) => e[h] ?? '').join(','));
  const csv = header.join(',') + '\n' + rows.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=comisiones_erleo.csv');
  res.send(csv);
});

export default router;
