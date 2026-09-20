// CUSUM tabular (Page 1954; Montgomery, *Introduction to Statistical Quality
// Control*, cap. 9). Acumula los desvíos respecto de la línea base personal
// descontando una holgura k; dispara cuando el acumulado supera h.
//
//   S⁺_t = max(0, S⁺_{t−1} + z_t − k)      S⁻_t = max(0, S⁻_{t−1} − z_t − k)
//   z_t = (y_t − μ₀) / σ₀,  k = 0.5,  h = 5
//
// Detecta desvíos chicos pero sostenidos (el "subió 8 bpm y se quedó ahí")
// que un umbral sobre valores individuales nunca vería. El día del cambio se
// estima como el último en que el acumulado estaba en cero. La línea base es
// auto-iniciada (ver `lineaBase`) y z se winsoriza a ±3 (Hawkins & Olwell
// 1998) para que un outlier aislado no dispare la carta.

import type { Alerta, MetricaType, SerieDiaria } from "../tipos";
import { media } from "../estadistica";
import { armarAlerta, consolidar, lineaBase, observaciones, winsorizar } from "./base";

export interface OpcionesCusum {
  k?: number;
  h?: number;
  /** Observaciones de línea base. Default 14. */
  nBase?: number;
}

/** Estado de la carta en cada observación monitoreada (para figuras y depuración). */
export interface PasoCusum {
  fecha: string;
  valor: number;
  mu: number;
  sigma: number;
  z: number;
  sp: number;
  sn: number;
  alarma: "sube" | "baja" | null;
}

export function cusum(serie: SerieDiaria, metrica: MetricaType, opciones: OpcionesCusum = {}): Alerta[] {
  return cusumDetallado(serie, metrica, opciones).alertas;
}

export function cusumDetallado(
  serie: SerieDiaria,
  metrica: MetricaType,
  opciones: OpcionesCusum = {}
): { alertas: Alerta[]; traza: PasoCusum[]; h: number; k: number } {
  const k = opciones.k ?? 0.5;
  const h = opciones.h ?? 5;
  const nBase = opciones.nBase ?? 14;

  const obs = observaciones(serie);
  if (obs.length < nBase + 1) return { alertas: [], traza: [], h, k };
  const base = lineaBase(obs, metrica, nBase);

  const alertas: Alerta[] = [];
  const traza: PasoCusum[] = [];
  let sp = 0;
  let sn = 0;
  let inicioP = nBase;
  let inicioN = nBase;
  let aprendiendo = true;

  for (let i = nBase; i < obs.length; i++) {
    const { mu, sigma } = base;
    const z = winsorizar((obs[i].valor - mu) / sigma);
    sp = Math.max(0, sp + z - k);
    sn = Math.max(0, sn - z - k);
    let alarma = false;

    if (sp > h) {
      alarma = true;
      const tramo = obs.slice(inicioP, i + 1).map((o) => o.valor);
      const magnitud = media(tramo) - mu;
      alertas.push(armarAlerta(metrica, "cusum", "sube", magnitud / sigma, magnitud, obs[inicioP].fecha, obs[i].fecha));
      sp = 0;
      inicioP = i + 1;
    } else if (sp === 0) {
      inicioP = i + 1;
    }

    if (sn > h) {
      alarma = true;
      const tramo = obs.slice(inicioN, i + 1).map((o) => o.valor);
      const magnitud = media(tramo) - mu;
      alertas.push(armarAlerta(metrica, "cusum", "baja", magnitud / sigma, magnitud, obs[inicioN].fecha, obs[i].fecha));
      sn = 0;
      inicioN = i + 1;
    } else if (sn === 0) {
      inicioN = i + 1;
    }

    traza.push({
      fecha: obs[i].fecha, valor: obs[i].valor, mu, sigma, z, sp, sn,
      alarma: alarma ? (alertas[alertas.length - 1].direccion) : null,
    });
    if (alarma) aprendiendo = false;
    if (aprendiendo) base.absorber(mu + z * sigma);
  }
  return { alertas: consolidar(alertas), traza, h, k };
}
