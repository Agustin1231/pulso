// Estrés: la tasa de llegada sube por escalones hasta que el servicio se degrada.
//   ESCALONES  "5,10,20,40,60" peticiones por segundo (default)
//   PASO       duración de cada escalón (default 60s)
//   EXCLUIR    endpoints a excluir (p. ej. "GET informe" para medir el resto de la API)
// Los umbrales NO abortan la prueba: se quiere ver dónde se rompe.
import { elegir, llamar, tokenAzar, ESTADISTICAS } from "../lib/comun.js";

const ESCALONES = (__ENV.ESCALONES || "5,10,20,40,60").split(",").map(Number);
const PASO = __ENV.PASO || "60s";
const EXCLUIR = (__ENV.EXCLUIR || "").split(",").filter(Boolean);
const stages = [];
for (const r of ESCALONES) {
  stages.push({ target: r, duration: "10s" }); // subida corta
  stages.push({ target: r, duration: PASO });  // meseta
}
export const options = {
  summaryTrendStats: ESTADISTICAS,
  thresholds: { http_req_failed: ["rate<0.05"], http_req_duration: ["p(95)<2000"] },
  scenarios: {
    estres: {
      executor: "ramping-arrival-rate", startRate: ESCALONES[0], timeUnit: "1s", stages,
      preAllocatedVUs: 50, maxVUs: Number(__ENV.MAX_VUS || 600),
    },
  },
};

export default function () {
  let n = elegir();
  while (EXCLUIR.includes(n)) n = elegir();
  llamar(n, tokenAzar());
}
