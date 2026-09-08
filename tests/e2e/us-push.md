# E2E — 020: avisos cuando el agente escala

Guion de la historia. Los niveles 1 y 2 están automatizados; el **nivel 3 es
manual y obligatorio** (Principio IX): que una notificación llegue de verdad a un
teléfono no lo puede afirmar ningún arnés.

> Trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el alias `G:\`.

> ### La regla que manda en este guion (heredada de la 018)
>
> **Una corrida en la que la notificación NO llegó no cuenta como
> verificación.** No es "casi verde", no es "seguramente por el modo de ahorro
> de batería", no es "ya llegará". O se repite hasta que llegue, o se registra
> abajo **explícitamente como *no reproducida*** — con lo que se vio y lo que se
> intentó.
>
> Es la misma regla que la 018, y por el mismo motivo: en un canal que a veces
> falla, dar por bueno lo que no se vio es exactamente cómo se cuela el fallo
> que la feature venía a arreglar. **SC-009 dice esto y no otra cosa.**

---

## Nivel 1 — Unidad ✅

`pnpm test`. Cubre lo que es función pura o generación determinista:

- **a quién se avisa** — y que con `is_test` no se avisa a nadie (FR-503);
- **que el aviso construido no lleva datos del negocio** (FR-505);
- **los textos**: el normal, el degradado, y que ninguno explica el mecanismo por
  vigésima vez (FR-507b);
- **las claves**: generación del par VAPID, cifrado en reposo, firma ES256;
- **el cuerpo de `/sw.js`** con la bandera apagada y encendida — incluido que
  encenderla **cambia los bytes** del archivo, que es lo único que hace que un
  worker ya instalado se entere de que hay versión nueva.

## Nivel 2 — Escritorio, navegador real ✅ AUTOMATIZADO

`scripts/e2e-push.mjs`, encadenado en `pnpm test:e2e`.

**Se corre dos veces, y las dos importan.** El guion mira la bandera y se adapta:

- Con la app arrancada **sin `PUSH`** comprueba el escenario A y termina: es la
  configuración de fábrica de toda la flota, y hay que verla apagada.
- Con la app arrancada con **`PUSH=on`** y `PUSH_SERVICE_BASE_URL` apuntando al
  mock (`http://localhost:3000/api/dev/push-mock`) corre los cuatro escenarios.

### A — con la bandera apagada, la feature no existe (FR-518/519, SC-003)

- [x] Las rutas de push responden **404**.
- [x] El service worker **no lleva** manejador de `push`, ni `notificationclick`,
      ni pide el detalle a ningún sitio.

### B — una escalación real avisa, y el aviso va vacío (FR-505, SC-002)

- [x] Una escalación de verdad del agente produce **un envío**.
- [x] **El cuerpo del envío va VACÍO** — comprobado mirando lo que recibió el
      mock, no razonándolo.
- [x] Va firmado con VAPID, y **ni el endpoint lleva datos del cliente**.
- [x] El detalle lo sirve la propia instancia: el título nombra a quien espera y
      el cuerpo dice **a qué entra**, no cómo funciona el producto (FR-507b).
- [x] Tocar el aviso abre **esa** conversación, no la bandeja genérica (FR-508).

### C — el Laboratorio no avisa a nadie (FR-503, SC-006)

- [x] Una escalación del Laboratorio **no manda ninguna notificación**, y se
      comprueba tras esperar a que el canal quede en silencio: la ventana de
      agrupación del agente son 6 s, así que mirar a los 3 s es la receta exacta
      para culpar al Laboratorio de un envío del escenario anterior.

### D — los caminos infelices no cuestan escalaciones (FR-504, FR-514, SC-004/007)

- [x] Un endpoint que responde **410** desaparece de la base sin que nadie lo
      pida.
- [x] Con endpoints caducados y rechazando, **la escalación se guarda igual**.
- [x] Activar dos veces el mismo teléfono no crea dos filas, y desactivar dos
      veces no es un error (Principio IV).

### E — la 019 sigue en pie con push encendido (FR-521/522/523)

- [x] El service worker se registra y **controla** la página.
- [x] **Las dos mitades en la misma corrida y con la bandera ENCENDIDA**: el
      worker está en el camino, y **nunca vio `/api/events`**.
- [x] El cuerpo servido conserva las reglas de exclusión, **con el manejador de
      push presente**.

### Corrida — 2026-09-08 ✅ VERDE

`pnpm test:e2e` con `PUSH=on`: **31 checks** del guion de push, 0 fallos, sobre
los 175 de la cadena anterior.

Dos cosas que se midieron en vez de suponerse:

- **El sondeo, no el `sleep`.** Con una espera fija de 3 s el escenario C
  "detectaba" envíos del B y culpaba al Laboratorio. Ahora se espera al envío y
  después al silencio.
- **El guardarraíl del Laboratorio es doble** —lo comprueba el arnés y lo
  comprueban los tests— y se falsificó a propósito antes de darlo por bueno.

---

## Nivel 3 — Dispositivo real (OBLIGATORIO, manual)

