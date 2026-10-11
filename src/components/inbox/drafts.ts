import { useMemo, useState, useSyncExternalStore } from "react";

/**
 * Borradores del compositor: uno por conversación y por usuario.
 *
 * La caja de escritura es una sola para toda la Bandeja. Antes su texto se
 * quedaba puesto al cambiar de conversación, y lo escrito para un contacto
 * podía salir hacia otro con un Ctrl+Enter. Borrarlo al cambiar quitaba el
 * riesgo pero castigaba lo más común: ir a otro hilo a revisar algo (qué
 * precio se le dio a otro cliente) y volver. Aquí el texto queda amarrado a
 * SU conversación, como en WhatsApp Web: la caja muestra siempre el borrador
 * de la conversación abierta, y nada viaja de un contacto a otro.
 *
 * Vive en el navegador (localStorage), no en el servidor: un borrador es de
 * quien lo escribe. En la base lo vería el compañero que atiende el mismo
 * chat, y costaría una tabla y una migración por algo que nadie más necesita.
 * La llave lleva el usuario para que, en una computadora compartida, quien
 * entra después no herede los borradores del anterior.
 *
 * El almacenamiento es solo persistencia: si el navegador lo niega (ventana
 * privada, cuota llena), los borradores siguen funcionando en memoria
 * durante la sesión.
 */
export type DraftStore = {
  /** Texto exacto del borrador de esa conversación ("" si no hay). */
  read(conversationId: string): string;
  /** Reemplaza el borrador; el texto vacío lo retira. */
  write(conversationId: string, text: string): void;
  subscribe(listener: () => void): () => void;
  /**
   * Firma de los borradores de las DEMÁS conversaciones. La lista la observa
   * en vez del mapa completo: escribir en la conversación abierta no cambia
   * la firma, así que teclear no repinta la lista entera.
   */
  othersSignature(exceptId: string | null): string;
  /** Adopta un cambio hecho en otra pestaña (evento `storage`). */
  adoptExternal(key: string | null, newValue: string | null): void;
};

/**
 * Un borrador olvidado un mes casi seguro se abandonó: la conversación ya
 * cambió y abrirla con ese texto puesto confunde más de lo que ayuda.
 */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PREFIX = "uniko.borrador.";

type Persisted = { t: string; at: number };

function parse(raw: string | null): Persisted | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Persisted> | null;
    if (typeof v?.t !== "string" || typeof v.at !== "number") return null;
    return { t: v.t, at: v.at };
  } catch {
    return null;
  }
}

export function createDraftStore(
  userId: string,
  storage: Storage | null,
  now: () => number = Date.now
): DraftStore {
  const prefix = `${PREFIX}${userId}.`;
  const drafts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const fresh = (raw: string | null): string | null => {
    const v = parse(raw);
    return v && v.t.trim() && now() - v.at <= DRAFT_TTL_MS ? v.t : null;
  };

  if (storage) {
    try {
      // Primero se juntan las llaves: borrar mientras se recorre corre los
      // índices y se saltaría la siguiente.
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(prefix)) keys.push(k);
      }
      for (const k of keys) {
        const text = fresh(storage.getItem(k));
        if (text === null) storage.removeItem(k);
        else drafts.set(k.slice(prefix.length), text);
      }
    } catch {
      // Sin acceso al almacenamiento: se arranca sin borradores guardados.
    }
  }

  return {
    read: (id) => drafts.get(id) ?? "",

    write(id, text) {
      if ((drafts.get(id) ?? "") === text) return;
      if (text) drafts.set(id, text);
      else drafts.delete(id);
      // En memoria se guarda el texto exacto (la caja lo muestra tal cual,
      // espacios incluidos); solo se persiste lo que tiene contenido.
      try {
        if (text.trim()) {
          storage?.setItem(prefix + id, JSON.stringify({ t: text, at: now() }));
        } else {
          storage?.removeItem(prefix + id);
        }
      } catch {
        // Cuota llena o almacenamiento bloqueado: el borrador sigue en memoria.
      }
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    othersSignature(exceptId) {
      const otros: [string, string][] = [];
      for (const [id, text] of drafts) {
        if (id !== exceptId && text.trim()) otros.push([id, text]);
      }
      return JSON.stringify(otros);
    },

    adoptExternal(key, newValue) {
      if (key === null) {
        // `localStorage.clear()` en otra pestaña.
        if (drafts.size === 0) return;
        drafts.clear();
        emit();
        return;
      }
      if (!key.startsWith(prefix)) return;
      const id = key.slice(prefix.length);
      const text = fresh(newValue) ?? "";
      if ((drafts.get(id) ?? "") === text) return;
      if (text) drafts.set(id, text);
      else drafts.delete(id);
      emit();
    },
  };
}

const stores = new Map<string, DraftStore>();

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Un almacén por usuario y por pestaña; en el servidor, uno inerte. */
export function draftStoreFor(userId: string): DraftStore {
  if (typeof window === "undefined") return createDraftStore(userId, null);
  let store = stores.get(userId);
  if (!store) {
    const s = createDraftStore(userId, browserStorage());
    window.addEventListener("storage", (e) => s.adoptExternal(e.key, e.newValue));
    stores.set(userId, s);
    store = s;
  }
  return store;
}

export function useDraftStore(userId: string): DraftStore {
  const [store] = useState(() => draftStoreFor(userId));
  return store;
}

/** El borrador de una conversación, en vivo. */
export function useDraft(store: DraftStore, conversationId: string): string {
  return useSyncExternalStore(
    store.subscribe,
    () => store.read(conversationId),
    () => ""
  );
}

/** Borradores de todas las conversaciones menos la abierta. */
export function useOtherDrafts(
  store: DraftStore,
  exceptId: string | null
): ReadonlyMap<string, string> {
  const signature = useSyncExternalStore(
    store.subscribe,
    () => store.othersSignature(exceptId),
    () => "[]"
  );
  return useMemo(
    () => new Map(JSON.parse(signature) as [string, string][]),
    [signature]
  );
}
