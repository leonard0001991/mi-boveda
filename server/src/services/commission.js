import { db, nowIso } from '../db/index.js';
import { priceUsd, usdToCrypto, cryptoToUsd } from './prices.js';

// Regla normal por velocidad (USD fijos), igual que la app.
export const NORMAL_COMMISSION = { slow: 0.10, medium: 0.25, fast: 0.50 };

// Regla especial opcional por moneda destino (ordenes pequeñas).
export function specialCommissionFor(symbol) {
  const row = db
    .prepare('SELECT specialUsd FROM small_order_commission WHERE symbol = ?')
    .get(symbol.toUpperCase());
  if (!row) return null;
  return row.specialUsd > 0 ? row.specialUsd : null;
}

// USD de la comision para una orden segun velocidad + regla especial.
export function commissionUsdFor(speed, toSymbol) {
  const special = specialCommissionFor(toSymbol);
  if (special != null) return special;
  return NORMAL_COMMISSION[speed] ?? NORMAL_COMMISSION.medium;
}

// Descuenta la comision de la moneda ORIGEN antes de convertir a destino.
// Devuelve { commissionUsd, commissionAmount (en fromSymbol), netToAmount (en toSymbol) }.
// estRate = tasa estimada to/from que envio la app (toAmount / fromAmount).
export async function computeNetAmount(order) {
  const commissionUsd = commissionUsdFor(order.speed, order.toSymbol);

  // Comision en la moneda origen.
  const commissionAmount = await usdToCrypto(commissionUsd, order.fromSymbol);
  if (commissionAmount == null) return null;

  const grossFrom = order.fromAmount;
  const netFrom = grossFrom - commissionAmount;
  if (netFrom <= 0) {
    return { commissionUsd, commissionAmount, netToAmount: 0, insufficient: true };
  }

  // Convertir a la moneda destino. Preferir la tasa de la app; si no, usar precios de mercado.
  let netToAmount = 0;
  const appRate = order.appRate; // toAmount / fromAmount
  if (appRate && appRate > 0) {
    netToAmount = netFrom * appRate;
  } else {
    const fromUsd = await cryptoToUsd(netFrom, order.fromSymbol);
    const toPrice = await priceUsd(order.toSymbol);
    if (fromUsd != null && toPrice != null && toPrice > 0) {
      netToAmount = fromUsd / toPrice;
    }
  }

  return { commissionUsd, commissionAmount, netToAmount, insufficient: false };
}

// Registra la comision en la contabilidad SEPARADA (categoria Intercambios Erleo).
export function recordCommissionEvent(order, commissionUsd, commissionAmount, netToAmount, providerFeeSavedUsd = 0) {
  db.prepare(`
    INSERT INTO commission_events
      (orderId, fromSymbol, toSymbol, speed, commissionUsd, commissionSymbol,
       commissionAmount, grossFromAmount, netToAmount, providerFeeSavedUsd, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id, order.fromSymbol, order.toSymbol, order.speed, commissionUsd,
    order.fromSymbol, commissionAmount, order.fromAmount, netToAmount,
    providerFeeSavedUsd, nowIso()
  );
}
