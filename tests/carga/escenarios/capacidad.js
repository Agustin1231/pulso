// Capacidad (modelo CERRADO): VUS usuarios virtuales piden sin pausa durante
// DUR. El throughput resultante (http_reqs/s) es la capacidad máxima de la
// configuración probada; se usa para la escalabilidad (PGPOOL_MAX, instancias).
import { elegir, llamar, tokenDeVU, ESTADISTICAS } from "../lib/comun.js";

const EXCLUIR = (__ENV.EXCLUIR || "").split(",").filter(Boolean);
export const options = {
  summaryTrendStats: ESTADISTICAS,
  thresholds: { http_req_failed: ["rate<0.01"] },
  scenarios: {
    capacidad: { executor: "constant-vus", vus: Number(__ENV.VUS || 32), duration: __ENV.DUR || "60s" },
  },
};

export default function () {
  let n = elegir();
  while (EXCLUIR.includes(n)) n = elegir();
  llamar(n, tokenDeVU());
}
