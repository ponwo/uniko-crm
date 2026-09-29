# E2E — La cita que agenda el operador desde la conversación (030)

Guion de comportamiento observable. La mitad de la API está automatizada en
`scripts/e2e-selftest.mjs` (`citaManualChecks()`, dentro del tramo del agente de la
015): con la app viva, los mocks encendidos y `AGENDA=on`, `pnpm test:e2e` lo conduce
y sale distinto de cero si algo falla. La pantalla se recorre en el navegador de
vista previa.

**Preparación**: la del bloque 015 (`tests/e2e/us-agenda.md`), que deja el horario de
09:00 a 18:00 todos los días, el conector en enlace fijo y el agente encendido.

---

## Con la agenda apagada, no existe

1. `GET /api/bookings?contactId=…` → **404**.
2. En *Bandeja → Detalles* no hay sección «Cita».

## Agendar desde la conversación (arnés)

1. Un contacto escribe; su conversación existe. Sus próximas vienen **vacías**, y las
   de un contacto que no es de la organización, también.
2. El operador agenda en un hueco libre con una nota: **201**. La cita aparece entre
   las próximas del contacto: origen **manual**, **ligada a la conversación**, con
   su nota y en el hueco elegido. Solo trae citas de ese contacto.
3. **Ningún mensaje** sale hacia el contacto.

## El agente la ve (arnés)

1. El contacto pide cambiar su cita → el agente ofrece horarios.
2. Elige una hora del menú → el agente **la mueve** («¡Listo, la moví!»). Sigue
   habiendo **una** cita: la misma, a la hora pedida.

## Mover y cancelar (arnés)

1. El operador la mueve a otro hueco libre: queda ahí.
2. Agendar otra en ese mismo hueco → **409 `slot_taken`**, sin cita nueva.
3. Cancelarla: deja de aparecer entre las próximas.
4. Ninguna de las dos acciones le manda nada al contacto.

## En la pantalla (navegador de vista previa)

1. *Bandeja → una conversación → Detalles*: la sección **«Cita»** entre la etapa y
   la ficha, con «Sin cita próxima» y *Agendar cita*.
2. *Agendar cita* → chips de día («Hoy · mar 29 sep», «Mañana · …») → chips de hora
   → nota opcional → *Agendar*: aparece la cita (día, hora, duración, «Manual»,
   *Enlace de la reunión*) y «Cita agendada. Al contacto no le llega aviso.». La
   etapa avanza, como con cualquier cita.
3. *Mover* → otro día y hora → *Mover aquí*: la tarjeta cambia de hora y conserva el
   enlace.
4. *Cancelar* pide confirmación («¿Cancelar esta cita? Se borra la reunión.») → *Sí,
   cancelar*: vuelve «Sin cita próxima».
5. Si la IA agenda en esa conversación con el panel abierto, la cita aparece sola.
6. En móvil (375 px), todo cabe en el panel sin scroll horizontal.
