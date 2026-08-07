import { randomBytes } from 'node:crypto';
import { db, nowIso } from '../db/index.js';
import { computeNetAmount, recordCommissionEvent, commissionUsdFor } from './commission.js';

// Lista de simbolos soportados (monedas que la app puede intercambiar).
export const SUPPORTED_SYMBOLS = new Set([
  'BTC', 'LTC', 'BCH', 'DASH', 'DOGE', 'XMR', 'WOW', 'ZANO', 'ZEC', 'DCR',
  'XNO', 'BAN', 'ETH', 'WETH', 'USDT', 'USDC', 'USDC.E', 'DAI', 'MATIC', 'POL',
  'SOL', 'TRX', 'BNB', 'ARB', 'OP', 'BASE', 'FLIP', 'XRP', 'BSC', 'NEAR',
]);

export const SPEEDS = new Set(['slow', 'medium', 'fast']);

function validateSymbol(symbol) {
  if (typeof symbol !== 'string') return false;
  return SUPPORTED_SYMBOLS.has(symbol.toUpperCase());
}

export function createOrder(payload) {
  const errors = [];
  const from = String(payload.fromSymbol ?? '').toUpperCase();
  const to = String(payload.toSymbol ?? '').toUpperCase();
  if (!validateSymbol(from)) errors.push('fromSymbol no soportado');
  if (!validateSymbol(to)) errors.push('toSymbol no soportado');
  const fromAmount = Number(payload.fromAmount);
  if (!Number.isFinite(fromAmount) || fromAmount <= 0) errors.push('fromAmount invalido');
  if (typeof payload.toAddress !== 'string' || payload.toAddress.trim().length < 4)
    errors.push('toAddress invalida');
  const speed = String(payload.speed ?? 'medium').toLowerCase();
  if (!SPEEDS.has(speed)) errors.push('speed debe ser slow|medium|fast');
  if (from === to) errors.push('fromSymbol no puede ser igual a toSymbol');
  if (errors.length) return { error: errors.join(', ') };

  const id = payload.id && typeof payload.id === 'string'
    ? payload.id
    : randomBytes(16).toString('hex');
  const ts = nowIso();
  const estReceive = Number(payload.estReceive) || 0;
  const appRate = estReceive > 0 ? estReceive / fromAmount : 0;

  const order = {
    id, status: 'pending',
    fromSymbol: from, fromNetwork: String(payload.fromNetwork ?? ''),
    fromAmount, toSymbol: to, toNetwork: String(payload.toNetwork ?? ''),
    toAddress: payload.toAddress.trim(), toExtraId: String(payload.toExtraId ?? ''),
    speed, estReceive, appRate,
    userLabel: String(payload.userLabel ?? ''),
    createdAt: ts, updatedAt: ts,
  };

  db.prepare(`
    INSERT INTO orders
      (id, status, fromSymbol, fromNetwork, fromAmount, toSymbol, toNetwork,
       toAddress, toExtraId, speed, estReceive, appRate, userLabel, createdAt, updatedAt)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id, from, order.fromNetwork, fromAmount, to, order.toNetwork,
    order.toAddress, order.toExtraId, speed, estReceive, appRate, order.userLabel, ts, ts
  );

  recordEvent(order.id, 'created', 'pending', 'Orden recibida de la app');
  return { order };
}

// Aprobar: calcula comision + monto neto, marca approved, deja listo para el paso manual.
export async function approveOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return { error: 'orden no encontrada' };
  if (order.status !== 'pending')
    return { error: `estado invalido (${order.status}), solo se aprueba desde pending` };

  // Doble validacion de monedas antes de mover nada.
  if (!validateSymbol(order.fromSymbol) || !validateSymbol(order.toSymbol))
    return { error: 'moneda no soportada, operacion bloqueada' };

  // Validar que las direcciones de reserva existan para ambas monedas.
  const reserveFrom = db.prepare('SELECT * FROM reserves WHERE symbol = ?').get(order.fromSymbol);
  const reserveTo = db.prepare('SELECT * FROM reserves WHERE symbol = ?').get(order.toSymbol);
  if (!reserveFrom || !reserveFrom.address || reserveFrom.address.trim().length < 4)
    return { error: `falta direccion de reserva para ${order.fromSymbol}` };
  if (!reserveTo || !reserveTo.address || reserveTo.address.trim().length < 4)
    return { error: `falta direccion de reserva para ${order.toSymbol}` };

  const net = await computeNetAmount(order);
  if (!net) return { error: 'no hay precio de mercado para calcular la comision' };
  if (net.insufficient)
    return { error: 'la comision es mayor que el monto, orden invalida' };

  const ts = nowIso();
  db.prepare(`
    UPDATE orders SET status='approved', commissionUsd=?, netToAmount=?,
      approvedAt=?, updatedAt=? WHERE id=?
  `).run(net.commissionUsd, net.netToAmount, ts, ts, orderId);
  recordEvent(orderId, order.status, 'approved', `Aprobado por el admin. Comision ${net.commissionUsd} USD`);
  return { order: db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) };
}

// Rechazar: la app mostrara el mensaje oficial del minimo.
export function rejectOrder(orderId, reason = '') {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return { error: 'orden no encontrada' };
  if (order.status !== 'pending')
    return { error: `estado invalido (${order.status})` };
  const ts = nowIso();
  db.prepare(`
    UPDATE orders SET status='rejected', rejectedAt=?, updatedAt=?, cancelledReason=? WHERE id=?
  `).run(ts, ts, String(reason || 'Rechazada por el admin'), orderId);
  recordEvent(orderId, order.status, 'rejected', String(reason || 'Rechazada por el admin'));
  return { order: db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) };
}

// Completar: el admin confirmo que ya envio y recibio manualmente. Registra comision.
export async function completeOrder(orderId, { txHashPayout = '', txHashRefund = '', adminNote = '', networkFeeUsd = 0 } = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return { error: 'orden no encontrada' };
  if (order.status !== 'approved')
    return { error: `estado invalido (${order.status}), debe estar approved` };

  const commissionUsd = order.commissionUsd || commissionUsdFor(order.speed, order.toSymbol);
  const ts = nowIso();
  db.prepare(`
    UPDATE orders SET status='completed', completedAt=?, updatedAt=?,
      txHashPayout=?, txHashRefund=?, adminNote=? WHERE id=?
  `).run(ts, ts, String(txHashPayout), String(txHashRefund), String(adminNote), orderId);

  const commissionAmount = order.commissionUsd > 0
    ? order.commissionUsd // approximation: real amount already in commissionAmount if stored
    : 0;
  // Recomputamos el monto real en la moneda origen para la contabilidad.
  const net = await computeNetAmount(order);
  const commissionAmountReal = net ? net.commissionAmount : commissionAmount;
  const providerFeeSavedUsd = 0; // cuando el admin lo procesa, se ahorra el fee del proveedor
  recordCommissionEvent(
    { ...order, status: 'completed' },
    commissionUsd, commissionAmountReal, order.netToAmount, providerFeeSavedUsd
  );
  recordEvent(orderId, order.status, 'completed', 'Completada por el admin');
  return { order: db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) };
}

function recordEvent(orderId, fromStatus, toStatus, note) {
  db.prepare(`
    INSERT INTO order_events (orderId, fromStatus, toStatus, note, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, fromStatus, toStatus, note, nowIso());
}

export function listOrders({ status, limit = 100 } = {}) {
  let sql = 'SELECT * FROM orders';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  return db.prepare(sql).all(...params);
}

export function getOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const events = db.prepare('SELECT * FROM order_events WHERE orderId = ? ORDER BY id').all(orderId);
  return { ...order, events };
}
