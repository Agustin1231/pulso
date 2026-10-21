# Pruebas no funcionales del backend (k6)

Rendimiento, carga, estrés, escalabilidad, disponibilidad, recuperabilidad,
confiabilidad (soak) y verificación de límites de tasa de la API móvil
(`/api/movil/v1/*`, sin las rutas de IA). Resultados e interpretación en
`Pulso - celular/docs/integrador/04-pruebas/no-funcionales.md`.

**Nunca contra producción.** Todo apunta al servidor de carga
`http://127.0.0.1:3109` (`servidor.sh … carga`) y a una base propia y
descartable: el contenedor `pulso-nf-db` (Postgres 18, `127.0.0.1:55433`,
base `pulso_carga`). `entorno.sh` y `lib/comun.js` se niegan a correr contra
una URL que no sea local.

## Preparación (una vez)

```bash
# 1. Base propia con el esquema del repo
source ~/.local/share/pulso-toolchain/dev/db.env
POSTGRES_PASSWORD="$ADMIN_PW" docker run -d --name pulso-nf-db --memory 768m --cpus 2 \
  -p 127.0.0.1:55433:5432 -e POSTGRES_PASSWORD -e POSTGRES_DB=pulso_carga postgres:18-alpine
DATABASE_ADMIN_URL="postgres://postgres:$ADMIN_PW@127.0.0.1:55433/pulso_carga" \
  PULSO_APP_PASSWORD="$APP_PW" node scripts/setup-db.mjs

# 2. El servidor de carga apunta a esa base: ~/.local/share/pulso-toolchain/srv/carga.env (permisos 600)
#    DATABASE_URL=postgres://pulso_app:<APP_PW>@127.0.0.1:55433/pulso_carga
#    PGPOOL_MAX=10
#    CLAUDE_AUTH_MODE=oauth / CLAUDE_PROXY_URL=http://127.0.0.1:3199 / CLAUDE_PROXY_TOKEN=…  (IA sin salida a Internet)
~/.local/share/pulso-toolchain/bin/servidor.sh parar carga && ~/.local/share/pulso-toolchain/bin/servidor.sh iniciar carga

# 3. 200 sesiones + 90 días de historial por usuario
source tests/carga/entorno.sh && node tests/carga/preparar.mjs --usuarios 200
```

### Por qué las sesiones se crean en la base

`POST /api/movil/v1/sesion` sin token está limitado a **30 sesiones nuevas por
IP y hora** (`src/lib/seguridad/tasa.ts`). Es un control de seguridad y no se
desactiva. Para cargar sin chocar con él, `preparar.mjs` crea las sesiones con
el rol dueño llamando a `pulso_crear_sesion(sha256(token), 30)` — la misma
función que usa el servidor (`src/lib/sesion.ts`, `db/seguridad.sql`) — y guarda
los tokens en `.data/tokens.json` (ignorado por git; base descartable). k6 los
manda como `Authorization: Bearer`. Con token vigente, `POST /sesion` renueva y
no consume el límite. Los últimos 10 tokens quedan reservados para las pruebas
que destruyen la sesión (`limites.js`, `escrituras.js`).

## Escenarios

| Script | Qué mide |
|---|---|
| `correr.sh <nombre> linea-base.js` | Latencia sin concurrencia por endpoint (1 VU, 12 s c/u) |
| `correr.sh <nombre> carga.js -e RATE=10 -e DUR=3m [-e EXCLUIR="GET informe"]` | Carga con la mezcla realista (modelo abierto) |
| `correr.sh <nombre> estres.js -e ESCALONES=2,5,10,15,20,30` | Estrés por escalones hasta degradar |
| `escalabilidad.sh [pool2 pool10 pool30 x2]` | Capacidad (modelo cerrado) con `PGPOOL_MAX` 2/10/30 y con 2 instancias; 50 usuarios con tiempo de lectura (`usuarios.js`) |
| `limites.sh` | Límites de tasa: sesiones/IP (30), IA/sesión (40), supresión/IP (3) → 429 + `Retry-After` |
| `correr.sh <nombre> escrituras.js` | Volumen de escritura de una sola sesión (RS-19) |
| `disponibilidad.sh` | `docker stop/start` de la base y reinicio del servidor bajo carga |
| `respaldo.sh` | `pg_dump`/`pg_restore` con desastre simulado: RTO y RPO medidos |
| `correr.sh soak carga.js -e RATE=5 -e DUR=25m` + `muestrear.sh` | Resistencia: errores y crecimiento de memoria |

Cada corrida deja en `resultados/`: `<nombre>-resumen.json` (resumen de k6),
`<nombre>.html` (reporte del dashboard web de k6), `<nombre>-crudo.csv.gz`
(cada petición), `<nombre>-recursos.csv` (RSS/CPU del servidor, memoria/CPU y
conexiones de la base, carga de la máquina) y `<nombre>-contexto.txt`.
`analizar.py endpoints|serie|grafico` resume el CSV crudo (p50/p95/p99 por
endpoint, serie temporal, gráfico PNG).

k6 corre en Docker (`grafana/k6:1.3.0`, `--network host`, `--memory 1g`, 2 CPU).
