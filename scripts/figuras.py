#!/usr/bin/env python3
"""Figuras del informe de tesis, a partir de los JSON que escriben los scripts del motor.

    npm run figuras          (exporta los datos y corre este script)
    python3 scripts/figuras.py

Entradas: docs/evaluacion-sintetica.json, docs/entrenamiento-uci.json, docs/entrenamiento-nhanes.json,
          docs/figuras/datos-figuras.json
          data/nhanes-2021-2023/muestra-analitica.csv (resumen SHAP sobre la muestra)
Salida:   docs/figuras/fig*.png (300 dpi) y .svg
"""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import rcParams
import numpy as np
import matplotlib.dates as mdates
import matplotlib.ticker
FECHA = mdates.DateFormatter("%d %b")

OUT = "docs/figuras"
os.makedirs(OUT, exist_ok=True)

# ── paleta (referencia validada del método de visualización; modo claro) ──
SURFACE, INK, INK2, MUTED, GRID, AXIS = "#ffffff", "#0b0b0b", "#52514e", "#8a8880", "#e8e7e3", "#cfcdc7"
S1, S2, S3, S4 = "#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7"   # slots categóricos 1–4
DEEMPH = "#b5b3ac"                                              # de-énfasis (benchmarks)

rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9,
    "axes.edgecolor": AXIS, "axes.labelcolor": INK2, "axes.titlecolor": INK, "axes.titlesize": 10, "axes.titleweight": "semibold",
    "axes.spines.top": False, "axes.spines.right": False, "axes.linewidth": 0.8,
    "xtick.color": INK2, "ytick.color": INK2, "xtick.labelsize": 8, "ytick.labelsize": 8,
    "grid.color": GRID, "grid.linewidth": 0.8, "grid.linestyle": "-",
    "legend.frameon": False, "legend.fontsize": 8,
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
})

def guardar(fig, nombre):
    for ext in ("png", "svg"):
        fig.savefig(f"{OUT}/{nombre}.{ext}", dpi=300, bbox_inches="tight",
                    metadata={"Date": None} if ext == "svg" else None)
    plt.close(fig)
    print(f"✓ {nombre}.png / .svg")

evaluacion = json.load(open("docs/evaluacion-sintetica.json", encoding="utf-8"))
entrenamiento = json.load(open("docs/entrenamiento-uci.json", encoding="utf-8"))
nhanes = json.load(open("docs/entrenamiento-nhanes.json", encoding="utf-8"))
datos = json.load(open("docs/figuras/datos-figuras.json", encoding="utf-8"))

# ── Fig. 1: MASE medio por modelo (cohorte sintética) ─────────────────────────
BENCH = {"Naïve", "Media móvil (7)", "Drift", "Naïve estacional (7 d)"}
acum = {}
for s in evaluacion["series"]:
    for fila in s["tabla"]:
        if np.isfinite(fila["mase"]):
            acum.setdefault(fila["nombre"], []).append(fila["mase"])
modelos = sorted(acum, key=lambda m: np.mean(acum[m]), reverse=True)
medias = [np.mean(acum[m]) for m in modelos]
fig, ax = plt.subplots(figsize=(6.4, 3.4))
colores = [DEEMPH if m in BENCH else S1 for m in modelos]
barras = ax.barh(modelos, medias, color=colores, height=0.55)
ax.axvline(1, color=INK2, lw=0.8, ls=(0, (3, 3)))
ax.text(1.005, len(modelos) - 0.45, "MASE = 1 (igual que el naïve)", fontsize=7.5, color=INK2, va="center")
for b, v in zip(barras, medias):
    ax.text(v + 0.01, b.get_y() + b.get_height() / 2, f"{v:.2f}", va="center", fontsize=8, color=INK)
ax.set_xlim(0, max(medias) * 1.18)
ax.set_xlabel("MASE medio en backtesting (28 series sintéticas, horizonte 7 días) — menor es mejor")
ax.xaxis.grid(True); ax.set_axisbelow(True); ax.tick_params(axis="y", length=0)
ax.set_title("Error de pronóstico por modelo, relativo al naïve")
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color=S1, label="Modelos ajustados"), Patch(color=DEEMPH, label="Benchmarks")], loc="upper center", bbox_to_anchor=(0.5, -0.26), ncol=2)
guardar(fig, "fig1-mase-por-modelo")

