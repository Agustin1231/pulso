#!/usr/bin/env python3
"""Analiza la salida CSV (gz) de k6 de las pruebas no funcionales de Pulso.

  analizar.py endpoints <crudo.csv.gz>             tabla por endpoint (n, p50, p95, p99, máx, % error)
  analizar.py serie <crudo.csv.gz> [ventana_s=10]  serie temporal (rps, p50/p95/p99, % error) en CSV
  analizar.py comparar <crudo1.csv.gz> <crudo2.csv.gz> ...    p50/p95 por endpoint de varias corridas lado a lado
  analizar.py grafico <crudo.csv.gz> <salida.png> [titulo] [ventana_s=10] [marcas]
        marcas: "t1:texto,t2:texto" en segundos desde el inicio (p. ej. "40:docker stop")

Sin dependencias fuera de la biblioteca estándar (salvo matplotlib para `grafico`).
"""
import csv
import gzip
import io
import math
import sys
from collections import defaultdict


def leer(ruta):
    with gzip.open(ruta, "rt", newline="") as fh:
        for fila in csv.DictReader(fh):
            yield fila


def pct(valores, p):
    if not valores:
        return float("nan")
    v = sorted(valores)
    k = (len(v) - 1) * p / 100
    f, c = math.floor(k), math.ceil(k)
    return v[f] if f == c else v[f] + (v[c] - v[f]) * (k - f)


def cargar(ruta):
    """Devuelve lista de (t, nombre, duracion_ms, fallida, status).

    Una petición es fallida si k6 la marcó `expected_response=false` (status
    fuera de 2xx/3xx, o 0 = sin respuesta: conexión rechazada, timeout).
    """
    out = []
    for f in leer(ruta):
        if f["metric_name"] == "http_req_duration":
            out.append((int(f["timestamp"]), f.get("name", ""), float(f["metric_value"]),
                        f.get("expected_response", "true") != "true", f.get("status", "")))
    return out


