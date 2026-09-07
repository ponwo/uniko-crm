# E2E — 019: PWA instalable en Android e iOS

Guion de la historia. Los niveles 1 y 2 están automatizados; el **nivel 3 es
manual y obligatorio** (Principio IX): instalar de verdad necesita HTTPS, y
`localhost` no lo da.

> Trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el alias `G:\`.

## Nivel 1 — Unidad ✅

`pnpm test`. Cubre las cuatro funciones puras: `sw-scope` (qué NO toca el service
worker), `platform` (iOS / Android / instalada), `png` (medidas desde el `IHDR`)
y `manifest` (la marca y los iconos), más el cuerpo servido en `/sw.js`.

## Nivel 2 — Escritorio, navegador real ✅ AUTOMATIZADO

Con la app viva y los mocks encendidos, `pnpm test:e2e` corre los tres arneses:
el HTTP, el de la 018 y `e2e-pwa.mjs`. Sale distinto de cero si algo falla.

- [x] El manifiesto responde con el nombre y el acento de **esta** instancia, se
      abre en la bandeja, en modo standalone, con id estable.
- [x] Declara iconos PNG de 192 y 512, y los dos responden.
- [x] El service worker se registra y **controla** la página.
- [x] **Las dos mitades de la exclusión del SSE, en la misma corrida**:
      `workerStart > 0` en la navegación —el service worker está en el camino— y
      `excluidasVistas === 0` según el propio service worker —nunca vio el canal.
- [x] El service worker no cachea nada y no pide permiso de notificaciones.
- [x] En Chromium sale el **botón**; se puede descartar y el descarte se respeta.
- [x] En modo instalado no sale nada, y se comprueba con las dos mitades: en el
      mismo contexto limpio el aviso SÍ aparece sin la señal de instalada.
- [x] En iPhone salen **instrucciones**, dicen qué tocar y dónde, sin jerga, y
      sin dar por hecho que es la primera vez.
- [x] En la app instalada y sin sesión, el login explica el re-login; en el
      navegador normal esa nota no aparece.
- [x] Sin PNG del negocio, el manifiesto trae los dos iconos de fábrica y Ajustes
      dice qué subir; subiendo un PNG de 512 pasa a una sola entrada y el aviso
      desaparece.
- [x] **Y el arnés completo de la 018 vuelve a correr con el service worker
      activo**, afirmándolo al arrancar.

### Corrida — 2026-09-07 ✅ VERDE

`pnpm test:e2e`: **103 + 26 + 46 = 175 checks**, 0 fallos, con un solo login para
toda la cadena (sesión compartida, sin tocar el límite de intentos de la app).

Dos cosas que se midieron en vez de suponerse, y que cambiaron el arnés:

- **`workerStart` no distingue** si la petición pasó por el handler: Chromium lo
  sella igual. La mitad 2 la reporta ahora el propio service worker.
- **Chromium no emula `display-mode: standalone`.** El escenario "ya instalada"
  pasaba por el motivo equivocado —el aviso estaba descartado de antes—, así que
  ahora se inyecta `navigator.standalone` (la señal real de iOS) y se comprueba
  con las dos mitades.

## Nivel 3 — Dispositivo real (OBLIGATORIO, manual)

Dos pasadas, en este orden.

### Pasada 1 — túnel HTTPS contra la app local

Levanta la app y abre un túnel con certificado hacia el puerto 3000. Arranca con
`APP_BASE_URL` puesto a la URL del túnel: el manifiesto y el registro del service
worker tienen que salir del mismo origen que visita el teléfono.

No toca ninguna instancia de clientes.

#### Android

- [x] Se abre la bandeja y aparece el **botón** de instalar dentro de la app (no
      hace falta el menú del navegador).
- [x] Al pulsarlo sale el diálogo del sistema y la app queda en la pantalla de
      inicio.
- [x] El icono es el esperado y el nombre debajo **no se corta de forma fea**.
- [x] Abierta desde la pantalla de inicio, **no hay barra de direcciones**.
- [x] El aviso ya no vuelve a salir dentro de la app instalada.

#### iOS

- [x] Aparecen las **instrucciones**, no un botón.
- [x] Siguiendo lo que dicen —Compartir → Añadir a pantalla de inicio— la app
      queda instalada, sin ayuda de nadie.
- [x] Al abrirla pide **iniciar sesión otra vez**, y el texto de esa pantalla se
      entiende sin sentirlo como un fallo.
- [x] Abierta desde la pantalla de inicio, no hay barra de direcciones.

#### Lo que hay que mirar con calma

- [x] ¿El logo de fábrica (el de Uniko) se ve **deliberado o pobre** en una
      instancia sin PNG propio? De esta respuesta depende si algún día hay que
      rasterizar en el servidor.

### Pasada 2 — LanCo desplegada

Tras el merge a `main`, en `https://uniko.lanco.cloud`. Es la que estrena y la
única con la marca de un negocio real.

