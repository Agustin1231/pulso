#!/usr/bin/env bash
# Portabilidad del backend (RNF-14): «se despliega en cualquier host con Node 24 y
# PostgreSQL >= 15; la configuración sensible va en variables de entorno».
#
# Para cada versión de Postgres pedida (default: 15 y 17; la 18 es la del resto de la
# campaña) levanta un contenedor DESCARTABLE (--rm, 512 MB) en 127.0.0.1:55434, y:
#   1. aplica el esquema con `node scripts/setup-db.mjs` sobre la base vacía (tiempo y código)
#   2. lo vuelve a aplicar (idempotencia: debe terminar bien sin cambiar nada)
#   3. levanta una instancia de Next (mismo build del servidor de carga) en :3129
#      contra esa base, solo con variables de entorno, y hace un humo de la API
#      móvil: sesión nueva, alta de métrica, lectura, informe del motor, 401 sin token
#   4. lo apaga todo (el contenedor se borra solo)
# Resultado en resultados/portabilidad.txt. Nunca toca pulso-movil-db ni producción.
#   portabilidad.sh [versiones...]   p. ej. portabilidad.sh 15 16 17
source "$(dirname "$0")/entorno.sh"
set +e
OUT="$RESULTADOS/portabilidad.txt"
P_DB=55434; P_WEB=3129; CONT=pulso-nf-portabilidad
REPO="$CARGA_DIR/../.."
versiones=("$@"); [[ ${#versiones[@]} -eq 0 ]] && versiones=(15 17)
ms() { date +%s%3N; }
limpiar() { [[ -n "${pid_web:-}" ]] && kill -TERM -- "-$pid_web" 2>/dev/null; docker stop "$CONT" >/dev/null 2>&1; }
trap limpiar EXIT
{
echo "# Portabilidad del backend — $(date -Is)"
echo "Node $(node --version) · engines en package.json: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("engines"))' "$REPO/package.json")"
echo "Build de Next: $(stat -c %y "$TC/srv/codigo/.next/BUILD_ID" | cut -d. -f1) ($TC/srv/codigo)"
for v in "${versiones[@]}"; do
  echo; echo "## PostgreSQL $v (postgres:$v-alpine)"
  POSTGRES_PASSWORD="$ADMIN_PW" docker run -d --rm --name "$CONT" --memory 512m --cpus 1 -p "127.0.0.1:$P_DB:5432" \
    -e POSTGRES_PASSWORD -e POSTGRES_DB=pulso_port "postgres:$v-alpine" >/dev/null || { echo "no se pudo levantar postgres:$v"; continue; }
  until docker exec "$CONT" pg_isready -U postgres -d pulso_port >/dev/null 2>&1; do sleep 0.5; done; sleep 2
  until docker exec "$CONT" pg_isready -U postgres -d pulso_port >/dev/null 2>&1; do sleep 0.5; done
  echo "servidor: $(docker exec "$CONT" psql -U postgres -Atc 'show server_version')"
  url="postgres://postgres:${ADMIN_PW}@127.0.0.1:$P_DB/pulso_port"
  for pasada in 1 2; do
    t0=$(ms); (cd "$REPO" && DATABASE_ADMIN_URL="$url" PULSO_APP_PASSWORD="$APP_PW" node scripts/setup-db.mjs > "$RESULTADOS/.portabilidad-setup.log" 2>&1); c=$?; t1=$(ms)
    echo "setup-db pasada $pasada: código $c en $((t1 - t0)) ms$( [[ $c -ne 0 ]] && echo " · $(grep -m1 -iE 'error|✗' "$RESULTADOS/.portabilidad-setup.log")")"
  done
  echo "objetos: $(docker exec "$CONT" psql -U postgres -d pulso_port -Atc "select count(*) || ' tablas, ' || (select count(*) from pg_policies) || ' políticas RLS, ' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || ' funciones' from pg_tables where schemaname = 'public'")"
  (cd "$TC/srv/codigo" && exec setsid env DATABASE_URL="postgres://pulso_app:$APP_PW@127.0.0.1:$P_DB/pulso_port" PGSSL="" \
     MEDIA_DIR="$(mktemp -d)" NODE_ENV=production node node_modules/next/dist/bin/next start -p "$P_WEB" -H 127.0.0.1) > "$RESULTADOS/.portabilidad-web.log" 2>&1 </dev/null &
  pid_web=$!
  for _ in $(seq 1 60); do curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$P_WEB/api/movil/v1/sesion" 2>/dev/null && break; sleep 1; done
  A="http://127.0.0.1:$P_WEB/api/movil/v1"
  tok=$(curl -sS -X POST -H 'Content-Type: application/json' -d '{}' "$A/sesion" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
  echo "POST /sesion (nueva): token $( [[ -n "$tok" ]] && echo "emitido (${#tok} caracteres)" || echo "NO emitido")"
  H=(-H "Authorization: Bearer $tok" -H 'Content-Type: application/json')
  for v2 in 72 75 70; do s=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${H[@]}" -d "{\"tipo\":\"frecuencia_cardiaca\",\"valor\":$v2}" "$A/metricas"); done
  echo "POST /metricas ×3: último $s"
  echo "GET /metricas/ultimas: $(curl -sS -o /dev/null -w '%{http_code} %{size_download} B' "${H[@]}" "$A/metricas/ultimas")"
  echo "GET /informe: $(curl -sS -o /dev/null -w '%{http_code} %{size_download} B %{time_total} s' "${H[@]}" "$A/informe")"
  echo "GET /perfil sin token: $(curl -sS -o /dev/null -w '%{http_code}' "$A/perfil") (esperado 401)"
  echo "filas en metricas (vistas por el dueño): $(docker exec "$CONT" psql -U postgres -d pulso_port -Atc 'select count(*) from metricas')"
  echo "errores en el log de Next: $(grep -ciE 'error|unhandled' "$RESULTADOS/.portabilidad-web.log")"
  kill -TERM -- "-$pid_web" 2>/dev/null; pid_web=""; sleep 1
  docker stop "$CONT" >/dev/null
  while docker ps -a --format '{{.Names}}' | grep -qx "$CONT"; do sleep 0.5; done
done
rm -f "$RESULTADOS/.portabilidad-setup.log" "$RESULTADOS/.portabilidad-web.log"
} 2>&1 | tee "$OUT"