def endpoints(ruta):
    filas = cargar(ruta)
    por = defaultdict(list)
    for t, n, d, e, s in filas:
        por[n].append((d, e))
    t0, t1 = min(f[0] for f in filas), max(f[0] for f in filas)
    dur = max(1, t1 - t0)
    print(f"Peticiones: {len(filas)} en {dur} s ({len(filas) / dur:.1f} req/s)")
    print("| Endpoint | n | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) | error |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    todas = []
    for n in sorted(por):
        ds = [d for d, _ in por[n]]
        err = sum(1 for _, e in por[n] if e) / len(por[n])
        todas += por[n]
        print(f"| {n} | {len(ds)} | {pct(ds, 50):.1f} | {pct(ds, 95):.1f} | {pct(ds, 99):.1f} | {max(ds):.1f} | {err * 100:.2f} % |")
    ds = [d for d, _ in todas]
    err = sum(1 for _, e in todas if e) / len(todas)
    print(f"| **Total** | {len(ds)} | {pct(ds, 50):.1f} | {pct(ds, 95):.1f} | {pct(ds, 99):.1f} | {max(ds):.1f} | {err * 100:.2f} % |")


def comparar(rutas):
    """Tabla markdown: una fila por endpoint, p50 / p95 (ms) de cada corrida, y % error total."""
    import os
    datos = []
    for r in rutas:
        por = defaultdict(list)
        for t, n, d, e, s in cargar(r):
            por[n].append((d, e))
        datos.append(por)
    nombres = sorted(set().union(*[d.keys() for d in datos]))
    cab = [os.path.basename(r).replace("-crudo.csv.gz", "") for r in rutas]
    print("| Endpoint | " + " | ".join(f"{c} p50 / p95 (ms)" for c in cab) + " |")
    print("|---|" + "---:|" * len(cab))
    for n in nombres + ["**Total**"]:
        celdas = []
        for d in datos:
            v = [x for x, _ in (sum(d.values(), []) if n == "**Total**" else d.get(n, []))]
            celdas.append(f"{pct(v, 50):.1f} / {pct(v, 95):.1f}" if v else "—")
        print(f"| {n} | " + " | ".join(celdas) + " |")
    print("| % error | " + " | ".join(f"{sum(1 for x in sum(d.values(), []) if x[1]) / max(1, len(sum(d.values(), []))) * 100:.2f} %" for d in datos) + " |")


def serie(ruta, ventana=10):
    filas = cargar(ruta)
    t0 = min(f[0] for f in filas)
    cubos = defaultdict(list)
    for t, n, d, e, s in filas:
        cubos[(t - t0) // ventana].append((d, e, s))
    res = []
    for k in range(0, max(cubos) + 1):
        c = cubos.get(k, [])
        ds = [d for d, _, _ in c]
        res.append({
            "t_s": k * ventana,
            "rps": len(c) / ventana,
            "p50_ms": pct(ds, 50), "p95_ms": pct(ds, 95), "p99_ms": pct(ds, 99),
            "error_pct": (sum(1 for _, e, _ in c if e) / len(c) * 100) if c else float("nan"),
            "status": ";".join(f"{s or 'sin-respuesta'}={m}" for s, m in sorted(_contar(x for _, _, x in c).items())),
        })
    return res


def _contar(it):
    d = defaultdict(int)
    for x in it:
        d[x] += 1
    return d


def imprimir_serie(ruta, ventana):
    res = serie(ruta, ventana)
    w = csv.DictWriter(sys.stdout, fieldnames=list(res[0]))
    w.writeheader()
    for r in res:
        w.writerow({k: (f"{v:.1f}" if isinstance(v, float) else v) for k, v in r.items()})


def grafico(ruta, salida, titulo="", ventana=10, marcas=""):
    """Tres paneles con el mismo eje de tiempo (nunca dos escalas en un mismo eje):
    latencia p50/p95/p99 (escala log), peticiones completadas por segundo y % de error.
    Paleta de referencia (modo claro) del método de visualización del equipo."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    SUP, TINTA, TINTA2, MUDO, GRILLA, EJE = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
    SERIES = {"p50": "#2a78d6", "p95": "#eb6834", "p99": "#1baf7a"}
    CRITICO = "#d03b3b"
    res = serie(ruta, ventana)
    t = [r["t_s"] + ventana / 2 for r in res]
    plt.rcParams.update({"font.family": "sans-serif", "font.size": 9, "axes.edgecolor": EJE,
                         "axes.labelcolor": TINTA2, "xtick.color": MUDO, "ytick.color": MUDO})
    fig, (a1, a2, a3) = plt.subplots(3, 1, figsize=(10, 6.4), dpi=110, sharex=True,
                                     gridspec_kw={"height_ratios": [2.2, 1, 1]}, facecolor=SUP)
    for ax in (a1, a2, a3):
        ax.set_facecolor(SUP)
        ax.grid(axis="y", color=GRILLA, lw=0.6)
        for lado in ("top", "right"):
            ax.spines[lado].set_visible(False)
    ultimo = max((k for k, r in enumerate(res) if not math.isnan(r["p50_ms"])), default=None)
    for clave, color in SERIES.items():
        a1.plot(t, [r[f"{clave}_ms"] for r in res], color=color, lw=1.6, label=clave)
    if ultimo is not None:   # rótulos directos al final de cada línea, separados para que no se pisen (escala log)
        ys = sorted((res[ultimo][f"{c}_ms"], c) for c in SERIES)
        pos, previo = [], None
        for y, c in ys:
            ly = math.log10(max(y, 0.1))
            if previo is not None and ly - previo < 0.12:
                ly = previo + 0.12
            pos.append((10 ** ly, c)); previo = ly
        for y, c in pos:
            a1.annotate(c, (t[ultimo], y), xytext=(5, 0), textcoords="offset points", fontsize=8, color=TINTA2, va="center")
    a1.set_yscale("log")
    a1.set_ylabel("latencia (ms, log)")
    a1.legend(loc="upper left", fontsize=8, frameon=False, ncol=3)
    a2.bar([r["t_s"] for r in res], [r["rps"] for r in res], width=ventana * 0.85, align="edge", color="#86b6ef")
    a2.set_ylabel("req/s")
    err = [0 if math.isnan(r["error_pct"]) else r["error_pct"] for r in res]
    a3.plot(t, err, color=CRITICO, lw=1.6)
    a3.fill_between(t, err, color=CRITICO, alpha=0.12, lw=0)
    a3.set_ylabel("% error")
    a3.set_ylim(0, max(5, max(err) * 1.1))
    a3.set_xlabel("tiempo desde el inicio (s)")
    for m in filter(None, marcas.split(",")):
        x, txt = m.split(":", 1)
        for ax in (a1, a2, a3):
            ax.axvline(float(x), color=MUDO, ls=":", lw=1)
        a1.annotate(txt, (float(x), 1), xycoords=("data", "axes fraction"), xytext=(2, -2),
                    textcoords="offset points", rotation=90, va="top", fontsize=7.5, color=TINTA2)
    a1.set_title(titulo or ruta, fontsize=10.5, color=TINTA, loc="left")
    fig.tight_layout()
    fig.savefig(salida, facecolor=SUP)
    print(f"✓ {salida}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "endpoints":
        endpoints(sys.argv[2])
    elif cmd == "serie":
        imprimir_serie(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 10)
    elif cmd == "comparar":
        comparar(sys.argv[2:])
    elif cmd == "grafico":
        grafico(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "",
                int(sys.argv[5]) if len(sys.argv) > 5 else 10, sys.argv[6] if len(sys.argv) > 6 else "")
    else:
        print(__doc__)
        sys.exit(2)
