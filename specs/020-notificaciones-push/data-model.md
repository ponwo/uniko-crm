# 020 — Modelo de datos

**Hay migración, y es ADITIVA PURA**: dos tablas nuevas, cero cambios sobre lo
existente. Ninguna columna añadida, ninguna alterada, ninguna borrada.

Eso importa por el Principio X: el ensayo contra un respaldo real **sigue siendo
obligatorio** —lo activa tocar `drizzle/`, no la gravedad del cambio— pero el
riesgo es el mínimo posible. Una migración que solo crea tablas no puede dejar
datos existentes a medias, y revertirla es redesplegar el código anterior con dos
tablas vacías de sobra.

## `push_subscription` — un teléfono que quiere recibir avisos

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `ps_` |
| `organization_id` | text NOT NULL → `organization` | Principio III; índice org-first |
| `user_id` | text NOT NULL → `user` | **por usuario, no por instancia** (FR-511) |
| `endpoint` | text NOT NULL **UNIQUE** | lo devuelve el navegador; identifica el dispositivo |
| `created_at` | timestamptz NOT NULL | |
| `last_ok_at` | timestamptz NULL | último envío aceptado; sirve para depurar, no para decidir |

**Por qué `endpoint` es la clave única y no `(user_id, dispositivo)`**: el
navegador no da identidad de dispositivo. Reactivar los avisos en el mismo
teléfono devuelve el mismo `endpoint`, así que la unicidad ahí es lo que hace la
operación idempotente (Principio IV) sin inventar identificadores.

**Lo que NO se guarda**: las claves `p256dh` y `auth` de la suscripción. Solo
hacen falta para **cifrar contenido**, y esta feature manda el aviso vacío. No
guardar lo que no se usa es la versión barata del Principio I.

**Borrado**: cuando el servicio de entrega responde **410 Gone**, la fila se
borra en el sitio. También al desactivar los avisos desde la app, y en cascada si
se borra el usuario o la organización.

## `push_key` — el par de claves de la instancia

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `pk_` |
| `organization_id` | text NOT NULL **UNIQUE** → `organization` | una por organización |
| `public_key` | text NOT NULL | viaja al navegador al suscribirse; no es secreto |
| `private_cipher` | text NOT NULL | AES-256-GCM |
| `private_iv` | text NOT NULL | mismo formato que `token_cipher/iv/tag` del WhatsApp |
| `private_tag` | text NOT NULL | |
| `created_at` | timestamptz NOT NULL | |

**Por qué una tabla y no `organization.metadata`**: el metadata se lee en cada
render y su contenido viaja a la marca del cliente. Meter ahí una clave privada
es dejarla a un descuido de salir al navegador. Una tabla aparte no se lee si no
se pide.

**Se crea sola** la primera vez que hace falta, con la bandera encendida
(FR-515). Con la bandera apagada, esta tabla existe **vacía** en toda la flota —
que es el patrón de siempre: la migración se aplica igual, las tablas inertes no
molestan.

**Rotación**: regenerar la fila invalida **todas** las suscripciones de esa
organización, porque el navegador las ató a la clave pública anterior. Por eso
FR-517 exige que eso se diga **en la pantalla donde se rota**, no en un
documento que nadie va a leer ese día.

## Lo que NO cambia

- **`conversation`**: el disparador es `handoff_at`, que ya existe. No hace falta
  ninguna marca de "ya avisé": el pipeline calla con handoff activo, así que no
  hay segundo aviso que deduplicar (research R4).
- **`user` y `organization`**: solo se referencian.
- **Nada más.** Si al implementar aparece una razón para tocar una tabla
  existente, el plan estaba equivocado y hay que pararse antes de diseñarlo: eso
  cambia el perfil de riesgo del Principio X y deja de ser una migración aditiva.

## Reversión

Revertir los commits y redesplegar. Las dos tablas quedan creadas y vacías,
inertes: **no hay `down`, y no hace falta**. Nada que borrar, nada que
rellenar, ningún dato existente transformado.

El único estado que sobrevive fuera de la base es el permiso de notificaciones
concedido en los teléfonos, que el operador puede quitar desde el sistema.