# ── Fig. 2: pronóstico con bandas ─────────────────────────────────────────────
p = datos["pronostico"]
hist = [(h["fecha"], h["valor"]) for h in p["historial"] if h["valor"] is not None]
fechas_h = [np.datetime64(f) for f, _ in hist]; vals_h = [v for _, v in hist]
fechas_p = [np.datetime64(q["fecha"]) for q in p["pronostico"]]
media = [q["media"] for q in p["pronostico"]]
lo80 = [q["ic80"][0] for q in p["pronostico"]]; hi80 = [q["ic80"][1] for q in p["pronostico"]]
lo95 = [q["ic95"][0] for q in p["pronostico"]]; hi95 = [q["ic95"][1] for q in p["pronostico"]]
fig, ax = plt.subplots(figsize=(6.4, 3.2))
ax.fill_between(fechas_p, lo95, hi95, color=S1, alpha=0.08, lw=0, label="Intervalo 95 %")
ax.fill_between(fechas_p, lo80, hi80, color=S1, alpha=0.18, lw=0, label="Intervalo 80 %")
ax.plot(fechas_h, vals_h, color=S1, lw=2, solid_joinstyle="round", label="Registros")
ax.plot(fechas_h, vals_h, "o", color=S1, ms=3.5, mec=SURFACE, mew=0.8)
ax.plot([fechas_h[-1]] + fechas_p, [vals_h[-1]] + media, color=S1, lw=2, ls=(0, (4, 3)), label=f"Pronóstico ({p['modelo']}, MASE {p['mase']:.2f})")
ax.axvline(np.datetime64(p["hoy"]), color=INK2, lw=0.8)
ax.text(np.datetime64(p["hoy"]), ax.get_ylim()[1], " hoy", fontsize=7.5, color=INK2, va="top")
ax.set_ylabel(p["metrica"]); ax.yaxis.grid(True); ax.set_axisbelow(True)
ax.set_title("Pronóstico a 30 días con intervalos de predicción (usuario demo sintético)")
ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=2)
ax.xaxis.set_major_formatter(FECHA)
guardar(fig, "fig2-pronostico-bandas")

# ── Fig. 3: detección de cambio de régimen con CUSUM ──────────────────────────
c = datos["cusum"]
fig, (a1, a2) = plt.subplots(2, 1, figsize=(6.4, 4.4), sharex=True, gridspec_kw={"height_ratios": [1.3, 1], "hspace": 0.12})
f_s = [np.datetime64(s["fecha"]) for s in c["serie"]]
obs = [(np.datetime64(s["fecha"]), s["valor"]) for s in c["serie"] if s["valor"] is not None]
a1.plot(f_s, [s["sinRuido"] for s in c["serie"]], color=INK2, lw=1, label="Nivel real (sin ruido)")
a1.plot([o[0] for o in obs], [o[1] for o in obs], "o", color=S1, ms=3.5, mec=SURFACE, mew=0.8, label="Registros")
a1.axvline(np.datetime64(c["diaCambio"]), color=S2, lw=1, ls=(0, (3, 3)))
a1.text(np.datetime64(c["diaCambio"]), a1.get_ylim()[1], f"cambio real (+{c['delta']} bpm) ", fontsize=7.5, color=INK2, va="top", ha="right")
a1.set_ylabel("FC en reposo (bpm)"); a1.yaxis.grid(True); a1.set_axisbelow(True)
a1.legend(loc="upper left", ncol=2)
a1.set_title("Detección de un desvío sostenido: la serie y el estadístico CUSUM")
f_t = [np.datetime64(t["fecha"]) for t in c["traza"]]
a2.plot(f_t, [t["sp"] for t in c["traza"]], color=S1, lw=2, label="S⁺ (acumulado hacia arriba)")
a2.axhline(c["h"], color=INK2, lw=0.8, ls=(0, (3, 3)))
a2.text(f_t[0], c["h"], f" umbral h = {c['h']}σ", fontsize=7.5, color=INK2, va="bottom")
for al in c["alertas"]:
    d = np.datetime64(al["detectadaEn"])
    a2.axvline(d, color=S2, lw=1)
    a2.text(d, c["h"] * 0.55, f" detectado el {al['detectadaEn'][8:]}/{al['detectadaEn'][5:7]} ({al['magnitudSigma']:.1f}σ)", fontsize=7.5, color=INK2,
            bbox=dict(boxstyle="round,pad=0.25", fc=SURFACE, ec="none", alpha=0.9))
