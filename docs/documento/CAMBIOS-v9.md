# Versión corta v9 (plantilla institucional USB)

Fecha: 2 de octubre de 2026. Base: `Pulso-version-corta-v7-USB.docx` más la redacción de la v8.
Archivos: `Pulso-version-corta-v9-USB.docx` y `.pdf` (36 páginas).

## Qué cambió

- El documento queda solo en la plantilla institucional de la USB. Se retiran las versiones en formato de
  artículo IEEE a dos columnas (v7 y v8 en LaTeX); siguen en el historial de git.
- Se pasa a la versión USB la redacción de la v8, que reescribió los pasajes señalados por Compilatio el
  28 de septiembre de 2026 (68 párrafos, incluidos el resumen y el *abstract*). Las cifras, las citas, las
  tablas y las referencias no cambian.
- Se agregan las figuras SHAP generadas en el commit b08cea7, como Figura 2 (explicación de una predicción:
  mujer de 55 años, IMC 35, no fumadora) y Figura 3 (valores SHAP de los 5.043 adultos de NHANES
  2021-2023), en los resultados del segundo objetivo, después de la tabla de odds ratio. Cada una con un
  párrafo que la lee con las cifras de `docs/figuras/datos-figuras.json`.

- Segunda pasada de redacción sobre el informe de Compilatio del 28-sep (detección de IA 36 %, idiomas no
  reconocidos 6 %). Se reescribieron con otras palabras los 26 párrafos que todavía conservaban frases
  marcadas, la primera frase del resumen y del *abstract*, y los dos párrafos nuevos de las figuras SHAP.
  Medido con coincidencias de 7 palabras, el texto marcado como IA que sigue igual bajó de 31 % a 21 %; lo
  que queda son fragmentos cortos, títulos y celdas de tablas. El "idioma no reconocido" venía sobre todo de
  las palabras cortadas con guion al final de línea del formato a dos columnas; en esta versión no hay
  (solo dos URL largas en las referencias).

## Pendientes

- Siguen los de la v7: nombre del asesor en la portada y guardar en IndexedDB la última evaluación con su
  explicación.
