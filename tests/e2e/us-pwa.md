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

### Pasada 2 — LanCo desplegada, **con marca real**

Tras el merge a `main`, en `https://uniko.lanco.cloud`.

> **Qué prueba esta pasada, y qué NO.** El degradado —instancia sin PNG propio,
> app instalada con el logo de Uniko— **ya quedó ejercido en la pasada 1** y no
> hace falta repetirlo. Lo que aquí se prueba, y en ningún otro sitio se ha
> probado fuera de los tests, es **el camino que van a recorrer los clientes**:
> subir su icono y ver que la app instalada pasa a llevar el suyo.
>
> Por eso el primer paso es **subir el PNG**. Instalar antes de subirlo
> convertiría esta pasada en una repetición de la anterior.

**Paso 0 — el icono, antes de instalar nada**

- [x] En Ajustes → Marca hay un aviso diciendo que el icono actual no sirve para
      la app instalada.
- [x] Se sube un **PNG cuadrado de 512×512 o más**.
- [x] **El aviso desaparece solo**, sin recargar a mano (FR-428).
- [x] `/api/branding/manifest` pasa a declarar **una sola entrada** de icono, la
      del negocio, con `sizes: "192x192 512x512"` (FR-425, FR-426).

**Instalación con la marca real**

- [ ] Android: el botón instala y en la pantalla de inicio aparece **el logo del
      negocio**, no el de Uniko, con el nombre del negocio debajo.
- [ ] iOS: lo mismo por Compartir → Añadir a pantalla de inicio.
- [ ] El `short_name` real del negocio **no se corta de forma fea** — esto solo
      se puede ver aquí: en la pasada 1 el nombre era "Uniko", que cabe en
      cualquier sitio.

**Lo que cierra la feature**

- [ ] **La no regresión del SSE en dispositivo**: con la app instalada, entra un
      mensaje real de WhatsApp y **aparece solo**, sin recargar (SC-007).
- [ ] Y si además se deja la app en segundo plano unos minutos antes de que
      entre, se ejerce de paso el fallo que arregló la 018, ahora con el service
      worker delante.

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

### Pasada 1, Android — 2026-09-07 ✅ VERDE (con matices de registro)

Túnel HTTPS (cloudflared) contra la app local, marca por defecto.

| Dato | Valor | Cómo se obtuvo |
|---|---|---|
| ¿Apareció NUESTRO botón? | **Sí**, sin pasar por el menú de Chrome (SC-001) | **respuesta explícita** |
| ¿El logo de fábrica se ve bien? | **"se ve claro y bien"** | **respuesta explícita**, tras preguntar por las tres causas posibles |
| Instalación desde el botón | correcta | cubierto por un *"todo funcionó bien"*, **no confirmado punto por punto** |
| Sin barra de direcciones | correcto | ídem |
| El aviso no reincide dentro de la app | correcto | ídem |
| Icono y nombre sin recortes feos | correcto | ídem |
| Versión de Android | **no registrada** | no se preguntó a tiempo / no se dio |

**Sobre el icono, con precisión**: se describió primero como "algo pobre" y
después, tras separar las tres causas posibles (máscara de Android sobre un
icono no `maskable`, borrosidad, o simplemente que no es la marca del negocio),
como **"se ve claro y bien"**. De ahí se concluye que **no es un problema de
render**. Conviene decir que esa conclusión sale de la descripción del dueño y
**no de una captura**: no llegó ninguna imagen del icono en la pantalla de
inicio.

Lo que falta es que sea SU logo, que es el degradado que la spec define a
propósito (FR-426), y se resuelve subiendo un PNG cuadrado de 512 o más.

**Consecuencia**: **rasterizar SVG en el servidor sigue descartado**. Era justo
lo que esta pasada tenía que averiguar antes de meter una dependencia de imagen
en el runtime.

**Pendiente operativo, no de código**: cada instancia sube su PNG antes de que
sus operadores instalen la app. Con el actual se instala igual, con el logo de
Uniko.

### Pasada 1, iOS — 2026-09-07 ✅ VERDE (registro global, sin desglose)

Mismo túnel, en Safari.

| Dato | Valor | Cómo se obtuvo |
|---|---|---|
| Instrucciones en vez de botón | correcto | cubierto por un *"todo bien en iOS también"*, **sin desglose** |
| Se pudo instalar siguiéndolas, sin ayuda | correcto | ídem |
| Pidió entrar de nuevo y el texto se entendió | correcto | ídem |
| Sin barra de direcciones | correcto | ídem |
| Versión de iOS | **no registrada** | no se dio |

**Honestidad sobre esta fila de verdes**: en iOS el dueño confirmó la pasada
entera con una frase, no punto por punto. La feature quedó ejercida —instalar en
iPhone requiere seguir las instrucciones, así que si no se entendieran no habría
app instalada— pero **el desglose de cada criterio no está registrado**, y esto
no debe leerse como si lo estuviera.

Lo que sí se puede afirmar sin matices, porque es consecuencia necesaria de que
la app quedara instalada: las instrucciones bastaron para llegar hasta el final
sin ayuda.

### Pasada 2, LanCo — 2026-09-07, en curso

**Despliegue**: LanCo pasó de `822b7f0` a **`e5337a4`**; `/sw.js` y el manifiesto
pasaron de 404 a 200. Antes del despliegue la instancia no era instalable, que es
lo que hace que esta pasada signifique algo.

**Paso 0 — el icono, ANTES de instalar** ✅

| Dato | Valor | Cómo se obtuvo |
|---|---|---|
| Punto de partida | `favicon: null`, `iconoInstalable: false`, manifiesto con los dos PNG de fábrica | **verificado desde fuera** por HTTP |
| Se subió un PNG del negocio | sí | acción del dueño |
| **El aviso desapareció solo, sin recargar** (FR-428) | **Sí** | **confirmación explícita del dueño** |
| El manifiesto quedó con **una sola entrada** | `/api/branding/icon?v=u1788830785540`, `sizes: "192x192 512x512"`, `image/png` | **verificado desde fuera** |
| El icono servido es el del negocio | **512×512, cuadrado, PNG**, y distinto byte a byte del de fábrica | **verificado leyendo los bytes**, no el JSON |
| Marca en el manifiesto | `name` "LanCo — CRM de WhatsApp", `short_name` "LanCo", `theme_color` `#3f6b66` | **verificado desde fuera** |

Esto es lo que la pasada 1 no podía probar: **el camino completo del cliente**
—aviso, subida, aviso que se retira solo, manifiesto con su icono— ejercido en
una instancia real y no en un test.

**Instalación con marca real** — pendiente (en curso)

**No regresión del SSE en dispositivo (SC-007)** — pendiente

### Hallazgo menor, anotado durante esta pasada

`GET /api/settings/branding` devuelve `iconoInstalable: false` a cualquier
llamada **sin sesión**: esa ruta es pública (el login necesita la marca) y sin
sesión no resuelve la organización, así que el campo cae a `false` aunque el
icono sí sirva. En la pantalla de Ajustes, con sesión, el dato es correcto — y el
manifiesto, que resuelve la organización por otro camino, ve el icono bien. **No
afecta a la feature**; queda apuntado para limpiar.
