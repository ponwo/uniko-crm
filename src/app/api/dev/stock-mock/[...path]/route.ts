import { jwtVerify } from "jose";
import { mockGuard } from "@/lib/dev-guard";
import {
  findActiveBySku,
  resetStockMock,
  searchActive,
  setStockMockMode,
  stockMockSnapshot,
  stockMockState,
  toPublic,
  type StockMockMode,
} from "@/server/dev/stock-mock-state";

export const dynamic = "force-dynamic";

/**
 * 026 — MS-Stock de mentira para el self-test. Tras `mockGuard()` (y el
 * middleware de la 024 sobre `/api/dev/*`): 404 incondicional en producción.
 *
 * Imita lo que el conector realmente usa —`/health`, la búsqueda del agente,
 * el producto exacto y la entrada SSO del portal— con el mismo contrato que la
 * feature 003 de MS-Stock, y expone `_state`, `_mode` y `_reset` para que el
 * arnés afirme y para poner el servicio en un modo infeliz.
 */

type Ctx = { params: Promise<{ path: string[] }> };

const MODES: StockMockMode[] = ["ok", "unauthorized", "down", "slow", "garbage"];

function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function authorized(req: Request): boolean {
  const expected = process.env.STOCK_API_KEY ?? "";
  const given = req.headers.get("x-api-key") ?? "";
  return expected.length > 0 && given === expected;
}

/** Aplica el modo infeliz a `/v1/*` y `/health`; `null` ⇒ seguir normal. */
async function unhappy(): Promise<Response | null> {
  const { mode } = stockMockState();
  if (mode === "down") {
    return apiError(503, "SERVICE_UNAVAILABLE", "Base de datos no disponible.");
  }
  if (mode === "unauthorized") {
    return apiError(401, "UNAUTHORIZED", "Llave inválida.");
  }
  if (mode === "garbage") {
    return new Response("not json", { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (mode === "slow") {
    // Más que el timeout del adaptador (3 s): el turno tiene que degradar.
    await new Promise((r) => setTimeout(r, 4_000));
  }
  return null;
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");
  const url = new URL(req.url);

  if (route === "_state") return Response.json(stockMockSnapshot());

  if (route === "health") {
    const bad = await unhappy();
    if (bad && bad.status === 503) return Response.json({ status: "degraded", db: "unavailable" }, { status: 503 });
    return Response.json({ status: "ok", db: "ok" });
  }

  if (route === "portal/sso") {
    return portalSso(url);
  }

  if (route.startsWith("v1/agent/")) {
    const isAuthorized = authorized(req);
    stockMockState().calls.push({ path: `/${route}`, authorized: isAuthorized });
    if (!isAuthorized) return apiError(401, "UNAUTHORIZED", "Llave inválida.");
    const bad = await unhappy();
    if (bad) return bad;

    if (route === "v1/agent/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit") ?? 10) || 10));
      if (q.length < 2 || q.length > 100) {
        return apiError(422, "VALIDATION_ERROR", "q debe tener entre 2 y 100 caracteres.");
      }
      const { results, truncated } = searchActive(q, limit);
      return Response.json({ results: results.map(toPublic), truncated });
    }

    const m = route.match(/^v1\/agent\/products\/([^/]+)$/);
    if (m && m[1]) {
      const product = findActiveBySku(decodeURIComponent(m[1]));
      if (!product) return apiError(404, "NOT_FOUND", "Producto no encontrado.");
      return Response.json(toPublic(product));
    }
  }

  return new Response(null, { status: 404 });
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");

  if (route === "_reset") {
    resetStockMock();
    return Response.json({ ok: true });
  }
  if (route === "_mode") {
    const body = (await req.json().catch(() => ({}))) as { mode?: string };
    const mode = MODES.find((m) => m === body.mode);
    if (!mode) return apiError(422, "VALIDATION_ERROR", `mode debe ser uno de ${MODES.join(", ")}`);
    setStockMockMode(mode);
    return Response.json({ ok: true, mode });
  }
  return new Response(null, { status: 404 });
}

/**
 * La entrada SSO del portal, reducida a lo que el self-test necesita: verificar
 * el pase como lo hace MS-Stock (HS256 con el secreto compartido, `aud` = esta
 * base, caducidad) y dejar constancia de a quién dejó entrar.
 */
async function portalSso(url: URL): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  const secret = process.env.STOCK_SSO_SECRET ?? "";
  const audience = (process.env.STOCK_BASE_URL ?? "").replace(/\/+$/, "");
  if (!token || !secret) return html(400, "Enlace no válido", "malformed");
  try {
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      audience,
      clockTolerance: 60,
    });
    if (protectedHeader.alg !== "HS256") return html(400, "Enlace no válido", "bad_signature");
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!payload.iss || !payload.sub || !payload.jti || !name || !payload.exp || !payload.iat) {
      return html(400, "Enlace no válido", "malformed");
    }
    if (payload.exp - payload.iat > 300) return html(400, "Enlace no válido", "malformed");
    const next = typeof payload.next === "string" ? payload.next : undefined;
    stockMockState().lastSso = {
      iss: payload.iss,
      aud: audience,
      sub: payload.sub,
      name,
      jti: payload.jti,
      ...(next ? { next } : {}),
      exp: payload.exp,
      iat: payload.iat,
    };
    return html(200, "Inventario de prueba", `${name} desde Uniko`);
  } catch (err) {
    const code = err instanceof Error && err.name === "JWTExpired" ? "expired" : "bad_signature";
    return html(400, code === "expired" ? "Este enlace caducó" : "Enlace no válido", code);
  }
}

function html(status: number, title: string, detail: string): Response {
  const body = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${detail}</p></body></html>`;
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
