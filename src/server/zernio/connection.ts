import {
  getInstagramCredentialsByOrg,
  setInstagramWebhookSecret,
} from "@/server/instagram/credentials";
import {
  getMessengerCredentialsByOrg,
  setMessengerWebhookSecret,
} from "@/server/messenger/credentials";
import {
  ensureUnikoWebhook,
  resolveSharedSecret,
  unikoCallbackUrls,
  unikoWebhookStatus,
  type ZernioChannel,
} from "@/server/zernio/provision";

/**
 * 025 — La conexión Zernio de un canal, vista desde fuera del canal.
 *
 * Instagram y Messenger guardan sus credenciales en tablas distintas pero,
 * conectados por Zernio, comparten llave, webhook y secreto. Este módulo es el
 * único que mira las dos tablas a la vez: resuelve el secreto compartido,
 * registra el webhook y deja a ambos canales con el mismo secreto guardado.
 */

export type ZernioConnection = {
  channel: ZernioChannel;
  organizationId: string;
  token: string;
  accountRef: string;
  webhookSecret: string | null;
};

export async function getZernioConnection(
  organizationId: string,
  channel: ZernioChannel
): Promise<ZernioConnection | null> {
  const creds =
    channel === "instagram"
      ? await getInstagramCredentialsByOrg(organizationId)
      : await getMessengerCredentialsByOrg(organizationId);
  if (!creds || creds.source !== "zernio" || !creds.accountRef) return null;
  return {
    channel,
    organizationId,
    token: creds.token,
    accountRef: creds.accountRef,
    webhookSecret: creds.webhookSecret,
  };
}

function otherChannel(channel: ZernioChannel): ZernioChannel {
  return channel === "instagram" ? "messenger" : "instagram";
}

async function setWebhookSecret(
  organizationId: string,
  channel: ZernioChannel,
  secret: string
): Promise<void> {
  if (channel === "instagram") await setInstagramWebhookSecret(organizationId, secret);
  else await setMessengerWebhookSecret(organizationId, secret);
}

/**
 * El secreto con el que se guardará ESTE canal, antes de guardar: el que
 * escribió el operador, o el que ya comparte la organización, o uno nuevo.
 */
export async function sharedSecretFor(input: {
  organizationId: string;
  channel: ZernioChannel;
  typed: string | null;
}): Promise<{ secret: string; generated: boolean }> {
  const [other, mine] = await Promise.all([
    getZernioConnection(input.organizationId, otherChannel(input.channel)),
    getZernioConnection(input.organizationId, input.channel),
  ]);
  return resolveSharedSecret({
    typed: input.typed,
    otherChannel: other?.webhookSecret ?? null,
    thisChannel: mine?.webhookSecret ?? null,
  });
}

export type WebhookProvision = {
  registered: boolean;
  url: string;
  action?: "created" | "updated" | "unchanged";
  generatedSecret: boolean;
  /** Por qué no se pudo, para que la pantalla diga qué hacer a mano. */
  error?: string;
};

/**
 * Registra el webhook en Zernio con el secreto compartido y alinea el otro
 * canal. Nunca lanza: un fallo de Zernio se devuelve como `registered: false`
 * y la conexión ya guardada sigue siendo válida (Constitución II).
 */
export async function provisionWebhook(input: {
  organizationId: string;
  channel: ZernioChannel;
  token: string;
  secret: string;
  generatedSecret: boolean;
}): Promise<WebhookProvision> {
  const url = unikoCallbackUrls()[input.channel];
  try {
    const result = await ensureUnikoWebhook({
      token: input.token,
      channel: input.channel,
      secret: input.secret,
    });
    // Zernio firma con UN secreto por endpoint: si el otro canal guardó otro,
    // sus entregas fallarían la firma. Se alinea aquí, no en la pantalla.
    const other = await getZernioConnection(input.organizationId, otherChannel(input.channel));
    if (other && other.webhookSecret !== input.secret) {
      await setWebhookSecret(input.organizationId, other.channel, input.secret);
    }
    return {
      registered: true,
      url: result.url,
      action: result.action,
      generatedSecret: input.generatedSecret,
    };
  } catch (err) {
    console.warn(`[zernio] no se pudo registrar el webhook de ${input.channel}:`, err);
    return {
      registered: false,
      url,
      generatedSecret: input.generatedSecret,
      error: err instanceof Error ? err.message : "Zernio no respondió",
    };
  }
}

export type WebhookState = { url: string; status: "registered" | "missing" | "unknown" };

/** Para el GET del canal: ¿sigue el webhook dado de alta en Zernio? */
export async function webhookState(conn: ZernioConnection): Promise<WebhookState> {
  const url = unikoCallbackUrls()[conn.channel];
  try {
    return { url, status: await unikoWebhookStatus(conn.token) };
  } catch {
    return { url, status: "unknown" };
  }
}
