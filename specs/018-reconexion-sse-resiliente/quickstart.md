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

> ### ✅ DESBLOQUEADO (2026-09-07)
>
> Estuvo bloqueado por no tener dónde correrlo: la máquina de desarrollo no
> levantaba la app, y en LanCo el simulador da **404 por diseño** —el gate
> `isMockEnabled()` exige `WA_MOCK_ENABLED=true` **y**
> `NODE_ENV !== "production"`, y aflojarlo sería abrir una superficie de
> desarrollo en una instancia con datos reales (Restricciones de Plataforma y
> Seguridad). **Eso no se tocó y no se toca.**
>
> Lo que se hizo fue montar el entorno que faltaba: Node 22 + PostgreSQL 16 +
> `.env` local con los mocks — [`docs/desarrollo-local.md`](../../docs/desarrollo-local.md).
> Era deuda de infraestructura, no de esta feature, y la 019 (PWA) la habría
> sufrido igual.

Levanta la app con los mocks:

```bash
WA_MOCK_ENABLED=true pnpm dev
```

y en otra terminal:

```bash
pnpm test:e2e
```

`pnpm test:e2e` encadena el arnés HTTP (`e2e-selftest.mjs`) y el de navegador
(`e2e-sse-reconexion.mjs`), que es el que cubre esta historia.

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

Camino infeliz cubierto también: sin red se avisa, no se reintenta en bucle
apretado, y se recupera al volver la red.

### Lo que se aprendió al automatizarlo

Tres cosas que no estaban escritas y que cambian cómo se lee un verde aquí:

1. **Hay que enmudecer TODAS las conexiones del arranque, no "la primera".** En
   desarrollo React monta el efecto dos veces y la pantalla tiene dos
   suscripciones vivas (la bandeja y el contador de la barra). Enmudeciendo una
   sola, la conexión viva era la sana y el arnés pasaba por el camino bueno
   creyendo que probaba el malo.
2. **El aviso hay que darle tiempo a existir.** Sale con 2 s de retardo a
   propósito (FR-312) y en `localhost` reconectar + refrescar tarda ~1 s: la
   recuperación entera cabe dentro del retardo y no hay nada que ver. El arnés
   frena el REFRESCO durante una ventana —no el reloj del vigilante— para poder
   mirar el orden. En un teléfono con red móvil, que es donde se reportó el
   fallo, ese refresco tarda de sobra.
3. **"Sin conexión" no es lo que se ve al quedarse sin red con la pestaña
   delante.** El navegador sigue reintentando por su cuenta (`readyState`
   CONNECTING), así que el vigilante dice *Reconectando…* y deja que reintente
   —que es lo correcto: no duplicar reconexiones—. *Sin conexión* queda para la
   pestaña oculta. El aviso sale igual y el operador se entera igual.

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

### Android — reproducir el fallo, igual que en iOS

*(Corregido 2026-09-07: aquí decía que el fallo "no está reportado en Android" y
que la plataforma era solo criterio de no regresión. La corrida real lo desmintió
—se reprodujo igual que en iOS—, y aquella afirmación no venía de ninguna fuente:
era una deducción nuestra a partir de que el reporte de iOS 18 hablaba de iOS.)*

Mismo procedimiento y mismo criterio que en iOS, incluido que **una corrida en la
que el fallo no se reproduzca no cuenta**. Además, lo específico de esta
plataforma:

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
