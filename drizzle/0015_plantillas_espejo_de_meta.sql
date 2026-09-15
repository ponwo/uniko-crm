ALTER TABLE "template" ADD COLUMN "meta_status" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "missing_since" timestamp;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "components" jsonb;--> statement-breakpoint
-- 027 — Relleno. `meta_status` pasa a MANDAR sobre el envío, así que sin esto
-- toda plantilla ya aprobada quedaría sin enviar al desplegar, hasta que
-- alguien pulsara Sincronizar. Una caída silenciosa introducida por una
-- migración es peor que el fallo que arregla.
--
-- No inventa nada: a `status = 'approved'` solo se llega porque Meta respondió
-- APPROVED —por el sync o por el webhook `message_template_status_update`—, así
-- que la fila YA lo afirmaba. Esto lo escribe donde ahora se lee.
--
-- Re-ejecutable (Principio IV): el WHERE se vuelve vacío en la segunda pasada.
UPDATE "template" SET "meta_status" = 'APPROVED'
  WHERE "status" = 'approved' AND "meta_status" IS NULL;
