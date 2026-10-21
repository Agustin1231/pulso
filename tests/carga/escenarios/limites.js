// Verificación de los límites de tasa (control de seguridad, src/lib/seguridad/tasa.ts):
//   1. sesionIp  : 30 sesiones nuevas por IP y hora  → la 31.ª devuelve 429 + Retry-After
//   2. ia        : 40 peticiones de IA por sesión y hora (POST /api/recetas) → la 41.ª, 429
//   3. supresion : 3 borrados de datos por IP y hora (DELETE /api/mis-datos) → el 4.º, 429
//   4. escritura : 300 escrituras por sesión y hora (POST /api/movil/v1/metricas) → la 301.ª, 429
//   5. escrituraIp: 1200 escrituras por IP y hora, repartidas en 5 sesiones de la misma IP
//                   (241 c/u, por debajo del límite de sesión) → desde la 1201.ª, 429
// Precondición: contadores en cero (el orquestador borra `limites_tasa` de la base
// de CARGA antes de correr). Las rutas de IA no llegan a ningún proveedor externo:
// el servidor de carga usa CLAUDE_AUTH_MODE=oauth con un proxy local inexistente
// y sin ANTHROPIC_API_KEY, así que el modelo falla localmente (respuesta 200 con
// una parte de error en el stream), pero el límite ya se consumió antes.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";
import { BASES } from "../lib/comun.js";

// Sesiones frescas creadas por limites.sh (preparar.mjs --salida .data/tokens-limites.json):
// [0] IA, [1] escritura, [2..6] supresión (cada borrado destruye su sesión), [7..11] escritura por IP.
const reservados = new SharedArray("limites", () => JSON.parse(open("/carga/.data/tokens-limites.json")));

const BASE = BASES[0];
const primer429 = new Counter("primer_429_en");
export const options = {
  scenarios: {
    sesion:    { executor: "per-vu-iterations", vus: 1, iterations: 1, exec: "sesionIp", startTime: "0s" },
    ia:        { executor: "per-vu-iterations", vus: 1, iterations: 1, exec: "ia", startTime: "15s", maxDuration: "5m" },
    supresion: { executor: "per-vu-iterations", vus: 1, iterations: 1, exec: "supresion", startTime: "20s" },
    escritura: { executor: "per-vu-iterations", vus: 1, iterations: 1, exec: "escritura", startTime: "25s", maxDuration: "5m" },
    escrituraIp: { executor: "per-vu-iterations", vus: 1, iterations: 1, exec: "escrituraIp", startTime: "40s", maxDuration: "10m" },
  },
  thresholds: {
    "checks{limite:sesionIp}": ["rate==1"],
    "checks{limite:ia}": ["rate==1"],
    "checks{limite:supresion}": ["rate==1"],
    "checks{limite:escritura}": ["rate==1"],
    "checks{limite:escrituraIp}": ["rate==1"],
  },
};

function rafaga(limite, n, max, hacer) {
  const estados = [];
  let primero = null;
  for (let i = 1; i <= n; i++) {
    const r = hacer(i);
    estados.push(r.status);
    if (r.status === 429 && primero === null) {
      primero = i;
      check(r, { [`${limite}: 429 trae Retry-After`]: (x) => x.headers["Retry-After"] === "3600" }, { limite });
    }
  }
  const ok = estados.slice(0, max).every((s) => s >= 200 && s < 300);
  const bloqueadas = estados.slice(max).every((s) => s === 429);
  check(null, {
    [`${limite}: las primeras ${max} pasan`]: () => ok,
    [`${limite}: desde la ${max + 1}.ª todas 429`]: () => bloqueadas,
  }, { limite });
  primer429.add(primero ?? 0, { limite });
  const resumen = Object.entries(estados.reduce((a, s) => ((a[s] = (a[s] || 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`).join(" ");
  console.log(`${limite}: max=${max} primer 429 en la petición ${primero} · ${resumen} · estados=${JSON.stringify(estados.length > 60 ? estados.slice(max - 5) : estados)}`);
}

export function sesionIp() {
  rafaga("sesionIp", 35, 30, () =>
    http.post(`${BASE}/api/movil/v1/sesion`, "{}", { headers: { "Content-Type": "application/json" }, tags: { name: "POST sesion (nueva)" } }));
}

export function ia() {
  const token = reservados[0];
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  rafaga("ia", 45, 40, () =>
    http.post(`${BASE}/api/recetas`, JSON.stringify({ ingredientes: "avena, banana, canela" }), { headers: h, tags: { name: "POST /api/recetas" } }));
}

export function supresion() {
  // Cada borrado usa una sesión distinta (reservada): el límite que se prueba es el de la IP.
  rafaga("supresion", 5, 3, (i) =>
    http.del(`${BASE}/api/mis-datos`, null, { headers: { Authorization: `Bearer ${reservados[i + 1]}` }, tags: { name: "DELETE /api/mis-datos" } }));
}

export function escritura() {
  const h = { Authorization: `Bearer ${reservados[1]}`, "Content-Type": "application/json", "X-Forwarded-For": "10.78.0.1" };
  const tipos = ["frecuencia_cardiaca", "peso", "horas_sueno", "nivel_estres"];
  rafaga("escritura", 305, 300, (i) =>
    http.post(`${BASE}/api/movil/v1/metricas`, JSON.stringify({ tipo: tipos[i % 4], valor: { frecuencia_cardiaca: 70, peso: 70, horas_sueno: 7, nivel_estres: 5 }[tipos[i % 4]] }),
      { headers: h, tags: { name: "POST metricas (cuota)" } }));
}

export function escrituraIp() {
  // Misma IP (10.78.0.2), cinco sesiones distintas en turno rotativo: ninguna llega a su
  // límite propio (241 < 300), pero la IP sí llega al suyo (1200).
  const tipos = ["frecuencia_cardiaca", "peso", "horas_sueno", "nivel_estres"];
  const valores = { frecuencia_cardiaca: 70, peso: 70, horas_sueno: 7, nivel_estres: 5 };
  rafaga("escrituraIp", 1205, 1200, (i) =>
    http.post(`${BASE}/api/movil/v1/metricas`, JSON.stringify({ tipo: tipos[i % 4], valor: valores[tipos[i % 4]] }),
      { headers: { Authorization: `Bearer ${reservados[7 + (i % 5)]}`, "Content-Type": "application/json", "X-Forwarded-For": "10.78.0.2" },
        tags: { name: "POST metricas (cuota IP)" } }));
}
