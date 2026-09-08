# Respaldos de la flota

**Estado (2026-09-08)**: la propuesta está **decidida**. La configuración exacta
a aplicar está en la sección **6-bis**, y **la aplica el dueño en Coolify** — no
un agente: es infraestructura viva de dos clientes.

**PROGRAMADAS Y VERIFICADAS el 2026-09-08.** Las cuatro bases tienen su
programación diaria, creada por MCP y leída de vuelta una por una.

| Base | UUID de la programación | Frecuencia | Base | Retención |
|---|---|---|---|---|
| `uniko-lanco-db` | `8rsztyk88fbd4g7wwcpufeip` | `0 3 * * *` | `uniko` | 14 días |
| `uniko-iltu-db` | `fauudbtdjg5otbqbo5ohdgj2` | `15 3 * * *` | `uniko` | 14 días |
| `uniko-nuriaandrea-db` | `t4y0oznkzh2f4a1sjazbcxa5` | `30 3 * * *` | `uniko` | 14 días |
| `kosmo-db` | `m7dhvivvxjhtzrkmpatdzutr` | `45 3 * * *` | `kosmo` | 14 días |

En las cuatro: habilitadas, `dump_all` en **false**, S3 apagado, retención por
número en 0 (manda la de días), `timeout` 3600 (el que pone el panel). **Una sola
programación por base**: no hay duplicados.

### Qué pasó con el intento anterior, y qué aprendimos del MCP

El dueño aplicó las cuatro por el panel y no llegaron a guardarse: al crear la
primera por MCP, el listado —que hasta entonces devolvía vacío— empezó a
responder con ella. **El listado no estaba ciego: de verdad no había nada.** El
hallazgo original de este documento se sostiene.

Lo que sí está roto en este MCP es `get_schedule` por uuid: devuelve *Not found*
para un uuid que el listado muestra. Para verificar, usar **`list_schedules`**.

### La primera ejecución: las cuatro en verde (2026-09-08)

El dueño lanzó el "Back up now" desde el panel —**este MCP no expone ninguna
acción para ejecutar un respaldo**: tiene crear, listar, actualizar y borrar, y
nada más—. Leídas después por `list_executions`:

| Base | Estado | Tamaño | Archivo |
|---|---|---|---|
| `uniko-lanco-db` | **success** | 86.590 B (~85 KB) | `pg-dump-uniko-1788880720.dmp` |
| `uniko-iltu-db` | **success** | 86.407 B (~84 KB) | `pg-dump-uniko-1788880754.dmp` |
| `uniko-nuriaandrea-db` | **success** | 79.942 B (~78 KB) | `pg-dump-uniko-1788880780.dmp` |
| `kosmo-db` | **success** | 113.106 B (~110 KB) | `pg-dump-kosmo-1788880806.dmp` |

Viven en `/data/coolify/backups/databases/root-team-0/<base>-<uuid>/` del propio
VPS.

**Lo que dicen esos tamaños.** Los cuatro volcados juntos pesan ~366 KB, así que
catorce días de retención ocupan unos **5 MB en total**. El coste de guardar más
es irrelevante: si algún día conviene subir la retención a 30 o 60 días, no hay
que pensárselo por espacio.

Y una advertencia para el ensayo del Principio X: **80 KB es muy poco dato**.
Estas instancias son de hace semanas y apenas tienen conversaciones. El ensayo
va a probar que la migración corre contra la FORMA real de los datos —que es lo
que pide el principio— pero **no** contra volumen. El día que una instancia tenga
un año de conversaciones, ese mismo ensayo dirá cosas nuevas sobre la duración.

## 7. Recomendación

**Opción B**, con esta secuencia:

1. **Hoy mismo, sin esperar al bucket**: programar el respaldo **local diario**
   en las tres bases. Son minutos y cierra el agujero más grande —hoy no hay
   nada— aunque no cubra la pérdida del servidor.
2. **Esta semana**: dar de alta el bucket S3 y activar la copia fuera con
   retención de 30 días.
3. **Antes de tocar `drizzle/` otra vez** (la 020 la toca): el primer simulacro
   de restauración, que sirve de ensayo del Principio X.
4. **Aparte**: comprobar en el panel del proveedor si hay snapshots del VPS y
   activarlos si no cuestan mucho — como complemento, y sabiendo lo que no
   resuelven.

## 7-bis. Qué queda pendiente después de esto

Con la configuración de arriba aplicada, el agujero grande se cierra a medias.
Lo que **sigue faltando**, dicho sin adornos:

1. **El destino sigue siendo LOCAL.** Los volcados quedan en el mismo disco que
   las bases. Eso protege de un borrado accidental, de una migración que salió
   mal y de una tabla corrupta — **no protege de perder la máquina**. Si el VPS
   desaparece, se van las bases y los respaldos juntos. Se resuelve a fin de mes
   activando el destino externo en el mismo panel.
2. **~~El simulacro de restauración sigue pendiente~~ — hecho el 2026-09-08.**
   El respaldo de LanCo de ese día (86.590 B) se restauró en una base desechable
   y aguantó la migración 0013: restauración en 981 ms, 1 conversación y 18
   mensajes recuperados, y la app arrancó contra la copia. Ya no es un archivo
   que nadie ha abierto. El procedimiento —corregido con lo que pasó de verdad—
   está en
   [`specs/020-notificaciones-push/quickstart.md`](../specs/020-notificaciones-push/quickstart.md).
   Lo que sigue pendiente es **repetirlo**: un simulacro mensual, no uno solo.
3. **Los snapshots del VPS siguen sin verificar.** Solo se ven en el panel del
   proveedor, y no sustituyen a esto (sección 2).

## 8. Lo que NO pude verificar desde aquí

Para que nadie lo dé por comprobado:

- **Espacio libre en disco** del VPS. Antes de fijar la retención local conviene
  mirarlo (`df -h`).
- **Tamaño real de cada base**. Con el volumen actual la estimación es de pocos
  megabytes por volcado, pero es una estimación:
  `select pg_size_pretty(pg_database_size('uniko'));`
- **Si ya existe un destino S3 configurado** en Coolify.
- **Si el proveedor tiene snapshots activos.** Solo se ve en su panel.
