# Respaldos de la flota — PROPUESTA (no implementada)

**Estado**: propuesta, esperando decisión. **Nada de esto está aplicado.**
**Fecha**: 2026-09-07.

Escrita porque al preparar el ensayo del Principio X de la feature 020 apareció
un hallazgo que es más grave que la feature.

---

## 1. El estado de hoy, verificado

Consultado contra Coolify (4.3.17) el 2026-09-07:

- **Ninguna de las tres bases de Uniko tiene respaldos programados.** Las tres
  devuelven cero programaciones: `uniko-lanco-db`, `uniko-iltu-db`,
  `uniko-nuriaandrea-db`.
- **Todo corre en un solo servidor** (`212.28.185.186`): las tres apps de Uniko,
  sus tres Postgres, y además Kosmo con su base, n8n, Waha, ChatWoot, Hermes y
  los sitios de LanCo e ILTU.

Lo que eso significa, sin adornos: **si hoy se pierde la base de un cliente, no
hay nada que restaurar.** Sus conversaciones, sus contactos y su pipeline se van
con ella. No es deuda técnica: es el activo del negocio de otra persona.

Y un matiz que se olvida: **`kosmo-db` está en la misma máquina y tiene la misma
carencia**. Queda fuera de esta propuesta porque es otro producto, pero el
agujero es idéntico.

## 2. Antes de nada: los snapshots del VPS no son esto

Es probable que exista —o se pueda activar— un snapshot del disco completo en el
panel del proveedor. **No lo pude verificar desde aquí** y hay que mirarlo. Pero
conviene dejar claro por qué **no sustituye** a los respaldos de base:

| | Snapshot del VPS | Respaldo de base (`pg_dump`) |
|---|---|---|
| Qué te devuelve | La máquina entera, tal como estaba | Un archivo restaurable donde quieras |
| Para ensayar una migración | **No sirve**: no hay dump que restaurar en un Postgres desechable | Es exactamente lo que el Principio X pide |
| Para recuperar *una* base | Vuelve **todo** atrás: las tres instancias, Kosmo, n8n, los sitios | Restauras solo la que se rompió |
| Para recuperar *unas filas* | Imposible sin levantar una máquina entera aparte | Trivial |
| Consistencia | De disco, no lógica: Postgres tiene que recuperarse al arrancar | Volcado lógico y coherente por diseño |
| Granularidad típica | Diaria o semanal, y ocupa el tamaño del disco | Diaria o más, y ocupa megabytes |

**La conclusión práctica**: los snapshots son un buen complemento para "el
servidor ardió", y son inútiles para "hay que ensayar una migración" y muy caros
para "se borró una conversación". Se recomiendan **además**, nunca **en vez de**.

## 3. Qué ofrece Coolify de serie

En 4.3.17, cada base tiene su pestaña de **Backups**, con:

- **Programación por cron** (frecuencia libre: diaria, cada N horas…).
- **Retención local**: por número de copias y por días, configurables.
- **Destino S3 opcional**, con su **retención propia**, separada de la local.
- **Ejecuciones manuales** y un **historial** con el estado de cada una.
- Opción de volcar **todas** las bases del servidor o solo la de esa instancia.

Dos límites que conviene saber antes de decidir:

1. **Coolify no restaura.** Genera y guarda; restaurar es a mano, con
   `pg_restore`. Eso está bien —restaurar debe doler un poco— pero significa que
   el procedimiento de restauración hay que escribirlo y ensayarlo nosotros.
2. **El respaldo local vive en el mismo disco que la base.** Protege contra
   "alguien borró algo", no contra "se perdió el servidor".

## 4. Las opciones, con su coste

### A. Solo respaldo local en Coolify

Programación diaria en las tres bases, retención local.

- **Coste**: cero dinero. ~15 minutos de configuración, una vez.
- **Protege de**: borrados accidentales, una migración que salió mal, una tabla
  que se corrompe.
- **NO protege de**: perder el VPS. Los respaldos se van con él.
- **Veredicto**: es el mínimo, y como única medida **es insuficiente** para datos
  de clientes.

### B. Local + copia fuera, con el S3 nativo de Coolify — *recomendada*

Lo mismo, marcando además el destino S3 con su retención.

