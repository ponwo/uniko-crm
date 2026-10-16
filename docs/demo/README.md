# Demostración de Uniko: capturas y videos

Material para enseñar cómo funciona Uniko sin abrir una instancia real. Todo sale
del negocio de ejemplo **Ferretería El Martillo**, con datos ficticios y contra
los mocks locales: ningún mensaje, cliente ni número es real.

## Videos (`videos/`)

Formato WebM (VP8), 1440×900, sin audio: cada paso lleva un **subtítulo en
pantalla** y un cursor visible. Se abren con Chrome, Edge, Firefox o VLC.

| Video | Qué muestra | Duración aprox. |
|---|---|---|
| `01-bandeja-y-agente.webm` | La bandeja de WhatsApp en tiempo real: llega un cliente nuevo, el agente de IA le responde con los datos del negocio, detecta la intención de compra y lo mueve a «Interesado»; después una persona toma la conversación | 1 min |
| `02-pipeline.webm` | El embudo: arrastrar clientes entre etapas y registrar el monto de una oportunidad | 30 s |
| `03-agente-y-conocimiento.webm` | Configurar al agente (nombre, tono, reglas de escalado), encenderlo y apagarlo, y agregar una pregunta/respuesta al conocimiento | 35 s |
| `04-laboratorio.webm` | El Laboratorio: seis clientes simulados prueban al agente, un juez encuentra un hueco (83/100), se agrega la respuesta que faltaba y la nueva evaluación sube a 100 | 1 min 30 s |
| `05-marca-y-ajustes.webm` | Conexión de WhatsApp, plantillas, marca propia (color) y tema claro/oscuro | 30 s |

## Capturas (`capturas/`)

PNG a 1440×900 (las móviles a 390×844 @2x): bandeja, cotización, pipeline,
contactos, agente (comportamiento y conocimiento), Laboratorio (reporte y
hallazgo con sugerencia), ajustes de WhatsApp, plantillas y marca, tema oscuro
y vista móvil.

## Qué NO está en este material

- **Agenda** (citas por WhatsApp y conectores de Zoom/Meet/Google) e
  **Inventario** (conector a MS-Stock): son módulos opcionales apagados por
  defecto y necesitan su propia puesta en escena.
- **Canales de Instagram y Messenger**, **atribución de anuncios** y **avisos
  push**.

## Cómo se regenera

Todo se produce con `scripts/demo-media.mjs`, contra una app local con los
mocks encendidos y una **base desechable `uniko_demo`** (nunca `uniko_dev` ni una
instancia real).

1. Node 22 y PostgreSQL 16 (ver [desarrollo-local.md](../desarrollo-local.md)) y
   `pnpm exec playwright install chromium`.
2. Base limpia (con la app parada): `DATABASE_URL=postgresql://…/uniko_demo node scripts/demo-reset-db.mjs`.
   Se niega con cualquier base que no sea `uniko_demo` en localhost.
3. LLM de demostración: `node scripts/demo-llm.mjs` (puerto 3101). Va delante del
   ai-mock y hace que el agente conteste con frases creíbles en vez de
   «Respuesta de prueba…».
4. La app en el puerto 3100 con estas variables (el resto, del `.env` local):

   ```bash
   DATABASE_URL=postgresql://postgres:…@localhost:5432/uniko_demo
   APP_BASE_URL=http://localhost:3100
   META_GRAPH_BASE_URL=http://localhost:3100/api/dev/wa-mock/graph
   OPENROUTER_BASE_URL=http://localhost:3101
   WA_MOCK_ENABLED=true
   INVENTARIO=off
   pnpm exec next dev -p 3100
   ```
5. `node scripts/demo-media.mjs shots` para las capturas, recargar la demo
   (`pnpm seed:demo --force` con el mismo `DATABASE_URL`) y
   `node scripts/demo-media.mjs 01 02 03 04 05` para los videos.

Las escenas **modifican** la base (cliente nuevo, etapas, conocimiento, marca):
para repetirlas hay que partir de una base limpia, como en el paso 2.