Necesita tres cosas a la vez, y ninguna se puede fingir: **un teléfono con la app
instalada**, **el permiso concedido** y **una escalación real del agente**.

Se corre sobre **LanCo desplegada** (`https://uniko.lanco.cloud`), que es donde
la app ya está instalada desde la 019 y donde hay un número de WhatsApp real al
que escribir. Ninguna instancia de clientes se toca: `PUSH` sigue apagada en
todas hasta que esto salga verde.

### Antes de empezar (una vez)

1. **La 020 mergeada a `main` y LanCo desplegada** con ese commit — se comprueba
   en `/api/health`, que reporta el commit, no solo `ok:true`.
2. **`PUSH=on` en las variables de LanCo** y redespliegue. Encenderla no pide
   credenciales de nadie: la instancia genera su par de claves VAPID la primera
   vez y guarda la privada cifrada.
3. **Abrir la app instalada una vez y cerrarla.** Encender la bandera cambia los
   bytes de `/sw.js`, así que el navegador instala la versión nueva del worker
   —la que sí trae el manejador de `push`— en esa visita. Sin este paso, el
   teléfono sigue con el worker viejo y **no llega nada**, y se parecería
   muchísimo a un fallo de la feature.

### Paso a paso, en este orden

**1. Activar los avisos en el teléfono**

- Abrir la app **desde la pantalla de inicio** (no desde el navegador).
- Ir a **Ajustes → Avisos**.
- Pulsar **Activar avisos** y **aceptar** el permiso del sistema.
- Confirmar que la tarjeta pasa a decir *"Activados en este dispositivo."*

**2. Cerrar la app del todo** — no dejarla en segundo plano: cerrarla. Es la
mitad de lo que esta prueba existe para responder.

**3. Provocar una escalación real** — desde **otro** teléfono, escribir por
WhatsApp al número de LanCo: **"quiero hablar con una persona"**. Eso es el
handoff por `cliente`, el más fácil de provocar a voluntad.

**4. Mirar el teléfono.** El agente agrupa ráfagas 6 s antes de contestar, así
que el aviso tarda unos segundos, no es instantáneo.

**5. Tocar la notificación** y ver dónde cae.

**6. La segunda escalación** — desde un **tercer** número (o el mismo contacto
tras responderle y devolverle la conversación al agente), repetir el paso 3. Esto
es lo que separa Android de iOS, y va detallado abajo.

**7. El texto degradado (FR-507, SC-008).** No se prueba con el modo avión: sin
red no llega el push, así que no habría nada que ver. Lo que sí lo ejerce es
**cerrar sesión en la app** —la suscripción vive en el navegador, no en la
sesión, así que el aviso sigue llegando— y provocar otra escalación: el worker
pregunta el detalle, recibe un 401 y debe enseñar *"Alguien necesita atención /
Abre la bandeja para ver quién"*. **Volver a entrar después.**

**8. El Laboratorio no suena (SC-006) — NO se ejerce en dispositivo.** Decidido
el 2026-09-08, con su razón, y **no se da por verde**: ver abajo, en el registro
de corridas. El guardarraíl queda cubierto por el nivel 1 y el nivel 2; lo que
NO hay es una confirmación en teléfono real, y así se dice.

**9. La 018 y la 019 siguen vivas.** Con la app abierta, que entre un mensaje y
aparezca **solo**, sin recargar. Si esto se rompió, se rompió con el service
worker nuevo delante.

### Qué se comprueba en Android

Chrome respeta la `tag` de la Notifications API: **una conversación, una
notificación**.

- [ ] Llega con la app **cerrada del todo**, no solo en segundo plano.
- [ ] El título nombra al contacto y el cuerpo dice el motivo
      ("Pidió hablar con una persona").
- [ ] Se ve **el icono del negocio**, no uno genérico.
- [ ] Al tocarla se abre **esa** conversación.
- [ ] **Dos escalaciones de contactos DISTINTOS → dos notificaciones**, cada una
      a su hilo.
- [ ] Con la app ya abierta, tocar el aviso **enfoca esa ventana** y la lleva al
      hilo — no abre una segunda pestaña encima de lo que estabas haciendo
      (FR-508c).

> **Por qué no se pide aquí el caso "dos avisos de la MISMA conversación"**: casi
> no puede ocurrir. El pipeline calla en cuanto hay `handoff_at`, así que la
> segunda escalación de la misma conversación exige devolvérsela al agente
> primero. Si se consigue provocar, lo esperado en Android es que **la nueva
> reemplace a la anterior**; anótalo si pasa, pero no bloquea la corrida.

### Qué se comprueba en iOS

Aquí hay una pregunta **abierta** que este nivel existe para responder (research
R4): está documentado que **Safari ignora la `tag`** y crea una notificación
nueva por cada push, y que **ignora el `icon`** (usa el de la app). El reporte es
de iOS 16.4 y el issue sigue abierto; no hay fuente que confirme que se arregló
ni que sigue roto. **La spec funciona en los dos casos** — lo que no vale es
suponer cuál.

