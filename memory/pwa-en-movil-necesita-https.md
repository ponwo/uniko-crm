---
name: pwa-en-movil-necesita-https
description: localhost desbloquea DESARROLLAR el service worker de la 019, pero no probar la PWA instalada en un móvil real: eso exige HTTPS (túnel o instancia desplegada). Anotado antes de empezar, no descubierto al final.
metadata:
  type: project
---

**Anotado el 2026-09-07, antes de arrancar la 019.** Sin resolver a propósito:
se registra ahora para que no aparezca como sorpresa al final.

## La distinción

`http://localhost` **cuenta como contexto seguro**, así que con el entorno de
desarrollo local (ver [`docs/desarrollo-local.md`](../docs/desarrollo-local.md))
se puede registrar el service worker, comprobar que no intercepta el SSE y
depurarlo en el navegador. Eso es lo que desbloquea el trabajo de la 019.

**Lo que NO desbloquea**: instalar la PWA en un teléfono real y ver cómo se
comporta. Un móvil no llega a tu `localhost`, y sin HTTPS no hay ni manifest
instalable ni service worker. Para eso hacen falta:

- un **túnel** con certificado (ngrok o equivalente), o
- una **instancia desplegada** — LanCo, que ya tiene HTTPS.

## Por qué importa tenerlo escrito

Es el mismo patrón que ya nos pasó en la 018: la verificación en dispositivo
real apareció al final, cuando la feature estaba casi cerrada, y hubo que
organizar una prueba manual con el dueño. Salió bien porque se planificó dentro
de la spec. Aquí conviene planificarlo igual **desde la spec de la 019**, no
descubrirlo al llegar.

Y en la 019 pesa más que en la 018: la feature *es* la instalación. Una PWA que
no se ha instalado nunca en un teléfono no está verificada, por muchos tests que
pase.

## Lo que NO es

No es la deuda del entorno no-producción, que quedó resuelta con Postgres
nativo. Son dos cosas distintas y solo se resolvió una.
