#!/usr/bin/env bash
# Resume los resultados de la campaña (resultados/*-crudo.csv.gz) y copia la
# evidencia al repositorio de la app:
#   "Pulso - celular/docs/integrador/evidencias/no-funcionales/backend/"
#     tablas/<corrida>.md       p50/p95/p99/máx/error por endpoint (analizar.py endpoints)
#     series/<corrida>.csv      serie temporal en ventanas de 10 s (analizar.py serie)
#     graficos/<corrida>.png    latencia + req/s + % error en el tiempo
#     k6/<corrida>-resumen.json y <corrida>.html (reporte del dashboard de k6)
#     recursos/<corrida>-recursos.csv, contexto, salidas de los scripts
# Uso: informe.sh [corrida ...]   (sin argumentos: todas las de resultados/)
source "$(dirname "$0")/entorno.sh"
set +e
EV="$HOME/proyectos/Pulso - celular/docs/integrador/evidencias/no-funcionales/backend"
mkdir -p "$EV"/{tablas,series,graficos,k6,recursos}
corridas=("$@")
if [[ ${#corridas[@]} -eq 0 ]]; then
  for f in "$RESULTADOS"/*-crudo.csv.gz; do corridas+=("$(basename "$f" -crudo.csv.gz)"); done
fi
for c in "${corridas[@]}"; do
  [[ -f "$RESULTADOS/$c-crudo.csv.gz" ]] || { echo "sin datos: $c"; continue; }
  python3 "$CARGA_DIR/analizar.py" endpoints "$RESULTADOS/$c-crudo.csv.gz" > "$EV/tablas/$c.md"
  python3 "$CARGA_DIR/analizar.py" serie "$RESULTADOS/$c-crudo.csv.gz" 10 > "$EV/series/$c.csv"
  marcas=""
  [[ "$c" == disponibilidad && -f "$RESULTADOS/disponibilidad-eventos.csv" ]] && marcas=$(python3 - "$RESULTADOS/disponibilidad-eventos.csv" "$RESULTADOS/$c-crudo.csv.gz" <<'PY'
import csv, gzip, sys
ev = list(csv.DictReader(open(sys.argv[1])))
with gzip.open(sys.argv[2], "rt") as fh:
    t0 = min(int(r["timestamp"]) for r in csv.DictReader(fh) if r["metric_name"] == "http_req_duration")
nombres = {"db_stop_inicio": "docker stop base", "db_lista": "base lista", "srv_parar": "parar servidor", "srv_listo": "servidor listo"}
print(",".join(f"{int(e['epoch_ms'])/1000 - t0:.0f}:{nombres[e['evento']]}" for e in ev if e["evento"] in nombres))
PY
)
  python3 "$CARGA_DIR/analizar.py" grafico "$RESULTADOS/$c-crudo.csv.gz" "$EV/graficos/$c.png" "$c" 10 "$marcas" >/dev/null
  cp -f "$RESULTADOS/$c-resumen.json" "$EV/k6/" 2>/dev/null
  cp -f "$RESULTADOS/$c.html" "$EV/k6/" 2>/dev/null
  for x in recursos.csv contexto.txt salida.txt eventos.csv respuesta-sin-db.txt; do
    [[ -f "$RESULTADOS/$c-$x" ]] && cp -f "$RESULTADOS/$c-$x" "$EV/recursos/"
  done
  echo "✓ $c"
done
for x in cuotas.txt limites-contadores.txt limites-salida.txt escalabilidad-salida.txt portabilidad.txt rotacion.txt suite.log disponibilidad-log-servidor.txt; do
  [[ -f "$RESULTADOS/$x" ]] && cp -f "$RESULTADOS/$x" "$EV/recursos/"
done
[[ -d "$RESULTADOS/respaldo" ]] && { mkdir -p "$EV/respaldo"; cp -f "$RESULTADOS/respaldo/"* "$EV/respaldo/"; }
true
