#!/usr/bin/env bash
# Recuperabilidad: respaldo y restauración de la base de CARGA con tiempos
# medidos (RTO) y pérdida de datos acotada por la antigüedad del respaldo (RPO).
#
#   1. Respaldo lógico: roles (pg_dumpall --globals-only) + base (pg_dump -Fc).
#   2. Escrituras DESPUÉS del respaldo (5 métricas): son las que se pierden (RPO).
#   3. Desastre: se elimina el contenedor de la base (docker rm -f) → la API cae.
#   4. Recuperación: contenedor nuevo, mismos puerto y nombre; se restauran roles
#      y base; el servidor reconecta solo (pool de pg) sin reiniciarse.
#   5. Verificación: conteos por tabla iguales a los del respaldo, la sesión de
#      un usuario sigue sirviendo, y las 5 métricas posteriores no están.
#
# Solo toca pulso-nf-db (127.0.0.1:55433), nunca la base compartida.
# Uso: respaldo.sh [nombre=respaldo]
source "$(dirname "$0")/entorno.sh"
nombre="${1:-respaldo}"
DIR="$RESULTADOS/$nombre"; mkdir -p "$DIR"
# Los archivos de respaldo (con hashes de contraseñas de roles) van a .data/, ignorado por git.
BK="$CARGA_DIR/.data/respaldo"; mkdir -p "$BK"; chmod 700 "$BK"
EV="$DIR/tiempos.csv"; echo "paso,inicio_ms,fin_ms,duracion_ms" > "$EV"
paso() { local n="$1"; shift; local a; a=$(date +%s%3N); "$@"; local b; b=$(date +%s%3N); echo "$n,$a,$b,$((b - a))" >> "$EV"; }
conteos() {
  psql_carga -At -F, -c "select 'identidades', count(*) from identidades union all select 'sesiones', count(*) from sesiones
    union all select 'metricas', count(*) from metricas union all select 'habitos', count(*) from habitos
    union all select 'habitos_definicion', count(*) from habitos_definicion union all select 'recetas_guardadas', count(*) from recetas_guardadas
    union all select 'listas_mercado', count(*) from listas_mercado union all select 'rutinas', count(*) from rutinas
    union all select 'perfil', count(*) from perfil union all select 'auditoria', count(*) from auditoria order by 1"
}
tok=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0])' "$CARGA_DIR/.data/tokens.json")
api() { curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tok" "$BASE_URL/api/movil/v1/metricas/ultimas" 2>/dev/null || true; }

# 1. Respaldo
conteos > "$DIR/conteos-respaldo.csv"
paso respaldo_roles  sh -c "docker exec $DB_CONTENEDOR pg_dumpall -U postgres --globals-only > '$BK/roles.sql'"
paso respaldo_base   sh -c "docker exec $DB_CONTENEDOR pg_dump -U postgres -Fc pulso_carga > '$BK/pulso_carga.dump'"
T_RESPALDO=$(date +%s%3N)
ls -l "$BK/roles.sql" "$BK/pulso_carga.dump" | awk '{print $5, $NF}' | sed "s#$BK/##" > "$DIR/tamanos.txt"
# El respaldo contiene hashes de contraseñas de roles: queda con permisos 600 y fuera del repo de evidencias.
chmod 600 "$BK/roles.sql" "$BK/pulso_carga.dump"

# 2. Escrituras posteriores al respaldo (se van a perder)
for v in 71 72 73 74 75; do
  curl -sS -o /dev/null -X POST -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
    -d "{\"tipo\":\"frecuencia_cardiaca\",\"valor\":$v,\"notas\":\"posterior al respaldo\"}" "$BASE_URL/api/movil/v1/metricas"
done
psql_carga -At -c "select count(*) from metricas where notas = 'posterior al respaldo'" > "$DIR/posteriores-antes.txt"

# 3. Desastre
T_DESASTRE=$(date +%s%3N)
paso desastre docker rm -f "$DB_CONTENEDOR"
echo "api_tras_desastre,$(api)" > "$DIR/estado-api.csv"

# 4. Recuperación
nuevo_contenedor() {
  # La contraseña viaja por el entorno del proceso docker, no por la línea de comandos.
  POSTGRES_PASSWORD="$ADMIN_PW" docker run -d --name "$DB_CONTENEDOR" --memory 768m --cpus 2 \
    -p "127.0.0.1:$DB_PUERTO:5432" -e POSTGRES_PASSWORD -e POSTGRES_DB=postgres postgres:18-alpine >/dev/null
  until docker exec "$DB_CONTENEDOR" pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 0.3; done
  sleep 2   # el entrypoint reinicia postgres una vez después de inicializar
  until docker exec "$DB_CONTENEDOR" pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 0.3; done
}
paso contenedor_nuevo nuevo_contenedor
paso restaurar_roles sh -c "docker exec -i $DB_CONTENEDOR psql -U postgres -q -v ON_ERROR_STOP=0 < '$BK/roles.sql' >/dev/null 2>'$DIR/roles-restauracion.err'"
paso crear_base      docker exec "$DB_CONTENEDOR" createdb -U postgres -O postgres pulso_carga
paso restaurar_base  sh -c "docker exec -i $DB_CONTENEDOR pg_restore -U postgres -d pulso_carga --no-owner --role=postgres < '$BK/pulso_carga.dump' 2>'$DIR/restauracion.err'"
paso api_responde    sh -c "until [ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -H 'Authorization: Bearer $tok' $BASE_URL/api/movil/v1/metricas/ultimas)\" = 200 ]; do sleep 0.3; done"
T_RECUPERADO=$(date +%s%3N)

# 5. Verificación
conteos > "$DIR/conteos-restaurada.csv"
psql_carga -At -c "select count(*) from metricas where notas = 'posterior al respaldo'" > "$DIR/posteriores-despues.txt"
echo "api_tras_restauracion,$(api)" >> "$DIR/estado-api.csv"
{
  echo "RTO medido (desastre → API 200 con la sesión previa): $(( (T_RECUPERADO - T_DESASTRE) )) ms"
  echo "Antigüedad del respaldo al momento del desastre (RPO efectivo de esta corrida): $(( (T_DESASTRE - T_RESPALDO) )) ms"
  echo "Métricas escritas después del respaldo: $(cat "$DIR/posteriores-antes.txt") · presentes tras restaurar: $(cat "$DIR/posteriores-despues.txt")"
  if diff -q "$DIR/conteos-respaldo.csv" "$DIR/conteos-restaurada.csv" >/dev/null; then echo "Conteos por tabla: IDÉNTICOS al respaldo"; else echo "Conteos por tabla: DIFERENTES"; diff "$DIR/conteos-respaldo.csv" "$DIR/conteos-restaurada.csv"; fi
  echo "Tamaños (bytes): $(tr '\n' ' ' < "$DIR/tamanos.txt")"
} | tee "$DIR/resumen.txt"
cat "$EV"
