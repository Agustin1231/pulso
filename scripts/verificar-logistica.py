#!/usr/bin/env python3
"""Verificación cruzada de la regresión logística del motor contra numpy.

Reimplementa IRLS de forma independiente sobre el mismo dataset y el mismo
conjunto de variables ("clínico básico"), y compara los coeficientes con los que
escribió `npm run entrenar -- --json docs/entrenamiento-uci.json`.

    python3 scripts/verificar-logistica.py [docs/entrenamiento-uci.json]
"""
import json, sys
import numpy as np

ruta_json = sys.argv[1] if len(sys.argv) > 1 else "docs/entrenamiento-uci.json"
ref = json.load(open(ruta_json))["coeficientes"]["estandarizados"]
lam = json.load(open(ruta_json))["protocolo"]["lambda"]

filas = []
for linea in open("data/uci-heart-disease/processed.cleveland.data"):
    c = linea.strip().split(",")
    if len(c) != 14 or "?" in c:
        continue
    filas.append([float(v) for v in c])
D = np.array(filas)
cols = ["age","sex","cp","trestbps","chol","fbs","restecg","thalach","exang","oldpeak","slope","ca","thal","num"]
idx = [cols.index(n) for n in ref["nombres"]]
X = D[:, idx]
y = (D[:, -1] > 0).astype(float)

media, sd = X.mean(0), X.std(0, ddof=1)
Xs = (X - media) / sd
A = np.hstack([np.ones((len(Xs), 1)), Xs])
beta = np.zeros(A.shape[1])
pen = np.eye(A.shape[1]) * lam; pen[0, 0] = 0
for it in range(50):
    p = 1 / (1 + np.exp(-A @ beta))
    W = p * (1 - p)
    g = A.T @ (y - p) - pen @ beta
    H = (A * W[:, None]).T @ A + pen
    delta = np.linalg.solve(H, g)
    beta += delta
    if np.abs(delta).max() < 1e-8:
        break
se = np.sqrt(np.diag(np.linalg.inv(H)))

dif_beta = np.abs(beta - np.array(ref["beta"])).max()
dif_se = np.abs(se - np.array(ref["errorEstandar"])).max()
dif_media = np.abs(media - np.array(ref["media"])).max()
print(f"numpy IRLS: {it+1} iteraciones · n={len(y)} · variables={ref['nombres']}")
print(f"máx |Δβ| = {dif_beta:.2e} · máx |ΔSE| = {dif_se:.2e} · máx |Δmedia| = {dif_media:.2e}")
ok = dif_beta < 1e-6 and dif_se < 1e-6
print("✅ coinciden con la implementación TypeScript" if ok else "❌ difieren")
sys.exit(0 if ok else 1)
