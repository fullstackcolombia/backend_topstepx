# backend_topstepx
panel topstepx

## API docs

- Swagger UI: /docs
- OpenAPI JSON: /docs.json

## CORS

- Configura `CORS_ORIGINS` en `.env` como lista separada por comas.
- Ejemplo: `CORS_ORIGINS=http://localhost:3000,https://tu-frontend.com`
- Soporta patrones con `*` para previews de Vercel. Ejemplo: `CORS_ORIGINS=http://localhost:3000,https://tu-frontend.com,https://*.vercel.app`

## TopstepX live

- El panel ahora arranca por defecto en `live` si no se define `PANEL_MODE`.
- Recomendado/obligatorio para operacion real: `PANEL_MODE=live`.

- `TOPSTEPX_API_BASE` debe apuntar al endpoint HTTP de TopstepX (default: `https://api.topstepx.com`).
- `TOPSTEPX_USER_NAME` es obligatorio en modo `live`.
- `TOPSTEPX_API_KEY` es obligatoria en modo `live`.
- `TOPSTEPX_DEFAULT_MAX_QTY` define el maximo de qty por cuenta para validaciones de riesgo locales (default: `30`).
- `TOPSTEPX_CONTRACT_MAP` es opcional y permite mapear instrumento del panel a `contractId` real. Ejemplo: `{"NQ SEP26":"CON.F.US.NQZ26"}`.
- El backend inicia sesion en `/api/Auth/loginKey`, guarda el `token` de sesion y lo usa como `Authorization: Bearer <token>` para las llamadas a la Gateway API.
- En `live`, el backend sincroniza cuentas con `/api/Account/search` para que el panel use IDs reales de TopstepX.
- Nuevo endpoint `POST /api/topstepx/chart` devuelve velas reales de TopstepX para un `symbol` (y opcional `contractId`).
- Puedes forzar/ajustar endpoints de chart con `TOPSTEPX_CHART_ENDPOINTS` (lista separada por comas). Ejemplo: `/api/History/retrieveBars,/api/Chart/getChart`.

## Tradovate integration

- Auth REST base demo: `https://demo.tradovateapi.com/v1`
- Auth REST base live: `https://live.tradovateapi.com/v1`
- Market Data WebSocket: `wss://md.tradovateapi.com/v1/websocket`

Variables opcionales:

- `TRADOVATE_ENV=live` (recomendado). El backend bloquea `demo` para endpoints de Tradovate.
- `TRADOVATE_DEMO_REST_BASE` (default: `https://demo.tradovateapi.com/v1`)
- `TRADOVATE_LIVE_REST_BASE` (default: `https://live.tradovateapi.com/v1`)
- `TRADOVATE_DEMO_WS_URL` (default: `wss://demo.tradovateapi.com/v1/websocket`)
- `TRADOVATE_LIVE_WS_URL` (default: `wss://live.tradovateapi.com/v1/websocket`)
- `TRADOVATE_MD_WS_URL` (default: `wss://md.tradovateapi.com/v1/websocket`)

Nuevos endpoints para ESPAR mixto:

- `POST /api/tradovate/accounts` conecta con credenciales y devuelve cuentas.
- `POST /api/tradovate/chart` obtiene velas via `md/getchart`.
- `POST /api/topstepx/chart` obtiene velas reales de TopstepX (con credenciales por request o por env del backend).
- `POST /api/orders/manual` soporta `broker: "tradovate"` y envía orden market en Tradovate.

Notas live-only:

- `POST /api/tradovate/accounts`, `POST /api/tradovate/chart` y ordenes Tradovate en `POST /api/orders/manual` exigen modo `live`.
- Si se envian credenciales Tradovate con `environment="demo"`, el backend responde error para evitar ejecucion fuera de live.