- [ ] En una **pestaña de Safari** (no la app instalada), Ajustes → Avisos dice
      que hacen falta instalarla, en vez de ofrecer un botón que no puede
      funcionar (FR-513).
- [ ] Desde la **app instalada**, el permiso se pide **dentro del toque** y se
      concede.
- [ ] Llega con la app **cerrada del todo**.
- [ ] Al tocarla se abre **esa** conversación.
- [ ] **La pregunta de R4**: dos avisos seguidos —de la misma conversación si se
      puede, y si no de dos contactos distintos— ¿se **apilan** o se
      **reemplazan**? Responder con lo que se vio, no con lo que dice la
      documentación.
- [ ] **Anotar la versión de iOS.** Sin ella la respuesta anterior no sirve para
      nada: es la variable de la que depende.
- [ ] ¿Qué icono muestra el sistema? (si ignora el nuestro y usa el de la app
      instalada, es lo esperado y no es un fallo).

### Qué anotar

| Dato | Android | iOS |
|---|---|---|
| Versión del sistema | | |
| ¿Llegó con la app cerrada? | | |
| Cuánto tardó (aprox.) | | |
| Texto que se vio (título / cuerpo) | | |
| ¿Al tocarla abrió ESA conversación? | | |
| Dos escalaciones: ¿apilan o reemplazan? | | |
| Icono mostrado | | |
| Texto degradado sin sesión | | |
| El Laboratorio, ¿sonó? | **no ejercido** — ver registro | **no ejercido** |
| Mensaje entrante en vivo, ¿sin recargar? | | |

---

## Registro de corridas

*(pendiente: el nivel 3 lo corre el dueño)*

### SC-006 en dispositivo — 2026-09-08 ⚠️ NO EJERCIDO (decisión del dueño)

**No se corrió el Laboratorio en LanCo, y esto no cuenta como verificación.**

**Por qué.** Correr el Laboratorio hoy es correr **las seis personas o ninguna**:
`POST /api/lab/runs` no acepta parámetros y `startRun()` inserta los seis casos
de golpe. Y esa corrida **no se puede borrar desde el producto** —no existe
`DELETE` de corridas, casos ni conversaciones—, así que quedaría para siempre en
el historial del Laboratorio con un **score que mide el desajuste entre los
guiones y el negocio**, no la calidad del agente: cuatro de las seis personas
preguntan por taladros, martillos, clavos y pintura
(`src/server/lab/personas.ts`), y el juez evalúa contra el knowledge base de
LanCo, donde eso no puede estar. Ensuciar el historial con un número que engaña
cuesta más que lo que aporta esta confirmación.

**Qué SÍ cubre el guardarraíl, y hasta dónde llega esa cobertura:**

- **Nivel 1**: el aviso construido para una conversación `is_test` no se manda a
  nadie — función pura, sin red.
- **Nivel 2, escenario C del arnés**: una escalación real del Laboratorio contra
  la app viva **no produce ningún envío**, comprobado tras esperar a que el canal
  quede en silencio (la ventana de agrupación del agente son 6 s; mirar antes es
  la receta exacta para atribuirle al Laboratorio un envío del escenario
  anterior — pasó, y por eso el guion sondea en vez de dormir).
- **Falsificado a propósito**: la protección se rompió a mano para ver el arnés
  ponerse rojo antes de darla por buena, y resultó estar en dos capas
  independientes (el corte por `is_test` en `avisarDeEscalacion` y el filtro de
  `/api/push/pendiente`).

**Lo que sigue sin comprobarse**: que en un **teléfono real**, con permiso
concedido y la app instalada, una evaluación del Laboratorio tampoco haga sonar
nada. Es una confirmación, no la prueba —`applyHandoff()` es el único escritor de
escalaciones y de ahí sale el aviso, así que el corte es el mismo camino que el
arnés recorre—, pero **no está hecha y no se declara verde**.

**Cuándo dejaría de costar esto**: el día que el Laboratorio permita elegir qué
personas correr, o que los guiones salgan del negocio en vez de estar fijos en el
repo. Cualquiera de las dos convierte esta comprobación en un minuto sin
residuo.

<!--
Plantilla, para que la corrida se registre con la misma honestidad que la 019:

### <Plataforma> — <fecha> ✅ VERDE | ⚠️ NO REPRODUCIDA

| Dato | Valor | Cómo se obtuvo |
|---|---|---|
| … | … | respuesta explícita / confirmación global sin desglose / verificado desde fuera |

Si la notificación NO llegó: decirlo aquí como **no reproducida**, con qué se
vio, qué se intentó y en qué quedó. Una corrida así no cierra el nivel 3.
-->

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Los cuatro, desde la ruta real. Y antes que todo eso, en esta feature: el
**ensayo del Principio X**, que está en
[`specs/020-notificaciones-push/quickstart.md`](../../specs/020-notificaciones-push/quickstart.md)
y ya se corrió contra el respaldo de LanCo del 2026-09-08.
