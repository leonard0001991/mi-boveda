import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'cerebro.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Direcciones de reserva propias por moneda (de donde sale el dinero del admin)
CREATE TABLE IF NOT EXISTS reserves (
  symbol      TEXT PRIMARY KEY,           -- XNO, BTC, XMR...
  network     TEXT NOT NULL DEFAULT '',   -- red para multi-network (ej. arb, btc)
  address     TEXT NOT NULL,              -- direccion de reserva (origen) para esa moneda
  receiveAddress TEXT NOT NULL DEFAULT '',-- direccion donde el admin RECIBE la moneda origen del usuario
  payoutAddress  TEXT NOT NULL DEFAULT '',-- direccion desde la que el admin ENVIA la moneda destino
  enabled     INTEGER NOT NULL DEFAULT 1
);

-- Comision especial opcional para ordenes pequeñas por moneda destino.
-- Si no existe fila o specialUsd es NULL/0 -> se usa la regla normal por velocidad.
CREATE TABLE IF NOT EXISTS small_order_commission (
  symbol     TEXT PRIMARY KEY,
  specialUsd REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,          -- id unico de la app
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | completed | cancelled
  fromSymbol    TEXT NOT NULL,
  fromNetwork   TEXT NOT NULL DEFAULT '',
  fromAmount    REAL NOT NULL,
  toSymbol      TEXT NOT NULL,
  toNetwork     TEXT NOT NULL DEFAULT '',
  toAddress     TEXT NOT NULL,             -- direccion destino del usuario
  toExtraId     TEXT NOT NULL DEFAULT '',
  speed         TEXT NOT NULL DEFAULT 'medium',  -- slow | medium | fast
  estReceive    REAL NOT NULL DEFAULT 0,   -- monto estimado a recibir (lo que calculo la app)
  appRate       REAL NOT NULL DEFAULT 0,   -- tasa estimada to/from enviada por la app
  commissionUsd REAL NOT NULL DEFAULT 0,   -- comision aplicada (USD)
  netToAmount   REAL NOT NULL DEFAULT 0,   -- monto neto a entregar al usuario (despues de comision)
  providerFeeSavedUsd REAL NOT NULL DEFAULT 0,
  userLabel     TEXT NOT NULL DEFAULT '',  -- identificacion del usuario (nombre/alias si app lo envia)
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL,
  approvedAt    TEXT,
  completedAt   TEXT,
  rejectedAt    TEXT,
  adminNote     TEXT NOT NULL DEFAULT '',
  txHashPayout  TEXT NOT NULL DEFAULT '',  -- hash de la tx con la que el admin envio al usuario
  txHashRefund  TEXT NOT NULL DEFAULT '',  -- hash de la tx con la que el admin recibio del usuario
  cancelledReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS commission_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId        TEXT NOT NULL,
  fromSymbol     TEXT NOT NULL,
  toSymbol       TEXT NOT NULL,
  speed          TEXT NOT NULL,
  commissionUsd  REAL NOT NULL,
  commissionSymbol TEXT NOT NULL,          -- moneda en que se desconto (origen)
  commissionAmount REAL NOT NULL,          -- cantidad de cripto descontada
  grossFromAmount REAL NOT NULL,           -- monto enviado por el usuario
  netToAmount    REAL NOT NULL,            -- monto entregado al usuario
  providerFeeSavedUsd REAL NOT NULL DEFAULT 0,
  networkFeeUsd  REAL NOT NULL DEFAULT 0,
  createdAt      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId   TEXT NOT NULL,
  fromStatus TEXT NOT NULL,
  toStatus  TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);
`);

function nowIso() {
  return new Date().toISOString();
}

function getSetting(key, def = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export { db, getSetting, setSetting, nowIso };
