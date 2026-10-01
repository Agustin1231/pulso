# Versión corta v8: nueva redacción de los pasajes señalados

Fecha: 1 de octubre de 2026. Base: `Pulso-version-corta-v7-IEEE.tex`.
Archivos: `Pulso-version-corta-v8-IEEE.tex` y `.pdf` (IEEEtran a dos columnas, 13 páginas).

## Qué cambió

- Se reescribieron los párrafos que el informe de Compilatio del 28 de septiembre de 2026 señaló en la v7
  (resumen, introducción, planteamiento, antecedentes, justificación, alcance y limitaciones, metodología,
  plan de pruebas, resultados esperados y conclusiones). Cambia la redacción, no el contenido: las cifras
  y las citas son las mismas, y se verificó comparando ambos `.tex`.
- El *abstract* en inglés se ajustó para seguir al resumen en español.
- VI-E decía que el procedimiento se documenta en un "cuaderno reproducible"; ahora dice que está
  programado en scripts del repositorio, que es lo que existe (`npm run entrenar:nhanes`).
- Las tablas no se tocaron.
- Los rangos de la bibliografía y de la tabla de odds ratio usan `--` en lugar del carácter "–", que la
  fuente Times del compilador no tenía y desaparecía del PDF.

## Pendientes

- La versión institucional `Pulso-version-corta-v7-USB.docx` no tiene esta redacción.
- Siguen los de la v7: nombre del asesor en la portada y guardar en IndexedDB la última evaluación con su
  explicación.
