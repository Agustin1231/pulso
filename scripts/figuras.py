#!/usr/bin/env python3
"""Figuras del informe de tesis, a partir de los JSON que escriben los scripts del motor.

    npm run figuras          (exporta los datos y corre este script)
    python3 scripts/figuras.py

Entradas: docs/evaluacion-sintetica.json, docs/entrenamiento-uci.json, docs/figuras/datos-figuras.json
Salida:   docs/figuras/fig*.png (300 dpi) y .svg
"""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import rcParams
import numpy as np
import matplotlib.dates as mdates
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
        fig.savefig(f"{OUT}/{nombre}.{ext}", dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"✓ {nombre}.png / .svg")

evaluacion = json.load(open("docs/evaluacion-sintetica.json", encoding="utf-8"))
entrenamiento = json.load(open("docs/entrenamiento-uci.json", encoding="utf-8"))
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
