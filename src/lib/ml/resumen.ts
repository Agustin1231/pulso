// Resumen textual del informe para los prompts del modelo de lenguaje.
//
// El LLM redacta sobre ESTE texto: todos los números que puede citar están acá,
// con su procedencia (modelo, MASE, confianza, intervalo). Es determinista y
// compacto; no es para mostrar al usuario.

import type { Informe, InformeMetrica, MetricaType } from "./tipos";
import { METRICA_MAP } from "../metricas-config";

const ORDEN: MetricaType[] = ["frecuencia_cardiaca", "horas_sueno", "nivel_estres", "peso"];

const signo = (x: number, decimales = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(decimales)}`;

function decimalesDe(tipo: MetricaType): number {
  const cfg = METRICA_MAP[tipo];
  return cfg && cfg.paso < 1 ? 1 : 0;
}

export function formatearValor(tipo: MetricaType, valor: number): string {
  const cfg = METRICA_MAP[tipo];
  const unidad = cfg?.unidad ?? "";
  const v = valor.toFixed(decimalesDe(tipo));
  return unidad.startsWith("/") ? `${v}${unidad}` : `${v} ${unidad}`.trim();
}

function lineaMetrica(tipo: MetricaType, m: InformeMetrica): string[] {
  const label = METRICA_MAP[tipo]?.label ?? tipo;
  const partes: string[] = [];
  partes.push(m.nivelActual === null ? "sin nivel actual" : `nivel actual ${formatearValor(tipo, m.nivelActual)}`);
  partes.push(`${m.n} registros en el ${Math.round(m.cobertura * 100)} % de los días`);

  if (m.tendencia) {
    const t = m.tendencia;
    const pend = `${signo(t.pendientePorSemana, decimalesDe(tipo) + 1)} por semana`;
    partes.push(
      t.direccion === "estable"
        ? `tendencia estable (${pend}${t.significativa ? ", estadísticamente distinta de cero pero irrelevante" : ""})`
        : `tendencia ${t.direccion} (${pend}, significativa)`
    );
  }

  const p7 = m.pronostico[6];
  const p30 = m.pronostico[m.pronostico.length - 1];
  if (p7 && p30) {
    const ic = (p: typeof p7) => `[${formatearValor(tipo, p.ic80[0])} – ${formatearValor(tipo, p.ic80[1])}]`;
    partes.push(
      `pronóstico a 7 días ${formatearValor(tipo, p7.media)} (80 %: ${ic(p7)}) y a ${p30.h} días ${formatearValor(tipo, p30.media)} (80 %: ${ic(p30)})`
    );
  }
  partes.push(
    `modelo ${m.modelo.nombre}` +
      (m.modelo.mase === null ? "" : `, MASE ${m.modelo.mase.toFixed(2)}`) +
      `, confianza ${m.modelo.confianza}`
  );

  const lineas = [`- ${label}: ${partes.join(" · ")}`];
  for (const a of m.alertas) lineas.push(`  · ALERTA (${a.severidad}): ${a.mensaje}`);
  return lineas;
}

export function resumirInforme(informe: Informe): string {
  const L: string[] = [];
  const r = informe.riesgo;

  L.push("ÍNDICE DE RIESGO (factores modificables, 0–100; NO es una escala clínica ni una probabilidad de evento)");
  if (r.score === null) {
    L.push(`- Sin índice: ${r.cobertura.disponibles} de ${r.cobertura.total} factores con datos; hacen falta al menos 2.`);
  } else {
    L.push(
      `- Score ${r.score}/100 (${r.etiqueta}). Riesgo relativo combinado respecto de la referencia: ×${(r.riesgoRelativo ?? 1).toFixed(2)}. ` +
        `Basado en ${r.cobertura.disponibles} de ${r.cobertura.total} factores.`
    );
  }
  for (const f of r.factores) {
    if (f.valor === null) {
      L.push(`- ${f.label}: sin datos`);
      continue;
    }
    const valor =
      f.clave === "tabaquismo" ? (f.valor >= 0.5 ? "fuma" : "no fuma")
      : f.clave === "imc" ? `${f.valor.toFixed(1)} kg/m²`
      : formatearValor(f.clave, f.valor);
    L.push(
      `- ${f.label}: ${valor} — estado ${f.estado}, resta ${f.puntosPerdidos.toFixed(1)} de ${f.maxPuntos.toFixed(1)} puntos posibles (evidencia ${f.evidencia})`
    );
  }
  L.push(
    r.contexto.multiplicador === null
      ? `- Contexto no modificable: ${r.contexto.detalle.join("; ")}`
      : `- Contexto no modificable (no entra al score): ×${r.contexto.multiplicador.toFixed(1)} — ${r.contexto.detalle.join("; ")}`
  );

  const p = informe.proyeccion;
  if (p.score !== null && p.ic80 && p.delta !== null) {
    L.push(
      `PROYECCIÓN A ${p.horizonteDias} DÍAS (calculada con los pronósticos; supone que el patrón reciente se mantiene): ` +
        `score ${p.score} (intervalo 80 %: ${p.ic80[0]}–${p.ic80[1]}), variación ${signo(p.delta, 0)} puntos.`
    );
  } else {
    L.push("PROYECCIÓN: no disponible (faltan pronósticos o el índice no se pudo calcular).");
  }

  L.push("MÉTRICAS (nivel actual = mediana de los últimos 7 días; intervalos del 80 %)");
  const presentes = ORDEN.filter((t) => informe.metricas[t]);
  if (presentes.length === 0) L.push("- Sin registros.");
  for (const t of presentes) L.push(...lineaMetrica(t, informe.metricas[t] as InformeMetrica));

  if (informe.adherencia) {
    const a = informe.adherencia;
    const pct = (x: number | null) => (x === null ? "sin datos" : `${Math.round(x * 100)} %`);
    L.push(`HÁBITOS: adherencia media ${pct(a.media7d)} en los últimos 7 días, ${pct(a.media14d)} en 14 días.`);
  }

  L.push("LIMITACIONES");
  for (const l of informe.limitaciones) L.push(`- ${l}`);
  return L.join("\n");
}
