# Contrato — Rutas de la instancia (029)

**Feature**: [029](../spec.md) · Errores con la forma estándar de la API interna:
`{ "error": { "code", "message" } }`.

**Disponibilidad**: todas las rutas y la página de este documento responden **404**
salvo que se cumplan las dos: `AGENDA` encendida **y** las tres `GOOGLE_OAUTH_*`
configuradas (FR-1401). 404 y no 403: si no está encendida, la superficie no existe.

## Operador (con sesión)

### `GET /api/settings/google/link`

```json
200 { "canManage": true, "pending": { "createdAt": "…", "expiresAt": "…" } }
200 { "canManage": false, "pending": null }
```

`canManage` = el rol es `owner`. `pending` = el link vigente de la organización, sin la
llave (FR-1408). La pantalla usa el 404 para no mostrar la sección.

### `POST /api/settings/google/link`

Genera un link y revoca los pendientes (FR-1407). Sin cuerpo.

```json
201 { "url": "https://lanco.cloud/google-calendar?i=…&t=…", "expiresAt": "…" }
403 { "error": { "code": "forbidden", "message": "Solo el dueño de la cuenta puede generar el link" } }
```

La `url` completa sale **solo** en esta respuesta.

### `DELETE /api/settings/google/link`

Revoca el link pendiente, si hay.

```json
200 { "ok": true, "revoked": 1 }
403 { "error": { "code": "forbidden", "message": "…" } }
```

## Titular (sin sesión)

### `GET /api/google/oauth/start?t={llave}`

- Link vigente → **302** a Google (`GOOGLE_AUTH_URL`) con `client_id`,
  `redirect_uri` (= `GOOGLE_OAUTH_REDIRECT_URI`), `response_type=code`,
  `scope=https://www.googleapis.com/auth/calendar.events`, `access_type=offline`,
  `prompt=consent`, `state`; y `Set-Cookie: uniko_google_oauth=<nonce>; HttpOnly;
  SameSite=Lax; Path=/api/google/oauth; Max-Age=900` (+ `Secure` en HTTPS).
- Link no válido, vencido o ya usado/revocado → **302** a
  `/conectar-google?estado=link_invalido|link_vencido|link_usado`.

### `GET /api/google/oauth/callback?…`

Recibe la consulta de Google tal cual (directa o reenviada por el relevo). **Siempre
302** a `/conectar-google?estado=<motivo>`, y siempre borra la cookie del nonce. En
`ok`, además, `Set-Cookie: uniko_google_conectado=<nombre del calendario>; HttpOnly;
SameSite=Lax; Path=/conectar-google; Max-Age=120`.

| `estado` | Cuándo |
|---|---|
| `ok` | Conectado: canje, permiso, prueba y guardado en verde. |
| `otro_navegador` | `state` vencido (15 min) o sin la cookie del nonce / nonce distinto. |
| `link_invalido` | `state` con firma inválida, manipulado o de otra instancia. |
| `cancelado` | `error=access_denied`. |
| `politica_empresa` | `error=admin_policy_enforced`. |
| `google_rechazo` | Cualquier otro `error` de Google. |
| `link_usado` | El link ya se usó o se revocó mientras tanto (incluida la carrera de dos pestañas). |
| `google_no_respondio` | El canje falló por red, 5xx o `invalid_grant` (código vencido o reutilizado). |
| `permiso_incompleto` | El `scope` concedido no incluye `calendar.events`. |
| `prueba_fallida` | Sin `refresh_token`, o la prueba de conexión contra el calendario falló. |

En todo caso distinto de `ok`, **ninguna conexión existente se toca** (FR-1417).

## Página pública

### `GET /conectar-google?estado={motivo}`

Mensaje en lenguaje llano por motivo (catálogo cerrado; un valor desconocido muestra el
genérico) con la marca de la instancia. En `ok` muestra el nombre del calendario si la
cookie `uniko_google_conectado` está presente. Nunca refleja texto de la dirección
(FR-1420) ni lleva datos personales en ella (FR-1421).
