#!/usr/bin/env bash
#
# Comprueba las condiciones MECANIZABLES de la puerta de promoción a producción
# (constitución, "Flujo de Desarrollo y Puertas de Calidad").
#
# SOLO LECTURA. No hace checkout de `production`, no mergea, no empuja y no
# escribe en ninguna rama. Su única escritura es el `git fetch`, que actualiza
# referencias remotas locales.
#
# No promueve, ni al final ni nunca. Ver el comando para el porqué.
#
# Salida: bloques marcados con `::` para que el agente los lea sin ambigüedad.
# Exit 0 = las condiciones mecanizables pasan. Exit != 0 = puerta cerrada.

set -uo pipefail

LANCO_HEALTH="https://uniko.lanco.cloud/api/health"
REMOTE="origin"
MAIN="main"
PROD="production"

fail() { echo "::ESTADO:: CERRADA"; echo "::MOTIVO:: $1"; echo; echo "$2"; exit "${3:-1}"; }

command -v git >/dev/null || fail "git no disponible" "Instala git." 2
command -v curl >/dev/null || fail "curl no disponible" "Instala curl." 2
command -v gh >/dev/null || fail "gh no disponible" "Instala GitHub CLI y autentícate: gh auth login" 2
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "no es un repo git" "Ejecuta desde el repositorio." 2

echo "== Actualizando referencias remotas (solo lectura) =="
git fetch --quiet "$REMOTE" || fail "no se pudo hacer fetch" "Revisa la red o el acceso a $REMOTE." 2
echo

# --- Cordura: main local al día con el remoto ------------------------------
LOCAL_MAIN=$(git rev-parse "$MAIN" 2>/dev/null) || fail "no existe la rama $MAIN" "Esperaba una rama local '$MAIN'." 2
REMOTE_MAIN=$(git rev-parse "$REMOTE/$MAIN" 2>/dev/null) || fail "no existe $REMOTE/$MAIN" "Esperaba '$REMOTE/$MAIN'." 2

if [ "$LOCAL_MAIN" != "$REMOTE_MAIN" ]; then
  fail "main local y $REMOTE/$MAIN no coinciden" \
"  local  : $(git rev-parse --short=7 "$MAIN")
  remoto : $(git rev-parse --short=7 "$REMOTE/$MAIN")

Sincroniza antes de evaluar la puerta: lo que se promueve es lo que está en el
remoto, y lo que se compara contra LanCo tiene que ser eso mismo."
fi

git rev-parse --verify --quiet "$REMOTE/$PROD" >/dev/null \
  || fail "no existe $REMOTE/$PROD" "Esperaba la rama '$PROD' en $REMOTE." 2

SHA_FULL=$(git rev-parse "$REMOTE/$MAIN")
SHA=$(git rev-parse --short=7 "$REMOTE/$MAIN")

# --- ¿Hay algo que promover? -----------------------------------------------
PENDING=$(git log "$REMOTE/$PROD..$REMOTE/$MAIN" --oneline)
PENDING_N=$(printf '%s' "$PENDING" | grep -c . || true)

if [ "$PENDING_N" -eq 0 ]; then
  echo "::ESTADO:: NADA_QUE_PROMOVER"
  echo "::COMMIT_MAIN:: $SHA"
  echo
  echo "$PROD ya está en el mismo commit que $MAIN ($SHA). No hay nada que"
  echo "viaje a los clientes; la puerta no aplica."
  exit 3
fi

# --- Condición 2: el cambio ya corre en la instancia de pruebas -------------
# Se comprueba PRIMERO porque es la que más veces va a cortar: main recién
# mergeado no es main desplegado, y promover lo que LanCo no ha ejercido es
# exactamente lo que la puerta existe para impedir.
echo "== [1/4] LanCo desplegado == HEAD de $MAIN =="
HEALTH=$(curl -fsS --max-time 20 "$LANCO_HEALTH" 2>/dev/null) || \
  fail "LanCo no respondió el healthcheck" \
"  $LANCO_HEALTH no contestó (o devolvió error).

Si la instancia está caída, eso es lo que hay que atender antes de pensar en
promover: es la única que ejerce el cambio antes que los clientes."

