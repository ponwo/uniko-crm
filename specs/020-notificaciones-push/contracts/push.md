# Contrato — El aviso de escalación

Lo que el dominio puede pedir, lo que el adaptador promete, y lo que el service
worker gana **sin tocar** lo que la 019 dejó garantizado.

## La capacidad de dominio

`applyHandoff()` no sabe que existen FCM ni APNs. Solo pide:

```
avisarDeEscalacion(conversationId, organizationId) → void
```

Reglas duras, en este orden:

1. **`is_test` corta antes que nada.** Una conversación del Laboratorio no
   produce ningún aviso (FR-503). Es la primera línea, no la última: el
   guardarraíl del sandbox no se comprueba al final.
2. **Bandera apagada → no hace nada**, sin error y sin log de alarma.
3. **Nunca lanza.** Cualquier fallo se registra y se traga. La escalación ya está
   guardada cuando esto corre, y **no puede costarla** (FR-504).
4. **No bloquea.** El handoff no espera a la entrega.

## El adaptador

```
enviarAviso(suscripcion) → "entregada" | "caducada" | "fallo"
```

| Resultado | Cuándo | Qué hace quien llama |
|---|---|---|
| `entregada` | el servicio aceptó | sella `last_ok_at` |
| `caducada` | **410 Gone** (o 404) | **borra la suscripción**, en el sitio |
| `fallo` | red caída, 429, 500, tiempo agotado | lo registra y sigue. No reintenta |

**No hay reintentos.** Decisión de producto (spec, "Fuera de alcance"): un aviso
que insiste convierte una herramienta en una alarma.

## Qué viaja, exactamente

**Nada.** El cuerpo del envío va **vacío**.

Lo que el servicio de entrega ve, y no puede ver más:

| Ve | No ve |
|---|---|
| Que la instancia mandó un aviso a un endpoint suyo | Quién es el cliente |
| Cuándo | Qué dijo |
| — | Que fue una escalación, o de qué conversación |

Esto no es una optimización: es coherencia con el Principio I. Uniko es una
instancia por negocio para que los datos de un cliente no salgan de ahí; un aviso
con contenido haría pasar el nombre o el mensaje de **un cliente de nuestro
cliente** por servidores de Google o Apple para llegar a un teléfono que está a
diez metros del servidor.

## Qué muestra el teléfono

El service worker pide el detalle **a su propia instancia** y muestra:

- **Con detalle**: quién necesita atención, y al tocar se abre esa conversación.
- **Sin detalle** —sin red, sesión caducada—:
  > **Alguien necesita atención**
  > El agente pasó una conversación a un humano. Ábrela para ver cuál.

  Sirve sin decir de quién es, es accionable, y no parece un error (FR-507).

Cada notificación se marca con su conversación, para que el sistema operativo
**reemplace** la anterior donde eso funcione. **No es un requisito**: hay
constancia de que iOS lo ignora (research R4), y el producto funciona igual
apilando. No se construye ninguna lógica de agrupación.

## Lo que el service worker gana, y lo que NO puede tocar

Con `PUSH` encendida, el cuerpo generado añade **dos** manejadores: `push` y
`notificationclick`. Nada más.

**Lo que sigue intacto**, y se comprueba en cada corrida del arnés:

- el **enrutado estático** del `install` que manda `/api/events`, los webhooks y
  `/api/bot` a la red **sin consultar al worker**;
- la **salida temprana** del `fetch` para esas mismas rutas;
- que el worker **no cachea nada**.

Un manejador de `push` no puede interceptar peticiones —son eventos distintos—,
así que el riesgo no es técnico sino humano: alguien que, tocando este archivo,
reescriba el `fetch` de paso. Por eso el arnés comprueba **las dos mitades
también con la bandera encendida**, y además que el cuerpo servido conserva las
reglas de exclusión.

## Con la bandera apagada

El cuerpo del service worker **no contiene** los manejadores; las rutas de push
responden **404**; no se genera ninguna clave; y la app no menciona los avisos.
Indistinguible de una instancia sin la feature.

Y como el cuerpo lleva el commit dentro (arreglo de la 019), **encender la
bandera cambia los bytes de `/sw.js`**: los teléfonos ya instalados detectan
versión nueva y se actualizan solos. Sin aquel arreglo, encender la bandera no
habría llegado a ningún worker ya instalado.
