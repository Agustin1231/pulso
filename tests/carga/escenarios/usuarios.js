// Usuarios concurrentes (RNF-06): cada usuario virtual recorre la app como una
// persona, con tiempo de lectura entre pantallas (PENSAR_MIN..PENSAR_MAX s):
//   abrir la app → POST sesion → Métricas (últimas + informe en paralelo, historial)
//   → una pantalla al azar (Score, Hábitos, Recetas, Rutinas, Mercado, registrar métrica).
// Las peticiones paralelas imitan los `async` de los ViewModels (http.batch).
//   VUS (default 50), DUR (meseta, default 2m), subida de 30 s.
import http from "k6/http";
import { check, sleep } from "k6";
import { API, base, cabeceras, tokenDeVU, ESTADISTICAS, umbralesPorEndpoint, ENDPOINTS } from "../lib/comun.js";

const VUS = Number(__ENV.VUS || 50);
const PMIN = Number(__ENV.PENSAR_MIN || 5), PMAX = Number(__ENV.PENSAR_MAX || 15);
export const options = {
  summaryTrendStats: ESTADISTICAS,
  thresholds: { http_req_failed: ["rate<0.01"], ...umbralesPorEndpoint({ p95Lectura: 500, p95Escritura: 500, p95Informe: 1500 }) },
  scenarios: {
    usuarios: { executor: "ramping-vus", startVUs: 0, gracefulRampDown: "20s",
      stages: [{ target: VUS, duration: "30s" }, { target: VUS, duration: __ENV.DUR || "2m" }] },
  },
};

function req(nombre, token) {
  const [metodo, ruta, cuerpo] = ENDPOINTS[nombre].fn();
  return { method: metodo, url: `${base()}${API}${ruta}`, body: cuerpo ?? null,
    params: { headers: cabeceras(token),
              tags: { name: nombre }, timeout: __ENV.TIMEOUT || "30s" } };
}
function lote(token, ...nombres) {
  const rs = http.batch(nombres.map((n) => req(n, token)));
  rs.forEach((r, i) => check(r, { "2xx": (x) => x.status >= 200 && x.status < 300 }, { name: nombres[i] }));
}
const pensar = () => sleep(PMIN + Math.random() * (PMAX - PMIN));

const PANTALLAS = [
  (t) => lote(t, "GET informe", "GET perfil"),                                         // Score
  (t) => lote(t, "GET rutinas", "GET habitos/definiciones", "GET habitos/fecha"),       // Hábitos
  (t) => lote(t, "GET recetas"),                                                       // Recetas guardadas
  (t) => lote(t, "GET rutinas", "GET metricas/ultimas"),                               // Rutinas
  (t) => lote(t, "GET mercado"),                                                       // Mercado
  (t) => { lote(t, "POST metricas"); lote(t, "GET metricas/ultimas", "GET informe"); }, // registrar y recargar
];

export default function () {
  const t = tokenDeVU();
  lote(t, "POST sesion");
  lote(t, "GET metricas/ultimas", "GET informe");
  lote(t, "GET metricas/historial");
  pensar();
  PANTALLAS[Math.floor(Math.random() * PANTALLAS.length)](t);
  pensar();
}
