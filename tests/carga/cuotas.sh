#!/usr/bin/env bash
# Seguridad como atributo de calidad (RS-12, RS-19): tope de tamaño del cuerpo (413)
# y cuota de filas por usuario (409), contra el servidor de CARGA y su base propia.
#
#   1. 413: POST /api/movil/v1/metricas con cuerpos de 255 KiB, 257 KiB y 1 MiB
#      (tope de la API móvil: 256 KiB, MAX_CUERPO_MOVIL) y uno de 300 KiB sin
#      Content-Length (chunked): el tope se aplica al leer, no solo al header.
#   2. 409: una sesión nueva (con 3 recetas de semilla) guarda recetas hasta pasar
#      la cuota de 200 filas de `recetas_guardadas`; se registra en qué petición
#      aparece el primer 409 y que las filas del usuario quedan exactamente en 200.
#   3. Auditoría: cada rechazo queda como `denegado` en `auditoria`.
# Resultado en resultados/cuotas.txt.
source "$(dirname "$0")/entorno.sh"
OUT="$RESULTADOS/cuotas.txt"
psql_carga -qc "delete from limites_tasa" >/dev/null
node "$CARGA_DIR/preparar.mjs" --usuarios 1 --dias 7 --salida "$CARGA_DIR/.data/tokens-cuota.json" >/dev/null
tok=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0])' "$CARGA_DIR/.data/tokens-cuota.json")
uid=$(psql_carga -Atc "select uid from sesiones order by created_at desc limit 1")
H=(-H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.79.0.1')
API="$BASE_URL/api/movil/v1"

cuerpo() {  # cuerpo JSON válido de N bytes exactos (relleno en "notas")
  python3 -c 'import json,sys; n=int(sys.argv[1]); b={"tipo":"peso","valor":70,"notas":""}; r=n-len(json.dumps(b,separators=(",",":"))); b["notas"]="x"*r; sys.stdout.write(json.dumps(b,separators=(",",":")))' "$1"
}
{
  echo "# Tope de cuerpo (413) y cuota de filas por usuario (409) — $(date -Is)"
  echo "Servidor: $BASE_URL (build $(stat -c %y "$TC/srv/codigo/.next/BUILD_ID" | cut -d. -f1)); identidad de prueba ${uid:0:8}…"
  echo
  echo "## 1. Tope de tamaño del cuerpo (API móvil: 256 KiB)"
  for n in 261120 263168 1048576; do
    cuerpo "$n" > "$CARGA_DIR/.data/cuerpo.json"
    r=$(curl -sS -o /dev/stdout -w ' HTTP %{http_code} %{time_total}s' -X POST "${H[@]}" --data-binary @"$CARGA_DIR/.data/cuerpo.json" "$API/metricas")
    echo "POST /metricas con cuerpo de $n bytes ($((n / 1024)) KiB) → $r"
  done
  cuerpo 307200 > "$CARGA_DIR/.data/cuerpo.json"
  r=$(curl -sS -o /dev/stdout -w ' HTTP %{http_code}' -X POST "${H[@]}" -H 'Transfer-Encoding: chunked' --data-binary @"$CARGA_DIR/.data/cuerpo.json" "$API/metricas")
  echo "POST /metricas con 300 KiB sin Content-Length (chunked) → $r"
  rm -f "$CARGA_DIR/.data/cuerpo.json"
  echo
  echo "## 2. Cuota de filas (recetas_guardadas: 200 por usuario)"
  previas=$(psql_carga -Atc "select count(*) from recetas_guardadas where uid = '$uid'")
  echo "Recetas previas del usuario: $previas (semilla)."
  estados=(); primero=""
  for i in $(seq 1 200); do
    s=$(curl -sS -o "$CARGA_DIR/.data/ultima.json" -w '%{http_code}' -X POST "${H[@]}" \
      -d "{\"titulo\":\"Receta de cuota $i\",\"contenido\":\"Avena con banana.\",\"ingredientes\":[\"avena\",\"banana\"]}" "$API/recetas")
    estados+=("$s"); [[ "$s" == 409 && -z "$primero" ]] && { primero=$i; cp "$CARGA_DIR/.data/ultima.json" "$CARGA_DIR/.data/409.json"; }
  done
  echo "200 POST /recetas → $(printf '%s\n' "${estados[@]}" | sort | uniq -c | awk '{printf "%s×%s ", $2, $1}') · primer 409 en la petición ${primero:-ninguna}"
  [[ -f "$CARGA_DIR/.data/409.json" ]] && echo "Cuerpo del 409: $(cat "$CARGA_DIR/.data/409.json")"
  echo "Filas del usuario después: $(psql_carga -Atc "select count(*) from recetas_guardadas where uid = '$uid'")"
  rm -f "$CARGA_DIR/.data/ultima.json" "$CARGA_DIR/.data/409.json"
  echo
  echo "## 3. Rechazos auditados (tabla auditoria, últimos 5 minutos)"
  psql_carga -c "select accion, resultado, detalle->>'motivo' as motivo, count(*) from auditoria
                 where ocurrido_at > now() - interval '5 minutes' and resultado <> 'ok' group by 1,2,3 order by 1"
} 2>&1 | tee "$OUT"
