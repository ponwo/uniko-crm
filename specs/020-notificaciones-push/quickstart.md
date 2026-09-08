# 020 — Quickstart: cómo ejercer y verificar

> **Antes de nada**: trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el
> alias `G:\`.

Esta feature tiene, además de los tres niveles de siempre, **un paso que ninguna
anterior necesitó**: el ensayo del Principio X. Va primero porque bloquea el
merge a `main`, no el final.

---

# Parte 1 — El ensayo del Principio X (obligatorio antes de `main`)

Esta feature toca `drizzle/`. La constitución exige ensayar la migración
**contra datos reales restaurados en un PostgreSQL desechable**, y `pnpm
seed:demo` no cuenta: contra una base vacía o de juguete, una migración siempre
pasa; lo que rompe es la forma de los datos que ya existen.

**El procedimiento no existía.** Se escribe aquí por primera vez.

## Lo primero, y es un hallazgo incómodo

**Ninguna de las tres bases de la flota tiene respaldos programados.**
Comprobado el 2026-09-07 contra Coolify: las tres devuelven cero
programaciones.

Es decir: hoy no hay de dónde sacar "el último respaldo", y si una base se
perdiera no habría nada que restaurar. Eso excede esta feature y está reportado
aparte, pero cambia el primer paso de este procedimiento: **hay que producir el
respaldo, no descargarlo.**

## Reglas que no se negocian

- **El respaldo se restaura en un PostgreSQL aislado y desechable.** Nunca sobre
  otra instancia de la flota —tampoco LanCo—, y **nunca sobre tu base de
  desarrollo habitual** (`uniko_dev`). Volcar los datos de un negocio sobre otro
  es un cruce entre clientes que el Principio I prohíbe aunque la intención sea
  probar.
- **Se borra al terminar**: la base del ensayo y el archivo del volcado. Un dump
  con datos de un cliente olvidado en `Descargas` es una fuga con fecha.
- **Nunca dentro del repositorio.** El volcado vive en una carpeta temporal fuera
  del árbol de trabajo; no hay `.gitignore` que arregle un descuido aquí.
- **Prefiere el respaldo de LanCo cuando sirva.** Es una instancia real, con
  conversaciones reales y volumen real, y es **nuestra**. Solo si la forma de sus
  datos no ejercita la migración (por ejemplo, no tiene filas de lo que la
  migración toca) se justifica pedir el de un cliente.

## Paso a paso

### 1. Producir el respaldo

En Coolify, en el proyecto de la instancia → su base **Postgres** → pestaña
**Backups** → crear una ejecución manual. Coolify guarda el volcado en el propio
VPS.

Alternativa directa por SSH al VPS, que es lo mismo sin intermediario:

```bash
docker exec <contenedor-postgres> pg_dump -U postgres -Fc uniko > /tmp/uniko-<instancia>-<fecha>.dump
```

`-Fc` (formato custom) es el que luego permite restaurar con `pg_restore` sin
depender de la versión exacta del cliente.

Los UUID de las bases de la flota están en
[`docs/despliegue-flota.md`](../../docs/despliegue-flota.md).

### 2. Traerlo a la máquina, fuera del repositorio

```bash
scp <vps>:/tmp/uniko-<instancia>-<fecha>.dump "$TEMP/uniko-ensayo/"
```

### 3. Crear la base desechable, aparte de la de desarrollo

En esta máquina **no hay Docker** (comprobado), así que el "Postgres desechable"
es una **base desechable** en el PostgreSQL 16 local, con un nombre que no se
pueda confundir con nada:

```bash
"/c/Program Files/PostgreSQL/16/bin/createdb" -U postgres uniko_ensayo_x_20260907
```

> Si algún día hay Docker en la máquina, un contenedor efímero es estrictamente
> mejor: aísla también el servidor, no solo la base. Mientras tanto, el
> aislamiento es de base y **el borrado del paso 6 es obligatorio**, no
> recomendable.

### 4. Restaurar

```bash
"/c/Program Files/PostgreSQL/16/bin/pg_restore" -U postgres \
  -d uniko_ensayo_x_20260907 --no-owner --no-privileges \
  "$TEMP/uniko-ensayo/uniko-<instancia>-<fecha>.dump"
