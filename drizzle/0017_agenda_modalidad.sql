-- 015 (modalidad, 2026-09-30) — Citas virtuales o presenciales, por negocio.
--
-- SOLO AGREGA columnas (Constitución X): nada se borra ni se reescribe. El
-- default `virtual` de la configuración es exactamente lo que toda instancia
-- hacía antes, y en `booking` las dos columnas nacen null (= cita virtual de
-- siempre), así que desplegar esto no cambia el comportamiento de nadie hasta
-- que el dueño elija «Presencial» en Ajustes → Agenda. Reversión: redesplegar
-- el commit anterior; el código viejo ignora las cuatro columnas.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV),
-- como la 0009 y la 0016: IF NOT EXISTS en cada columna.
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "meeting_mode" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "location" text;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN IF NOT EXISTS "meeting_mode" text DEFAULT 'virtual' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN IF NOT EXISTS "location" text;
