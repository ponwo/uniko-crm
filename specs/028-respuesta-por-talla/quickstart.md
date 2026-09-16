# Quickstart — 028 Respuesta por talla y fotos por producto

Guía de **verificación en vivo** (Principio IX): con los mocks primero, contra MS-Stock
local después y contra la instancia de pruebas al final, con los cuatro modelos
reales. Contratos: [turno-check-stock.md](contracts/turno-check-stock.md) ·
[forma-exacta-delta.md](contracts/forma-exacta-delta.md) · MS-Stock:
[`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md) §4.

## 0. Prerrequisitos

- Los de la 026 ([quickstart §0](../026-conector-inventario/quickstart.md)): Node 22
  (`eval "$(fnm env --shell bash)" && fnm use 22`), Postgres 16, `.env` con los mocks
  y el conector apuntando al stock-mock (`INVENTARIO=on`, `STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock`, …).
- **MS-Stock ya con el contrato §4 y el plural mergeados** (PR propio del repo hermano):
  es el orden que exige FR-1310.
- Windows: antes de relanzar `pnpm dev`, matar el anterior con `taskkill //F //PID <pid>
  //T` (o `//IM node.exe`); `pkill` no lo mata y el arnés le pegaría al viejo.

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Tests nuevos/ampliados: `check-stock-turn` (conjunto, tope, dedupe, frases, un producto
idéntico), `stock-client` (`limit=25`), `inventario-prompt` (singular), `stock-mock`
(catálogo ampliado, plural), `wa-mock-media` (rechazo por link).

## 2. App viva y self-test automatizado

```bash
pnpm dev            # http://localhost:3000, con INVENTARIO=on
pnpm test:e2e       # scripts/e2e-selftest.mjs, sección "== 028: respuesta por talla y fotos =="
```

Lo que verifica la sección 028 (catálogo del stock-mock, [contrato §3](contracts/turno-check-stock.md)):

| Pregunta | Salientes esperados |
|---|---|
| "¿tienen playeras en G?" (plural) | `image` NEG con pie `Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN` · `text` `Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN` · `image` GRS con pie `Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN`; nada más; ningún texto contiene "agotad", "no viene" ni otra talla |
| "¿tienen playeras en M?" | `image` NEG · `image` VRD (`talla M: 10 pieza — $200 MXN`); roja (M 0), gris (M 0), azul y amarilla (sin M) ausentes |
| "¿tienen playeras en XCH?" / "… en extra chica" | `image` NEG · `image` AZL (`talla XCH: 1 pieza — $800 MXN`) |
| "¿tienen pantalones en 40?" | un solo `text`: `Déjame revisar.\nPor ahora no tengo pantalones en talla 40.` |
| "¿tienen pantalones en 32?" | `image` PAN-AZ (`talla 32: 4 pieza — $650 MXN`) · `text` PAN-NG (`talla 32: 1 pieza — $650 MXN`) |
| "¿tienen playeras?" (sin talla) | 5 mensajes (NEG img, ROJ txt, AZL img, VRD img, GRS img; blanca agotada ausente) + `text` `Hay más coincidencias, ¿me dices cuál te interesa?`; ≤ 5 `image` y sin `link` repetido |
| `media-mode {reject, link:"m=grs"}` + "¿tienen playeras en G?" | `image` NEG · `text` ROJ · `text` GRS (la línea, sin foto), en ese orden; `[agente] foto:` en el log; ningún mensaje `failed` en el hilo |
| Laboratorio (conversación de prueba) "¿tienen playeras en M?" | dos mensajes `image` persistidos con `media.payload.url` y el pie como `text`, sin tocar Graph |
| Casos 1–8 y 10–17 de la 026 | texto **idéntico** al esperado hoy; el caso 9 pasa a la regla nueva |

Con la bandera **apagada** (`INVENTARIO=` vacío, base desechable nueva): el arnés
completo pasa sin cambios (nada de esto existe).

## 3. Self-test manual en el Laboratorio

1. Laboratorio → conversación de prueba → "¿tienen playeras en G?": aparecen dos
   burbujas de imagen (negra, gris) con su pie y una de texto (roja) entre ellas, en
   ese orden; la frase de entrada solo en la primera.
2. "¿tienen playera roja en M?": una sola burbuja de texto con `agotada — … Con
   existencia: CH 4, G 7, XG 1` (regla de un producto, sin cambio).
3. Inbox: el hilo enseña las imágenes como `image` con la URL pública y el pie, marcadas
   IA, sin `failed`.

## 4. Contra MS-Stock real en local

MS-Stock local (`uv run uvicorn app.main:create_app --factory --port 8000` en el repo
hermano) con un catálogo réplica del real (`PLA-AZL`, `PLA-NGO`, `PLY-ROJ`, `PLA-VRD` con
foto vía el stub S3 o sin foto); `.env` de Uniko con `STOCK_BASE_URL=http://localhost:8000`
y su llave. Preguntar en el Laboratorio "¿tienen playeras en G?" → Negra y roja; "¿en
M?" → Negra y verde; "¿en XCH?" → solo roja; "¿en 24?" → `Por ahora no tengo playera en
talla 24.` (la consulta tal como la mandó el modelo: en singular por el prompt); "¿tienen playeras negras?" (plural doble) → Negra. Confirma D1 (plural) y D2
(forma) del contrato contra el servicio de verdad.

## 5. Despliegue e instancia de pruebas (SC-007)

1. PR → CI verde (`default` y `completo`) → merge a `main` = **señal del dueño** →
   Coolify despliega `uniko-lanco`; `GET /api/health` reporta el commit.
2. En WhatsApp (número de pruebas) o en el Laboratorio de `uniko.lanco.cloud`, contra
   `stock.lanco.cloud` con los cuatro modelos reales:
   - "¿tienen playeras en G?" → foto Negra + `Playera Negra (PLA-NGO) talla G: 8 pieza
     — $300 MXN`; foto roja + `Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN`.
   - "¿en M?" → Negra (M 9) y verde (M 10) con foto; sin roja ni Azul.
   - "¿en XCH?" → solo la roja (XCH 2).
   - "¿tienen playeras en 24?" → `Por ahora no tengo playera en talla 24.` (sin fotos).
   - "¿tienen playera roja en M?" → `agotada — $219 MXN. Con existencia: XCH 2, CH 4, G
     7, XG 1` con foto (026 intacta).
3. Registrar aquí los resultados (mensajes recibidos, `ms`, log de `uniko-lanco` sin
   `[agente] inventario:` de error) y cerrar la T057 de la 026 con la misma evidencia.
4. **No promover a `production`**: eso es otra señal del dueño (puerta de promoción de
   la constitución).

## Criterio de "Hecho"

Gate verde · arnés verde en ambas configuraciones · §3 y §4 observados · SC-007 en la
instancia de pruebas con los cuatro modelos · derogaciones marcadas en la 026 ·
contrato §4 de MS-Stock actualizado antes del código · docs (`inventario-conector.md`,
`us-inventario.md`, README, CLAUDE.md) al día.
