import { describe, expect, it, vi } from "vitest";

/**
 * 029 — El flujo OAuth de la conexión por link: la firma del `state`, las
 * direcciones, y `completeGoogleOAuth` motivo por motivo.
 *
 * `completeGoogleOAuth` recibe sus dependencias, así que cada camino se prueba
 * sin red ni base. La regla que se vigila en TODOS los caminos infelices: no se
 * guarda nada (`consumeAndSave` no se llama).
 */

vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("no debía tocar la base");
  },
  schema: {},
}));

const {
  STATE_TTL_SECONDS,
  buildGoogleAuthUrl,
  buildGoogleLinkUrl,
  completeGoogleOAuth,
  nonceHash,
  resultUrl,
  signOAuthState,
  verifyOAuthState,
} = await import("@/server/agenda/connectors/google-oauth");
const { ConnectorError } = await import("@/server/agenda/connectors/types");

type Deps = Parameters<typeof completeGoogleOAuth>[2];

const CFG = {
  origin: "https://uniko.negocio.test",
  authSecret: "secreto-de-better-auth-de-prueba",
};
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const NOW = new Date("2026-09-27T12:00:00.000Z");
const NONCE = "nonce-del-navegador";

function decodePayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("029 — el state", () => {
  it("lleva el origen legible para el relevo, y el nonce solo como huella", async () => {
    const jwt = await signOAuthState(
      { organizationId: "org_1", linkId: "glink_1", nonce: NONCE, now: NOW },
      CFG
    );
    expect(jwt.split(".")).toHaveLength(3);
    const payload = decodePayload(jwt);
    expect(payload.ret).toBe(CFG.origin);
    expect(payload.lnk).toBe("glink_1");
    expect(payload.sub).toBe("org_1");
    expect(payload.nh).toBe(nonceHash(NONCE));
    expect(JSON.stringify(payload)).not.toContain(NONCE);
  });

  it("se verifica dentro de los 15 minutos y vence después", async () => {
    const jwt = await signOAuthState(
      { organizationId: "org_1", linkId: "glink_1", nonce: NONCE, now: NOW },
      CFG
    );
    const dentro = await verifyOAuthState(jwt, new Date(NOW.getTime() + 14 * 60_000), CFG);
    expect(dentro).toEqual({
      ok: true,
      state: { organizationId: "org_1", linkId: "glink_1", nonceHash: nonceHash(NONCE) },
    });
    const fuera = await verifyOAuthState(
      jwt,
      new Date(NOW.getTime() + (STATE_TTL_SECONDS + 60) * 1000),
      CFG
    );
    expect(fuera).toEqual({ ok: false, reason: "vencido" });
  });

  it("cambiar el origen, o firmarlo otra instancia, lo invalida", async () => {
    const jwt = await signOAuthState(
      { organizationId: "org_1", linkId: "glink_1", nonce: NONCE, now: NOW },
      CFG
    );
    const [h, p, s] = jwt.split(".");
    const payload = JSON.parse(Buffer.from(p ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    payload.ret = "https://atacante.test";
    const manipulado = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
    expect(await verifyOAuthState(manipulado, NOW, CFG)).toEqual({ ok: false, reason: "invalido" });

    const otraInstancia = { ...CFG, origin: "https://otra.test" };
    expect(await verifyOAuthState(jwt, NOW, otraInstancia)).toEqual({ ok: false, reason: "invalido" });
    expect(await verifyOAuthState(jwt, NOW, { ...CFG, authSecret: "otro-secreto-cualquiera" })).toEqual({
      ok: false,
      reason: "invalido",
    });
    expect(await verifyOAuthState("no-es-un-jwt", NOW, CFG)).toEqual({ ok: false, reason: "invalido" });
  });
});

describe("029 — las direcciones", () => {
  it("la autorización pide un solo permiso, de larga duración y con consentimiento", () => {
    const url = new URL(
      buildGoogleAuthUrl("STATE", {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        clientId: "cli.apps.googleusercontent.com",
        redirectUri: "https://lanco.cloud/google-calendar/callback",
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cli.apps.googleusercontent.com",
      redirect_uri: "https://lanco.cloud/google-calendar/callback",
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: "STATE",
    });
  });

  it("con página de aterrizaje, el link lleva el host y la llave (contrato §1)", () => {
    expect(
      buildGoogleLinkUrl("LLAVE_43", {
        onboardingUrl: "https://lanco.cloud/google-calendar",
        origin: CFG.origin,
      })
    ).toBe("https://lanco.cloud/google-calendar?i=uniko.negocio.test&t=LLAVE_43");
  });

  it("sin página de aterrizaje (self-hoster), el link va directo a la instancia", () => {
    expect(buildGoogleLinkUrl("LLAVE_43", { onboardingUrl: null, origin: CFG.origin })).toBe(
      "https://uniko.negocio.test/api/google/oauth/start?t=LLAVE_43"
    );
  });

  it("el resultado solo lleva la clave del motivo", () => {
    expect(resultUrl(CFG.origin, "ok")).toBe("https://uniko.negocio.test/conectar-google?estado=ok");
  });
});

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    config: { clientId: "cli-agencia", clientSecret: "secreto-agencia" },
    verifyState: vi.fn(async () => ({
      ok: true as const,
      state: { organizationId: "org_1", linkId: "glink_1", nonceHash: nonceHash(NONCE) },
    })),
    getLink: vi.fn(async () => ({
      id: "glink_1",
      organizationId: "org_1",
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      usedAt: null,
      revokedAt: null,
    })),
    currentCalendarId: vi.fn(async () => null),
    exchange: vi.fn(async () => ({ refreshToken: "ref-nuevo", scope: SCOPE })),
    testConnection: vi.fn(async () => ({ ok: true as const, detail: "titular@gmail.com" })),
    consumeAndSave: vi.fn(async () => "ok" as const),
    useGoogleConnector: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  };
}

function query(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams({ state: "STATE", code: "codigo-1", ...params });
}

const CTX = { cookieNonce: NONCE, now: NOW };

describe("029 — completar el flujo: camino feliz", () => {
  it("canjea, prueba, guarda con el cliente de la agencia y deja Google como conector", async () => {
    const deps = makeDeps();
    const out = await completeGoogleOAuth(query({}), CTX, deps);
    expect(out).toEqual({ motivo: "ok", calendario: "titular@gmail.com" });
    expect(deps.exchange).toHaveBeenCalledWith("codigo-1", "primary");
    expect(deps.consumeAndSave).toHaveBeenCalledWith({
      organizationId: "org_1",
      linkId: "glink_1",
      creds: {
        clientId: "cli-agencia",
        clientSecret: "secreto-agencia",
        refreshToken: "ref-nuevo",
        calendarId: "primary",
      },
      now: NOW,
    });
    expect(deps.useGoogleConnector).toHaveBeenCalledWith("org_1");
  });

  it("al reconectar conserva el calendario destino que ya tenía (FR-1417)", async () => {
    const deps = makeDeps({ currentCalendarId: vi.fn(async () => "citas@group.calendar.google.com") });
    await completeGoogleOAuth(query({}), CTX, deps);
    expect(deps.exchange).toHaveBeenCalledWith("codigo-1", "citas@group.calendar.google.com");
    expect(deps.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "citas@group.calendar.google.com" })
    );
  });

  it("si el link vence durante la ida y vuelta, el state vigente basta", async () => {
    const deps = makeDeps({
      getLink: vi.fn(async () => ({
        id: "glink_1",
        organizationId: "org_1",
        expiresAt: new Date(NOW.getTime() - 60_000),
        usedAt: null,
        revokedAt: null,
      })),
    });
    expect((await completeGoogleOAuth(query({}), CTX, deps)).motivo).toBe("ok");
  });

  it("si cambiar el conector falla, la conexión ya es buena: ok, y queda en el log", async () => {
    const deps = makeDeps({
      useGoogleConnector: vi.fn(async () => {
        throw new Error("base ocupada");
      }),
    });
    expect((await completeGoogleOAuth(query({}), CTX, deps)).motivo).toBe("ok");
    expect(deps.log).toHaveBeenCalled();
  });
});

