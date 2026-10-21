#!/usr/bin/env bash
# Verifica con k6 que los límites de tasa devuelven 429 (ver escenarios/limites.js).
# Pone en cero los contadores de la base de CARGA antes de empezar, para que el
# resultado no dependa de corridas anteriores dentro de la misma hora.
source "$(dirname "$0")/entorno.sh"
psql_carga -qc "delete from limites_tasa" >/dev/null
node "$CARGA_DIR/preparar.mjs" --usuarios 12 --dias 7 --salida "$CARGA_DIR/.data/tokens-limites.json" >/dev/null
codigo=0; k6 limites /carga/escenarios/limites.js "$@" || codigo=$?
psql_carga -c "select split_part(clave, ':', 1) as limite, count(*) as claves, max(conteo) as max_conteo from limites_tasa group by 1 order by 1" \
  > "$RESULTADOS/limites-contadores.txt" 2>&1 || true
exit $codigo
