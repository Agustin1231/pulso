// Carga con la mezcla realista de endpoints (modelo ABIERTO: tasa de llegada
// constante, como usuarios reales que no esperan a los demás).
//   RATE      peticiones por segundo (default 10)
//   DUR       duración (default 3m)
//   EXCLUIR   endpoints a excluir, separados por coma (p. ej. "GET informe")
// También se usa para la prueba de resistencia (soak) y la de disponibilidad.
import { elegir, llamar, tokenAzar, ESTADISTICAS, umbralesPorEndpoint } from "../lib/comun.js";

const RATE = Number(__ENV.RATE || 10);
const EXCLUIR = (__ENV.EXCLUIR || "").split(",").filter(Boolean);
export const options = {
  summaryTrendStats: ESTADISTICAS,
  thresholds: {
    http_req_failed: [`rate<${__ENV.ERROR_MAX || 0.01}`],
    http_req_duration: [`p(95)<${__ENV.P95_MAX || 800}`],
    ...umbralesPorEndpoint(),
  },
  scenarios: {
    carga: {
      executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: __ENV.DUR || "3m",
      preAllocatedVUs: Math.max(20, RATE * 2), maxVUs: Number(__ENV.MAX_VUS || 400),
    },
  },
};

export default function () {
  let n = elegir();
  while (EXCLUIR.includes(n)) n = elegir();
  llamar(n, tokenAzar());
}
