# Quickstart: verificación de la 033

Principio IX: esto lo corre quien implementa, hasta verde. No se delega al dueño.

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Con la matriz de CI en mente: los unitarios corren con las banderas vacías (`default`) y
con todo encendido (`completo`). La zona del negocio depende de `AGENDA`: los tests de la
puerta fijan la bandera en los dos sentidos.

## 2. Arnés de la feature

App viva con mocks (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock), base **fresca** y migrada (`pnpm db:dev`):

```bash
node --env-file=.env scripts/e2e-kb-vigencia.mjs
```

Lo que comprueba (FR-1853):

1. Alta sin fecha → `vigente`, `validUntil: null`.
2. Alta con fecha futura lejana → `vigente`; a 5 días → `por_vencer`; hoy → `por_vencer`
   (vale todo hoy); ayer → `vencida`.
3. `validUntil: "el martes"` y `"2026-02-31"` → `422` con mensaje, nunca `500`.
4. `/api/kb/size` no cuenta la vencida.
5. `/api/bot/profile` trae el token de la vigente y no el de la vencida.
6. Turno del agente (inbound por el wa-mock): pregunta por el token vencido →
   `NO_CONOZCO`; por el vigente → `SI_CONOZCO`; por el permanente → `SI_CONOZCO`.
7. Renovar la vencida (`PATCH` fecha futura) → el siguiente turno `SI_CONOZCO`, sin haber
   tocado el texto. Quitar la fecha (`null`) → permanente.
8. Editar solo el texto → la fecha no cambia.
9. El prompt del agente lleva `AHORA ES:` y la regla del historial (estado del ai-mock).
10. Laboratorio: tras una corrida, el último prompt (el del juez) no contiene el token
    vencido y sí el vigente; generar escenarios → el prompt del generador, igual.
11. Pantalla (Playwright, `/agent`): aviso de «por vencer», la vencida dentro de
    «Conocimiento obsoleto» con su fecha, «Hacer permanente» la saca de obsoletos,
    editar el texto conserva la fecha.

Y en la cadena completa (`pnpm test:e2e`), los arneses existentes siguen verdes con y sin
`AGENDA` (el eco del ai-mock no cambia; `e2e-lab.mjs` sigue en 83 → 100).

## 3. Lo que hay que demostrar en ROJO

Que la suite pase no prueba nada; hay que enseñar que puede caerse:

1. **Un `from(schema.kbEntry)` fuera de la puerta** → cae `kb-vigencia-guard.test.ts`.
2. **El corte en UTC** (calcular `hoy` con `toISOString()`) → cae el borde de las 18:30
   en `kb-vigencia.test.ts`.
3. **Un lector sin filtro** (el pipeline leyendo `conocimientoCompleto`) → cae el check
   del agente en el arnés (`NO_CONOZCO` esperado, `SI_CONOZCO` recibido).

## 4. Ensayo del Principio X (antes de `main`)

Un Postgres **desechable** local, con los respaldos reales de ILTU y NuriaAndrea
restaurados (en `C:\G\gApps\LanCo\BackUps\<cliente>\`). Nunca contra una instancia viva.

1. Crear una base desechable por cliente y restaurar (`pg_restore --no-owner`).
2. Contar filas de `kb_entry` antes.
3. Aplicar las migraciones del branch (`node scripts/migrate.mjs` con `DATABASE_URL` →
   la desechable): debe aplicar `0018` (y la `0017` si el volcado es anterior).
4. Comprobar: la columna existe, es nullable, **todas** las filas tienen
   `valid_until IS NULL`, el conteo no cambió.
5. Re-ejecutar las migraciones: no hace nada (idempotente).
6. Arrancar la app contra esa base y abrir `/agent`: el conocimiento se ve completo y
   todo `vigente`.
7. Borrar las bases desechables.

Reversión declarada: redesplegar el commit anterior. La columna queda sin uso: el código
viejo no la nombra y un `select()` de todas las columnas solo trae un campo de más.

## 5. Tras el merge (instancia de pruebas, `uniko-lanco`)

- `/api/health` con el commit nuevo y `[migrate] migraciones aplicadas` en el log.
- El dueño pone fecha a una entrada real y ve los estados.
- Prueba con el modelo real de la regla del historial: una conversación vieja donde el
  agente mencionó algo que hoy ya no está en el conocimiento.
- Sin promover a `production`: eso es la puerta de promoción, por señal del dueño.
