---
name: android-sin-vista-movil
description: En Chrome/Android la app se ve como escritorio encogido con letra diminuta; en iOS se ve bien. NO es por falta de meta viewport — está presente. Sin diagnosticar. Bloquea de facto a la 019 (PWA).
metadata:
  type: project
---

**Hallazgo del 2026-09-07, al probar la 018 en dispositivo real. No lo introduce
esa feature: es anterior y está sin diagnosticar.**

En **Chrome sobre Android**, la aplicación entera se sirve como la vista de
escritorio encogida, con la letra diminuta. En **Safari sobre iOS se ve
optimizada**. El aviso de reconexión de la 018 se lee bien en las dos; el
problema es el resto de la app.

## Lo que YA se comprobó, y descarta la primera hipótesis

La sospecha razonable era que faltara el `meta viewport` —Safari disimula esa
ausencia y Chrome no—. **No es eso.** Comprobado dos veces:

- `src/app/layout.tsx` no lo declara, ni hay ningún `export const viewport` en
  todo `src/`.
- **Pero el HTML servido SÍ lo lleva**: `curl` a LanCo devuelve
  `<meta name="viewport" content="width=device-width, initial-scale=1"/>`.
  Next.js inyecta ese valor por defecto cuando la app no lo declara.

O sea que la etiqueta está y es la correcta. La causa es otra.

## Por dónde seguir cuando se ataque

Hipótesis viva, y la más barata de comprobar primero: que el dispositivo
reporte un **ancho de viewport CSS ≥ 768 px**, con lo que los `md:` de Tailwind
entran y la app muestra su layout de escritorio *legítimamente* — que es
exactamente lo que se ve. La bandeja usa `md:w-[300px]`, `lg:`, `xl:` para
decidir columnas.

Lo primero que hay que medir en ese teléfono, no suponer: `window.innerWidth`,
`document.documentElement.clientWidth` y `devicePixelRatio`. Si sale ≥ 768,
el problema no es el viewport sino dónde están puestos los breakpoints. Otras
pistas a descartar: "Sitio para computadora" activado en Chrome, y un
`initial-scale` efectivo distinto por zoom del sistema.

## Por qué importa para la 019

**Le afecta de lleno.** La 019 pide botón de instalar en Android, e instalar una
app que se ve como escritorio encogido no sirve de nada: el usuario la abre una
vez y la borra. Una PWA instalable con la vista rota es peor que no ofrecer la
instalación, porque la instalación es una promesa.

Conviene resolver esto **antes** de rematar la 019, o al menos decidir a
sabiendas que se lanza sin ello. Ver [[019-pwa-instalable]].
