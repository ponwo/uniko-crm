# 019 — Modelo de datos

**No hay cambios en el modelo de datos. Esta feature no añade migración y no
toca `drizzle/`.**

Se documenta en vez de omitir el archivo, por lo mismo que en la 018:

- El **Principio X** (irreversibilidad ante datos de clientes) **no aplica**: no
  hay ensayo de migración que hacer ni plan de reversión más allá del redeploy.
- La **puerta de promoción** no activará su condición 4 ("si algún commit toca
  `drizzle/`, el ensayo del Principio X está hecho"). `/uniko-promote` lo
  detectará por el diff y no preguntará.

## Lo que se reutiliza tal cual

- **`organization.metadata.branding`** — nombre, acento y `favicon: { mime,
  version }`. La feature **lee**; no escribe nada nuevo. El único campo que
  interpreta distinto es `favicon.mime`: ahora, además de servir la pestaña,
  decide si el manifiesto puede ofrecer el icono del negocio.
- **El volumen de medios** (`MEDIA_DIR/{organizationId}/favicon`) — el archivo
  subido. Si el volumen no está montado, la ruta ya degrada al icono generado; en
  esta feature degrada además a los PNG de fábrica, que viven en la imagen y no
  en el volumen. Es una degradación mejor que la de hoy, no peor.

## Estado nuevo, y dónde vive

| Estado | Dónde | Por qué ahí |
|---|---|---|
| `beforeinstallprompt` guardado | memoria del cliente | Es un evento del navegador; muere con la pestaña y no significa nada fuera de ella |
| "El operador descartó el aviso de instalar" | `localStorage` del dispositivo | Es una preferencia **de ese teléfono**, no del negocio. Guardarla en la base la propagaría a todos los dispositivos del operador, que no es lo que pidió |
| "¿Sirve el icono actual para instalar?" | derivado, no almacenado | Se calcula de los bytes del archivo (PNG, cuadrado, ≥512). Guardarlo sería una copia que puede quedar desincronizada del archivo real |
| Registro del service worker | el navegador | Lo gestiona el propio navegador. En iOS se descarta tras ~7 días sin uso, y eso no es estado nuestro que podamos preservar |

**Nada de lo anterior sobrevive a borrar los datos del sitio, y no debe.** Un
operador que limpia su navegador vuelve a ver el aviso de instalar: es correcto,
porque su dispositivo volvió al estado de no tener la app.
