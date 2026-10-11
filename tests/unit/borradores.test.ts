import { describe, expect, it, vi } from "vitest";
import { createDraftStore, DRAFT_TTL_MS } from "@/components/inbox/drafts";

/** Storage mínimo en memoria, con el mismo contrato que localStorage. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
}

const T0 = 1_760_000_000_000;

describe("borradores del compositor", () => {
  it("cada conversación guarda el suyo: lo de una no aparece en otra", () => {
    const store = createDraftStore("u1", memoryStorage(), () => T0);
    store.write("cv_a", "precio para Ana");
    expect(store.read("cv_a")).toBe("precio para Ana");
    expect(store.read("cv_b")).toBe("");
  });

  it("sobrevive a recargar la página (persiste en el almacenamiento)", () => {
    const storage = memoryStorage();
    createDraftStore("u1", storage, () => T0).write("cv_a", "hola Ana");
    const recargado = createDraftStore("u1", storage, () => T0 + 1000);
    expect(recargado.read("cv_a")).toBe("hola Ana");
  });

  it("es de cada usuario: quien entra después en la misma compu no lo hereda", () => {
    const storage = memoryStorage();
    createDraftStore("u1", storage, () => T0).write("cv_a", "borrador de u1");
    expect(createDraftStore("u2", storage, () => T0).read("cv_a")).toBe("");
  });

  it("vaciarlo lo retira también del almacenamiento", () => {
    const storage = memoryStorage();
    const store = createDraftStore("u1", storage, () => T0);
    store.write("cv_a", "algo");
    store.write("cv_a", "");
    expect(storage.length).toBe(0);
    expect(createDraftStore("u1", storage, () => T0).read("cv_a")).toBe("");
  });

  it("solo espacios se muestran tal cual pero no se guardan como borrador", () => {
    const storage = memoryStorage();
    const store = createDraftStore("u1", storage, () => T0);
    store.write("cv_a", " ");
    expect(store.read("cv_a")).toBe(" ");
    expect(storage.length).toBe(0);
    expect(store.othersSignature(null)).toBe("[]");
  });

  it("uno abandonado más de 30 días se descarta al cargar", () => {
    const storage = memoryStorage();
    createDraftStore("u1", storage, () => T0).write("cv_viejo", "de hace mucho");
    createDraftStore("u1", storage, () => T0 + DRAFT_TTL_MS - 1000).write(
      "cv_reciente",
      "de ayer"
    );
    const despues = createDraftStore("u1", storage, () => T0 + DRAFT_TTL_MS + 1000);
    expect(despues.read("cv_viejo")).toBe("");
    expect(despues.read("cv_reciente")).toBe("de ayer");
    expect(storage.length).toBe(1);
  });

  it("ignora entradas corruptas en vez de romper la Bandeja", () => {
    const storage = memoryStorage({
      "uniko.borrador.u1.cv_a": "{no es json",
      "uniko.borrador.u1.cv_b": JSON.stringify({ t: 42, at: T0 }),
    });
    const store = createDraftStore("u1", storage, () => T0);
    expect(store.read("cv_a")).toBe("");
    expect(store.read("cv_b")).toBe("");
    expect(storage.length).toBe(0);
  });

  it("sin almacenamiento (ventana privada, cuota llena) sigue en memoria", () => {
    const roto = memoryStorage();
    roto.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = createDraftStore("u1", roto, () => T0);
    expect(() => store.write("cv_a", "sigue aquí")).not.toThrow();
    expect(store.read("cv_a")).toBe("sigue aquí");
    expect(createDraftStore("u1", null).read("cv_a")).toBe("");
  });

  it("la firma de la lista excluye la conversación abierta", () => {
    const store = createDraftStore("u1", memoryStorage(), () => T0);
    store.write("cv_a", "para Ana");
    store.write("cv_b", "para Beto");
    const sinA = store.othersSignature("cv_a");
    expect(JSON.parse(sinA)).toEqual([["cv_b", "para Beto"]]);
    // Teclear en la abierta no cambia la firma: la lista no se repinta.
    store.write("cv_a", "para Ana, con más texto");
    expect(store.othersSignature("cv_a")).toBe(sinA);
  });

  it("avisa a quien escucha solo cuando algo cambió", () => {
    const store = createDraftStore("u1", memoryStorage(), () => T0);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.write("cv_a", "x");
    store.write("cv_a", "x");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.write("cv_a", "y");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("adopta lo escrito en otra pestaña, solo de su usuario", () => {
    const store = createDraftStore("u1", memoryStorage(), () => T0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.adoptExternal(
      "uniko.borrador.u1.cv_a",
      JSON.stringify({ t: "desde otra pestaña", at: T0 })
    );
    expect(store.read("cv_a")).toBe("desde otra pestaña");
    store.adoptExternal(
      "uniko.borrador.u2.cv_a",
      JSON.stringify({ t: "de otro usuario", at: T0 })
    );
    expect(store.read("cv_a")).toBe("desde otra pestaña");
    store.adoptExternal("uniko.borrador.u1.cv_a", null);
    expect(store.read("cv_a")).toBe("");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
