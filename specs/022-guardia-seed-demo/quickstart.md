# 022 — Quickstart: cómo ejercerlo y verificarlo

> Trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el alias `G:\`.

Esta feature **no tiene migración**, así que **no hay ensayo del Principio X**. Lo
que sí tiene es un caso que ninguna instancia de la flota puede enseñar, y por eso
este documento existe.

---

## Lo que no se puede probar donde uno esperaría

La pantalla que hay que ver —el estado vacío de la bandeja— **sólo aparece con
cero conversaciones**. LanCo tiene conversaciones reales desde hace semanas, y las
instancias de clientes son de clientes. **Ninguna instancia de la flota puede
enseñar este estado sin ensuciarla**, así que la verificación manual es **local**,
por necesidad y no por comodidad.

Y hace falta algo más raro todavía: una organización **recién dada de alta**, sin
nada configurado. Eso tampoco se consigue en una instancia viva.

## Preparar el escenario en local

1. **Base limpia**. La forma barata es una base desechable, igual que en el ensayo
   del Principio X de la 020 pero sin restaurar nada:

   ```bash
   export PGPASSWORD=<la contraseña local de postgres>
   "/c/Program Files/PostgreSQL/16/bin/createdb" -U postgres -h localhost uniko_guardia
   DATABASE_URL="postgresql://postgres:<clave>@localhost:5432/uniko_guardia" pnpm db:migrate
   ```

   > **No uses `uniko_dev`**: el escenario exige una organización virgen, y la de
   > desarrollo tiene datos de todas las pruebas anteriores. Y **no uses
   > `pnpm db:dev`**, que además siembra.

2. **Arranca la app contra esa base** y **regístrate**. Esa primera alta crea la
   organización y la deja exactamente en el estado que la guardia debe considerar
   virgen (es lo que AC-1 afirma en unitario; aquí se ve con los ojos).

3. **Borra la base al terminar**: `dropdb -U postgres -h localhost uniko_guardia`.

## Las cuatro pantallas que hay que ver

### 1. Organización virgen — el botón está y funciona

- [ ] La bandeja vacía muestra el botón, y su etiqueta **dice que sustituye la
      configuración del agente** (FR-707), no sólo que carga datos.
- [ ] Pulsarlo carga la demo. Es el caso para el que la feature existe: **la
      guardia no puede estorbar aquí**.

### 2. Con conocimiento, sin contactos — el caso de NuriaAndrea

Recarga la base limpia (pasos 1-2) y, antes de tocar la bandeja, **añade una
entrada de conocimiento** en Ajustes → Agente.

- [ ] La bandeja vacía **no muestra botón**.
- [ ] En su lugar hay una frase que **nombra lo que hay configurado** y dice que la
      demo lo reemplazaría (FR-706).
- [ ] `POST /api/seed/demo` responde **409** con el detalle, y **la entrada de
      conocimiento sigue ahí** después.

### 3. Sólo el perfil tocado — el caso más probable, y el que peor se lee

Base limpia otra vez; cambia **sólo** el nombre del agente en Ajustes, sin
conocimiento y sin correr el Laboratorio.

- [ ] La frase se lee como una frase, **no como una enumeración de un elemento**
      (D4 del plan). Debe decir algo como *"ya configuraste tu agente"*, no *"ya
      tienes: el agente"*.

> Este es el caso que más va a ocurrir en un despliegue nuevo y el único que
> obliga a mirar la redacción con cuidado. Si sólo se prueba con las cuatro
> comprobaciones incumplidas, la plantilla parece correcta y luego no lo es.

### 4. Mientras la comprobación viaja

- [ ] Con la red ralentizada (DevTools → Network → throttling), **en ningún
      momento aparece un botón que luego desaparezca**. O no hay nada, o está la
      frase.

## El CLI

Con la base del caso 2 (con conocimiento):

```bash
DATABASE_URL="postgresql://postgres:<clave>@localhost:5432/uniko_guardia" pnpm seed:demo
```

- [ ] Se niega y **dice qué encontró**.

```bash
DATABASE_URL="..." pnpm seed:demo --force
```

- [ ] Carga la demo, y **antes imprime los conteos de lo que va a destruir**
      (FR-708): entradas de conocimiento, corridas y si el perfil está
      configurado.

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Y el arnés, con la app viva y los mocks encendidos:

```bash
pnpm test:e2e
```

AC-12 vive ahí: `POST /api/seed/demo` contra la organización del arnés —que ya
tiene contactos, conocimiento y corridas— responde 409 con detalle **y no borra
nada**. Es seguro precisamente porque lo esperado es que no pase nada.

## Al revisar el PR

- [ ] **FR-709**: el diff **no toca `drizzle/`**. Se declara aquí, en el PR; no hay
      test automático porque es una afirmación sobre el repositorio, no sobre el
      producto.
- [ ] Se registra la corrida manual en
      [`tests/e2e/us-guardia-demo.md`](../../tests/e2e/us-guardia-demo.md), con la
      regla de siempre: **lo que no se vio no se marca**.
