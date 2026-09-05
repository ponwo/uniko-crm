# Despliegue de la flota

Uniko es **una instancia = un negocio**. No hay multi-tenant entre clientes: cada
uno tiene su app, su Postgres, su dominio, su volumen y sus secretos. Lo único
compartido es este repositorio.

Eso no es una limitación que arrastramos, es la [Constitución
II](../.specify/memory/constitution.md): el día que un cliente pida su copia de
los datos, o se vaya, o le entre una auditoría, la respuesta es un volcado de SU
base y nada más.

## Inventario

Servidor `v8y5y29zlbg1aft37px9qfxg` (`localhost`), red `coolify`
(`goowhn5rf251hqsf4f2ub1pp`). Todas las apps salen de `ponwo/uniko-crm` por el
GitHub App **lanco-tools** (`lnwheppq2uthod0ur1d8dhwp`), cada una siguiendo su
rama (ver "Cómo se suelta un cambio").

| | LanCo (prueba) | I Love The Universe | NuriaAndrea |
|---|---|---|---|
| Dominio | `uniko.lanco.cloud` | `uniko.ilovetheuniverse.mx` | `uniko.nuriaandrea.com` |
| Proyecto | `4rftksfo2ii423y3hy6m0job` | `fl6vzdksfrncfkvo0pljeaoy` | `maywyzbkzqcyjrkbb2fz0xyz` |
| App | `c2caigvzd8phgbfznrjvm7tl` | `2ot8l9duhkzfc0qpckzpqrqb` | `iqxwof0cagol09qlvcqorxdl` |
| Postgres | `mdculd8ymchlpqapypxolr86` | `opmzwkjlw7vnfpnq2oydohyo` | `l3rfxifjouusbob12omrrnve` |
| Volumen | `vsze669ddpoxrguka4evjrqa` | `wfkz7pkxiiksqwg3ohqtysyx` | `gcxnxpg7cg9yds5fpq9imz5y` |

Los tres subdominios resuelven a `212.28.185.186`, la misma IP que el resto de
las apps del servidor.

## Cómo queda configurada cada app

| Ajuste | Valor | Por qué |
|---|---|---|
| Build pack | `dockerfile` | el `Dockerfile` del repo, multi-etapa standalone |
| Puerto | `3000` | el que expone el standalone de Next |
| Volumen | `/data/media` | los adjuntos de WhatsApp y el favicon subido viven ahí; **sin volumen se pierden en cada redeploy** |
| HTTPS forzado | sí | Meta exige `https` para el webhook |
| Auto-deploy | sí | pero cada instancia sigue SU rama — ver abajo |
| Rama | `main` en LanCo, `production` en los clientes | LanCo estrena; los clientes esperan |

Las migraciones se aplican **al arrancar el contenedor**, no al construir. Un
despliegue que arranca es un despliegue migrado.

## Variables de entorno

Todas van en **runtime**, no en build (`is_buildtime: false`). Puestas por
instancia, con valores DISTINTOS en cada una:

| Variable | Origen |
|---|---|
| `APP_BASE_URL` | el dominio de esa instancia |
| `DATABASE_URL` | la URL interna del Postgres de esa instancia |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — **exactamente 32 bytes**, se valida al arrancar |
| `META_WEBHOOK_VERIFY_TOKEN` | `openssl rand -hex 20` — es el segmento secreto de la URL del webhook |
| `META_GRAPH_API_VERSION` | `v26.0` |
| `MEDIA_DIR` | `/data/media` — tiene que coincidir con el volumen |

Jamás se reutiliza un secreto entre instancias. Compartir `ENCRYPTION_KEY` entre
dos clientes significa que la clave que descifra el token de WhatsApp de uno
descifra el del otro.

### Banderas de módulos opcionales

Ninguna instancia arranca con módulos opcionales. Se encienden por cliente
cuando hagan falta, agregando la variable y redesplegando:

- `CHANNELS=whatsapp,instagram,messenger` — canales extra ([ADR-001](adr-001-canales-opcionales.md))
- `AGENDA=on` — motor de agenda ([ADR-002](adr-002-conectores-de-agenda.md), [guía](agenda-conectores.md))
- `ATRIBUCION=on` — conversiones a Meta ([guía](atribucion-capi.md))

### Lo que NO pone el agente

- `OPENROUTER_API_TOKEN` / `OPENROUTER_MODEL` — sin ellas la instancia funciona
  como CRM sin agente de IA. Se pegan cuando el dueño decida el modelo y la
  facturación.
- Las credenciales de WhatsApp (WABA ID, Phone Number ID, token) — **no son
  variables de entorno**: se pegan en Ajustes → WhatsApp dentro de la app, y se
  guardan cifradas con `ENCRYPTION_KEY`.

## Cómo se suelta un cambio

```
rama de feature ──PR──► main ──fast-forward──► production
                         │                         │
                         ▼                         ▼
                   uniko-lanco              uniko-iltu
                   (estrena solo)           uniko-nuriaandrea
```

1. Rama por feature. La skill `speckit-git-feature` la crea con la numeración
   del proyecto, alineada a `specs/`.
2. PR. La CI corre los cuatro gates en las dos configuraciones de la matriz
   (`default` y `completo`). **Es el único sitio donde se sabe si el build pasa**
   si tu máquina no lo puede correr.
