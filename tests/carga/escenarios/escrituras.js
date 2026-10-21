// Volumen de escritura de UNA sola sesión (RS-19 / AM-21): una sesión manda
// POST /metricas a RATE req/s durante DUR. Si existiera una cuota de escritura,
// a partir de cierto punto el servidor respondería 429 o 413; se cuenta cuántas
// escrituras acepta antes de frenar (o si no frena nunca).
import { Counter } from "k6/metrics";
import { llamar, reservados, ESTADISTICAS } from "../lib/comun.js";

const aceptadas = new Counter("escrituras_aceptadas");
const rechazadas429 = new Counter("escrituras_429_413");
export const options = {
  summaryTrendStats: ESTADISTICAS,
  scenarios: {
    escrituras: { executor: "constant-arrival-rate", rate: Number(__ENV.RATE || 50), timeUnit: "1s",
                  duration: __ENV.DUR || "30s", preAllocatedVUs: 20, maxVUs: 100 },
  },
};

export default function () {
  const r = llamar("POST metricas", reservados[9]);
  if (r.status === 200) aceptadas.add(1);
  if (r.status === 429 || r.status === 413) rechazadas429.add(1);
}
