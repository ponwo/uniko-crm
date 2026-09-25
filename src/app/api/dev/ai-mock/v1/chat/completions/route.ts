import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion } from "@/server/dev/ai-mock";
import { recordAiMockCall } from "@/server/dev/ai-mock-state";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: string }[];
    model?: string;
  };
  // 015 — Se anota el modelo pedido: es lo que le permite al arnés comprobar
  // que `AGENDA_MODEL` entra SOLO en los turnos de elegir horario.
  recordAiMockCall(body.model);
  const content = aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
