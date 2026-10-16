# Demostración de Uniko: capturas y videos

Material para enseñar cómo funciona Uniko sin abrir una instancia real. Todo sale
del negocio de ejemplo **Ferretería El Martillo**, con datos ficticios y contra
mocks locales: ningún mensaje, cliente ni número es real.

**Los archivos no viven en este repo**: se publican en la página oficial de
LanCo. Aquí quedan solo los guiones que los producen y esta guía. El script
exige `DEMO_OUT` (la carpeta de salida) y se niega si apunta dentro del repo.

## Videos

WebM (VP8), 1440×900, sin audio: cada paso lleva un **subtítulo en pantalla** y
un cursor visible.

| Video | Qué muestra |
|---|---|
| `01-bandeja-y-agente` | Llega un cliente nuevo, el agente le responde con los datos del negocio, detecta la intención de compra y lo mueve a «Interesado»; después una persona toma la conversación |
| `02-pipeline` | Arrastrar clientes entre etapas y registrar el monto de una oportunidad |
| `03-agente-y-conocimiento` | Nombre, tono y reglas del agente; encenderlo y apagarlo; agregar una pregunta/respuesta al conocimiento |
| `04-laboratorio` | Seis clientes simulados prueban al agente, el juez encuentra un hueco (83/100), se agrega la respuesta y la nueva corrida sube a 100 |
| `05-marca-y-ajustes` | Conexión de WhatsApp, plantillas, color de marca y tema claro/oscuro |
| `06-agenda-citas` | El cliente pide una cita por WhatsApp: el agente pregunta el día, mañana o tarde, ofrece cuatro horarios y la agenda; se ve en la ficha y en Citas |
| `07-inventario-y-catalogo` | El agente consulta existencias reales (con foto y precio, sin ofrecer lo agotado) y manda el catálogo en PDF |
| `08-anuncio-de-origen` | Una conversación que llega de un anuncio de Facebook/Instagram queda marcada con su creativo, y se filtra con «Anuncios» |
| `09-instagram-y-messenger` | DMs de Instagram y Messenger en la misma bandeja, contestados por el mismo agente |

## Capturas

PNG a 1440×900 (las móviles a 390×844 @2x). Del 01 al 15, con
`demo-media.mjs shots`: bandeja, pipeline, contactos, agente, Laboratorio,
ajustes, tema oscuro y móvil. Del 16 al 22 salen solas al grabar las escenas 06
a 09: agenda, inventario, anuncio de origen, Instagram y Messenger.

## Qué NO está en este material

- **Avisos push** (necesitan la app instalada y el permiso del teléfono).
- **La CAPI de atribución** (el reporte a Meta tras la bandera `ATRIBUCION`).

## Cómo se regenera

Contra una app local con los mocks encendidos y una **base desechable
`uniko_demo`** (nunca `uniko_dev` ni una instancia real). Tres servidores de
demostración se ponen delante de los mocks sin tocar el código de la app:

| Script | Puerto | Para qué |
|---|---|---|
| `scripts/demo-llm.mjs` | 3101 | Delante del ai-mock: el agente contesta con frases creíbles en vez de «Respuesta de prueba…» |
| `scripts/demo-stock.mjs` | 3102 | MS-Stock con productos de ferretería, fotos dibujadas y catálogo PDF |
| `scripts/demo-meta.mjs` | 3103 | Delante del wa-mock: sirve la imagen del anuncio desde el origen que la app acepta |

1. Node 22 y PostgreSQL 16 (ver [desarrollo-local.md](../desarrollo-local.md)) y
   `pnpm exec playwright install chromium`.
2. Base limpia, con la app parada:
   `DATABASE_URL=postgresql://…/uniko_demo node scripts/demo-reset-db.mjs`.
   Se niega con cualquier base que no sea `uniko_demo` en localhost, y deja la
   base en UTC (el Postgres de Windows trae la zona local y descuadra las horas
   de los mensajes nuevos).
3. Los tres servidores de la tabla, cada uno con `node scripts/demo-….mjs`.
4. La app en el puerto 3100 (el resto de variables, del `.env` local):

   ```bash
   DATABASE_URL=postgresql://postgres:…@localhost:5432/uniko_demo
   APP_BASE_URL=http://localhost:3100
   META_GRAPH_BASE_URL=http://localhost:3103/api/dev/wa-mock/graph
   OPENROUTER_BASE_URL=http://localhost:3101
   STOCK_BASE_URL=http://localhost:3102
   ZERNIO_BASE_URL=http://localhost:3100/api/dev/zernio-mock
   WA_MOCK_ENABLED=true
   AGENDA=on
   INVENTARIO=on
   CHANNELS=whatsapp,instagram,messenger
   pnpm exec next dev -p 3100
   ```

   Las escenas 01 a 05 se grabaron con `INVENTARIO` apagado: con él encendido,
   «¿tienen taladros?» consulta el inventario en vez de contestar con el
   conocimiento.
5. `DEMO_OUT="<carpeta fuera del repo>" node scripts/demo-media.mjs shots 01 02 …`

Las escenas **modifican** la base (clientes nuevos, etapas, conocimiento,
marca, citas): para repetirlas hay que partir de una base limpia, como en el
paso 2.