- [ ] Se repite lo de arriba en las dos plataformas.
- [ ] **El que cierra la no regresión del SSE**: con la app instalada, entra un
      mensaje real de WhatsApp y **aparece solo**, sin recargar (SC-007).

### Qué anotar

| Dato | Android | iOS |
|---|---|---|
| Versión del sistema | | |
| ¿Botón / instrucciones? | | |
| ¿Icono y nombre correctos? | | |
| ¿`short_name` recortado de forma aceptable? | | |
| ¿Sin barra de direcciones? | | |
| ¿Pidió entrar de nuevo? ¿Se entendió? | — | |
| ¿Llegó un mensaje real estando instalada? | | |

## Registro de corridas

### Pasada 1, Android — 2026-09-07 ✅ VERDE

| Dato | Valor |
|---|---|
| Dónde | túnel HTTPS (cloudflared) contra la app local, marca por defecto |
| ¿Apareció NUESTRO botón? | **Sí** — sin pasar por el menú de Chrome (SC-001) |
| Instalación | correcta desde el botón |
| Abierta desde la pantalla de inicio | sin barra de direcciones |
| ¿Reincide el aviso dentro de la app? | no |
| Versión de Android | *no registrada* |
| ¿El logo de fábrica se ve bien? | **nítido**, sin recorte raro ni máscara mal aplicada |

**Sobre el icono**: el dueño lo describió primero como "algo pobre" y, al
distinguir las causas, quedó claro que **no es un problema de render**: se ve
claro y correcto. Lo que falta es que sea SU logo, que es exactamente el
degradado que la spec define a propósito (FR-426). Se resuelve subiendo un PNG
cuadrado de 512 o más, como dice el aviso de Ajustes → Marca.

**Consecuencia**: la opción de **rasterizar SVG en el servidor sigue
descartada**. No hizo falta, que era justo lo que esta pasada tenía que
averiguar antes de meter una dependencia de imagen en el runtime.

**Pendiente operativo, no de código**: cada instancia sube su PNG antes de que
sus operadores instalen la app. Con el actual se instala igual, con el logo de
Uniko.

### Pasada 1, iOS — 2026-09-07 ✅ VERDE

| Dato | Valor |
|---|---|
| Dónde | mismo túnel HTTPS, en Safari |
| ¿Instrucciones en vez de botón? | **Sí** |
| ¿Se pudo instalar siguiéndolas, sin ayuda? | **Sí** |
| ¿Pidió entrar de nuevo? | Sí — y el texto de la pantalla lo explicó bien |
| Abierta desde la pantalla de inicio | sin barra de direcciones |
| Versión de iOS | *no registrada* |

**Lectura**: las dos mitades de US2 se comportaron como se escribieron. Las
instrucciones sirvieron para instalar sin saber qué es una PWA, y el re-login
—que es del sistema y no tiene arreglo— se leyó como lo que es y no como un
fallo. Era lo único que esos dos textos tenían que conseguir.

### Pasada 2, LanCo — pendiente (tras el merge a `main`)