describe("029 — completar el flujo: caminos infelices, sin guardar nada", () => {
  type Caso = [string, Partial<Deps>, Record<string, string>, { cookieNonce: string | null }, string];
  const casos: Caso[] = [
    ["sin state", {}, { state: "" }, { cookieNonce: NONCE }, "link_invalido"],
    [
      "state con firma inválida",
      { verifyState: vi.fn(async () => ({ ok: false as const, reason: "invalido" as const })) },
      {},
      { cookieNonce: NONCE },
      "link_invalido",
    ],
    [
      "state vencido (más de 15 min)",
      { verifyState: vi.fn(async () => ({ ok: false as const, reason: "vencido" as const })) },
      {},
      { cookieNonce: NONCE },
      "otro_navegador",
    ],
    ["sin la cookie del navegador", {}, {}, { cookieNonce: null }, "otro_navegador"],
    ["con la cookie de otro flujo", {}, {}, { cookieNonce: "otro-nonce" }, "otro_navegador"],
    ["canceló en Google", {}, { error: "access_denied" }, { cookieNonce: NONCE }, "cancelado"],
    [
      "política de su empresa",
      {},
      { error: "admin_policy_enforced" },
      { cookieNonce: NONCE },
      "politica_empresa",
    ],
    ["otro error de Google", {}, { error: "server_error" }, { cookieNonce: NONCE }, "google_rechazo"],
    ["link que ya no existe", { getLink: vi.fn(async () => null) }, {}, { cookieNonce: NONCE }, "link_invalido"],
    [
      "link usado mientras tanto",
      {
        getLink: vi.fn(async () => ({
          id: "glink_1",
          organizationId: "org_1",
          expiresAt: new Date(NOW.getTime() + 3_600_000),
          usedAt: NOW,
          revokedAt: null,
        })),
      },
      {},
      { cookieNonce: NONCE },
      "link_usado",
    ],
    [
      "link revocado mientras tanto",
      {
        getLink: vi.fn(async () => ({
          id: "glink_1",
          organizationId: "org_1",
          expiresAt: new Date(NOW.getTime() + 3_600_000),
          usedAt: null,
          revokedAt: NOW,
        })),
      },
      {},
      { cookieNonce: NONCE },
      "link_invalido",
    ],
    ["sin code ni error", {}, { code: "" }, { cookieNonce: NONCE }, "google_rechazo"],
    [
      "código vencido o reusado (400)",
      {
        exchange: vi.fn(async () => {
          throw new ConnectorError("google", "invalid_grant", { status: 400 });
        }),
      },
      {},
      { cookieNonce: NONCE },
      "google_no_respondio",
    ],
    [
      "Google caído (503)",
      {
        exchange: vi.fn(async () => {
          throw new ConnectorError("google", "Service Unavailable", { status: 503 });
        }),
      },
      {},
      { cookieNonce: NONCE },
      "google_no_respondio",
    ],
    [
      "sin red",
      {
        exchange: vi.fn(async () => {
          throw new ConnectorError("google", "No se pudo contactar a Google");
        }),
      },
      {},
      { cookieNonce: NONCE },
      "google_no_respondio",
    ],
    [
      "cliente OAuth mal configurado (401)",
      {
        exchange: vi.fn(async () => {
          throw new ConnectorError("google", "invalid_client", { status: 401 });
        }),
      },
      {},
      { cookieNonce: NONCE },
      "prueba_fallida",
    ],
    [
      "desmarcó el permiso de calendario",
      { exchange: vi.fn(async () => ({ refreshToken: "ref", scope: "openid email" })) },
      {},
      { cookieNonce: NONCE },
      "permiso_incompleto",
    ],
    [
      "Google no devolvió refresh token",
      { exchange: vi.fn(async () => ({ refreshToken: null, scope: SCOPE })) },
      {},
      { cookieNonce: NONCE },
      "prueba_fallida",
    ],
    [
      "la prueba contra el calendario falla",
      { testConnection: vi.fn(async () => ({ ok: false as const, error: "403" })) },
      {},
      { cookieNonce: NONCE },
      "prueba_fallida",
    ],
  ];

  for (const [nombre, overrides, params, ctx, esperado] of casos) {
    it(`${nombre} → ${esperado}`, async () => {
      const deps = makeDeps(overrides);
      const out = await completeGoogleOAuth(query(params), { ...ctx, now: NOW }, deps);
      expect(out).toEqual({ motivo: esperado });
      expect(deps.consumeAndSave).not.toHaveBeenCalled();
      expect(deps.useGoogleConnector).not.toHaveBeenCalled();
    });
  }

  it("dos pestañas: la segunda respuesta encuentra el link consumido → link_usado", async () => {
    const deps = makeDeps({ consumeAndSave: vi.fn(async () => "link_usado" as const) });
    expect(await completeGoogleOAuth(query({}), CTX, deps)).toEqual({ motivo: "link_usado" });
    expect(deps.useGoogleConnector).not.toHaveBeenCalled();
  });

  it("un error de Google no se refleja entero en el log", async () => {
    const deps = makeDeps();
    await completeGoogleOAuth(query({ error: "x".repeat(500) }), CTX, deps);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged.length).toBeLessThan(120);
  });
});
