#!/usr/bin/env bash
# Muestrea cada INTERVALO segundos la memoria y CPU del servidor de carga y de
# la base, y la carga de la máquina. Escribe CSV en $1 hasta que lo maten.
#   muestrear.sh salida.csv [intervalo=10] [pid del servidor] [contenedor]
set -uo pipefail
export LC_ALL=C
SALIDA="$1"; INTERVALO="${2:-10}"
PID="${3:-$(cat "$HOME/.local/share/pulso-toolchain/srv/carga.pid")}"
CONT="${4:-pulso-nf-db}"
TICKS=$(getconf CLK_TCK)
echo "epoch,rss_servidor_kb,cpu_servidor_pct,heap_fds,db_mem_mib,db_cpu_pct,db_conexiones,load1" > "$SALIDA"
cpu_prev=$(awk '{print $14+$15}' "/proc/$PID/stat" 2>/dev/null || echo 0); t_prev=$(date +%s.%N)
while true; do
  sleep "$INTERVALO"
  t=$(date +%s.%N)
  if [[ -r "/proc/$PID/stat" ]]; then
    cpu=$(awk '{print $14+$15}' "/proc/$PID/stat"); rss=$(awk '/VmRSS/{print $2}' "/proc/$PID/status")
    fds=$(ls "/proc/$PID/fd" 2>/dev/null | wc -l)
    pct=$(awk -v a="$cpu_prev" -v b="$cpu" -v t0="$t_prev" -v t1="$t" -v k="$TICKS" 'BEGIN{printf "%.1f", (b-a)/k/(t1-t0)*100}')
    cpu_prev=$cpu
  else rss=""; pct=""; fds=""; fi
  t_prev=$t
  read -r dbmem dbcpu < <(docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' "$CONT" 2>/dev/null | awk '{m=$1; if (m ~ /GiB/) {sub("GiB","",m); m*=1024} else sub("MiB","",m); c=$NF; sub("%","",c); print m, c}')
  con=$(docker exec "$CONT" psql -U postgres -Atc "select count(*) from pg_stat_activity where datname='pulso_carga'" 2>/dev/null)
  echo "$(date +%s),$rss,$pct,$fds,${dbmem:-},${dbcpu:-},${con:-},$(cut -d' ' -f1 /proc/loadavg)" >> "$SALIDA"
done
