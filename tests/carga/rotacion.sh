#!/usr/bin/env bash
# Confiabilidad/recuperabilidad de la sesión (RNF-09, RS-22): una rotación de token
# disparada por N peticiones CONCURRENTES con el mismo token viejo no deja al
# cliente sin sesión válida ni crea identidades nuevas.
#
#   1. Sesión nueva (preparar.mjs) y se la "envejece" 2 días en la base de CARGA
#      (created_at), así el próximo POST /sesion la rota.
#   2. N (default 20) POST /api/movil/v1/sesion simultáneos con el token viejo.
#      Esperado: todos 200 y mismo uid; exactamente UNO trae token nuevo
#      (origen "rotada"); el resto, token null (= seguir con el que tiene, válido 2 min).
#   3. Con el token viejo dentro de la gracia → 200; con el nuevo → 200.
#   4. Vencida la gracia (se adelanta expira_at en la base, sin esperar 2 min) →
#      el viejo da 401 y el nuevo sigue en 200. Identidades creadas: 0.
# Resultado en resultados/rotacion.txt.
source "$(dirname "$0")/entorno.sh"
set +e
N="${N:-20}"; OUT="$RESULTADOS/rotacion.txt"; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
psql_carga -qc "delete from limites_tasa" >/dev/null
node "$CARGA_DIR/preparar.mjs" --usuarios 1 --dias 7 --salida "$TMP/t.json" >/dev/null
viejo=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0])' "$TMP/t.json")
hash=$(printf '%s' "$viejo" | sha256sum | cut -d' ' -f1)
API="$BASE_URL/api/movil/v1"
{
echo "# Rotación concurrente de la sesión — $(date -Is)"
psql_carga -qc "update sesiones set created_at = now() - interval '2 days' where token_hash = '$hash'"
ids0=$(psql_carga -Atc "select count(*) from identidades")
echo "sesión envejecida 2 días (created_at); identidades antes: $ids0"
seq 1 "$N" | xargs -P "$N" -I{} sh -c "curl -sS -X POST -H 'Authorization: Bearer $viejo' -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.80.0.1' -d '{}' -w '\n%{http_code}\n' '$API/sesion' > '$TMP/r{}.txt'"
python3 - "$TMP" "$N" <<'PY'
import json, sys, pathlib, collections
d = pathlib.Path(sys.argv[1]); n = int(sys.argv[2])
estados, origenes, nuevos = collections.Counter(), collections.Counter(), []
for i in range(1, n + 1):
    cuerpo, codigo = (d / f"r{i}.txt").read_text().strip().rsplit("\n", 1)
    estados[codigo] += 1
    j = json.loads(cuerpo)
    origenes[j.get("origen")] += 1
    if j.get("token"): nuevos.append(j["token"])
print(f"{n} POST /sesion concurrentes → estados {dict(estados)} · origen {dict(origenes)}")
print(f"respuestas con token nuevo: {len(nuevos)} (distintos: {len(set(nuevos))}); con token null (seguir con el actual): {n - len(nuevos)}")
(d / "nuevo").write_text(nuevos[0] if nuevos else "")
PY
nuevo=$(cat "$TMP/nuevo")
echo "sesiones del uid: $(psql_carga -Atc "select count(*) || ' (rotadas: ' || count(rotada_at) || ')' from sesiones where uid = (select uid from sesiones where token_hash = '$hash')")"
echo "token viejo en la gracia → GET /metricas/ultimas: $(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $viejo" "$API/metricas/ultimas")"
echo "token nuevo → GET /metricas/ultimas: $(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $nuevo" "$API/metricas/ultimas")"
psql_carga -qc "update sesiones set expira_at = now() - interval '1 second' where token_hash = '$hash'"
echo "gracia vencida → token viejo: $(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $viejo" "$API/metricas/ultimas") (esperado 401) · token nuevo: $(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $nuevo" "$API/metricas/ultimas")"
echo "POST /sesion con el viejo vencido → $(curl -sS -X POST -H "Authorization: Bearer $viejo" -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.80.0.2' -d '{}' "$API/sesion" | python3 -c 'import json,sys; j=json.load(sys.stdin); print("origen", j.get("origen"), "· token nuevo:", "sí" if j.get("token") else "no")') (identidad nueva: la app pierde el historial si su token quedó vencido)"
echo "identidades creadas durante la rotación concurrente: $(( $(psql_carga -Atc "select count(*) from identidades") - ids0 - 1 )) (la última línea crea 1 a propósito)"
} 2>&1 | tee "$OUT"
