#!/usr/bin/env bash
# Corre la campaña no funcional del backend completa (o por fases), en orden,
# contra el servidor de CARGA (:3109) y la base propia pulso-nf-db. Nunca producción.
#
#   suite.sh [fase ...]      fases: rendimiento estres pico limites escalabilidad disponibilidad respaldo soak
#                            (sin argumentos: todas, ≈ 85 min)
#
# Cada fase deja sus archivos en resultados/ (ver README) y una línea en
# resultados/suite.log. Al final, `analizar.py` arma las tablas por endpoint y los
# gráficos en "Pulso - celular/docs/integrador/evidencias/no-funcionales/backend/".
source "$(dirname "$0")/entorno.sh"
set +e
LOG="$RESULTADOS/suite.log"
C="$CARGA_DIR/correr.sh"
fase() { echo "$(date -Is) ▶ $1 (load $(cut -d' ' -f1-3 /proc/loadavg))" | tee -a "$LOG"; }
fin()  { echo "$(date -Is) ■ $1 → código $2" | tee -a "$LOG"; }
enfriar() { sleep "${ENFRIAR:-20}"; }   # que la máquina vuelva a reposo entre corridas

fases=("$@"); [[ ${#fases[@]} -eq 0 ]] && fases=(rendimiento estres pico limites escalabilidad disponibilidad respaldo soak)
for f in "${fases[@]}"; do
  case "$f" in
    rendimiento)
      fase "línea base (1 VU, 12 s por endpoint)"; "$C" linea-base linea-base.js -e DUR=12; fin linea-base $?; enfriar
      fase "carga 10 req/s, mezcla completa, 3 min"; "$C" carga-10rps carga.js -e RATE=10 -e DUR=3m; fin carga-10rps $?; enfriar
      fase "carga 10 req/s sin informe, 2 min"; "$C" carga-10rps-sin-informe carga.js -e RATE=10 -e DUR=2m -e EXCLUIR="GET informe"; fin carga-10rps-sin-informe $?; enfriar
      fase "carga 5 req/s, mezcla completa, 2 min"; "$C" carga-5rps carga.js -e RATE=5 -e DUR=2m; fin carga-5rps $?; enfriar ;;
    estres)
      fase "estrés mezcla completa 2→30 req/s"; "$C" estres-mezcla estres.js -e ESCALONES=2,5,10,15,20,30 -e PASO=45s -e TIMEOUT=15s; fin estres-mezcla $?; enfriar
      fase "estrés sin informe 25→500 req/s"; "$C" estres-sin-informe estres.js -e ESCALONES=25,50,100,200,300,400,500 -e PASO=30s -e TIMEOUT=15s -e EXCLUIR="GET informe" -e MAX_VUS=900; fin estres-sin-informe $?; enfriar ;;
    pico)
      # Prueba de picos: 5 req/s → 30 req/s durante 60 s → 5 req/s. Mide cuánto tarda en volver
      # a la latencia normal cuando el pico termina (recuperación tras sobrecarga).
      fase "pico 5→30→5 req/s, mezcla completa"; "$C" pico estres.js -e ESCALONES=5,30,5 -e PASO=60s -e TIMEOUT=15s; fin pico $?; enfriar ;;
    limites)
      fase "límites de tasa (429)"; "$CARGA_DIR/limites.sh" > "$RESULTADOS/limites-salida.txt" 2>&1; fin limites $?
      fase "tope de cuerpo (413) y cuota de filas (409)"; "$CARGA_DIR/cuotas.sh" >/dev/null 2>&1; fin cuotas $?
      fase "volumen de escritura de una sesión (RS-19)"; LIMPIAR_TASA=1 "$C" escrituras-una-sesion escrituras.js -e RATE=50 -e DUR=30s; fin escrituras $?; enfriar ;;
    escalabilidad)
      fase "escalabilidad (PGPOOL_MAX 2/10/30 y 2 instancias)"; "$CARGA_DIR/escalabilidad.sh" > "$RESULTADOS/escalabilidad-salida.txt" 2>&1; fin escalabilidad $?; enfriar ;;
    disponibilidad)
      fase "disponibilidad (caída de la base y reinicio del servidor bajo carga)"; "$CARGA_DIR/disponibilidad.sh" > "$RESULTADOS/disponibilidad-orquestador.txt" 2>&1; fin disponibilidad $?; enfriar ;;
    respaldo)
      fase "respaldo y restauración (RTO/RPO)"; "$CARGA_DIR/respaldo.sh" > "$RESULTADOS/respaldo-salida.txt" 2>&1; fin respaldo $?; enfriar ;;
    soak)
      fase "resistencia (soak) 5 req/s, ${SOAK_DUR:-25m}"; MUESTREO=15 "$C" soak carga.js -e RATE=5 -e DUR="${SOAK_DUR:-25m}" -e TIMEOUT=15s; fin soak $? ;;
    *) echo "fase desconocida: $f" >&2 ;;
  esac
done
