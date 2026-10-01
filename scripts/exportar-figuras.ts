#!/usr/bin/env node
/**
 * Exporta a JSON los datos que necesitan las figuras del informe
 * (`scripts/figuras.py` las dibuja con matplotlib):
 *
 *   - pronóstico de ejemplo con bandas (FC del usuario demo sintético)
 *   - traza CUSUM sobre una serie con cambio de régimen conocido
 *   - pendientes verdaderas vs. estimadas en la cohorte sintética
 *   - valores SHAP de la logística de NHANES: una persona de ejemplo y el
 *     resumen sobre la muestra (coeficientes de docs/entrenamiento-nhanes.json)
 *
 *   npm run figuras   (corre este export y después el script de Python)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { generarUsuario, generarSerie, generarCohorte } from "../src/lib/ml/sintetico";
import { generarInforme } from "../src/lib/ml";
import { construirSerie, aPuntos, interpolar, segmentoRegular, sumarDias } from "../src/lib/ml/series";
import { cusumDetallado } from "../src/lib/ml/anomalias/cusum";
import { ajustarOLS } from "../src/lib/ml/modelos/lineal";
import { ajustarTheilSen } from "../src/lib/ml/modelos/robusta";
import { ajustarHolt } from "../src/lib/ml/modelos/holt";
import { explicarSHAP } from "../src/lib/ml/supervisado/logistica";
import { desdeCSV, estresDesdePHQ9 } from "../src/lib/ml/supervisado/nhanes";
import type { FilaNHANES } from "../src/lib/ml/supervisado/nhanes";

const SALIDA = process.argv[2] ?? "docs/figuras/datos-figuras.json";

// ── 1. pronóstico de ejemplo: FC del usuario demo ───────────────────────────
const usuario = generarUsuario(7);
const informe = generarInforme(usuario);
const fc = informe.metricas.frecuencia_cardiaca!;
const serieFC = construirSerie(usuario.metricas.frecuencia_cardiaca!, usuario.hoy);
const desde = serieFC.dias.length - 45;
const pronostico = {
  metrica: "Frecuencia cardíaca en reposo (bpm)",
  hoy: usuario.hoy,
  historial: serieFC.dias.slice(desde).map((fecha, i) => ({ fecha, valor: serieFC.y[desde + i] })),
  pronostico: fc.pronostico.map((p) => ({ fecha: p.fecha, media: p.media, ic80: p.ic80, ic95: p.ic95 })),
  modelo: fc.modelo.nombre,
  mase: fc.modelo.mase,
  tabla: fc.modelo.tabla.map((f) => ({ nombre: f.nombre, mase: f.mase, cobertura80: f.cobertura80 })),
};

// ── 2. CUSUM sobre un salto conocido ────────────────────────────────────────
const salto = generarSerie({
  dias: 60, nivel: 70, sigma: 3, cambioRegimen: { dia: 30, delta: 8 }, semilla: 21, decimales: 0,
  rango: [40, 130], inicio: "2026-06-01",
});
const det = cusumDetallado(salto.serie, "frecuencia_cardiaca");
const cusum = {
  diaCambio: sumarDias("2026-06-01", 30),
  delta: 8,
  h: det.h,
  serie: salto.serie.dias.map((fecha, i) => ({ fecha, valor: salto.serie.y[i], sinRuido: salto.sinRuido[i] })),
  traza: det.traza,
  alertas: det.alertas.map((a) => ({ desde: a.desde, detectadaEn: a.detectadaEn, hasta: a.hasta, magnitud: a.magnitud, magnitudSigma: a.magnitudSigma })),
};

// ── 3. recuperación de pendientes en la cohorte ─────────────────────────────
const pendientes = generarCohorte(42)
  .filter((s) => s.verdad.pendientePorDia !== undefined)
  .map((s) => {
    const puntos = aPuntos(s.serie);
    const { serie: interp, fraccionImputada } = interpolar(s.serie);
    const reg = segmentoRegular(interp);
    return {
      metrica: s.metrica, perfil: s.nombre, sigma: s.verdad.sigma,
      verdadera: s.verdad.pendientePorDia as number,
      ols: ajustarOLS(puntos).pendiente,
      theilSen: ajustarTheilSen(puntos).pendiente,
      holt: reg.y.length >= 10 && fraccionImputada <= 0.4 ? ajustarHolt(reg).parametros.pendiente : null,
    };
  });

// ── 4. valores SHAP de la logística «estilo de vida + edad y sexo» ──────────
// Se usan los coeficientes ya reportados en el documento, no un reajuste.
const nhanes = JSON.parse(readFileSync("docs/entrenamiento-nhanes.json", "utf-8"));
const modeloNHANES = nhanes.coeficientes.completo.estandarizados as { nombres: (keyof FilaNHANES)[]; beta: number[]; media: number[]; sd: number[] };
const filas = desdeCSV(readFileSync("data/nhanes-2021-2023/muestra-analitica.csv", "utf-8"));
const explicaciones = filas.map((f) => explicarSHAP(modeloNHANES, modeloNHANES, modeloNHANES.nombres.map((c) => Number(f[c]))));
// Persona hipotética del ejemplo de VII-B: IMC alto y sin tabaquismo.
const persona: Partial<Record<keyof FilaNHANES, number>> = { fc: 78, imc: 35, sueno: 7.5, phq9: 4, fumador: 0, edad: 55, hombre: 0 };
const xPersona = modeloNHANES.nombres.map((c) => persona[c] as number);
const ePersona = explicarSHAP(modeloNHANES, modeloNHANES, xPersona);
const shap = {
  variables: modeloNHANES.nombres,
  media: modeloNHANES.media,
  base: ePersona.base,
  prevalencia: nhanes.dataset.prevalencia,
  ejemplo: { valores: xPersona, estres: estresDesdePHQ9(persona.phq9 as number), phi: ePersona.phi, logit: ePersona.logit, probabilidad: ePersona.probabilidad },
  muestra: {
    n: filas.length,
    mediaAbsPhi: modeloNHANES.nombres.map((_, j) => explicaciones.reduce((s, e) => s + Math.abs(e.phi[j]), 0) / filas.length),
    probabilidadMedia: explicaciones.reduce((s, e) => s + e.probabilidad, 0) / filas.length,
  },
};

writeFileSync(SALIDA, JSON.stringify({ pronostico, cusum, pendientes, shap }, null, 2));
console.log(`✓ ${SALIDA}: pronóstico (${pronostico.pronostico.length} días), CUSUM (${cusum.traza.length} pasos, ${cusum.alertas.length} alerta/s), ${pendientes.length} series con pendiente, SHAP de ${shap.muestra.n} adultos`);
