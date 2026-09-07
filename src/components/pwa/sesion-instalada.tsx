"use client";

import { useEffect, useState } from "react";
import { estaInstalada } from "@/lib/platform";

/**
 * La línea que explica por qué hay que entrar otra vez en la app instalada.
 *
 * Solo aparece cuando la app corre instalada (desde la pantalla de inicio) y no
 * hay sesión. En el navegador no sale: ahí entrar es lo normal y no hay nada que
 * explicar.
 *
 * **El texto está escrito para la quinta vez, no para la primera.** Es el mismo
 * criterio de FR-423, y aquí importa el doble porque este caso se repite: en iOS
 * la app instalada tiene su propia sesión —separada de la de Safari— y además el
 * sistema descarta el almacenamiento tras unos días sin abrirla. Quien lee esto
 * puede acabar de instalar la app o volver después de dos semanas, y para el
 * segundo un "bienvenido, la primera vez hay que entrar" le hace buscar un fallo
 * que no existe.
 *
 * Por eso no dice "bienvenido", no dice "la primera vez", no felicita por
 * instalar y no da por hecho nada sobre cuántas veces ha pasado. Dice qué está
 * ocurriendo y que no se ha perdido nada.
 */
export function SesionInstalada() {
  const [instalada, setInstalada] = useState(false);

  useEffect(() => {
    setInstalada(
      estaInstalada({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        displayStandalone: window.matchMedia("(display-mode: standalone)")
          .matches,
        navigatorStandalone:
          (navigator as Navigator & { standalone?: boolean }).standalone ===
          true,
      })
    );
  }, []);

  if (!instalada) return null;

  return (
    <p
      data-testid="sesion-instalada"
      className="mb-4 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs leading-relaxed text-[var(--text-2)]"
    >
      La app instalada guarda su sesión aparte de la del navegador, y el sistema
      la borra tras unos días sin usarla. Entra de nuevo y sigue todo donde
      estaba: no se ha perdido ninguna conversación.
    </p>
  );
}