3. Merge a `main`. LanCo se redespliega sola: ahí se mira.
4. Promoción a `production`, y con ella a los clientes. El disparador es una
   señal explícita del dueño, nunca un plazo ni un automatismo — pero la señal
   solo abre la puerta si se cumplen antes las seis condiciones de la **puerta
   de promoción a producción** ([constitución, "Flujo de Desarrollo y Puertas de
   Calidad"](../.specify/memory/constitution.md)): CI verde para ESE commit en
   las dos configuraciones, el cambio ya corriendo en LanCo desplegada y con uso
   real encima, el self-test de comportamiento contra LanCo (no solo contra
   `localhost`), el ensayo del Principio X si algún commit toca `drizzle/`,
   `git log production..main` revisado, y plan de reversión declarado. Entonces:

```bash
git checkout production && git merge --ff-only main && git push
```

`--ff-only` no es adorno: obliga a que `production` sea siempre un punto exacto
de la historia de `main`. Si el comando falla, es que alguien tocó `production`
a mano — arréglalo antes de seguir, no lo fuerces.

Cierra verificando `/api/health` en las tres instancias y comparando el commit
que reporta cada una contra el que promoviste. No es trámite: las bases de los
clientes migran al arrancar y a la vez, y un contenedor que no levanta porque la
migración reventó no avisa — su health sigue respondiendo con el commit viejo.

Para saber qué NO han recibido todavía los clientes:

```bash
git log production..main --oneline
```

Un commit que solo toca `docs/` o `specs/` llega a `main`, redespliega LanCo y
ahí se queda hasta que alguien decida soltarlo. Por eso no hacen falta
`watch_paths`: la separación de ramas ya evita que documentación reconstruya
producción, y sin el riesgo de que un patrón mal escrito se salte un deploy que
sí hacía falta.

### Migraciones: la única parte irreversible

Corren **al arrancar el contenedor**, en las tres bases, y Drizzle las genera
**solo hacia adelante**: no hay `down`. Redesplegar el commit anterior devuelve
el código, no el esquema. De ahí dos reglas:

Esto ya no es solo criterio operativo: es el [Principio
X](../.specify/memory/constitution.md) de la constitución. Las reglas:

- **Todo PR que toque `drizzle/` se ensaya contra datos reales, antes de
  `main`.** Contra una base vacía, una migración siempre pasa; lo que rompe es
  la forma de los datos que ya existen. La vía limpia es levantar un PostgreSQL
  **desechable**, restaurar ahí un respaldo real y correr la migración contra
  esa copia. `pnpm seed:demo` no satisface el requisito.
- **El respaldo de un cliente nunca se restaura sobre una instancia viva.** Ni
  siquiera sobre LanCo: con LanCo recibiendo sus propias conversaciones, volcarle
  encima los datos de un cliente es un cruce entre negocios, que el Principio I
  prohíbe aunque la intención sea probar. El respaldo va a un Postgres aislado
  que se tira al terminar.
- **Los cambios destructivos van en dos entregas.** Primero agregar (columna
  nueva, nullable) y backfill; borrar lo viejo en una entrega posterior, cuando
  ya se sabe que nadie lo usa. Una sola entrega que borra no se puede deshacer
  con un redeploy.
- **El PR declara su plan de reversión.** Si la respuesta honesta es que no se
  puede revertir, es que le falta partirse en dos entregas.

Los respaldos de las bases se llevan a nivel del VPS, fuera de Coolify.

## Alta de un cliente nuevo

1. Registro **A** de `uniko.<dominio-del-cliente>` a la IP del servidor. Espera
   a que resuelva: sin DNS, Coolify no puede emitir el certificado.
2. Proyecto en Coolify (si el cliente no tiene uno).
3. Postgres `standalone-postgresql`, base `uniko`, usuario `postgres`. Coolify
   genera la contraseña.
4. App desde `ponwo/uniko-crm` con la configuración de la tabla de arriba.
5. Volumen persistente en `/data/media`.
6. Variables de entorno, con secretos nuevos.
7. Desplegar y verificar `/api/health`. Si es un cliente, la app sigue la rama
   `production`; solo LanCo sigue `main`.
8. Registrar la primera cuenta: el registro público **se cierra solo** tras la
   primera organización. Quien se registre primero es el propietario.
9. Conectar el número de WhatsApp en Ajustes → WhatsApp y pegar en Meta la URL
   del webhook y el verify token que la propia app enseña.

## Historia: qué había antes

**vocero-iltu** — `vocero-iltu.ilovetheuniverse.mx`, sobre `kevinrivm/vocero-crm`,
fue el arranque de pruebas de I Love The Universe. La sustituyó `uniko-iltu` y el
dueño la borró a mano, con su base, el 2026-09-04. Ya no existe en Coolify.

**kosmo-crm** — `kosmo.lanco.cloud`, sobre `ponwo/kosmo-CRM`, es el MISMO
producto que este repo: los dos salen de Vocero y se bifurcaron en la migración
`0007`. Kosmo siguió por su lado (PWA y notificaciones push, conocimiento con
caducidad, correo por SMTP, Embedded Signup) con seis migraciones propias que
chocan con las de aquí; este repo siguió por el suyo (canales opcionales, agenda,
atribución CAPI).

**Corre en paralelo y se queda así por ahora.** No es parte de esta flota, no se
toca y no se fusiona: reconciliar las dos cadenas de migración es un trabajo
propio, para cuando se decida hacerlo. Si vas a portar algo de allá para acá,
cuenta con reescribir su migración sobre esta cadena.
