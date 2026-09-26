#!/usr/bin/env python3
"""Íconos de la PWA (public/icons/): corazón coral con un trazo de pulso sobre el fondo de la app.

    python3 scripts/iconos.py

El fondo ocupa todo el cuadrado y el dibujo queda dentro del círculo central del 80 %, así el
mismo archivo sirve como ícono normal y como "maskable" (Android lo recorta con cualquier forma).
"""
import math
import os
from PIL import Image, ImageDraw

FONDO = (13, 17, 23)        # #0d1117, background_color del manifest
CORAL = (255, 107, 107)     # #ff6b6b, theme_color
BLANCO = (255, 255, 255)
SALIDA = "public/icons"
ESCALA = 4                  # se dibuja a 4× y se reduce para suavizar los bordes


def corazon(lado: int) -> list[tuple[float, float]]:
    """Curva paramétrica clásica del corazón, escalada al 56 % del lado y centrada."""
    puntos = []
    for i in range(720):
        t = 2 * math.pi * i / 720
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        puntos.append((x, -y))
    xs = [p[0] for p in puntos]
    ys = [p[1] for p in puntos]
    ancho, alto = max(xs) - min(xs), max(ys) - min(ys)
    k = 0.56 * lado / max(ancho, alto)
    cx = lado / 2 - k * (min(xs) + max(xs)) / 2
    cy = lado / 2 - k * (min(ys) + max(ys)) / 2 + 0.02 * lado
    return [(cx + k * x, cy + k * y) for x, y in puntos]


def pulso(lado: int) -> list[tuple[float, float]]:
    """Trazo de electrocardiograma que cruza el corazón a media altura."""
    base = 0.52 * lado
    tramos = [(0.20, 0), (0.38, 0), (0.44, -0.07), (0.50, 0.15), (0.56, -0.20), (0.61, 0.05), (0.66, 0), (0.80, 0)]
    return [(x * lado, base + dy * lado) for x, dy in tramos]


def icono(tam: int) -> Image.Image:
    lado = tam * ESCALA
    img = Image.new("RGB", (lado, lado), FONDO)
    d = ImageDraw.Draw(img)
    d.polygon(corazon(lado), fill=CORAL)
    d.line(pulso(lado), fill=BLANCO, width=round(0.045 * lado), joint="curve")
    return img.resize((tam, tam), Image.LANCZOS)


os.makedirs(SALIDA, exist_ok=True)
for tam in (192, 512, 180):
    nombre = "apple-touch-icon.png" if tam == 180 else f"icon-{tam}.png"
    icono(tam).save(f"{SALIDA}/{nombre}", optimize=True)
    print(f"✓ {SALIDA}/{nombre}")
