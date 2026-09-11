import { commentAutomationHandlers } from "@/server/zernio/comment-automation-route";

export const dynamic = "force-dynamic";

/** 025 — Automatización comentario→DM de la cuenta de Facebook conectada por Zernio. */
export const { GET, PUT } = commentAutomationHandlers("messenger");
