-- 034 (anuncio de origen, 2026-10-09) — De qué anuncio llegó cada conversación:
-- la imagen del creativo. Puerto de la 0014 de Vocero (su spec 018).
--
-- SOLO AGREGA (Constitución X): una columna nula, su clave foránea y un índice
-- sobre ad_attribution (016). Nada se borra ni se reescribe. Las filas que ya
-- existen quedan sin imagen; la app la repara al abrir el contacto con la URL
-- que ya guarda su raw, mientras Meta no la caduque.
-- Reversión: redesplegar el commit anterior; el código viejo ignora la columna.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV):
-- IF NOT EXISTS en columna e índice, como la 0018, y la clave foránea en bloque
-- DO, como la 0010 que creó esta tabla.
--
-- Mismos nombres de columna, clave foránea e índice que Vocero (0014) y Vocero
-- Cloud (0023): los repos comparten la forma de la tabla.

ALTER TABLE "ad_attribution" ADD COLUMN IF NOT EXISTS "image_asset_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_image_asset_id_media_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_attribution_org_source_idx" ON "ad_attribution" USING btree ("organization_id","source_id");
