// Punto de entrada del motor: de observaciones crudas a un informe completo.
//
// Por cada métrica: serie diaria → tendencia (OLS) → selección de modelo por
// backtesting → pronóstico con intervalos → alertas (CUSUM + EWMA). Con los
// niveles actuales se calcula el índice de riesgo y, con los pronósticos, su
// proyección. El LLM recibe este informe y REDACTA sobre él; ningún número
// sale del modelo de lenguaje.

import type {
  Alerta,
  EntradaInforme,
  Informe,
  InformeMetrica,
  MetricaType,
  Observacion,
  Prediccion,
  TendenciaMetrica,
} from "./tipos";
import { aPuntos, construirSerie, diasEntre, hoyLocal, nivelRobusto, sumarDias } from "./series";
import { ajustarSobreSerie, seleccionar } from "./evaluacion/seleccion";
import { ajustarOLS } from "./modelos/lineal";
import { adherenciaMedia, clasificarTendencia } from "./features";
import { cusum } from "./anomalias/cusum";
import { ewma } from "./anomalias/ewma";
import { armarValores, calcularIndice } from "./riesgo/indice";
import type { EntradaValores } from "./riesgo/indice";
import { proyectarIndice } from "./riesgo/proyeccion";
import { METRICA_MAP } from "../metricas-config";

export type * from "./tipos";

const METRICAS_INDICE = new Set<MetricaType>([
  "frecuencia_cardiaca",
  "horas_sueno",
  "nivel_estres",
  "peso",
]);

/** Una alerta cuya última confirmación es más vieja que esto ya no es "reciente". */
const DIAS_ALERTA_RECIENTE = 14;
const N_MIN_ANOMALIAS = 15;
const ORDEN_SEVERIDAD: Record<Alerta["severidad"], number> = { alta: 0, atencion: 1, info: 2 };

const etiqueta = (tipo: MetricaType) => METRICA_MAP[tipo]?.label ?? tipo;

function acotador(tipo: MetricaType): (v: number) => number {
  const cfg = METRICA_MAP[tipo];
  if (!cfg) return (v) => v;
  return (v) => Math.min(cfg.max, Math.max(cfg.min, v));
}

function analizarMetrica(
  tipo: MetricaType,
  obs: Observacion[],
  hoy: string,
  horizonte: number,
  limitaciones: string[]
): InformeMetrica | null {
  const serie = construirSerie(obs, hoy);
  if (serie.n === 0) return null;
  const nombre = etiqueta(tipo);

  // Tendencia descriptiva: OLS sobre toda la serie.
  let tendencia: TendenciaMetrica | null = null;
  const puntos = aPuntos(serie);
  if (puntos.y.length >= 5) {
    const ols = ajustarOLS(puntos);
    tendencia = clasificarTendencia(tipo, ols.parametros.pendienteSemanal, ols.parametros.significativa === 1);
  }

  // Selección por backtesting y pronóstico desde hoy.
  const sel = seleccionar(serie);
  const acotar = acotador(tipo);
  const idxHoy = Math.max(0, diasEntre(serie.dias[0], hoy));
  let pronostico: Prediccion[] = [];
  try {
    const { ajuste, tUltimo } = ajustarSobreSerie(serie, sel.clave);
    const hTotal = idxHoy + horizonte - tUltimo;
    if (hTotal > 0) {
      pronostico = ajuste
        .predecir(hTotal)
        .filter((p) => p.t > idxHoy)
        .map((p) => ({
          h: p.t - idxHoy,
          t: p.t,
          fecha: sumarDias(serie.dias[0], p.t),
          media: acotar(p.media),
          ic80: [acotar(p.ic80[0]), acotar(p.ic80[1])],
          ic95: [acotar(p.ic95[0]), acotar(p.ic95[1])],
        }));
    }
  } catch (err) {
    limitaciones.push(
      `${nombre}: no se pudo pronosticar (${err instanceof Error ? err.message : String(err)}).`
    );
  }
  if (sel.confianza === "baja") {
    limitaciones.push(`${nombre}: pronóstico con confianza baja (${serie.n} registros). ${sel.razon}`);
  }

  // Alertas recientes, las más graves primero.
  let alertas: Alerta[] = [];
  if (serie.n >= N_MIN_ANOMALIAS) {
    alertas = [...cusum(serie, tipo), ...ewma(serie, tipo)]
      .filter((a) => diasEntre(a.hasta, hoy) <= DIAS_ALERTA_RECIENTE)
      .sort(
        (a, b) =>
          ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad] ||
          (a.hasta < b.hasta ? 1 : a.hasta > b.hasta ? -1 : 0)
      );
  } else {
    limitaciones.push(
      `${nombre}: con ${serie.n} registros no se evalúan cambios de régimen (hacen falta ${N_MIN_ANOMALIAS}).`
    );
  }

  return {
    n: serie.n,
    cobertura: serie.cobertura,
    nivelActual: nivelRobusto(serie),
    tendencia,
    modelo: {
      clave: sel.clave,
      nombre: sel.nombre,
      mase: sel.mase,
      confianza: sel.confianza,
      razon: sel.razon,
      tabla: sel.tabla,
    },
    pronostico,
    alertas,
  };
}