a2.set_ylabel("S⁺ (en σ)"); a2.yaxis.grid(True); a2.set_axisbelow(True)
a2.legend(loc="upper left", bbox_to_anchor=(0, 0.9))
a2.xaxis.set_major_formatter(FECHA)
guardar(fig, "fig3-cusum-deteccion")

# ── Fig. 4: curvas ROC (UCI) ──────────────────────────────────────────────────
res = {r["clave"]: r for r in entrenamiento["resultados"]}
SERIES = [
    ("logistica_completo", "Logística · completo (13 var.)", S1),
    ("knn_completo", "k-NN · completo", S2),
    ("logistica_clinico_basico", "Logística · clínico básico (6 var.)", S3),
    ("logistica_pulso", "Logística · solo lo que Pulso captura (3 var.)", S4),
]
fig, ax = plt.subplots(figsize=(5.2, 5.0))
ax.plot([0, 1], [0, 1], color=DEEMPH, lw=1, ls=(0, (3, 3)))
for clave, nombre, color in SERIES:
    pts = np.array(entrenamiento["roc"][clave])
    ax.plot(pts[:, 0], pts[:, 1], color=color, lw=2, solid_joinstyle="round",
            label=f"{nombre} — AUC {res[clave]['auc']['media']:.2f} ± {res[clave]['auc']['sd']:.2f}")
ax.set_xlabel("Tasa de falsos positivos (1 − especificidad)"); ax.set_ylabel("Sensibilidad")
ax.set_xlim(0, 1); ax.set_ylim(0, 1.02); ax.grid(True); ax.set_axisbelow(True)
ax.set_title("Curvas ROC — enfermedad coronaria, UCI Cleveland (n = 297)\npredicciones fuera de muestra, validación cruzada 5 particiones")
ax.legend(loc="lower right")
guardar(fig, "fig4-roc-uci")

# ── Fig. 5: calibración de la logística completa ──────────────────────────────
cal = entrenamiento["calibracion"]["logistica_completo"]
fig, ax = plt.subplots(figsize=(4.6, 4.4))
ax.plot([0, 1], [0, 1], color=DEEMPH, lw=1, ls=(0, (3, 3)), label="Calibración perfecta")
ax.plot([b["pMedia"] for b in cal], [b["observada"] for b in cal], color=S1, lw=2, marker="o", ms=6, mec=SURFACE, mew=1, label="Logística · completo")
for b in cal:
    ax.text(b["pMedia"], b["observada"] + 0.035, f"n={b['n']}", fontsize=7, color=INK2, ha="center")
ax.set_xlabel("Probabilidad predicha (media del bin)"); ax.set_ylabel("Frecuencia observada de enfermedad")
ax.set_xlim(0, 1); ax.set_ylim(0, 1.08); ax.grid(True); ax.set_axisbelow(True)
ax.set_title("Diagrama de confiabilidad (10 bins, fuera de muestra)")
ax.legend(loc="upper left")
guardar(fig, "fig5-calibracion-uci")

# ── Fig. 6: odds ratios con IC 95 % ───────────────────────────────────────────
co = entrenamiento["coeficientes"]["filas"]
ETQ = {"age": "Edad (+10 años)", "sex": "Sexo (hombre vs. mujer)", "trestbps": "PA sistólica (+10 mm Hg)",
       "chol": "Colesterol (+10 mg/dl)", "fbs": "Glucemia > 120 (sí vs. no)", "thalach": "FC máxima (+10 bpm)"}
fig, ax = plt.subplots(figsize=(6.2, 3.2))
ys = np.arange(len(co))[::-1]
for y, fila in zip(ys, co):
    ax.plot(fila["ic95"], [y, y], color=S1, lw=2, solid_capstyle="round")
    ax.plot(fila["or"], y, "o", color=S1, ms=7, mec=SURFACE, mew=1.2)
    ax.text(fila["ic95"][1] * 1.12, y, f"OR {fila['or']:.2f}  [{fila['ic95'][0]:.2f} – {fila['ic95'][1]:.2f}]" + ("" if fila["p"] < 0.05 else "  (n.s.)"), va="center", fontsize=7.5, color=INK2)
