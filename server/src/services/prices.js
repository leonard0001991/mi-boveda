// Precios de mercado con fallback CoinGecko + Binance. Cache en memoria 60s.

const BINANCE = 'https://api.binance.com/api/v3/ticker/price?symbol=';
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';

// Mapeo ticker -> id de CoinGecko para monedas que no tienen par en Binance.
const TICKER_TO_COINGECKO = {
  XHV: 'haven', ZANO: 'zano', WOW: 'wownero', BAN: 'banano',
  WETH: 'weth', STETH: 'staked-ether', FLIP: 'chainflip',
  XMR: 'monero', XNO: 'nano', XRP: 'ripple',
};

const cache = new Map(); // symbol -> { price, at }

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Precio de un simbolo en USD.
export async function priceUsd(symbol) {
  const key = symbol.toUpperCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.price;

  let price = null;

  const ticker = key === 'MATIC' ? 'POL' : key;
  const bin = await fetchJson(`${BINANCE}${ticker}USDT`);
  if (bin && bin.price) {
    price = parseFloat(bin.price);
  } else {
    const cgId = TICKER_TO_COINGECKO[key];
    if (cgId) {
      const cg = await fetchJson(`${COINGECKO}?ids=${cgId}&vs_currencies=usd`);
      if (cg && cg[cgId] && cg[cgId].usd) price = parseFloat(cg[cgId].usd);
    }
  }

  if (price != null && price > 0) {
    cache.set(key, { price, at: Date.now() });
    return price;
  }
  return cached ? cached.price : null;
}

// Convierte un monto USD a cantidad de cripto. Devuelve null si no hay precio.
export async function usdToCrypto(usd, symbol) {
  const price = await priceUsd(symbol);
  if (price == null || price <= 0) return null;
  return usd / price;
}

// Convierte una cantidad de cripto a USD.
export async function cryptoToUsd(amount, symbol) {
  const price = await priceUsd(symbol);
  if (price == null) return null;
  return amount * price;
}
