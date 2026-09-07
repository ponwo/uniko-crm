"use client";

import { useEffect } from "react";

/**
 * Registra el service worker, una vez, cuando la app ya es usable.
 *
 * No pinta nada. Va en el layout raíz porque el ámbito del service worker es
 * todo el sitio y el registro debe ocurrir se entre por donde se entre.
 *
 * Tres decisiones pequeñas:
 *
 * 1. **Después de `load`**, no durante el arranque. Registrar compite por red y
 *    CPU con lo que el operador está esperando ver, y no hay ninguna prisa: el
 *    service worker no sirve para nada en esta visita, solo para que el
 *    navegador ofrezca instalar la app.
 * 2. **Silencioso si falla.** Un navegador sin service workers, o un contexto no
 *    seguro (HTTP), simplemente no instala: la app funciona igual y el operador
 *    no tiene nada que hacer con ese error.
 * 3. **No se desregistra nunca desde aquí.** Si algún día hay que retirar el
 *    service worker, se hace sirviendo uno que se dé de baja a sí mismo, no
 *    quitando este componente — quitarlo dejaría el viejo instalado para
 *    siempre en los navegadores que ya lo tienen.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const registrar = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Contexto no seguro o navegador sin soporte: no hay nada que decirle
        // al operador. La app funciona; simplemente no se podrá instalar.
      });
    };

    if (document.readyState === "complete") {
      registrar();
      return;
    }
    window.addEventListener("load", registrar, { once: true });
    return () => window.removeEventListener("load", registrar);
  }, []);

  return null;
}