ax.axvline(1, color=INK2, lw=0.8)
ax.set_xscale("log"); ax.set_xlim(0.25, 60)
ax.set_yticks(ys); ax.set_yticklabels([ETQ[f["variable"]] for f in co]); ax.tick_params(axis="y", length=0)
ax.set_xlabel("Odds ratio (escala logarítmica) — regresión logística «clínico básico», n = 297")
ax.xaxis.grid(True); ax.set_axisbelow(True)
ax.set_title("Coeficientes aprendidos con intervalos de confianza del 95 %")
guardar(fig, "fig6-odds-ratios-uci")

# ── Fig. 7: pendiente estimada vs. real (normalizada por σ) ───────────────────
pen = datos["pendientes"]
fig, ax = plt.subplots(figsize=(4.8, 4.6))
lim = max(abs(q["verdadera"] / q["sigma"]) for q in pen) * 1.35
ax.plot([-lim, lim], [-lim, lim], color=DEEMPH, lw=1, ls=(0, (3, 3)), label="Estimación perfecta")
for clave, nombre, color, marker, ms in (("ols", "OLS", S1, "o", 11), ("theilSen", "Theil-Sen", S2, "s", 6), ("holt", "Holt amortiguado", S3, "^", 7)):
    xs = [q["verdadera"] / q["sigma"] for q in pen if q[clave] is not None]
    ys_ = [q[clave] / q["sigma"] for q in pen if q[clave] is not None]
    ax.plot(xs, ys_, marker, color=color, ms=ms, mec=SURFACE, mew=1, ls="none", label=nombre)
ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim)
ax.set_xlabel("Pendiente real (σ por día)"); ax.set_ylabel("Pendiente estimada (σ por día)")
ax.grid(True); ax.set_axisbelow(True)
ax.set_title("Recuperación de la tendencia real en 12 series sintéticas\n(pendientes normalizadas por el ruido; OLS y Theil-Sen casi coinciden)")
ax.legend(loc="upper left")
guardar(fig, "fig7-pendientes-recuperadas")

# ── Fig. 8: AUC de todos los modelos sobre NHANES (escalera de benchmarks) ────
GRUPO_COLOR = {"benchmark": DEEMPH, "sin_entrenamiento": S2, "entrenado": S1}
rn = sorted(nhanes["resultados"], key=lambda r: r["auc"]["media"])
fig, ax = plt.subplots(figsize=(6.6, 4.2))
ys = np.arange(len(rn))
for y, r in zip(ys, rn):
    c = GRUPO_COLOR[r["grupo"]]
    m, sdv = r["auc"]["media"], r["auc"]["sd"]
    ax.plot([m - sdv, m + sdv], [y, y], color=c, lw=2, solid_capstyle="round")
    ax.plot(m, y, "o", color=c, ms=7, mec=SURFACE, mew=1.2)
    ax.text(m + sdv + 0.008, y, f"{m:.3f}", va="center", fontsize=7.5, color=INK)
ax.axvline(0.5, color=INK2, lw=0.8, ls=(0, (3, 3)))
ax.set_yticks(ys); ax.set_yticklabels([f"{r['modelo']} · {r['variables']}" if r["variables"] != "—" else r["modelo"] for r in rn], fontsize=7.5)
ax.tick_params(axis="y", length=0)
ax.set_xlim(0.45, 0.86)
ax.set_xlabel(f"AUC-ROC (media ± sd, validación cruzada 5 × 10, n = {nhanes['dataset']['n']})")
ax.xaxis.grid(True); ax.set_axisbelow(True)
ax.set_title("Discriminación de antecedente cardiovascular en NHANES 2021-2023")
ax.legend(handles=[Patch(color=S1, label="Entrenado sobre NHANES"), Patch(color=S2, label="Sin entrenamiento (reglas / literatura)"), Patch(color=DEEMPH, label="Benchmark")],
          loc="upper center", bbox_to_anchor=(0.3, -0.14), ncol=3)
guardar(fig, "fig8-auc-nhanes")

# ── Fig. 9: curvas ROC sobre NHANES ────────────────────────────────────────────
resn = {r["clave"]: r for r in nhanes["resultados"]}
SERIES_N = [
    ("log_completo", "Logística · estilo de vida + edad y sexo", S1, "-"),
    ("indice_contexto", "Índice del motor + contexto (sin entrenar)", S3, "-"),
    ("log_demografico", "Logística · solo edad y sexo", S4, (0, (4, 2))),
    ("indice", "Índice del motor (sin entrenar)", S2, "-"),
    ("heuristica_v1", "Heurística v1 de la app", DEEMPH, "-"),
]
fig, ax = plt.subplots(figsize=(5.2, 5.0))
ax.plot([0, 1], [0, 1], color=DEEMPH, lw=1, ls=(0, (3, 3)))
for clave, nombre, color, ls in SERIES_N:
    pts = np.array(nhanes["roc"][clave])
    ax.plot(pts[:, 0], pts[:, 1], color=color, lw=2, ls=ls, solid_joinstyle="round",
            label=f"{nombre} — AUC {resn[clave]['auc']['media']:.3f}")
