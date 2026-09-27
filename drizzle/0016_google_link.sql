-- 029 Conexión de Google Calendar por link (modelo agencia, ADR-004): el
-- registro de links de un solo uso. Solo guarda la HUELLA (SHA-256) del link.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV),
-- como la 0009 de la agenda: IF NOT EXISTS en la tabla y los índices, y
-- DO-block en cada clave foránea.
--
-- Es puramente ADITIVA (Principio X): no toca ninguna tabla existente. Se
-- aplica en toda la flota, con o sin AGENDA: una tabla vacía es inerte.
-- Reversión: redesplegar el commit anterior (ningún código previo la lee).

CREATE TABLE IF NOT EXISTS "google_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "google_link" ADD CONSTRAINT "google_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "google_link" ADD CONSTRAINT "google_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "google_link_token_uq" ON "google_link" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_link_org_idx" ON "google_link" USING btree ("organization_id");
