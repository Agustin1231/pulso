# UCI Heart Disease — Cleveland

`processed.cleveland.data`: 303 pacientes, 13 variables y un diagnóstico (`num`, 0 = sin enfermedad
coronaria, 1–4 = grado de estrechamiento). Es el dataset de referencia para clasificación de enfermedad
cardíaca en la literatura de aprendizaje automático. Se usa acá para el experimento supervisado del
motor de predicción (`npm run entrenar`): entrenar y validar una regresión logística desde cero.

- **Fuente:** UCI Machine Learning Repository, https://archive.ics.uci.edu/dataset/45/heart+disease
  (archivo `processed.cleveland.data`, descargado el 2026-09-20).
- **Licencia:** Creative Commons Attribution 4.0 (CC BY 4.0).
- **Cita:** Janosi, A., Steinbrunn, W., Pfisterer, M., Detrano, R. (1988). *Heart Disease*. UCI Machine
  Learning Repository. Estudio original: Detrano, R. et al. (1989). International application of a new
  probability algorithm for the diagnosis of coronary artery disease. *American Journal of Cardiology*, 64(5), 304–310.
- **Datos faltantes:** 6 filas tienen `?` en `ca` o `thal`; el experimento las descarta (quedan 297).

| Columna | Significado |
|---|---|
| `age` | edad (años) |
| `sex` | 1 = hombre, 0 = mujer |
| `cp` | tipo de dolor torácico (1 angina típica, 2 atípica, 3 no anginoso, 4 asintomático) |
| `trestbps` | presión arterial sistólica en reposo (mm Hg) |
| `chol` | colesterol sérico (mg/dl) |
| `fbs` | glucemia en ayunas > 120 mg/dl (1/0) |
| `restecg` | ECG en reposo (0 normal, 1 anomalía ST-T, 2 hipertrofia VI) |
| `thalach` | frecuencia cardíaca máxima alcanzada en prueba de esfuerzo |
| `exang` | angina inducida por ejercicio (1/0) |
| `oldpeak` | depresión del ST inducida por ejercicio |
| `slope` | pendiente del ST en el pico (1 ascendente, 2 plana, 3 descendente) |
| `ca` | vasos principales coloreados por fluoroscopia (0–3) |
| `thal` | talasemia (3 normal, 6 defecto fijo, 7 defecto reversible) |
| `num` | diagnóstico (0 = sin enfermedad; 1–4 = enfermedad) → el experimento usa `num > 0` |

Importante para interpretar: es una cohorte de pacientes derivados a evaluación cardiológica, no una
muestra poblacional. Los odds ratios que se aprenden describen ese grupo y no son riesgos absolutos
de la población general.