LANCO_COMMIT=$(printf '%s' "$HEALTH" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -z "$LANCO_COMMIT" ]; then
  fail "LanCo no reporta commit en /api/health" \
"  respuesta: $HEALTH

Sin commit no se puede saber qué código corre allí. Lo inyecta la plataforma de
hosting (SOURCE_COMMIT); revísalo antes de seguir."
fi

if [ "$LANCO_COMMIT" != "$SHA" ]; then
  fail "LanCo corre $LANCO_COMMIT, pero $MAIN está en $SHA" \
"$MAIN tiene algo que LanCo todavía no corre. No se promueve lo que no se ha
ejercido: espera al redespliegue de LanCo y vuelve a evaluar la puerta.

  LanCo : $LANCO_COMMIT
  $MAIN  : $SHA"
fi
echo "  ✓ LanCo corre $LANCO_COMMIT, igual que $MAIN"
echo

# --- Condición 1: CI en verde para ESE commit ------------------------------
# Por SHA, no por 'último run de la rama': un run verde de hace tres commits no
# dice nada del que va a viajar.
echo "== [2/4] CI en verde para $SHA, en toda la matriz =="
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) || \
  fail "no se pudo resolver el repositorio en GitHub" "¿Está autenticado 'gh'? Prueba: gh auth status" 2

RUNS=$(gh api "repos/$REPO/commits/$SHA_FULL/check-runs" \
        --jq '.check_runs[] | "\(.conclusion // .status)\t\(.name)"' 2>/dev/null) || \
  fail "no se pudieron leer los check-runs de $SHA" "Revisa el acceso a $REPO." 2

if [ -z "$RUNS" ]; then
  fail "no hay ningún check-run para $SHA" \
"GitHub no reporta CI para ese commit. Puede que el workflow no se haya
disparado todavía, o que no se haya empujado. No se promueve a ciegas."
fi

BAD=$(printf '%s\n' "$RUNS" | grep -v '^success' || true)
printf '%s\n' "$RUNS" | while IFS=$'\t' read -r c n; do echo "  - $n :: $c"; done
if [ -n "$BAD" ]; then
  fail "hay checks que no están en verde para $SHA" \
"$(printf '%s\n' "$BAD" | while IFS=$'\t' read -r c n; do echo "  ✗ $n :: $c"; done)

La condición 1 exige verde en TODAS las configuraciones de la matriz."
fi
echo "  ✓ todos los checks en verde"
echo

# --- Condición 5: qué va a recibir cada cliente ----------------------------
echo "== [3/4] Lo que viaja a los clientes ($PROD..$MAIN) =="
echo "$PENDING" | sed 's/^/  /'
echo
echo "  ($PENDING_N commit(s))"
echo "::COMMITS_N:: $PENDING_N"
echo

# --- Condición 4: ¿toca drizzle/? ------------------------------------------
echo "== [4/4] ¿El cambio toca migraciones? =="
DRIZZLE=$(git diff --name-only "$REMOTE/$PROD" "$REMOTE/$MAIN" -- drizzle/ || true)

if [ -z "$DRIZZLE" ]; then
  echo "  ✓ No toca drizzle/. La condición 4 no aplica: no preguntes por el"
  echo "    ensayo del Principio X."
  echo "::DRIZZLE:: NO"
else
  echo "  ⚠ TOCA drizzle/. Archivos:"
  printf '%s\n' "$DRIZZLE" | sed 's/^/    /'
  echo "::DRIZZLE:: SI"
  echo "  Las migraciones corren al arrancar el contenedor, en las dos bases de"
  echo "  clientes a la vez, y solo hacia adelante: no hay 'down'. Un redeploy"
  echo "  del commit anterior devuelve el código, nunca el esquema."
fi
echo

echo "::ESTADO:: MECANIZABLES_OK"
echo "::COMMIT:: $SHA"
echo "::REPO:: $REPO"
echo
echo "Las condiciones automáticas pasan. Faltan las que solo puede responder"
echo "quien da la señal: uso real en LanCo, self-test del Principio IX contra"
echo "LanCo desplegado, el ensayo del Principio X si toca drizzle/, y el plan de"
echo "reversión. Este guion NO promueve."
exit 0
