// Línea base por endpoint: 1 usuario virtual, sin concurrencia, DUR segundos por
// endpoint, uno después del otro. Da la latencia "sin carga" (p50/p95/p99).
import { llamar, NOMBRES, tokenAzar, ESTADISTICAS, umbralesPorEndpoint } from "../lib/comun.js";

const DUR = Number(__ENV.DUR || 10);
const PAUSA = 2;
export const options = {
  summaryTrendStats: ESTADISTICAS,
  thresholds: umbralesPorEndpoint({ p95Lectura: 300, p95Escritura: 500, p95Informe: 2500 }),
  scenarios: Object.fromEntries(NOMBRES.map((n, i) => [
    n.replace(/[^a-z]/gi, "_"),
    { executor: "constant-vus", vus: 1, duration: `${DUR}s`, startTime: `${i * (DUR + PAUSA)}s`,
      exec: "ejecutar", env: { ENDPOINT: n }, gracefulStop: "5s" },
  ])),
};

export function ejecutar() {
  llamar(__ENV.ENDPOINT, tokenAzar());
}
