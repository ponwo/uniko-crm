---
name: android-sin-vista-movil
description: RESUELTO — la app se veía como escritorio encogido en Android porque Chrome tenía "Versión para ordenador" activada en ese sitio. No era del código. Lección- descartar eso ANTES de diagnosticar cualquier problema de renderizado móvil.
metadata:
  type: project
---

**RESUELTO el 2026-09-07. No era un problema de la aplicación.**

## La lección, que es lo único que hay que recordar

**Antes de diagnosticar un problema de renderizado móvil, descarta que el
navegador esté forzando la vista de escritorio.** Es un ajuste por sitio, se
queda activado sin que nadie lo recuerde, y produce exactamente los síntomas de
un fallo de CSS o de viewport. Cuesta diez segundos comprobarlo y ahorra una
investigación entera.

Se comprueba en Chrome/Android en el menú de tres puntos: la casilla **"Versión
para ordenador"**. Si está marcada, desmárcala y recarga antes de mirar nada más.

## Qué se observó

En Chrome sobre Android, la aplicación entera se servía como la vista de
escritorio encogida, con la letra diminuta. En Safari sobre iOS se veía bien. El
contraste entre plataformas fue lo que hizo pensar en un problema real del
código, cuando en realidad solo reflejaba que en un navegador estaba el ajuste
puesto y en el otro no.

## La causa real

**Chrome tenía activada "Versión para ordenador" para ese sitio.** Al quitarla,
la app se ve correctamente en Android. Cero cambios en el código.

## Las dos hipótesis que se manejaron, y en qué quedaron

**1. Faltaba el `meta viewport`.** Era la sospecha razonable, porque Safari
disimula esa ausencia y Chrome no. **Descartada con evidencia**: aunque
`src/app/layout.tsx` no lo declara y no hay ningún `export const viewport` en
`src/`, el HTML que sirve la app **sí lo lleva** —comprobado con `curl` contra
LanCo: `<meta name="viewport" content="width=device-width, initial-scale=1"/>`—
porque Next.js inyecta ese valor por defecto cuando la app no lo declara.

Eso sigue siendo cierto y vale la pena saberlo por separado: **no hace falta
declarar el viewport en este proyecto, Next ya pone uno correcto.**

**2. El dispositivo reportaba ≥ 768 px CSS y entraban los `md:` de Tailwind.**
Era la siguiente hipótesis y habría explicado el síntoma. **Nunca se llegó a
medir**: quedó sin comprobar, no descartada por evidencia. Se volvió irrelevante
al aparecer la causa real. Si algún día vuelve un síntoma parecido *con la vista
de escritorio ya descartada*, esta sigue siendo la siguiente a medir —
`window.innerWidth`, `document.documentElement.clientWidth`, `devicePixelRatio`—
en vez de suponerla.

## Historia

Apareció el 2026-09-07 probando la feature 018 en dispositivo real. Se anotó
entonces como problema anterior a esa feature, que no lo introducía, y **como
bloqueo de la 019 (PWA)**, con el argumento de que instalar una app que se ve
como escritorio encogido no sirve de nada.

**Esa nota ya no aplica: la 019 no está bloqueada por esto.**