```

Comprueba que llegaron datos de verdad antes de seguir — un ensayo contra una
restauración vacía es el mismo verde inútil que la constitución quiere evitar:

```bash
"/c/Program Files/PostgreSQL/16/bin/psql" -U postgres -d uniko_ensayo_x_20260907 \
  -c "select count(*) from conversation;" -c "select count(*) from message;"
```

### 5. Correr la migración contra esa copia

Solo las migraciones. **No** `pnpm db:dev` (crea y siembra), **no** `seed:demo`:

```bash
DATABASE_URL="postgresql://postgres:<clave>@localhost:5432/uniko_ensayo_x_20260907" pnpm db:migrate
```

Qué hay que mirar, y qué se anota en el PR:

- que aplique **sin errores** y sin bloqueos largos;
- que las tablas nuevas queden creadas y **nada existente haya cambiado**
  (es aditiva: si algo existente cambió, el plan mintió);
- cuánto tardó, con el volumen real de esa instancia;
- y que la app **arranca** contra esa base:
  `DATABASE_URL=… pnpm build && DATABASE_URL=… pnpm start`, y `/api/health`
  responde `ok`.

### 6. Tirarlo todo

```bash
"/c/Program Files/PostgreSQL/16/bin/dropdb" -U postgres uniko_ensayo_x_20260907
rm -rf "$TEMP/uniko-ensayo"
```

Y en el VPS, borrar el volcado que quedó en `/tmp`.

### 7. Dejarlo escrito

En el PR: **qué instancia**, **de qué fecha** era el respaldo, qué hizo la
migración, cuánto tardó y que la app arrancó contra la copia. La puerta de
promoción va a pedir exactamente eso, y sin las dos primeras no cuenta.

---

# Parte 2 — Los tres niveles

## Nivel 1 — Unidad

```bash
pnpm test
```

Quién recibe el aviso (función pura; con `is_test` no recibe nadie) · que el
aviso construido **no lleva datos del negocio** · el texto degradado · la
generación y el cifrado de las claves · la firma ES256.

## Nivel 2 — Local, con mock del servicio de entrega

Con la app viva y los mocks encendidos, `pnpm test:e2e` corre también
`scripts/e2e-push.mjs`.

**Con `PUSH` apagada** (configuración por defecto):

- las rutas de push responden 404;
- el cuerpo de `/sw.js` **no contiene** `push` ni `notificationclick`;
- la app no menciona los avisos en ningún sitio.

**Con `PUSH=on`**:

- una escalación real produce un envío al mock, y **su cuerpo va vacío**;
- una escalación del **Laboratorio** no produce ninguno;
- un endpoint que responde **410** desaparece de la base sin que nadie lo pida;
- con el mock caído, lento o rechazando, **la escalación se guarda igual**;
- y **las dos mitades de la 019 siguen verdes**: el service worker controla la
  página y el canal de eventos no pasa por él.

## Nivel 3 — Dispositivo real (OBLIGATORIO)

Necesita **un teléfono con la app instalada** (019), **el permiso concedido** y
**una escalación real del agente**. No se puede simular.

> **Regla heredada de la 018**: una corrida en la que **no llegó** la notificación
> **no cuenta** como verificación. O se repite, o se registra explícitamente como
> *no reproducida*. Un verde sin notificación recibida es ruido.

Cómo provocar una escalación real: escribir al número de WhatsApp de la
instancia pidiendo hablar con una persona ("quiero hablar con alguien"), que es
el handoff por `cliente`.

Lo que hay que responder:

1. ¿Llega con la app **cerrada**, no solo en segundo plano?
2. En **iOS**, un segundo aviso de la misma conversación ¿**reemplaza** al
   primero o se **apilan**? (research R4: sin confirmar en ninguno de los dos
   sentidos)
3. ¿Al tocarla se abre **esa** conversación?
4. Con el teléfono **sin red** al recibirlo, ¿aparece el texto degradado en vez
   de nada?

Qué anotar: versión del sistema, si llegó, cuánto tardó, y qué se vio en
pantalla.

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Los cuatro, desde la ruta real. Es el piso, no el techo — y en esta feature ni
siquiera es lo primero: sin el ensayo de la Parte 1, esto no llega a `main`.
