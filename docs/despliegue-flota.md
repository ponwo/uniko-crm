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
(`goowhn5rf251hqsf4f2ub1pp`). Todas las apps salen de `ponwo/uniko-crm`, rama
`main`, por el GitHub App **lanco-tools** (`lnwheppq2uthod0ur1d8dhwp`).

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
| Auto-deploy | sí | un push a `main` redespliega las tres |

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
| `META_GRAPH_API_VERSION` | `v25.0` |
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

## Alta de un cliente nuevo

1. Registro **A** de `uniko.<dominio-del-cliente>` a la IP del servidor. Espera
   a que resuelva: sin DNS, Coolify no puede emitir el certificado.
2. Proyecto en Coolify (si el cliente no tiene uno).
3. Postgres `standalone-postgresql`, base `uniko`, usuario `postgres`. Coolify
   genera la contraseña.
4. App desde `ponwo/uniko-crm` con la configuración de la tabla de arriba.
5. Volumen persistente en `/data/media`.
6. Variables de entorno, con secretos nuevos.
7. Desplegar y verificar `/api/health`.
8. Registrar la primera cuenta: el registro público **se cierra solo** tras la
   primera organización. Quien se registre primero es el propietario.
9. Conectar el número de WhatsApp en Ajustes → WhatsApp y pegar en Meta la URL
   del webhook y el verify token que la propia app enseña.

## Estado de vocero-iltu

La app `arwru6uh1ohbp7pldqnarmzn` (`vocero-iltu.ilovetheuniverse.mx`) y su base
`ybdm3mpaqtpwm2rnxv4ldrgc` fueron el arranque de pruebas de I Love The Universe,
sobre `kevinrivm/vocero-crm`. Las sustituye `uniko-iltu`.

**Se detienen, no se borran**, hasta que el dueño lo apruebe explícitamente. El
borrado es irreversible y se llevaría por delante las conversaciones y contactos
que haya en esa base.
