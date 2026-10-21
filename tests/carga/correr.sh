#!/usr/bin/env bash
# Corre un escenario k6 con muestreo de recursos (servidor + base) en paralelo.
#   correr.sh <nombre> <escenario.js> [opciones de k6, p. ej. -e RATE=10 -e DUR=3m]
# Resultados en tests/carga/resultados/<nombre>-*.{json,html,csv.gz,csv,txt}
source "$(dirname "$0")/entorno.sh"
nombre="$1"; esc="$2"; shift 2
# Contadores de límites de tasa en cero (solo en la base de CARGA): las pruebas de
# rendimiento miden el servidor, no el límite de 300 escrituras/h por sesión, que se
# verifica aparte con limites.sh. LIMPIAR_TASA=0 para conservarlos.
[[ "${LIMPIAR_TASA:-1}" == 1 ]] && psql_carga -qc "delete from limites_tasa" >/dev/null
"$CARGA_DIR/muestrear.sh" "$RESULTADOS/$nombre-recursos.csv" "${MUESTREO:-5}" & muestreador=$!
trap 'kill $muestreador 2>/dev/null' EXIT
{ echo "inicio $(date -Is) load=$(cut -d' ' -f1-3 /proc/loadavg) PGPOOL_MAX=$(grep -oP '^PGPOOL_MAX=\K.*' "$TC/srv/carga.env" || echo 10) BASE_URL=$BASE_URL args=$*"
  echo "build del servidor: $(stat -c %y "$TC/srv/codigo/.next/BUILD_ID" 2>/dev/null | cut -d. -f1) · rama $(git -C "$CARGA_DIR/../.." branch --show-current 2>/dev/null) @ $(git -C "$CARGA_DIR/../.." rev-parse --short HEAD 2>/dev/null) (+ cambios sin commit)"; } > "$RESULTADOS/$nombre-contexto.txt"
codigo=0; k6 "$nombre" "/carga/escenarios/$esc" --quiet "$@" > "$RESULTADOS/$nombre-salida.txt" 2>&1 || codigo=$?
echo "fin $(date -Is) load=$(cut -d' ' -f1-3 /proc/loadavg) k6_exit=$codigo" >> "$RESULTADOS/$nombre-contexto.txt"
exit $codigo
