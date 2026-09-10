# E2E — 024: los mocks devuelven 404 antes de que Next mire el método

Guion de la historia. Los tres niveles están automatizados; el nivel 3 exige una
app construida en **modo producción**, que `pnpm test:e2e` no levanta, así que
se corre a mano y forma parte de la puerta de promoción.

> Trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el alias `G:\`.

## Lo que se mide

`mockGuard()` corre dentro de cada handler; Next resuelve el método antes. En
producción, `PUT /api/dev/wa-mock/outbox` respondía **405** (la ruta existe, no
exporta `PUT`) y `PUT /api/dev/inexistente` **404**: la diferencia confirma qué
rutas de mock existen en la instancia. La 024 pone un middleware en
`/api/dev/:path*` que responde 404 antes del enrutado.

## Nivel 1 — Unidad ✅

`pnpm test` → `tests/unit/mocks-404-incondicional.test.ts`: el middleware
responde 404 a los siete métodos en producción, deja pasar con mocks fuera de
producción, su `matcher` es exactamente `/api/dev/:path*`, y ningún archivo de
`src/app` llama a `mockGuard()` fuera de `src/app/api/dev/`.

## Nivel 2 — Desarrollo con mocks (el perímetro deja pasar) ✅

Con `pnpm dev` y `WA_MOCK_ENABLED=true`:

```bash
node --env-file=.env scripts/e2e-mocks-404.mjs --expect=open
```

Y los dos arneses que dependen enteros de los mocks, en verde:

```bash
node --env-file=.env scripts/e2e-selftest.mjs
```

```bash
node --env-file=.env scripts/e2e-lab.mjs
```

## Nivel 3 — Modo producción de verdad ✅

No se razona: se construye y se mide. Con la base de desarrollo:

```bash
pnpm build
```

```bash
pnpm start -p 3100
```

(`next start` fija `NODE_ENV=production` por su cuenta; no hace falta
exportarlo.) Y contra ella:

```bash
node scripts/e2e-mocks-404.mjs --base=http://localhost:3100
```

Todas las rutas de `src/app/api/dev/` —derivadas del árbol— más la raíz y una
inexistente, con `GET HEAD POST PUT PATCH DELETE OPTIONS`: **404 en todas**.
`/api/health` sigue en 200 y `PUT /api/inexistente-de-verdad` en 404.

## En la flota (puerta de promoción)

El mismo guion vale contra una instancia desplegada, sin `.env`:

```bash
node scripts/e2e-mocks-404.mjs --base=https://uniko.lanco.cloud
```
