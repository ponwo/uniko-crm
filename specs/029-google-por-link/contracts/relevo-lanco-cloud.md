# Contrato — Uniko ↔ `lanco.cloud` (página de aterrizaje y relevo de Google)

**Feature**: [029](../spec.md) · **Consumidor**: repo `lanco-ws` (sitio `lanco.cloud`)
· **Estado**: v1

Este contrato es lo único que `lanco.cloud` necesita saber de una instancia de Uniko
para el alta de Google. Todo lo demás del flujo es privado de la instancia y puede
cambiar sin avisar. Si algo de aquí cambia, cambia en los dos repos en la misma
entrega.

## 1. El link que genera la instancia

Con `GOOGLE_ONBOARDING_URL` configurada (el caso de la flota de LanCo):

```text
{GOOGLE_ONBOARDING_URL}?i={host}&t={llave}
https://lanco.cloud/google-calendar?i=uniko.ilovetheuniverse.mx&t=Qm9…(43)
```

- `i` — el *host* de la instancia (`new URL(APP_BASE_URL).host`), sin esquema ni
  ruta.
- `t` — la llave del link: base64url, `[A-Za-z0-9_-]`, 43 caracteres hoy. El sitio
  acepta de 20 a 128 para no atarse a la longitud.

Sin `GOOGLE_ONBOARDING_URL` (self-hoster sin página de aterrizaje) el link va directo a
la instancia y `lanco.cloud` no interviene:
`{APP_BASE_URL}/api/google/oauth/start?t={llave}`.

## 2. La página de aterrizaje — `GET https://lanco.cloud/google-calendar`

| Entrada | Comportamiento |
|---|---|
| Sin `i` | **Página de la app** «LanCo Agenda»: qué es, qué permiso pide y para qué, cómo revocarlo, enlaces a privacidad y términos. Es la página principal que revisa la verificación de Google. Sin botón de continuar. |
| `i` fuera de la lista de la flota | Error: el link no corresponde a un negocio atendido por LanCo. Sin botón. |
| `t` ausente o con forma inválida | Error: link incompleto; pedir que lo copien entero. Sin botón. |
| Navegador embebido de una app | Pide abrir el link en Chrome o Safari, con botón para copiarlo. Sin botón de Google (Google respondería `403 disallowed_useragent`). |
| Todo en orden | Nombre del negocio **según la lista** (nunca según la dirección), qué se va a autorizar, aviso de app sin verificar mientras dure, y **Continuar con Google** → `https://{i}/api/google/oauth/start?t={t}` |

## 3. El relevo — `GET https://lanco.cloud/google-calendar/callback`

Es el **único URI de redirección** registrado en cada cliente OAuth de la flota. Google
llega con la respuesta en la consulta: `code`, `state`, `scope`, … o `error`, `state`.

1. Leer `state`. Es un JWT compacto (`xxx.yyy.zzz`). Decodificar el segundo segmento
   (base64url → JSON) **sin verificar la firma** (el sitio no tiene la clave, ni la
   necesita).
2. Leer `ret` (string). Debe cumplir **todo**:
   - `new URL(ret)` no lanza;
   - `protocol === "https:"`;
   - `url.origin === ret` (un origen pelado: sin ruta, consulta ni fragmento);
   - `url.host` está en la lista de la flota.
3. Si cumple: `location.replace(ret + "/api/google/oauth/callback" + location.search)`
   — **la consulta completa y sin tocar**, también cuando trae `error`.
4. Si no: mostrar que la respuesta no corresponde a una instancia de LanCo y **no
   redirigir a ninguna parte**.

La instancia verifica la firma de `state`, su vigencia y el navegador: el relevo no
decide nada más que *a dónde*.

### Forma de `state` (lo que el relevo puede asumir)

```json
{ "ret": "https://uniko.ilovetheuniverse.mx", "...": "privado de la instancia" }
```

Solo `ret` es contrato. El resto de campos (`lnk`, `nh`, `iat`, `exp`, …) pertenece a
la instancia.

## 4. La lista de la flota

Vive en el repo `lanco-ws` (`data/flota.ts`): `host` + nombre visible del negocio.
Dar de alta un negocio en Google incluye añadir su host aquí (y desplegar el sitio).
Quitar un host deja sin alta nueva a esa instancia; sus conexiones hechas siguen
funcionando.

## 5. Lo que `lanco.cloud` NO hace (FR-1427)

- No guarda, no registra a propósito y no envía a terceros la llave, el `code`, el
  `state` ni ningún dato del recorrido (sin analítica ni píxeles en estas dos rutas).
- Declara `referrer` `no-referrer` en las dos páginas.
- No llama a ninguna API: todo ocurre en el navegador del titular.
- No participa después del alta: una instancia conectada no vuelve a pasar por aquí.
