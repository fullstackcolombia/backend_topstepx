# backend_topstepx
panel topstepx

## API docs

- Swagger UI: /docs
- OpenAPI JSON: /docs.json

## CORS

- Configura `CORS_ORIGINS` en `.env` como lista separada por comas.
- Ejemplo: `CORS_ORIGINS=http://localhost:3000,https://tu-frontend.com`

## TopstepX live

- `TOPSTEPX_API_BASE` debe apuntar al endpoint HTTP de TopstepX (default: `https://api.topstepx.com`).
- `TOPSTEPX_USER_NAME` es obligatorio en modo `live`.
- `TOPSTEPX_API_KEY` es obligatoria en modo `live`.
- `TOPSTEPX_DEFAULT_MAX_QTY` define el maximo de qty por cuenta para validaciones de riesgo locales (default: `30`).
- `TOPSTEPX_CONTRACT_MAP` es opcional y permite mapear instrumento del panel a `contractId` real. Ejemplo: `{"NQ SEP26":"CON.F.US.NQZ26"}`.
- El backend inicia sesion en `/api/Auth/loginKey`, guarda el `token` de sesion y lo usa como `Authorization: Bearer <token>` para las llamadas a la Gateway API.
- En `live`, el backend sincroniza cuentas con `/api/Account/search` para que el panel use IDs reales de TopstepX.
