# Versión corta v7: correcciones a la revisión del docente

Fecha: 28 de septiembre de 2026. Base: `Pulso_version_corta_1.docx`, la versión entregada al docente.
Archivos: `Pulso-version-corta-v7-USB.docx` y `Pulso-version-corta-v7-USB.pdf` (36 páginas).

## Observaciones del docente y cómo se resolvieron

1. **Definición de algoritmos.** Objetivos, alcance, metodología y resultados nombran el modelo: regresión
   logística entrenada sobre NHANES 2021-2023 (5.043 adultos), comparada contra gradient boosting y k vecinos
   más cercanos. Nueva sección VI-F con la tabla de algoritmos y la justificación de por qué no se evalúan
   Random Forest, XGBoost ni redes neuronales.
2. **SHAP frente a operación sin conexión.** Nueva sección IV-F. La predicción y su explicación se calculan
   en el servidor; como el modelo es lineal, el valor SHAP es exacto (φᵢ = βᵢ (xᵢ − x̄ᵢ)) y se guarda con la
   evaluación. Sin conexión se consulta la última evaluación con su explicación; una evaluación nueva requiere
   red. Tabla de funciones con y sin conexión.
3. **Resultados esperados específicos.** VII-B con la comparación de algoritmos (AUC y Brier en validación
   cruzada 5 × 10), criterios de aceptación con resultado preliminar, curva de calibración y tabla de odds
   ratio en lugar de la figura genérica de importancia de variables. VII-C con criterios de la aplicación.
4. **IEEE y plantilla institucional.** Plantilla IEEE de la Universidad de San Buenaventura, citas numeradas
   y 27 referencias en formato IEEE.

## Otros cambios

- La sección VI-E (preparación de datos) decía que se entrenaba con UCI y Framingham; se reescribió para
  NHANES 2021-2023, que es la fuente real. Framingham exige comité de ética y UCI solo verifica la implementación.
- Se añadieron SCORE2 como respaldo del rango de 40 a 69 años y Weng et al. (2017), citado pero ausente
  de la lista de referencias.

## Pendientes

- Nombre del asesor en la portada.
- La app aún no guarda en IndexedDB la última evaluación con su explicación para consulta sin conexión,
  aunque el documento lo describe como parte del diseño.
