# Mi Bóveda · Cerebro Server

Servidor backend del sistema **Erleo**: intercambios propios para montos por debajo del
mínimo permitido por ChangeNOW, con comisiones en categoría separada y dashboard web
de aprobación manual.

## ¿Qué hace?

Cuando un usuario intenta cambiar un monto menor al mínimo de ChangeNOW (ej. 10 XNO
cuando el mínimo es ~18.05), la app **no muestra error**: envía la orden al Cerebro y
muestra "Procesando tu intercambio…".

En el dashboard web (solo tú), la orden aparece como **pendiente**. Tú decides:

- **✅ Aceptar** → se calcula tu comisión (USD convertida a la moneda origen) y el
  monto neto a entregar al usuario. El panel te indica la dirección de tu reserva para
  recibir la moneda origen y cuánto enviar de la moneda destino. Ejecutas manualmente y
  marcas **completada**.
- **❌ Rechazar** → la app muestra el mensaje oficial del mínimo.

Todo queda registrado en la contabilidad separada **"Comisiones - Intercambios Erleo"**,
sin mezclarse con envíos ni con ChangeNOW.

## Requisitos

- Node.js ≥ 22.5 (usa `node:sqlite` nativo, sin compilación).

## Instalación y arranque

```bash
cd server
npm install
cp .env.example .env   # edita las claves
npm start
```

Dashboard: `http://localhost:8787/`
API: `http://localhost:8787/api/v1`

### Variables de entorno (`.env`)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto (por defecto `8787`) |
| `CEREBRO_API_KEY` | Clave que usan las billeteras (header `x-api-key`). Debe coincidir con la configurada en la app. |
| `ADMIN_PASSWORD` | Contraseña del dashboard web. |
| `SESSION_SECRET` | Secreto de sesión (por ahora no crítico, se reserva). |

> En el **primer arranque**, si faltan `CEREBRO_API_KEY` o `ADMIN_PASSWORD`, se generan
> automáticamente y se imprimen en consola.

## Cómo conectar la app

1. En `lib/core/cerebro_service.dart` de la app, pon la URL de tu servidor en
   `kCerebroServerUrl` y la API key en `kCerebroApiKey`:

   ```dart
   static const String kCerebroServerUrl = 'https://tu-dominio-o-ip:8787';
   static const String kCerebroApiKey = 'la_misma_cerebro_api_key';
   ```

2. Compila la app. Cuando detecte un monto por debajo del mínimo y el servidor tenga
   `erleoExchangeEnabled: true`, ofrecerá el intercambio propio.

## Configuración del dashboard

### Direcciones de reserva (obligatorio para aprobar)

En la pestaña **Direcciones de reserva** agrega, por moneda:

- **Moneda**: `XNO`, `BTC`, `XMR`, etc.
- **Red**: opcional (ej. `btc`, `arb`).
- **Dirección de reserva**: tu dirección principal de esa moneda (de donde sale el pago).
- **Recepción** (opcional): dónde recibes la moneda del usuario si es distinta.
- **Pago** (opcional): desde dónde envías al usuario si es distinta.

Sin reserva configurada para la moneda origen o destino, la orden **no se puede aprobar**
(validación doble).

### Comisión especial para órdenes pequeñas (opcional)

Por defecto se usan los montos fijos por velocidad: **Lento $0.10 · Normal $0.25 · Rápido $0.50** (USD).

Puedes definir una comisión distinta solo para órdenes pequeñas por moneda destino vía API:

```bash
curl -X POST http://localhost:8787/api/v1/small-commissions \
  -H "Content-Type: application/json" -H "x-session-token: <token>" \
  -d '{"symbol":"BTC","specialUsd":0.05}'
```

Si la dejas en `0`/sin configurar, se usa la regla normal automáticamente.

## API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/v1/config` | api-key | Config que consume la app (kill switch, comisiones, coins, erleo). |
| POST | `/api/v1/orders` | api-key | La app envía una orden de intercambio pequeño. |
| GET | `/api/v1/orders/:id` | pública | Estado de una orden (polling de la app). |
| GET | `/api/v1/orders` | sesión | Listado de órdenes. |
| POST | `/api/v1/orders/:id/approve` | sesión | Aprobar (calcula comisión + neto). |
| POST | `/api/v1/orders/:id/reject` | sesión | Rechazar. |
| POST | `/api/v1/orders/:id/complete` | sesión | Confirmar envío manual + registrar comisión. |
| GET/POST/DELETE | `/api/v1/reserves` | sesión | Direcciones de reserva. |
| GET/POST | `/api/v1/small-commissions` | sesión | Comisión especial opcional. |
| GET | `/api/v1/report/commissions` | sesión | Contabilidad separada (filtros por moneda/fechas). |
| GET | `/api/v1/report/export` | sesión | Export CSV de la contabilidad. |
| POST | `/api/v1/admin/login` | pública | Login del dashboard. |

## Seguridad

- `x-api-key` comparado con `timingSafeEqual` (solo las billeteras la conocen).
- Sesiones del dashboard con token en memoria (12 h).
- Doble validación de monedas antes de aprobar (nunca mueve nada automáticamente).
- **Nunca ejecuta operaciones automáticamente**: siempre requiere tu clic de aprobación.
- Rate limit en el login.
