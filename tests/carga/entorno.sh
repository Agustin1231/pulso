#!/usr/bin/env bash
# Entorno común de las pruebas no funcionales del backend (se carga con `source`).
#
# Todo corre contra el servidor de CARGA (http://127.0.0.1:3109) y su base
# propia `pulso_carga` en el contenedor descartable `pulso-nf-db`
# (127.0.0.1:55433). Nunca contra producción.
#
# No imprime contraseñas: las toma de ~/.local/share/pulso-toolchain/dev/db.env.
set -euo pipefail

CARGA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TC="$HOME/.local/share/pulso-toolchain"
K6_IMAGEN="grafana/k6:1.3.0"            # tag fijo
DB_CONTENEDOR="${DB_CONTENEDOR:-pulso-nf-db}"
DB_PUERTO="${DB_PUERTO:-55433}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3109}"
RESULTADOS="${RESULTADOS:-$CARGA_DIR/resultados}"
mkdir -p "$RESULTADOS"

# shellcheck source=/dev/null
source "$TC/dev/db.env"   # ADMIN_PW, APP_PW
export DATABASE_ADMIN_URL="postgres://postgres:${ADMIN_PW}@127.0.0.1:${DB_PUERTO}/pulso_carga"

case "$BASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "✗ BASE_URL tiene que ser local (127.0.0.1/localhost): $BASE_URL" >&2; exit 2 ;;
esac

# k6 en Docker: red del host (el servidor escucha solo en 127.0.0.1), 1 GB de RAM,
# el directorio de scripts montado de solo lectura y los resultados aparte.
k6() {
  local nombre="$1"; shift
  docker run --rm --network host --memory 1g --cpus "${K6_CPUS:-2}" \
    -u "$(id -u):$(id -g)" \
    -v "$CARGA_DIR:/carga:ro" -v "$RESULTADOS:/resultados" \
    -e BASE_URL="$BASE_URL" -e K6_WEB_DASHBOARD=true \
    -e K6_WEB_DASHBOARD_EXPORT="/resultados/$nombre.html" -e K6_WEB_DASHBOARD_HOST=127.0.0.1 -e K6_WEB_DASHBOARD_PORT="${K6_DASH_PUERTO:-5665}" \
    "$K6_IMAGEN" run --summary-export "/resultados/$nombre-resumen.json" \
    --system-tags status,method,name,scenario,expected_response,error_code \
    --out "csv=/resultados/$nombre-crudo.csv.gz" "$@"
}

# psql dentro del contenedor de la base (el host no tiene cliente de Postgres).
psql_carga() { docker exec -i "$DB_CONTENEDOR" psql -U postgres -d pulso_carga -v ON_ERROR_STOP=1 "$@"; }
