#!/usr/bin/env bash
# Escalabilidad del backend: misma carga contra distintas configuraciones.
#   A) Vertical/configuración: PGPOOL_MAX = 2, 10 (default), 30 con 1 instancia.
#   B) Horizontal: 2 instancias de Next (3109 + 3119) con PGPOOL_MAX=10 cada una,
#      misma base; k6 reparte las peticiones entre las dos.
# Para cada configuración corre:
#   - capacidad.js (modelo cerrado, VUS sin pausa, 60 s) con la mezcla SIN informe → techo de la API/base
#   - capacidad.js con la mezcla COMPLETA → techo con el motor de predicción
#   - usuarios.js (50 usuarios con tiempo de lectura) solo en 1×10 y 2×10 → RNF-06
# Deja el servidor de carga como estaba (PGPOOL_MAX=10, 1 instancia).
#   escalabilidad.sh [configuraciones...]   (default: pool2 pool10 pool30 x2)
source "$(dirname "$0")/entorno.sh"
SRV="$TC/bin/servidor.sh"; ENV="$TC/srv/carga.env"
VUS="${VUS:-32}"

fijar_pool() { sed -i "s/^PGPOOL_MAX=.*/PGPOOL_MAX=$1/" "$ENV"; "$SRV" parar carga >/dev/null; "$SRV" iniciar carga >/dev/null; }
calentar() { for u in ${BASE_URL//,/ }; do for _ in 1 2 3; do curl -s -o /dev/null -H "Authorization: Bearer $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[0])' "$CARGA_DIR/.data/tokens.json")" "$u/api/movil/v1/informe"; done; done; }

confs=("$@"); [[ ${#confs[@]} -eq 0 ]] && confs=(pool2 pool10 pool30 x2)
for conf in "${confs[@]}"; do
  case "$conf" in
    pool*) fijar_pool "${conf#pool}"; export BASE_URL="http://127.0.0.1:3109" ;;
    x2)    fijar_pool 10; "$CARGA_DIR/instancia2.sh" iniciar; export BASE_URL="http://127.0.0.1:3109,http://127.0.0.1:3119" ;;
  esac
  calentar
  "$CARGA_DIR/correr.sh" "escala-$conf-sin-informe" capacidad.js -e VUS="$VUS" -e DUR=60s -e EXCLUIR="GET informe" || true
  "$CARGA_DIR/correr.sh" "escala-$conf-completa" capacidad.js -e VUS="$VUS" -e DUR=60s -e TIMEOUT=30s || true
  if [[ "$conf" == pool10 || "$conf" == x2 ]]; then
    "$CARGA_DIR/correr.sh" "usuarios50-$conf" usuarios.js -e VUS=50 -e DUR=2m || true
  fi
  [[ "$conf" == x2 ]] && "$CARGA_DIR/instancia2.sh" parar
done
export BASE_URL="http://127.0.0.1:3109"; fijar_pool 10
python3 - "$RESULTADOS" <<'PY'
import json, sys, pathlib, glob
r = pathlib.Path(sys.argv[1])
print("| Configuración | Mezcla | req/s | p50 (ms) | p95 (ms) | p99 (ms) | error |")
print("|---|---|---:|---:|---:|---:|---:|")
for f in sorted(r.glob("escala-*-resumen.json")) + sorted(r.glob("usuarios50-*-resumen.json")):
    m = json.load(open(f))["metrics"]
    d, q, e = m["http_req_duration"], m["http_reqs"], m["http_req_failed"]
    n = f.name.replace("-resumen.json", "")
    print(f"| {n} | | {q['rate']:.1f} | {d['med']:.1f} | {d['p(95)']:.1f} | {d['p(99)']:.1f} | {e['value']*100:.2f} % |")
PY
