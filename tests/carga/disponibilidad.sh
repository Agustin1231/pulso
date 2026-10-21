#!/usr/bin/env bash
# Disponibilidad y recuperación ante fallas, con carga constante de fondo.
#
# Mientras k6 manda RATE req/s (mezcla sin informe, para que la línea base sea
# estable), se inyectan dos fallas en el entorno de CARGA (nunca en la base
# compartida pulso-movil-db):
#   1. t=T_DB      `docker stop` de la base propia (pulso-nf-db) durante CAIDA_DB s
#   2. t=T_SRV     reinicio del servidor de carga (servidor.sh parar/iniciar carga)
# y se registra cada evento con su marca de tiempo en <nombre>-eventos.csv para
# medir después: ventana de errores, tiempo hasta la primera respuesta 2xx
# (MTTR) y si el proceso sobrevive sin intervención.
#
# Uso: disponibilidad.sh [nombre=disponibilidad]
source "$(dirname "$0")/entorno.sh"
nombre="${1:-disponibilidad}"
RATE="${RATE:-10}"; T_DB="${T_DB:-40}"; CAIDA_DB="${CAIDA_DB:-30}"; T_SRV="${T_SRV:-150}"; DUR="${DUR:-240}"
SRV="$TC/bin/servidor.sh"
EV="$RESULTADOS/$nombre-eventos.csv"
echo "epoch_ms,evento" > "$EV"
marca() { echo "$(date +%s%3N),$1" >> "$EV"; }
sondear() {   # primera respuesta 2xx de un endpoint con datos, después de una falla
  local tok; tok=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0])' "$CARGA_DIR/.data/tokens.json")
  until curl -fsS -o /dev/null --max-time 2 -H "Authorization: Bearer $tok" "$BASE_URL/api/movil/v1/metricas/ultimas" 2>/dev/null; do sleep 0.2; done
  marca "$1"
}

marca inicio_k6
"$CARGA_DIR/correr.sh" "$nombre" carga.js -e RATE="$RATE" -e DUR="${DUR}s" -e EXCLUIR="GET informe" -e TIMEOUT=10s & k6pid=$!

sleep "$T_DB"
marca db_stop_inicio; docker stop "$DB_CONTENEDOR" >/dev/null; marca db_detenida
# ¿Qué devuelve el servidor con la base caída? (sin filtrar detalles internos)
tok=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0])' "$CARGA_DIR/.data/tokens.json")
curl -sS --max-time 15 -w '\nstatus=%{http_code} tiempo=%{time_total}s\n' -H "Authorization: Bearer $tok" \
  "$BASE_URL/api/movil/v1/metricas/ultimas" > "$RESULTADOS/$nombre-respuesta-sin-db.txt" 2>&1 || true
# ¿Hay una sonda de salud que detecte la base caída? (GET /sesion sin token es lo que usa servidor.sh)
{ echo "--- GET /api/movil/v1/sesion sin token (sonda de vida de servidor.sh) con la base caída:"
  curl -sS --max-time 15 -w '\nstatus=%{http_code} tiempo=%{time_total}s\n' "$BASE_URL/api/movil/v1/sesion"
  echo "--- POST /api/movil/v1/sesion con token con la base caída:"
  curl -sS --max-time 15 -X POST -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{}' -w '\nstatus=%{http_code} tiempo=%{time_total}s\n' "$BASE_URL/api/movil/v1/sesion"
} >> "$RESULTADOS/$nombre-respuesta-sin-db.txt" 2>&1 || true
sleep "$CAIDA_DB"
marca db_start_inicio; docker start "$DB_CONTENEDOR" >/dev/null
until docker exec "$DB_CONTENEDOR" pg_isready -U postgres -d pulso_carga >/dev/null 2>&1; do sleep 0.2; done
marca db_lista
sondear api_recuperada_tras_db

sleep $(( T_SRV - T_DB - CAIDA_DB - 5 ))
marca srv_parar; "$SRV" parar carga >/dev/null; marca srv_detenido
marca srv_iniciar; "$SRV" iniciar carga >/dev/null; marca srv_listo
sondear api_recuperada_tras_reinicio

wait $k6pid || true
marca fin
cp "$TC/srv/carga.log" "$RESULTADOS/$nombre-log-servidor.txt" 2>/dev/null || true
cat "$EV"
