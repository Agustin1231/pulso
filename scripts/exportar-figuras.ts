#!/usr/bin/env node
/**
 * Exporta a JSON los datos que necesitan las figuras del informe
 * (`scripts/figuras.py` las dibuja con matplotlib):
 *
 *   - pronóstico de ejemplo con bandas (FC del usuario demo sintético)
 *   - traza CUSUM sobre una serie con cambio de régimen conocido
 *   - pendientes verdaderas vs. estimadas en la cohorte sintética
 *
 *   npm run figuras   (corre este export y después el script de Python)
 */
import { writeFileSync } from "node:fs";
import { generarUsuario, generarSerie, generarCohorte } from "../src/lib/ml/sintetico";
import { generarInforme } from "../src/lib/ml";
import { construirSerie, aPuntos, interpolar, segmentoRegular, sumarDias } from "../src/lib/ml/series";
import { cusumDetallado } from "../src/lib/ml/anomalias/cusum";
import { ajustarOLS } from "../src/lib/ml/modelos/lineal";
import { ajustarTheilSen } from "../src/lib/ml/modelos/robusta";
import { ajustarHolt } from "../src/lib/ml/modelos/holt";

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

writeFileSync(SALIDA, JSON.stringify({ pronostico, cusum, pendientes }, null, 2));
console.log(`✓ ${SALIDA}: pronóstico (${pronostico.pronostico.length} días), CUSUM (${cusum.traza.length} pasos, ${cusum.alertas.length} alerta/s), ${pendientes.length} series con pendiente`);
