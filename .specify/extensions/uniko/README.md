# Extensión `uniko` — operaciones de flota

Ejecuta la **puerta de promoción a producción** normada en
`.specify/memory/constitution.md`. No añade criterios: los comprueba.

## Comandos

| Comando | Qué hace |
|---|---|
| `/uniko-promote` | Evalúa las seis condiciones de la puerta, resume y **se detiene sin promover** |

## Guiones

| Guion | Qué hace |
|---|---|
| `scripts/bash/promote-gate.sh` | Condiciones mecanizables: LanCo al día, CI verde por SHA, qué viaja, si toca `drizzle/`. Solo lectura |
| `scripts/bash/verify-fleet.sh` | Cierre: `/api/health` de las tres instancias contra el commit promovido |

Los dos se pueden correr a mano; `verify-fleet.sh` acepta el commit esperado
como argumento y, sin él, usa `origin/production`.

## Lo que no hace

No promueve. No hace `merge`, no hace `push`, no escribe en `production`.

Es deliberado: dos bases de clientes migran al arrancar el contenedor, a la vez
y sin `down`. Si el comando promoviera al final de su propia checklist, el
momento irreversible llegaría como consecuencia de haber contestado bien seis
preguntas, y para la sexta uno ya está en modo trámite. La constitución lo
separa igual — *la señal es el disparador; estas condiciones son la puerta*.

Tampoco tiene escape: sin `--force` y sin "saltar con justificación". Si alguna
vez estorba, se relaja a propósito y sabiendo por qué.
