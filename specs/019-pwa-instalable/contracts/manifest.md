# Contrato — El manifiesto de la aplicación

## La ruta

`GET /api/branding/manifest` — pública (se pide antes de haber iniciado sesión,
igual que el favicon), `force-dynamic`, `Content-Type:
application/manifest+json`.

Caché: `public, max-age=31536000, immutable` **solo** cuando la URL trae `?v=`
(que cambia con la marca); `public, max-age=60` sin él. Es la misma regla que
`/api/branding/favicon`, por la misma razón.

Se enlaza desde el `<head>` con `rel="manifest"` y el mismo `?v=`.

## Campos

| Campo | Valor | Nota |
|---|---|---|
| `id` | fijo, **no derivado de la marca** | Si cambiara al renombrar el negocio, el navegador trataría la app como otra distinta y el operador acabaría con dos iconos |
| `name` | `<marca> — CRM de WhatsApp` | |
| `short_name` | la marca, recortada a lo que cabe bajo un icono | El recorte real se ve en el nivel 3 |
| `start_url` | `/inbox` | La pantalla de trabajo. Sin sesión, redirige al login como cualquier otra |
| `scope` | `/` | |
| `display` | `standalone` | Sin barra de direcciones (FR-406) |
| `theme_color` | el acento de la instancia | |
| `background_color` | el fondo del tema claro | |
| `icons` | ver abajo | |

## Iconos

Siempre PNG. El SVG de marca **no entra aquí**: su soporte en la lista de iconos
del manifiesto no es fiable entre plataformas, e iOS lo ignora para el icono de
la pantalla de inicio.

**Caso A — el dueño subió un PNG cuadrado de 512 px o más**: una sola entrada,
la suya, declarada con `"sizes": "192x192 512x512"`.

> Una sola entrada a propósito: con dos, el navegador podría escoger el logo de
> Uniko para el hueco pequeño y el del negocio para el grande, y el resultado
> sería una app con dos marcas.

**Caso B — cualquier otra cosa** (no hay icono subido, no es PNG, es pequeño, o
el volumen de medios no está montado): dos entradas con el logo de Uniko de
fábrica, 192 y 512, servidas desde `public/`.

> El caso B es **el estado actual de las tres instancias de la flota**
> (research R0), no una rareza. Es lo que garantiza que cualquier instancia sea
> instalable desde su primer arranque.

En los dos casos, `apple-touch-icon` en el `<head>` apunta a la misma ruta de
icono, porque iOS no lee el manifiesto para esto.

## Qué hace que un icono subido "sirva"

Se decide con los bytes del archivo, no con lo que declare nadie:

1. es PNG (firma en los primeros ocho bytes, como ya hace `sniffFaviconMime`);
2. es cuadrado;
3. mide 512 px o más (ancho y alto leídos del chunk `IHDR`).

Si falla cualquiera de las tres, se cae al caso B y la pantalla de marca lo dice
con la instrucción exacta para arreglarlo. **No es un error**: la instancia
funciona, se instala, y lleva el icono de fábrica hasta que el dueño suba el
suyo.