- **Coste**: un bucket compatible con S3 (Backblaze B2, Cloudflare R2, Wasabi,
  Hetzner Object Storage…). Con el volumen de estas bases —instancias de semanas,
  un número de WhatsApp cada una— hablamos de **céntimos o pocos euros al mes**.
  Configuración: ~30 minutos contando el alta del bucket.
- **Protege de**: todo lo de A, más la pérdida del servidor.
- **Objeción esperable, y su respuesta**: el Principio II prohíbe S3 **como
  dependencia del núcleo**. Aquí la app **no habla con S3 jamás**: el producto
  sigue funcionando completo si el bucket no existe. Es infraestructura de
  operación, del mismo tipo que el propio VPS o Coolify. Si el bucket se cae, no
  se cae ninguna instancia; solo dejan de subirse copias.

### C. Local + copia fuera montada a mano (rclone/rsync por cron)

- **Coste**: sin proveedor nuevo si ya hay dónde copiar; ~1-2 horas de montaje.
- **Contra**: es una pieza más que mantener, fuera de Coolify, que nadie va a
  mirar hasta que falle. Los respaldos que dependen de un cron artesanal son los
  que se descubren rotos el día que hacen falta.

### D. Dumps manuales antes de cada migración

Es el estado actual con mejor nombre. **Descartada**: protege exactamente en el
momento en que uno se acuerda, y los datos no se pierden solo durante las
migraciones.

## 5. Frecuencia y retención propuestas

| Qué | Valor | Por qué |
|---|---|---|
| Frecuencia | **Diaria**, de madrugada (03:00 hora local) | Perder hasta un día de conversaciones es malo pero sobrevivible; cada hora es fácil de activar después si el volumen crece |
| Retención local | **7 copias** | Cubre "me di cuenta el lunes de algo que pasó el martes" sin llenar el disco |
| Retención en S3 | **30 días** | Un mes es el horizonte razonable para descubrir un daño silencioso |
| Alcance | Las **tres** bases de Uniko, por separado | Una por instancia: restaurar una no debe tocar a las otras |

## 6. Cómo se verifica que un respaldo sirve

Es la parte que casi nadie hace, y sin ella lo demás es decoración: **un respaldo
que nadie ha restaurado nunca no es un respaldo, es un archivo.**

Tres capas, de barata a cara:

1. **Automática, cada día**: el historial de ejecuciones de Coolify dice si la
   copia terminó bien. Basta con mirarlo; si falla, se ve ahí.
2. **Mensual, 20 minutos**: **simulacro de restauración**. Se baja el último
   volcado, se restaura en una base desechable, se comprueban unos recuentos
   (`conversation`, `message`, `contact`) y que la app arranca contra esa copia.
   Se anota la fecha y el resultado.
3. **Anual o al cambiar algo gordo**: restaurar de cero como si el servidor no
   existiera, midiendo cuánto se tarda. Eso es lo que responde "¿cuánto estamos
   caídos si pasa?".

**Convergencia útil**: el simulacro mensual (2) **es exactamente el ensayo que
pide el Principio X** antes de una migración. Resuelto esto, el ensayo deja de
necesitar un procedimiento inventado para cada feature: habrá respaldos de los
que tirar, y el procedimiento ya estará rodado. El paso a paso de restauración
ya está escrito en
[`specs/020-notificaciones-push/quickstart.md`](../specs/020-notificaciones-push/quickstart.md),
y al implementar esto conviene moverlo aquí, que es su sitio.

**Las reglas del simulacro no cambian**: base desechable, nunca sobre otra
instancia de la flota ni sobre la base de desarrollo habitual, y borrado del
volcado y de la base al terminar (Principios I y X a la vez).

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

## 8. Lo que NO pude verificar desde aquí

Para que nadie lo dé por comprobado:

- **Espacio libre en disco** del VPS. Antes de fijar la retención local conviene
  mirarlo (`df -h`).
- **Tamaño real de cada base**. Con el volumen actual la estimación es de pocos
  megabytes por volcado, pero es una estimación:
  `select pg_size_pretty(pg_database_size('uniko'));`
- **Si ya existe un destino S3 configurado** en Coolify.
- **Si el proveedor tiene snapshots activos.** Solo se ve en su panel.
