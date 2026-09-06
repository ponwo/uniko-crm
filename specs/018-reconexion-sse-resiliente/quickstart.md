# 018 — Quickstart: cómo ejercer y verificar

Los tres niveles de la spec, en orden de coste. Ninguno sustituye al siguiente.

> **Antes de nada**: trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el
> alias `G:\`, o `predev`/`prebuild` te cortan. Ver
> [`memory/build-rojo-desde-la-unidad-g.md`](../../memory/build-rojo-desde-la-unidad-g.md).

## Nivel 1 — Unidad

```bash
pnpm test
```

Cubre la función pura de decisión con reloj inyectable. Lo que debe quedar
probado:

- silencio por **debajo** del margen (60 s) → no pasa nada;
- silencio por **encima** → se declara muerta;
- la página se hace visible → comprobación inmediata, sin esperar al margen;
- `error` con `readyState === CONNECTING` → esperar, el navegador ya reintenta;
- `error` con `readyState === CLOSED` → un intento; si vuelve a cerrar, sesión
  terminada y **sin más reintentos**;
- la espera crece 1→15 s y se **reinicia** al conectar bien;
- con la página oculta no se reintenta.

No necesita servidor ni navegador: es la parte determinista.

## Nivel 2 — Escritorio, con muerte silenciosa simulada

> ### ⚠️ BLOQUEADO: hoy no hay dónde correrlo
>
> Este nivel necesita la app levantada **fuera de producción**, y ahora mismo no
> existe ese entorno en ningún sitio:
>
> - **En la máquina de desarrollo**, la app no arranca: no hay `.env`, no hay
>   PostgreSQL escuchando en 5432 y no hay Docker ni WSL instalados para
>   levantarlo. (Comprobado 2026-09-06.)
> - **En LanCo, NO se puede**, y no es cuestión de poner una variable. El gate
>   `isMockEnabled()` exige `WA_MOCK_ENABLED=true` **y**
>   `NODE_ENV !== "production"`. LanCo corre el build standalone de producción,
>   así que `/api/dev/sse-mudo` devuelve **404 ahí pase lo que pase**.
>
>   Y así debe quedarse: "las rutas de mock/desarrollo devuelven 404
>   incondicional en producción" es una regla dura de la constitución
>   (Restricciones de Plataforma y Seguridad). Aflojar ese gate para poder
>   probar sería abrir una superficie de desarrollo en una instancia con datos
>   reales — y LanCo ya tiene número de WhatsApp conectado. **No se hace.**
>
> **Consecuencia para esta feature**: la verificación determinista de la muerte
> silenciosa se cubre hoy con los tests unitarios (`sse-watchdog.test.ts`,
> `sse-mudo.test.ts`, `connection-status.test.ts`), y el camino de navegador
> queda pendiente. El nivel 3 en dispositivo real **no lo sustituye pero sí lo
> compensa**: prueba lo mismo con la causa real en vez de simulada.
>
> **Esto no es deuda de esta feature, es de infraestructura**: falta un entorno
> donde la app arranque fuera de producción. Se ataca aparte. Anotarlo aquí
> porque la **019 (PWA) lo va a sufrir más**: un service worker no se puede
> probar de ninguna forma sin navegador contra una app viva.

Cuando exista ese entorno, esto es lo que hay que correr. Levanta la app con los
mocks:

```bash
WA_MOCK_ENABLED=true pnpm dev
```

y en otra terminal:

```bash
pnpm test:e2e
```

El guion usa el **simulador** (`src/app/api/dev/…`, tras `src/lib/dev-guard.ts`)
que abre un stream SSE válido y **deja de escribir sin cerrarlo** — el síntoma
exacto que produce iOS. Camino que debe quedar verde:

1. la bandeja está conectada y al día;
2. el stream enmudece sin cerrarse (ni `error`, ni `readyState` distinto de
   OPEN);
3. pasado el margen, la app **lo detecta** y muestra el aviso;
4. reconecta;
5. hace el catch-up y **el aviso desaparece solo entonces**, no antes;
6. los mensajes que entraron durante el hueco están, sin duplicados.

Camino infeliz a cubrir también: sin red, aparece *sin conexión*, no se reintenta
en bucle apretado, y se recupera al volver la red.

> El simulador responde **404 en producción**, incondicionalmente. Es el gate que
> ya existe; no se añade otro.

## Nivel 3 — Dispositivo real (OBLIGATORIO)

Con la feature desplegada en **LanCo** (`https://uniko.lanco.cloud`), no en
`localhost`. Aquí no se está comprobando lo mismo en cada plataforma.

### iOS — reproducir el fallo

1. Abre la app en Safari en un iPhone y entra a la bandeja.
2. Mándala a segundo plano (bloquea el teléfono o cambia de app) **varios
   minutos**, lo bastante para que el sistema la congele.
3. Que entre un mensaje real durante el hueco.
4. Vuelve a primer plano.

**Criterio**: el mensaje aparece, y en ningún momento la pantalla afirmó estar al
día cuando no lo estaba.

**Cuenta solo si el fallo se reprodujo** (SC-009). Si al volver resulta que el
navegador sí avisó del cierre, se ejerció el camino que ya funcionaba antes y la
corrida no dice nada: repite alargando el tiempo en segundo plano, o **anótalo
como "no reproducido"**. Un verde sin fallo reproducido es ruido.

### Android — comprobar que no se rompió nada

El fallo silencioso no está reportado en Android y Chrome normalmente sí avisa
del cierre. **No fuerces la narrativa**: si no se reproduce, es lo esperado y así
se registra. Lo que hay que ver:

- el ciclo normal (segundo plano → mensaje → volver) deja la vista al día,
  **incluido el contador de no leídos** de la barra de navegación;
- **no** aparecen reconexiones espurias ni parpadeo del aviso (FR-312);
- el aviso sale cuando de verdad no hay red y desaparece al volver.

### Qué anotar

Deja registrado, en el PR o en el guion de la historia:

- si el fallo se reprodujo en iOS (sí / no);
- cuánto tiempo estuvo en segundo plano;
- versión de iOS y de Android probadas;
- qué se vio en pantalla al volver.

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Los cuatro, desde la ruta real. Es el piso, no el techo: sin el nivel 3 esta
feature no está Hecha (Principio IX).
