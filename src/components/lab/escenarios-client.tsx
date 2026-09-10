"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FlaskConical,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Escenario = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  script: string[];
  origin: "generado" | "manual";
};

/** Una propuesta en revisión: lo que el modelo escribió, editable por el dueño. */
type Propuesta = {
  label: string;
  description: string;
  script: string[];
  descartada: boolean;
};

export function EscenariosClient() {
  const [escenarios, setEscenarios] = useState<Escenario[]>([]);
  const [max, setMax] = useState(8);
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/lab/scenarios");
    if (!res.ok) return;
    const data = await res.json();
    setEscenarios(data.escenarios ?? []);
    setMax(data.max ?? 8);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function generar() {
    setGenerando(true);
    setError(null);
    setAviso(null);
    const res = await fetch("/api/lab/scenarios/generate", { method: "POST" });
    const data = await res.json().catch(() => null);
    setGenerando(false);

    if (!res.ok) {
      // El servidor distingue "falta configurar" de "vuelve a intentarlo".
      setError(data?.error?.message ?? "No se pudieron generar escenarios.");
      return;
    }
    setPropuestas(
      (data.propuestas ?? []).map((p: Omit<Propuesta, "descartada">) => ({
        ...p,
        descartada: false,
      }))
    );
    const notas: string[] = [];
    if (data.descartados > 0) {
      notas.push(
        `Se descartaron ${data.descartados} que no cumplían las reglas de un guion.`
      );
    }
    if (data.conocimientoRecortado) {
      notas.push(
        "Tu conocimiento es largo y se usó solo una parte para generar."
      );
    }
    setAviso(notas.join(" ") || null);
  }

  async function confirmar() {
    if (!propuestas) return;
    const aGuardar = propuestas.filter((p) => !p.descartada);
    if (aGuardar.length === 0) {
      setPropuestas(null);
      return;
    }
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/lab/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        escenarios: aGuardar.map(({ label, description, script }) => ({
          label,
          description,
          script: script.filter((l) => l.trim()),
        })),
      }),
    });
    const data = await res.json().catch(() => null);
    setGuardando(false);
    if (!res.ok) {
      setError(data?.error?.message ?? "No se pudieron guardar.");
      return;
    }
    setPropuestas(null);
    await cargar();
  }

  async function borrar(id: string) {
    await fetch(`/api/lab/scenarios/${id}`, { method: "DELETE" });
    await cargar();
  }

  const quedan = max - escenarios.length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
            <FlaskConical className="h-4 w-4 text-primary" /> Tus escenarios
          </h2>
          <p className="text-xs text-muted-foreground">
            Se corren <strong>además</strong> de los seis que trae el producto
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/lab">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" /> Al Laboratorio
            </Button>
          </Link>
          <Button
            onClick={() => void generar()}
            disabled={generando || quedan <= 0 || propuestas !== null}
          >
            <Wand2 className="h-4 w-4" />
            {generando ? "Generando…" : "Generar desde mi conocimiento"}
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <p className="text-xs text-muted-foreground">
          Los seis del producto miden <strong>comportamiento</strong> —si
          inventa, si escala, si entiende un mensaje mal escrito— y sirven para
          cualquier negocio. Estos miden si <strong>tu conocimiento</strong>{" "}
          tiene huecos, así que se generan buscando justo lo que no responde.
          Puedes tener hasta {max}; te quedan {Math.max(0, quedan)}.
        </p>

        {error && (
          <Card className="border-destructive">
            <CardContent className="py-3 text-sm">{error}</CardContent>
          </Card>
        )}
        {aviso && !error && (
          <p className="text-xs text-muted-foreground">{aviso}</p>
        )}

        {propuestas && (
          <RevisionDePropuestas
            propuestas={propuestas}
            guardando={guardando}
            onCambiar={setPropuestas}
            onConfirmar={() => void confirmar()}
            onCancelar={() => setPropuestas(null)}
          />
        )}

        {!propuestas && escenarios.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <Sparkles className="mx-auto mb-2 h-5 w-5 text-text-3" />
              <p className="text-sm font-medium">Todavía no tienes escenarios propios</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Genéralos desde tu conocimiento: el Laboratorio buscará lo que
                no cubre y verás dónde tu agente se queda sin respuesta.
              </p>
            </CardContent>
          </Card>
        )}

        {!propuestas &&
          escenarios.map((e) => (
            <Card key={e.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-sm">{e.label}</CardTitle>
                  {e.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {e.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">
                    {e.origin === "generado" ? "Generado" : "Escrito a mano"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Borrar ${e.label}`}
                    onClick={() => void borrar(e.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ol className="space-y-1">
                  {e.script.map((linea, i) => (
                    <li key={i} className="text-xs text-foreground">
                      <span className="mr-1.5 font-mono text-text-3">
                        {i + 1}.
                      </span>
                      {linea}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}

/**
 * FR-622, FR-623 — el dueño revisa ANTES de que nada exista.
 *
 * Nada de lo que se ve aquí está guardado: son borradores en memoria. Puede
 * corregir el texto y descartar lo que no sirva, y solo al confirmar se
 * escriben los que quedan. Que no haya estado intermedio persistido es lo que
 * hace cierta esa promesa.
 */
function RevisionDePropuestas({
  propuestas,
  guardando,
  onCambiar,
  onConfirmar,
  onCancelar,
}: {
  propuestas: Propuesta[];
  guardando: boolean;
  onCambiar: (p: Propuesta[]) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const vivas = propuestas.filter((p) => !p.descartada).length;

  function actualizar(i: number, cambios: Partial<Propuesta>) {
    onCambiar(propuestas.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand bg-brand-tint p-3">
        <p className="text-xs">
          <strong>Nada de esto está guardado todavía.</strong> Revisa el texto,
          corrige lo que no suene a tu negocio y descarta lo que no sirva.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancelar}>
            Descartar todo
          </Button>
          <Button size="sm" onClick={onConfirmar} disabled={guardando || vivas === 0}>
            {guardando ? "Guardando…" : `Guardar ${vivas}`}
          </Button>
        </div>
      </div>

      {propuestas.map((p, i) => (
        <Card key={i} className={p.descartada ? "opacity-40" : undefined}>
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
            <div className="flex-1">
              <Label htmlFor={`label-${i}`} className="text-[11px]">
                Nombre del caso
              </Label>
              <Input
                id={`label-${i}`}
                value={p.label}
                disabled={p.descartada}
                onChange={(e) => actualizar(i, { label: e.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-5 shrink-0"
              aria-label={p.descartada ? "Recuperar" : "Descartar"}
              onClick={() => actualizar(i, { descartada: !p.descartada })}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor={`script-${i}`} className="text-[11px]">
              Lo que escribe el cliente, un mensaje por línea
            </Label>
            <Textarea
              id={`script-${i}`}
              rows={p.script.length + 1}
              value={p.script.join("\n")}
              disabled={p.descartada}
              onChange={(e) =>
                actualizar(i, { script: e.target.value.split("\n") })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Cada mensaje tiene que sostenerse solo: el cliente simulado no
              reacciona a lo que conteste tu agente.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