ax.set_xlabel("Tasa de falsos positivos (1 − especificidad)"); ax.set_ylabel("Sensibilidad")
ax.set_xlim(0, 1); ax.set_ylim(0, 1.02); ax.grid(True); ax.set_axisbelow(True)
ax.set_title(f"Curvas ROC — NHANES 2021-2023 (n = {nhanes['dataset']['n']})\npredicciones fuera de muestra, validación cruzada 5 particiones")
ax.legend(loc="lower right", fontsize=7.2)
guardar(fig, "fig9-roc-nhanes")

# ── Fig. 10: calibración por deciles de la logística de referencia ─────────────
ref = nhanes["referencia"]
dec = ref["calibracion"]["deciles"]
fig, ax = plt.subplots(figsize=(4.6, 4.4))
lim = max(max(d["predicha"] for d in dec), max(d["observada"] for d in dec)) * 1.12
ax.plot([0, lim], [0, lim], color=DEEMPH, lw=1, ls=(0, (3, 3)), label="Calibración perfecta")
ax.plot([d["predicha"] for d in dec], [d["observada"] for d in dec], color=S1, lw=2, marker="o", ms=6, mec=SURFACE, mew=1,
        label=f"Logística · pendiente {ref['calibracion']['pendiente']:.2f}, intercepto {ref['calibracion']['intercepto']:.2f}")
ax.xaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
ax.set_xlim(0, lim); ax.set_ylim(0, lim)
ax.set_xlabel("Riesgo predicho (media del decil)"); ax.set_ylabel("Frecuencia observada de antecedente CV")
ax.grid(True); ax.set_axisbelow(True)
ax.set_title("Calibración por deciles (fuera de muestra, n ≈ 504 por decil)")
ax.legend(loc="upper left", fontsize=7.5)
guardar(fig, "fig10-calibracion-nhanes")

# ── Fig. 11: pesos aprendidos para cada componente del índice ─────────────────
ETQ_F = {"logRR frecuencia_cardiaca": "FC en reposo", "logRR horas_sueno": "Sueño", "logRR nivel_estres": "Estrés (≈ PHQ-9)",
         "logRR imc": "IMC", "logRR tabaquismo": "Tabaquismo", "logRR edad": "Edad (contexto)", "logRR sexo": "Sexo (contexto)"}
pf = nhanes["coeficientes"]["factoresIndice"]["filas"]
fig, ax = plt.subplots(figsize=(6.2, 3.4))
ys = np.arange(len(pf))[::-1]
for y, fila in zip(ys, pf):
    color = S1 if fila["ic95"][0] <= 1 <= fila["ic95"][1] else S2
    ax.plot(fila["ic95"], [y, y], color=color, lw=2, solid_capstyle="round")
    ax.plot(fila["peso"], y, "o", color=color, ms=7, mec=SURFACE, mew=1.2)
    ax.text(fila["ic95"][1] + 0.15, y, f"{fila['peso']:.2f}  [{fila['ic95'][0]:.2f} – {fila['ic95'][1]:.2f}]", va="center", fontsize=7.5, color=INK2)
ax.axvline(1, color=INK2, lw=0.8)
ax.set_ylim(-1.0, len(pf) - 0.5)
ax.text(1.08, -0.7, "1 = magnitud de la literatura", fontsize=7.5, color=INK2, va="center")
ax.axvline(0, color=DEEMPH, lw=0.8, ls=(0, (3, 3)))
ax.set_xlim(-0.3, 10.2)
ax.set_yticks(ys); ax.set_yticklabels([ETQ_F[f["variable"]] for f in pf]); ax.tick_params(axis="y", length=0)
ax.set_xlabel("Peso aprendido sobre el log RR del motor (IC 95 %) — logística, n = 5043")
ax.xaxis.grid(True); ax.set_axisbelow(True)
ax.set_title("Recalibración del índice con datos reales")
ax.legend(handles=[Patch(color=S1, label="Compatible con la literatura (el IC incluye 1)"), Patch(color=S2, label="Difiere de la literatura")],
          loc="upper center", bbox_to_anchor=(0.45, -0.2), ncol=2)
