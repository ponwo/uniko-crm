# E2E 008 — Paridad WhatsApp del inbox

Guion de comportamiento (Constitución IX). La parte automatizada vive en la
sección "008" de `scripts/e2e-selftest.mjs` (app con `WA_MOCK_ENABLED=true`,
BD fresca, `MEDIA_DIR` local); esto documenta el mapeo a los AC del spec y
los pasos visuales de Playwright.

## US1 — Echoes de coexistence (automatizado)

| AC | Check del selftest |
|---|---|
| AC-1 mensaje manual visible como saliente manual | "el mensaje manual aparece como saliente origin=manual" |
| AC-2 IA pausada tras respuesta manual | "la IA quedó pausada con handoff manual_reply" + "el echo NO tocó la ventana" |
| AC-3 reactivación desde el CRM | "reactivar la IA desde el CRM limpia el handoff" |
| AC-4 echo duplicado no duplica | "echo duplicado (mismo wamid) no duplica el mensaje" |
| AC-5 echo con adjunto previsualizable | "echo con imagen: manual + asset descargado" |
| Edge: conversación nueva desde el teléfono | "echo a número nuevo crea contacto y conversación" |
| Edge: payload bajo clave `messages` | "echo bajo la clave `messages` también se ingiere" |

## US2 — Envío de adjuntos (automatizado)

| AC | Check |
|---|---|
| AC-1 imagen + caption + estados | "imagen con caption enviada (201)" + "asset disponible y origin=operator" + outbox `type=image` |
| AC-2 ubicación | "ubicación enviada" + payload lat/long + outbox `type=location` |
| AC-3 límite de tamaño ANTES de enviar | "imagen de 6 MB → 413 too_large" |
| AC-4 ventana cerrada = misma regla que texto | cubierto por los checks de ventana existentes (el pre-flight es compartido: `prepareSend`) |
| AC-5 fallo del canal → mensaje failed visible | unit `media-send.test.ts` (persistencia failed) + sandbox |
| AC-6 lote de adjuntos (varios a la vez, en orden, pie solo en el primero) | "lote de 3 imágenes seguidas: las 3 salen (201)" + "el hilo conserva el orden en que se eligieron" + "el pie va solo en la primera del lote" + outbox: un `type=image` por archivo |

### Lote de adjuntos — pasos visuales (verificados en vivo con los mocks)

El compositor acepta VARIOS archivos por envío: picker con `multiple`,
soltar sobre toda la columna del hilo (cabecera + mensajes + caja), o pegar
una imagen del portapapeles. Cada archivo sale como un mensaje propio, en el
orden elegido; el texto va como pie del primero.

1. Arrastrar archivos sobre el hilo → velo "Suelta para adjuntar" cubriendo la
   columna; al soltar, aparece la tira de fichas (miniatura para imágenes,
   icono + extensión para el resto), cada una con su ✕, la ficha «+» para
   agregar más y el resumen "N adjuntos · tamaño · salen en orden…".
2. Soltar los mismos archivos otra vez no duplica (dedup por
   nombre+tamaño+fecha). Más de 30 → aviso "Máximo 30 adjuntos por envío…".
3. Enviar con pie → el resumen dice "Enviando 1 de N…", las ✕ desaparecen
   mientras sale el lote, el hilo va mostrando cada imagen conforme llega, el
   texto se limpia tras el primero y la tira desaparece al terminar.
4. Camino infeliz: lote con un archivo de 6 MB en medio → los anteriores
   salen, el error nombra el archivo ("grande.png: El archivo excede el
   límite…"), y ese archivo y los siguientes se QUEDAN en la tira para
   quitarlos o reintentar. Un `image/*` corrupto cae al icono genérico.
5. Cambiar de conversación descarta el lote pendiente (como WhatsApp Web);
   con la ventana de 24 h cerrada no hay velo ni lote, y el drop no navega al
   archivo.

## US3 — Previews entrantes (automatizado)

| AC | Check |
|---|---|
| AC-1 foto ampliable | "imagen entrante queda disponible" + "el binario entrante se sirve" |
| AC-2 nota de voz reproducible | mismo pipeline que imagen (kind audio); visual en Playwright |
| AC-3 disponible tras expirar en Meta | el binario se sirve desde `MEDIA_DIR`, no desde Graph (la URL del mock solo se usa al descargar) |
| AC-4 contenido no disponible degradado | "descarga fallida degrada a failed" + "410 gone" |

## Pasos visuales (Playwright, al cerrar la feature)

1. Login → Inbox → conversación "Lead 008": el hilo muestra la burbuja manual
   con badge 📱 "Celular", la imagen enviada con miniatura y caption, la
   ubicación con enlace, y el adjunto roto con "contenido no disponible".
2. Composer: clip 📎 abre el picker (multiselección); una imagen sola muestra
   su ficha con nombre/tamaño y el texto pasa a ser "pie del adjunto"; varias
   forman la tira del lote (ver "Lote de adjuntos" arriba).
3. Panel de contacto: la conversación pausada muestra "Respondiste desde el
   teléfono — IA en pausa" y el botón de reactivar funciona.

## En vivo (producción, reglas Evolution)

1. Responder desde la app de WhatsApp Business del teléfono a la conversación
   de la línea de pruebas → aparece como manual en el CRM y la IA se pausa (probado con una instancia real en coexistence).
2. Reactivar la IA desde el CRM → el agente vuelve a contestar.
3. Enviar desde el CRM a la línea de pruebas: imagen con caption, un PDF y
   una ubicación (pausas ≥8 s; verificar recepción en el teléfono).
4. Desde la línea de pruebas enviar foto y nota de voz → previews en el CRM.