export function generarInforme(entrada: EntradaInforme): Informe {
  const hoy = entrada.hoy ?? hoyLocal();
  const horizonte = entrada.horizonte ?? 30;
  const limitaciones: string[] = [];
  const metricas: Partial<Record<MetricaType, InformeMetrica>> = {};
  const porMetrica: Partial<Record<MetricaType, number>> = {};
  const niveles: EntradaValores = {};
  const pronosticoFinal: Partial<Record<MetricaType, Prediccion>> = {};
  let diasMax = 0;

  for (const [tipo, obs] of Object.entries(entrada.metricas) as [MetricaType, Observacion[] | undefined][]) {
    if (!obs || obs.length === 0) continue;
    const resultado = analizarMetrica(tipo, obs, hoy, horizonte, limitaciones);
    if (!resultado) continue;
    metricas[tipo] = resultado;
    porMetrica[tipo] = resultado.cobertura;
    diasMax = Math.max(diasMax, diasEntre(construirSerie(obs).dias[0], hoy) + 1);
    if (METRICAS_INDICE.has(tipo)) {
      niveles[tipo as keyof EntradaValores] = resultado.nivelActual;
      if (resultado.pronostico.length) {
        pronosticoFinal[tipo] = resultado.pronostico[resultado.pronostico.length - 1];
      }
    }
  }

  const perfil = entrada.perfil;
  const riesgo = calcularIndice(armarValores(niveles, perfil), perfil);
  const proyeccion = proyectarIndice(niveles, pronosticoFinal, perfil, horizonte, riesgo.score);

  const adherencia = entrada.adherencia?.length
    ? {
        media7d: adherenciaMedia(entrada.adherencia, 7, hoy),
        media14d: adherenciaMedia(entrada.adherencia, 14, hoy),
      }
    : null;

  // Limitaciones estructurales, siempre presentes.
  limitaciones.unshift(
    "El índice de riesgo pondera factores modificables con coeficientes tomados de meta-análisis publicados; " +
      "no es una escala clínica validada (Framingham, SCORE) ni estima la probabilidad absoluta de un evento."
  );
  if (!perfil) {
    limitaciones.push("Sin perfil: no se evalúan IMC, tabaquismo ni el contexto de edad y sexo.");
  } else {
    if (perfil.alturaCm == null && niveles.peso != null) {
      limitaciones.push("Sin altura en el perfil: el peso no se convierte a IMC y no entra al índice.");
    }
    if (perfil.fumador == null) limitaciones.push("Tabaquismo sin responder: no entra al índice.");
    if (perfil.edad == null) limitaciones.push("Sin edad en el perfil: el contexto no se evalúa.");
  }
  if (riesgo.insuficiente) {
    limitaciones.push("Índice no calculado: hacen falta al menos dos factores con datos.");
  }
  limitaciones.push(
    "Los modelos se eligen por backtesting sobre el propio historial del usuario; los intervalos (80 % y 95 %) " +
      "suponen que el patrón reciente se mantiene y se ensanchan con el horizonte."
  );

  return {
    generadoEn: hoy,
    horizonte,
    cobertura: { dias: diasMax, porMetrica },
    metricas,
    adherencia,
    riesgo,
    proyeccion,
    limitaciones,
  };
}