guardar(fig, "fig11-pesos-indice-nhanes")

# ── valores SHAP de la logística NHANES (figuras 12 y 13) ────────────────────
# Rojo/azul: par divergente de la paleta (aumenta / reduce el riesgo).
# Azules: rampa secuencial para el valor de la variable (claro = bajo).
SUBE, BAJA = "#e34948", "#2a78d6"
RAMPA = matplotlib.colors.LinearSegmentedColormap.from_list("azules", ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])

def es(v, d=2, signo=False):
    """Número en formato español, con signo menos tipográfico."""
    txt = f"{v:+.{d}f}" if signo else f"{v:.{d}f}"
    return txt.replace(".", ",").replace("-", "−")

FMT_ES = matplotlib.ticker.FuncFormatter(lambda v, _: es(v, 1))
sh = datos["shap"]
VARS = sh["variables"]
MEDIA = dict(zip(VARS, sh["media"]))

# ── Fig. 12: explicación SHAP de una predicción individual ────────────────────
ej = sh["ejemplo"]
x = dict(zip(VARS, ej["valores"]))
phi = dict(zip(VARS, ej["phi"]))
ETQ_EJ = {
    "fc": f"FC en reposo = {x['fc']:.0f} lpm (media {es(MEDIA['fc'], 1)})",
    "imc": f"IMC = {x['imc']:.0f} kg/m² (media {es(MEDIA['imc'], 1)})",
    "sueno": f"Sueño = {es(x['sueno'], 1)} h (media {es(MEDIA['sueno'], 1)})",
    "phq9": f"Estrés: PHQ-9 = {x['phq9']:.0f}, {ej['estres']}/10 en la app (media {es(MEDIA['phq9'], 1)})",
    "fumador": f"Fumador = {'sí' if x['fumador'] else 'no'} ({MEDIA['fumador'] * 100:.0f} % fuma)",
    "edad": f"Edad = {x['edad']:.0f} años (media {es(MEDIA['edad'], 1)})",
    "hombre": f"Sexo = {'hombre' if x['hombre'] else 'mujer'} ({MEDIA['hombre'] * 100:.0f} % hombres)",
}
orden = sorted(VARS, key=lambda v: abs(phi[v]))          # de abajo (menor |φ|) hacia arriba
p_base = 1 / (1 + np.exp(-sh["base"]))
fig, ax = plt.subplots(figsize=(6.6, 3.8))
acum = sh["base"]
for y, v in enumerate(orden):
    f = phi[v]
    ax.barh(y, f, left=acum, height=0.55, color=SUBE if f > 0 else BAJA)
    extremo = acum + f
    ax.text(max(acum, extremo) + 0.012, y, f"{es(f, 2, signo=True)}  (odds ×{es(np.exp(f), 2)})", va="center", fontsize=7.5, color=INK,
            bbox=dict(boxstyle="round,pad=0.15", fc=SURFACE, ec="none"), zorder=3)
    if y < len(orden) - 1:
        ax.plot([extremo, extremo], [y + 0.28, y + 0.72], color=AXIS, lw=0.8)
    acum = extremo
ax.axvline(sh["base"], color=INK2, lw=0.8, ls=(0, (3, 3)))
ax.axvline(ej["logit"], color=INK, lw=1)
alto = len(orden) - 0.35
ax.text(sh["base"], -0.85, f"valor base {es(sh['base'])}\n(persona promedio, {es(p_base * 100, 1)} %)", fontsize=7.5, color=INK2, ha="right", va="center")
ax.text(ej["logit"], -0.85, f" predicción {es(ej['logit'])}\n ({es(ej['probabilidad'] * 100, 1)} % de riesgo)", fontsize=7.5, color=INK, ha="left", va="center")
ax.set_yticks(range(len(orden))); ax.set_yticklabels([ETQ_EJ[v] for v in orden]); ax.tick_params(axis="y", length=0)
ax.set_ylim(-1.4, alto)
ax.set_xlim(sh["base"] - 0.42, sh["base"] + 0.52)
ax.xaxis.set_major_formatter(FMT_ES)
ax.set_xlabel("Log-odds de antecedente cardiovascular (regresión logística, NHANES 2021-2023)")
ax.xaxis.grid(True); ax.set_axisbelow(True)
ax.set_title("Valores SHAP de una predicción individual\nmujer de 55 años, IMC 35, no fumadora (persona hipotética)")
ax.legend(handles=[Patch(color=SUBE, label="Aumenta el riesgo frente al promedio"), Patch(color=BAJA, label="Reduce el riesgo frente al promedio")],
          loc="upper center", bbox_to_anchor=(0.35, -0.17), ncol=2)
