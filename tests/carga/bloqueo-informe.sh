#!/usr/bin/env bash
# Reproducción mínima de DEF-NF-01: el cálculo del informe bloquea el event loop de Node.
# Mide la latencia de una lectura trivial (GET /perfil) sola y mientras hay K informes en
# curso de otros usuarios. Si el informe no bloqueara, GET /perfil tardaría lo mismo.
#   bloqueo-informe.sh [K=4] [repeticiones=5]     → resultados/bloqueo-informe.txt
source "$(dirname "$0")/entorno.sh"
set +e
K="${1:-4}"; N="${2:-5}"; API="$BASE_URL/api/movil/v1"; OUT="$RESULTADOS/bloqueo-informe.txt"
tok() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[int(sys.argv[2])])' "$CARGA_DIR/.data/tokens.json" "$1"; }
T0=$(tok 0)
perfil() { curl -s -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $T0" "$API/perfil"; }
{
echo "# GET /perfil solo y con $K informes en curso — $(date -Is)"
for i in $(seq 1 "$N"); do echo "solo,$i,$(perfil)"; sleep 0.5; done
for i in $(seq 1 "$N"); do
  for k in $(seq 1 "$K"); do curl -s -o /dev/null -H "Authorization: Bearer $(tok "$k")" "$API/informe" & done
  sleep 0.05; echo "con_${K}_informes,$i,$(perfil)"; wait; sleep 0.5
done
} | tee "$OUT.csv" | python3 -c '
import sys, statistics as st, collections
d = collections.defaultdict(list)
for l in sys.stdin:
    if l.startswith("#"): print(l.strip()); continue
    c, i, t = l.strip().split(","); d[c].append(float(t) * 1000)
for c, v in d.items():
    print(f"{c}: n={len(v)} mediana={st.median(v):.1f} ms mín={min(v):.1f} máx={max(v):.1f}")
' | tee "$OUT"
