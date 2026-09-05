#!/usr/bin/env bash
#
# Paso de CIERRE de la promoción: comprueba que las tres instancias corren el
# commit que se promovió.
#
# Se corre DESPUÉS del `git merge --ff-only` + push, no antes. Es el único modo
# de saber que las migraciones arrancaron: las bases de clientes migran al
# arrancar el contenedor, y un contenedor que no levanta porque la migración
# reventó NO avisa — su /api/health sigue contestando desde el contenedor viejo
# y reportando el commit anterior. Un "ok:true" no basta: hay que comparar el
# commit.
#
# SOLO LECTURA: tres GET a /api/health. No toca git ni la plataforma.
#
# Uso:  verify-fleet.sh <commit-corto>
#       verify-fleet.sh            # usa origin/production
#
# Exit 0 = las tres al día. Exit 1 = alguna no llegó (o no levantó).

set -uo pipefail

# Dominios según docs/despliegue-flota.md.
INSTANCIAS=(
  "LanCo (pruebas)|https://uniko.lanco.cloud/api/health"
  "I Love The Universe|https://uniko.ilovetheuniverse.mx/api/health"
  "NuriaAndrea|https://uniko.nuriaandrea.com/api/health"
)

ESPERADO="${1:-}"
if [ -z "$ESPERADO" ]; then
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "Pasa el commit esperado: verify-fleet.sh <commit-corto>"; exit 2; }
  git fetch --quiet origin || true
  ESPERADO=$(git rev-parse --short=7 origin/production 2>/dev/null) || {
    echo "No pude resolver origin/production. Pasa el commit a mano."; exit 2; }
fi

echo "Commit esperado en las tres instancias: $ESPERADO"
echo

FALLOS=0
for entry in "${INSTANCIAS[@]}"; do
  NOMBRE="${entry%%|*}"
  URL="${entry##*|}"
  printf '  %-22s ' "$NOMBRE"

  BODY=$(curl -fsS --max-time 20 "$URL" 2>/dev/null)
  if [ -z "$BODY" ]; then
    echo "✗ sin respuesta ($URL)"
    FALLOS=$((FALLOS + 1))
    continue
  fi

  COMMIT=$(printf '%s' "$BODY" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -z "$COMMIT" ]; then
    echo "✗ responde pero no reporta commit :: $BODY"
    FALLOS=$((FALLOS + 1))
  elif [ "$COMMIT" != "$ESPERADO" ]; then
    echo "✗ corre $COMMIT (esperado $ESPERADO)"
    FALLOS=$((FALLOS + 1))
  else
    echo "✓ $COMMIT"
  fi
done

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "Las tres instancias corren $ESPERADO. Las migraciones arrancaron."
  exit 0
fi

cat <<EOF
$FALLOS instancia(s) NO están en $ESPERADO.

Si corriste esto ANTES de promover, que LanCo aparezca adelantada es lo normal:
sigue \`main\` y los clientes siguen \`production\`. Este guion es el paso de
cierre, después del merge; ahí las tres deben coincidir.

Una instancia que sigue reportando el commit viejo puede ser un redespliegue que
aún no termina — o un contenedor que no levantó porque la migración falló. Lo
segundo no se anuncia solo: revisa los logs del contenedor de esa instancia
antes de dar la promoción por buena.

Recuerda que no hay marcha atrás por redeploy: si una migración corrió a medias,
volver al commit anterior devuelve el código, no el esquema (Principio X).
EOF
exit 1