guardar(fig, "fig12-shap-individual")

# ── Fig. 13: resumen de los valores SHAP sobre la muestra de NHANES ───────────
# φ = β^z·z con los mismos coeficientes; se contrasta con el resumen que
# calculó el motor en TypeScript (explicarSHAP) para no tener dos verdades.
import csv
est_ = nhanes["coeficientes"]["completo"]["estandarizados"]
filas_ = list(csv.DictReader(open("data/nhanes-2021-2023/muestra-analitica.csv", encoding="utf-8")))
X_ = np.array([[float(f[v]) for v in VARS] for f in filas_])
PHI = (X_ - np.array(est_["media"])) / np.array(est_["sd"]) * np.array(est_["beta"][1:])
assert len(filas_) == sh["muestra"]["n"]
assert np.allclose(np.abs(PHI).mean(axis=0), sh["muestra"]["mediaAbsPhi"], atol=1e-9), "SHAP de Python y del motor no coinciden"
ETQ_RES = {"fc": "FC en reposo", "imc": "IMC", "sueno": "Sueño", "phq9": "Estrés (PHQ-9)",
           "fumador": "Tabaquismo", "edad": "Edad", "hombre": "Sexo (hombre)"}
media_abs = np.abs(PHI).mean(axis=0)
orden_j = list(np.argsort(media_abs))                     # de abajo hacia arriba
rng_ = np.random.default_rng(42)
fig, ax = plt.subplots(figsize=(6.6, 4.4))
bordes = np.linspace(PHI.min(), PHI.max(), 160)
for y, j in enumerate(orden_j):
    f, v = PHI[:, j], X_[:, j]
    # enjambre: dentro de cada bin de φ los puntos se apilan alternando arriba/abajo
    bin_ = np.digitize(f, bordes)
    desp = np.zeros(len(f))
    for b in np.unique(bin_):
        idx = rng_.permutation(np.where(bin_ == b)[0])
        k = np.arange(len(idx))
        desp[idx] = np.where(k % 2 == 0, 1, -1) * ((k + 1) // 2)
    desp = desp / max(np.abs(desp).max(), 1) * 0.38
    lo, hi = np.percentile(v, [5, 95])
    color = np.clip((v - lo) / (hi - lo if hi > lo else 1), 0, 1)
    perm = rng_.permutation(len(f))
    ax.scatter(f[perm], y + desp[perm], c=color[perm], cmap=RAMPA, vmin=0, vmax=1, s=2.5, lw=0, rasterized=True)
ax.axvline(0, color=INK2, lw=0.8)
ax.set_yticks(range(len(orden_j)))
ax.set_yticklabels([f"{ETQ_RES[VARS[j]]}\n|φ| medio {es(media_abs[j])}" for j in orden_j], fontsize=7.5)
ax.tick_params(axis="y", length=0)
ax.xaxis.set_major_formatter(FMT_ES)
ax.set_xlabel("Valor SHAP: contribución al log-odds frente a la persona promedio")
ax.xaxis.grid(True); ax.set_axisbelow(True)
ax.set_title(f"Valores SHAP sobre los {sh['muestra']['n']:,} adultos de NHANES 2021-2023".replace(",", ".") +
             "\ncada punto es una persona; a la derecha del 0, la variable sube su riesgo")
cb = fig.colorbar(matplotlib.cm.ScalarMappable(cmap=RAMPA, norm=matplotlib.colors.Normalize(0, 1)), ax=ax, pad=0.02, aspect=30, shrink=0.8)
cb.set_ticks([0, 1]); cb.set_ticklabels(["bajo", "alto"]); cb.outline.set_visible(False)
cb.set_label("Valor de la variable (sí / hombre = alto)", fontsize=7.5, color=INK2)
cb.ax.tick_params(labelsize=7.5, colors=INK2, length=0)
guardar(fig, "fig13-shap-resumen-nhanes")
