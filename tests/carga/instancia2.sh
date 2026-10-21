#!/usr/bin/env bash
# Segunda instancia del servidor de carga (escalabilidad horizontal), en
# 127.0.0.1:${PUERTO2:-3119}, con el MISMO build ($TC/srv/codigo), la misma base
# y las mismas variables que el servidor de carga ($TC/srv/carga.env).
#   instancia2.sh iniciar | parar
# k6 reparte entre las dos con BASE_URL=http://127.0.0.1:3109,http://127.0.0.1:3119
set -euo pipefail
TC="$HOME/.local/share/pulso-toolchain"
P="${PUERTO2:-3119}"
PIDF="$(dirname "$0")/.data/instancia2.pid"
case "${1:-}" in
  iniciar)
    source "$TC/dev/db.env"
    extra=(); while IFS= read -r l; do [[ -n "$l" && "$l" != \#* ]] && extra+=("$l"); done < "$TC/srv/carga.env"
    (cd "$TC/srv/codigo" && exec setsid env DATABASE_URL="postgres://pulso_app:$APP_PW@127.0.0.1:55433/pulso_carga" PGSSL="" \
       MEDIA_DIR="$TC/srv/media-carga" NODE_ENV=production "${extra[@]}" \
       node node_modules/next/dist/bin/next start -p "$P" -H 127.0.0.1) > "$(dirname "$0")/.data/instancia2.log" 2>&1 </dev/null &
    echo $! > "$PIDF"
    for _ in $(seq 1 60); do curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$P/api/movil/v1/sesion" 2>/dev/null && { echo "instancia 2 lista en :$P (pid $(cat "$PIDF"))"; exit 0; }; sleep 1; done
    echo "la instancia 2 no respondió" >&2; exit 1 ;;
  parar)
    [[ -f "$PIDF" ]] && { kill -TERM -- "-$(cat "$PIDF")" 2>/dev/null || kill "$(cat "$PIDF")" 2>/dev/null || true; rm -f "$PIDF"; }
    echo "instancia 2 detenida" ;;
  *) sed -n 2,7p "$0"; exit 2 ;;
esac
