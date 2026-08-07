import { db } from '../db/index.js';

// Reportes de contabilidad SEPARADA: categoria "Comisiones - Intercambios Erleo".
export function commissionReport({ from, to, symbol, limit = 500 } = {}) {
  let sql = 'SELECT * FROM commission_events';
  const clauses = [];
  const params = [];
  if (from) { clauses.push('createdAt >= ?'); params.push(new Date(from).toISOString()); }
  if (to) { clauses.push('createdAt <= ?'); params.push(new Date(to).toISOString()); }
  if (symbol) { clauses.push('(fromSymbol = ? OR toSymbol = ?)'); params.push(symbol.toUpperCase(), symbol.toUpperCase()); }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 5000));
  const rows = db.prepare(sql).all(...params);

  const totals = rows.reduce(
    (acc, r) => {
      acc.totalCommissionUsd += r.commissionUsd || 0;
      acc.totalProviderFeeSavedUsd += r.providerFeeSavedUsd || 0;
      acc.count += 1;
      return acc;
    },
    { totalCommissionUsd: 0, totalProviderFeeSavedUsd: 0, count: 0 }
  );
  return { events: rows, totals };
}

// Resumen del dashboard: pendientes, totales por estado.
export function dashboardSummary() {
  const byStatus = db.prepare('SELECT status, COUNT(*) as c FROM orders GROUP BY status').all();
  const summary = { pending: 0, approved: 0, rejected: 0, completed: 0, cancelled: 0 };
  for (const row of byStatus) summary[row.status] = row.c;
  const pending = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY createdAt DESC').all('pending');
  const approved = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY updatedAt DESC').all('approved');
  const recent = db.prepare('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 20').all();
  return { summary, pending, approved, recent };
}
