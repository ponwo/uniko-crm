import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import {
  nextTemplateId,
  templatesOf,
  type MockTemplate,
} from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * 027 — Siembra plantillas DIRECTAMENTE en el panel simulado de Meta, sin
 * pasar por el CRM (solo dev, tras el gate único de `mockGuard`).
 *
 * Existe para poder montar el caso que hasta ahora era imposible de
 * reproducir: **el negocio ya tenía plantillas antes de conectar Uniko**, o
 * las creó en el Administrador de WhatsApp porque aquí "marcaba error". Es la
 * situación NORMAL, no un caso de borde — y mientras la única forma de meter
 * una plantilla en el mock fuera crearla desde el CRM, ninguna prueba podía
 * distinguir "el sync las importa" de "el sync solo sabe de las que él mismo
 * creó". La suite pasaba porque el escenario no se podía escribir.
 *
 * Devuelve el total que queda en ese WABA para que el llamador no tenga que
 * suponerlo.
 */
const plantillaSchema = z.object({
  name: z.string().min(1),
  language: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  /** Texto libre y en MAYÚSCULAS (027): el mock produce cualquier estado. */
  status: z
    .string()
    .min(1)
    .transform((s) => s.trim().toUpperCase())
    .optional(),
  body: z.string().min(1).optional(),
  /**
   * Componentes completos, como los devuelve Graph. Si vienen, mandan sobre
   * `body` (el cuerpo se toma del componente BODY): así se siembra una
   * plantilla con encabezado de imagen o botones, que el CRM no crea.
   */
  components: z.array(z.record(z.string(), z.unknown())).optional(),
});

const bodySchema = z.object({
  wabaId: z.string().min(1),
  templates: z.array(plantillaSchema).min(1).max(500),
});

function cuerpoDe(components: Record<string, unknown>[] | undefined): string | null {
  const body = components?.find(
    (c) => String(c.type ?? "").toUpperCase() === "BODY"
  );
  return typeof body?.text === "string" ? body.text : null;
}

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const bolsa = templatesOf(body.data.wabaId);
  const sembradas: MockTemplate[] = [];
  for (const cruda of body.data.templates) {
    const texto = cuerpoDe(cruda.components) ?? cruda.body ?? "Hola, seguimos disponibles.";
    const language = cruda.language ?? "es_MX";
    // Meta rechaza el nombre duplicado dentro del mismo idioma: sembrar dos
    // veces actualiza la existente en vez de crear una gemela.
    const previa = bolsa.find(
      (t) => t.name === cruda.name && t.language === language
    );
    if (previa) {
      // Solo se pisa lo que el llamador mandó de verdad: re-sembrar una
      // plantilla para cambiarle el estado no debe reescribirle el cuerpo.
      if (cruda.category) previa.category = cruda.category;
      if (cruda.status) previa.status = cruda.status;
      if (cruda.components) {
        previa.components = cruda.components;
        previa.body = texto;
      } else if (cruda.body) {
        previa.body = cruda.body;
        previa.components = [{ type: "BODY", text: cruda.body }];
      }
      sembradas.push(previa);
      continue;
    }
    const tpl: MockTemplate = {
      id: nextTemplateId("tplseed"),
      name: cruda.name,
      language,
      category: cruda.category ?? "UTILITY",
      status: cruda.status ?? "APPROVED",
      body: texto,
      components: cruda.components ?? [{ type: "BODY", text: texto }],
    };
    bolsa.push(tpl);
    sembradas.push(tpl);
  }

  return Response.json({
    seeded: sembradas.map((t) => ({ id: t.id, name: t.name, language: t.language })),
    total: bolsa.length,
  });
}
