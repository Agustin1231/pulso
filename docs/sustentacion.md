# Sustentación del motor de predicción de Pulso — guía para la defensa

> Este documento es para el día de la defensa: qué decir, qué mostrar, qué te van a preguntar y cómo
> responder con evidencia. Todo lo que afirma se puede reproducir con un comando (sección 7).
> El detalle técnico completo está en [`motor-prediccion.md`](./motor-prediccion.md).

## 1. El mensaje en 60 segundos

Pulso registra métricas cardiovasculares diarias (frecuencia cardíaca en reposo, sueño, estrés, peso) y
**aprende de la serie de cada usuario**: ajusta ocho modelos de pronóstico —cuatro benchmarks y cuatro
modelos de regresión y suavizado exponencial— y elige el mejor por validación cruzada temporal contra su
propio historial. Con eso pronostica cada métrica a 30 días con intervalos de predicción, detecta
cambios sostenidos con cartas de control estadístico, y calcula un índice de riesgo con coeficientes
tomados de meta-análisis publicados. Ese índice lo **validamos sobre 5.043 adultos reales de NHANES
2021-2023**, que miden las mismas variables que la app: sin entrenar, ordena igual que una regresión
logística entrenada con esos datos (AUC 0.799 vs 0.805, diferencia no significativa), y le gana a la
heurística anterior (0.611 vs 0.564 con las variables de estilo de vida). La **regresión logística, el
gradient boosting y el k-NN están implementados desde cero**, validados con validación cruzada 5×10 y
verificados contra numpy (10⁻¹⁵). El modelo de lenguaje (Claude) no calcula nada: recibe el informe del
motor y redacta sobre él. Todo el motor es TypeScript propio, sin librerías de ML, con 70 tests y una
evaluación reproducible.

## 2. Qué es "inteligencia artificial clásica" acá, y dónde está cada cosa

| Técnica | Dónde | Qué aprende / estima | Cómo se valida | Evidencia |
|---|---|---|---|---|
| **Regresión lineal (OLS)** | `src/lib/ml/modelos/lineal.ts` | Nivel y pendiente por mínimos cuadrados; error estándar de la pendiente; significancia (t de Student) | Backtesting rolling-origin; recuperación de pendientes sintéticas | Fig. 7; `docs/evaluacion-sintetica.txt` |
| **Regresión robusta (Theil-Sen)** | `modelos/robusta.ts` | Pendiente = mediana de las pendientes de todos los pares | Test: un outlier de +50 no la mueve (a OLS sí) | `tests/ml/lineal.test.ts` |
| **Suavizado exponencial (Holt amortiguado, Holt-Winters)** | `modelos/holt.ts`, `modelos/holt-winters.ts` | α, β*, φ, γ por **optimización de la suma de errores al cuadrado** (búsqueda en grilla) | Backtesting; recuperación de la amplitud semanal | Fig. 1, Fig. 2 |
| **Selección automática de modelo** | `evaluacion/seleccion.ts` | Cuál de los 8 modelos pronostica mejor a *este* usuario en *esta* métrica | Validación cruzada temporal (rolling-origin), MASE | 23/28 series con MASE < 1 |
| **Regresión logística (IRLS / Newton-Raphson)** | `supervisado/logistica.ts` | Antecedente cardiovascular a partir de las variables de la app en 5.043 adultos de NHANES; enfermedad coronaria en 297 pacientes de UCI | Validación cruzada estratificada 5×10, ROC, calibración, bootstrap de ΔAUC; verificación con numpy a 10⁻¹⁵ / 10⁻¹⁴ | Fig. 8–11 (NHANES), 4–6 (UCI); `docs/entrenamiento-nhanes.txt` |
| **Gradient boosting (Friedman 2001)** | `supervisado/boosting.ts` | 100 árboles de profundidad 3 sobre el gradiente de la log-loss | Misma validación cruzada; test: aprende un XOR que la logística no puede | AUC 0.794 vs 0.805 de la logística en NHANES |
| **Lector SAS XPORT** | `supervisado/xpt.ts` | Decodifica los archivos del CDC (coma flotante IBM) | Tests con valores conocidos; la muestra reproduce exactamente la del v4 del documento | `data/nhanes-2021-2023/flujo.json` |
| **k vecinos más cercanos** | `supervisado/knn.ts` | Comparador no paramétrico | Misma validación cruzada | AUC 0.88 vs 0.90 de la logística |
| **Cartas de control (CUSUM, EWMA) con línea base auto-iniciada** | `anomalias/` | μ y σ del usuario se actualizan en línea hasta la primera alarma (Hawkins 1987) | Retraso de detección y falsas alarmas en series con cambio conocido | Fig. 3; 4/4 detectados, 4.5 días de retraso medio |
| **Índice de riesgo log-lineal** | `riesgo/` | No se entrena: coeficientes de meta-análisis (y se explica por qué, §5 P8) | Validación externa en NHANES (AUC 0.611; 0.799 con contexto) y recalibración de sus pesos; propiedades exactas testeadas | Fig. 8, 11; `tests/ml/riesgo.test.ts` |
| **Cohorte sintética con verdad conocida** | `sintetico.ts` | Series con tendencia, estacionalidad, ruido, faltantes y saltos conocidos | Permite medir si los modelos recuperan la verdad | `npm run evaluar` |

Nada de esto llama a una API. El único uso de un LLM es redactar texto a partir del informe ya calculado.

## 3. Resultados que podés mostrar

### 3.1 Pronóstico (cohorte sintética, 28 series, backtesting con horizonte de 7 días)

| Modelo | MASE medio | Mediana | Cobertura IC 80 % |
|---|---|---|---|
| Media móvil (benchmark) | 0.88 | 0.87 | 81 % |
| **Regresión lineal (OLS)** | **0.88** | 0.86 | 78 % |
| **Theil-Sen** | **0.88** | 0.86 | 78 % |
| **Holt amortiguado** | 0.90 | 0.87 | 74 % |
| Holt-Winters | 1.04 | 1.01 | 80 % |
| Naïve (benchmark) | 1.11 | 1.10 | 93 % |
| Naïve estacional (benchmark) | 1.11 | 1.07 | 78 % |
| Drift (benchmark) | 1.17 | 1.13 | 93 % |

- El modelo elegido le gana al naïve (MASE < 1) en **23 de 28 series**; en 20 de 28 no es un benchmark.
- Las coberturas empíricas del IC 80 % rondan el 74–81 %: los intervalos están calibrados (los del naïve y el drift sobrecubren —93 %— porque son demasiado anchos).
- OLS y Theil-Sen recuperan la pendiente real (Fig. 7); Holt-Winters recupera la amplitud semanal (1.60 h → 1.76 h en sueño).
- Figuras: `figuras/fig1-mase-por-modelo.png`, `fig2-pronostico-bandas.png`, `fig7-pendientes-recuperadas.png`.

### 3.2 Detección de cambios de régimen

- Los 4 saltos sintéticos se detectan: CUSUM con retraso medio de **4.5 días**, EWMA 5.8 días.
- Falsas alarmas: 5 en 8 series estables/ruidosas de 90 días (0.6 por serie), con outliers de ±5σ incluidos a propósito.
- Figura: `figuras/fig3-cusum-deteccion.png` (salto de +8 bpm el día 30, detectado 2 días después).

### 3.3 Entrenamiento supervisado con datos reales (UCI Heart Disease, Cleveland, n = 297)

Validación cruzada estratificada de 5 particiones repetida 10 veces (50 ajustes por modelo):

| Modelo | Variables | AUC | Accuracy | F1 | log-loss |
|---|---|---|---|---|---|
| Baseline (prevalencia) | — | 0.500 | 0.539 | 0.000 | 0.690 |
| Regresión logística | solo lo que Pulso captura (edad, sexo, FC) | 0.785 ± 0.058 | 0.710 | 0.677 | 0.560 |
| Regresión logística | clínico básico (+ PA, colesterol, glucemia) | 0.795 ± 0.056 | 0.710 | 0.672 | 0.549 |
| **Regresión logística** | **completo (13 variables)** | **0.904 ± 0.032** | **0.836** | **0.815** | **0.407** |
| k-NN (k = 7) | completo | 0.880 ± 0.042 | 0.809 | 0.789 | 0.962 |

- Los coeficientes de la implementación TypeScript coinciden con una reimplementación independiente en numpy con diferencia máxima de **2·10⁻¹⁴** (`python3 scripts/verificar-logistica.py`).
- La ablación es un hallazgo en sí: con solo lo que Pulso captura el AUC cae de 0.90 a 0.79. Cuantifica por qué el índice de la app no pretende ser un clasificador clínico.
- Coeficientes aprendidos (modelo «clínico básico», Fig. 6): sexo masculino OR 6.0 [3.1–11.7], PA sistólica OR 1.25 por +10 mm Hg, colesterol OR 1.07 por +10 mg/dl, FC máxima OR 0.63 por +10 bpm (protectora), edad OR 1.17 por década **no significativa** (p = 0.38) y glucemia no significativa.
- Figuras: `figuras/fig4-roc-uci.png`, `fig5-calibracion-uci.png`, `fig6-odds-ratios-uci.png`.

### 3.4 Entrenamiento y validación con las variables de la app (NHANES 2021-2023, n = 5.043)

La muestra se construye con el lector XPORT propio a partir de 7 archivos del CDC (597 casos, 11.8 %) y
coincide exactamente con la del v4 del documento. Mismas 50 particiones para todos los modelos:

| Modelo | Variables | AUC |
|---|---|---|
| Prevalencia (benchmark) | — | 0.500 |
| Heurística v1 de la app | FC, sueño, estrés | 0.564 ± 0.026 |
| **Índice del motor, sin entrenar** | FC, sueño, estrés (≈ PHQ-9), IMC, tabaco | **0.611 ± 0.025** |
| Regresión logística | las mismas 5 | 0.608 ± 0.025 |
| Gradient boosting | las mismas 5 | 0.605 ± 0.025 |
| Regresión logística (benchmark) | solo edad y sexo | 0.769 ± 0.013 |
| **Índice + contexto, sin entrenar** | índice + edad y sexo | **0.799 ± 0.015** |
| **Regresión logística** | 5 + edad y sexo | **0.805 ± 0.014** |
| Gradient boosting | 5 + edad y sexo | 0.794 ± 0.016 |
| k-NN (k = 65) | 5 + edad y sexo | 0.775 ± 0.017 |

- **Índice vs heurística:** ΔAUC +0.046 [0.016; 0.075]. **Logística vs índice (mismas variables):** −0.001 [−0.022; 0.019]. **Logística vs índice + contexto:** +0.007 [−0.001; 0.015], no significativa. **Variables de la app sobre edad y sexo:** +0.037 [0.025; 0.049]. **Boosting vs logística:** −0.010 [−0.018; −0.001]. (Bootstrap pareado de 2.000 remuestreos.)
- Calibración de la logística: pendiente 0.99, intercepto −0.02, Brier 0.091 vs 0.104 de la prevalencia. Umbral de Youden 0.11: sensibilidad 0.82, especificidad 0.66, VPN 0.965.
- Recalibración: los pesos aprendidos para FC (1.97 [0.68–3.26]), sueño (1.00) e IMC (1.16) son compatibles con la literatura; estrés ≈ PHQ-9 (5.3), edad (1.28) y sexo (1.58) pesan más, tabaquismo menos (0.70). Reajustarlos lleva el AUC de 0.799 a 0.801.
- Figuras: `figuras/fig8-auc-nhanes.png`, `fig9-roc-nhanes.png`, `fig10-calibracion-nhanes.png`, `fig11-pesos-indice-nhanes.png`.

### 3.5 La app en funcionamiento

`docs/capturas/`: dashboard con pronóstico y bandas, tabla de backtesting, score con índice, alertas, desglose con fuentes y proyección. Todo sale del motor; la etiqueta "no estimado por la IA" está en pantalla.

## 4. La decisión de arquitectura que hay que contar

Antes: el cliente mandaba cuatro valores y el modelo de lenguaje inventaba tendencias y proyecciones ("tu score podría subir 10 puntos en 3 semanas"). Un jurado pregunta de dónde sale ese número y no había respuesta.

Ahora: el cliente manda un identificador; el servidor corre el motor (`getInforme`), que produce un informe con pronósticos, intervalos, modelo elegido, MASE, alertas, índice y limitaciones; el LLM recibe ese informe como texto (`resumirInforme`) con la regla de no inventar cifras y **redacta**. Si el servicio de IA falla, los números siguen en pantalla. Frase para la defensa: *"la inteligencia artificial generativa es la interfaz; la inteligencia artificial clásica es el motor."*

## 5. Preguntas probables del jurado y cómo responderlas

**P1. ¿Esto es inteligencia artificial o es estadística?**
Es aprendizaje automático clásico, que es estadística computacional: regresión lineal y logística, suavizado exponencial, k-NN y validación cruzada son capítulos centrales de cualquier texto de machine learning (Hastie, Tibshirani & Friedman; Bishop; Hyndman). Lo que lo hace "aprendizaje" y no un cálculo fijo es que los parámetros se ajustan automáticamente a los datos de cada usuario y el modelo se elige por desempeño predictivo fuera de muestra, no por criterio manual.

**P2. ¿Dónde está el entrenamiento?**
En cuatro lugares. (1) Cada modelo de pronóstico se ajusta a los datos del usuario: OLS por mínimos cuadrados, Holt y Holt-Winters optimizando la suma de errores al cuadrado sobre una grilla de α, β*, φ, γ. (2) La selección del modelo es una validación cruzada temporal contra el propio historial. (3) La regresión logística se entrena por IRLS sobre 297 pacientes reales y se valida con validación cruzada repetida. (4) Las cartas de control aprenden en línea la media y la varianza del usuario hasta la primera alarma.

**P3. ¿Por qué no redes neuronales o deep learning?**
Por el tamaño de los datos y el objetivo. Un usuario tiene como mucho 90 puntos por métrica; un paciente del dataset es una fila de 13 variables entre 297. Con ese volumen un modelo con miles de parámetros sobreajusta; el equilibrio sesgo-varianza favorece modelos lineales y de suavizado. Además necesitamos intervalos de predicción e interpretabilidad (qué factor resta cuántos puntos), que estos modelos dan de forma natural. Lo comprobamos: k-NN, que es no paramétrico y puede capturar no linealidades, no supera a la logística (AUC 0.88 vs 0.90).

**P4. ¿Por qué no usaron scikit-learn o statsmodels?**
El stack de la app es TypeScript y el motor corre en el servidor de la app sin infraestructura extra. Implementar los algoritmos desde cero hace que cada fórmula sea auditable línea por línea, y verificamos la regresión logística contra una implementación independiente en numpy: coeficientes idénticos a 10⁻¹⁴.

**P5. ¿Cómo saben que funciona?**
Con validación fuera de muestra en dos frentes. Pronóstico: backtesting rolling-origin contra benchmarks canónicos, con MASE (< 1 significa mejor que repetir el último valor): 23 de 28 series. Riesgo: validación cruzada estratificada 5×10 sobre 5.043 adultos reales de NHANES con las variables de la app (AUC 0.805 para la logística, 0.799 para el índice sin entrenar) y sobre UCI (AUC 0.904 ± 0.032 con las 13 variables clínicas). Y las coberturas empíricas de los intervalos (≈ 80 % para el IC 80 %) muestran que la incertidumbre está bien calibrada.

**P6. ¿Por qué datos sintéticos?**
Porque no existe historial real de usuarios y, aunque existiera, no tendría "verdad" contra la cual medir. La cohorte sintética tiene tendencia, estacionalidad, ruido, faltantes y saltos **conocidos**, así que podemos medir si el modelo recupera la pendiente real (Fig. 7) y cuántos días tarda en detectar un cambio (Fig. 3). Lo complementamos con dos datasets reales públicos para el estimador de riesgo: NHANES (las mismas variables que la app) y UCI (validación de la implementación).

**P7. ¿El score de riesgo es válido clínicamente?**
No como escala clínica, y la aplicación lo dice en pantalla: no estima probabilidad absoluta de eventos. Sí está validado externamente como ordenamiento: sobre 5.043 adultos de NHANES, sin haber visto esos datos, discrimina el antecedente cardiovascular con AUC 0.611 con los factores modificables y 0.799 con el contexto de edad y sexo, igual que una logística entrenada ahí (0.805). Las escalas clínicas (Framingham, SCORE) necesitan presión arterial y colesterol, que Pulso no captura por decisión de producto.

**P8. Si tenían datos reales, ¿por qué no entrenaron el índice con ellos?**
Lo probamos, y la respuesta es un resultado. Con NHANES entrenamos una logística con las mismas variables (0.608 vs 0.611 del índice) y otra que aprende un peso para cada componente del índice (0.801 vs 0.799): entrenar no mejora el orden. Además los pesos que difieren de la literatura son justo los que un diseño transversal distorsiona: el tabaquismo pesa menos (quien tuvo un infarto suele dejar de fumar) y el PHQ-9 pesa más (hay más síntomas depresivos después de un evento). Reemplazar coeficientes de cohortes prospectivas por estos sería empeorar el modelo. Con UCI tampoco: es una cohorte de derivación cardiológica (46 % con la enfermedad, edad no significativa con p = 0.38, sexo masculino OR 6), que describe a quién llega a cardiología y no el riesgo poblacional (Fig. 6).

**P8b. ¿Por qué NHANES y qué no se puede afirmar con él?**
Es el único dataset público que mide lo mismo que la app (pulso en reposo medido, peso e IMC medidos, horas de sueño, PHQ-9, tabaquismo, edad, sexo) con un desenlace cardiovascular. No permite afirmar predicción prospectiva (es transversal: antecedente, no incidencia), el desenlace es autorreportado, el PHQ-9 mide síntomas depresivos y no estrés, no aplicamos los ponderadores muestrales y describe a Estados Unidos. Lo decimos en la sección de limitaciones del documento.

**P8c. ¿Las cifras de NHANES del avance anterior eran reales?**
Las reprodujimos con nuestro propio código: la muestra coincide exactamente (5.043 y 597) y las medias de validación cruzada también (0.603 y 0.803 frente a 0.600 y 0.802 reportadas; la heurística da 0.5645 frente a 0.565). Las cifras de partición única difieren dentro de su variabilidad, por eso ahora reportamos validación cruzada repetida.

**P9. ¿Cómo garantizan que el modelo de lenguaje no invente números?**
Por arquitectura: no recibe los datos crudos sino el informe del motor como texto, con cada número y su procedencia (modelo, MASE, intervalo), y el prompt le prohíbe citar cifras que no estén ahí. Además la interfaz muestra los números calculados independientemente de la IA, con la etiqueta "no estimado por la IA".

**P10. ¿Qué pasa cuando hay pocos datos?**
El motor degrada explícitamente: con menos de 21 registros no compara modelos y usa un benchmark con confianza baja; con menos de 15 no emite alertas; con menos de dos factores no calcula el índice. Nunca rellena.

**P11. ¿Qué es MASE y por qué no RMSE?**
MASE divide el error absoluto por el error del pronóstico naïve dentro del entrenamiento. Es adimensional: permite comparar frecuencia cardíaca (bpm), sueño (horas) y peso (kg) en la misma tabla, y tiene un umbral con significado: MASE < 1 = mejor que repetir el último valor. RMSE se reporta también, pero no es comparable entre métricas.

**P12. ¿Por qué validación temporal y no k-fold?**
Porque en series temporales k-fold aleatorio entrena con el futuro para predecir el pasado. Rolling-origin ajusta solo con lo anterior a cada origen y pronostica hacia adelante, como en producción.

**P13. ¿Por qué Theil-Sen si ya tienen OLS?**
Porque un registro erróneo (una noche de 12 horas, un pesaje mal cargado) tuerce a OLS y no a Theil-Sen, que usa la mediana de las pendientes de todos los pares. Hay un test que lo demuestra con un outlier de +50.

**P14. ¿Cómo eligen los parámetros de Holt?**
Búsqueda en grilla de α, β* ∈ [0.05, 0.95] y φ ∈ [0.80, 0.98] minimizando la suma de errores a un paso: eso es entrenar el modelo. La amortiguación φ hace que el pronóstico a 30 días quede acotado, que es lo fisiológicamente razonable.

**P15. ¿Cómo detectan los cambios sostenidos?**
Con CUSUM y EWMA, cartas de control clásicas (Page 1954, Roberts 1959). Aprendimos dos cosas evaluándolas: la línea base tiene que ser auto-iniciada (aprender con todas las observaciones hasta la primera alarma, Hawkins 1987) porque con 14 días de base las falsas alarmas se disparaban, y hay que winsorizar a ±3σ para que un outlier aislado no dispare la carta. Resultado: 4 de 4 cambios detectados, 4.5 días de retraso medio.

**P16. ¿Qué tan preciso es el pronóstico?**
Depende del ruido de la métrica. En frecuencia cardíaca sintética con σ = 3 bpm el MAE a 7 días ronda 2.5 bpm: cerca del piso irreducible, porque el ruido diario no se puede predecir, solo el nivel y la tendencia. Por eso reportamos intervalos y no un número seco.

**P17. ¿Cuál es el aporte original?**
La integración: selección automática de modelo por usuario y por métrica contra benchmarks, índice con atribución exacta por factor y fuentes, cartas de control auto-iniciadas, y una arquitectura donde el LLM consume el motor. Y la validación externa del índice sobre datos poblacionales reales, que muestra que un índice de literatura bien construido rinde como un modelo entrenado. Todo implementado desde cero, con 70 tests y una evaluación reproducible.

**P18. ¿Sobreajuste?**
Todas las métricas reportadas son fuera de muestra. En NHANES hay 5.043 observaciones para 8 parámetros; en UCI la relación observaciones/parámetros es 297/19 ≈ 16, hay una penalización ridge pequeña, y k-NN sirve de contraste. En el pronóstico, la selección por backtesting penaliza a los modelos que sobreajustan: Holt-Winters, el más flexible, es el que peor MASE medio tiene.

**P19. ¿Por qué el k-NN tiene log-loss tan alto (0.96) si su AUC es 0.88?**
Porque con k = 7 sus "probabilidades" son fracciones gruesas (0, 1/7, …, 1) y cuando se equivoca lo hace con confianza total, lo que log-loss castiga. La logística está calibrada (Fig. 5): sus probabilidades se pueden interpretar como tales.

**P20. ¿Privacidad y ética?**
Identidad anónima (UUID en el dispositivo), perfil opcional, disclaimer médico obligatorio, ningún diagnóstico: las alertas se enuncian como cambios ("subió ~8 bpm de forma sostenida"), no como enfermedades, y la app recomienda consultar al médico.

**P21. ¿Cómo se reproduce todo?**
Sección 7. Semillas fijas: la misma corrida da el mismo resultado.

**P22. ¿Qué harían con más tiempo?**
Un dataset real de wearables para evaluar el pronóstico; validación externa y recalibración en población colombiana; un diseño longitudinal para predicción prospectiva; aplicar los ponderadores muestrales de NHANES; reincorporar presión arterial para poder implementar Framingham no-lab; modelos jerárquicos que compartan información entre usuarios (partial pooling); caché del informe.

## 6. Guion de la demo en vivo (≈ 8 minutos)

1. **Tests (30 s).** `npm run test:ml` → 70 tests verdes. "Cada fórmula tiene un test con respuesta conocida."
2. **Evaluación de pronóstico (1 min).** `npm run evaluar` → tabla por modelo; señalar MASE < 1 y la columna de cobertura IC 80 %.
3. **Entrenamiento supervisado (1 min).** `npm run entrenar:nhanes` (≈ 50 s: once modelos × 50 particiones, bootstrap y coeficientes) o `npm run entrenar` (UCI, 0.3 s); luego `python3 scripts/verificar-logistica.py docs/entrenamiento-nhanes.json` → "coinciden con numpy".
4. **La app (4 min).** Con el usuario demo (`npm run seed:demo -- --uid <pulso_uid> --limpiar`):
   - `/dashboard`: gráfica con pronóstico y bandas; abrir la tabla de backtesting ("el modelo se eligió por esto"); tendencia; alerta en la tarjeta de estrés.
   - `/score`: índice, riesgo relativo, contexto, proyección "no estimada por la IA", cambios detectados, desglose con fuentes (abrir una), "Cómo se calcula".
   - Botón de análisis IA: mostrar que redacta sobre esos números (o, sin key, que falla de forma controlada y los números siguen).
5. **Figuras (1 min).** AUC de todos los modelos (Fig. 8) y pesos del índice (Fig. 11) para cerrar con el experimento real.

## 7. Cómo reproducir cada afirmación

```bash
npm run test:ml                     # 70 tests: motor + supervisado + NHANES
npm run evaluar                     # cohorte sintética → docs/evaluacion-sintetica.txt
npm run nhanes:descargar            # 7 archivos .xpt del CDC (no se versionan)
npm run nhanes:muestra              # → data/nhanes-2021-2023/muestra-analitica.csv (versionado)
npm run entrenar:nhanes -- --json docs/entrenamiento-nhanes.json   # NHANES → 11 modelos, bootstrap, calibración
npm run entrenar -- --json docs/entrenamiento-uci.json   # UCI → validación cruzada + coeficientes
python3 scripts/verificar-logistica.py docs/entrenamiento-nhanes.json   # numpy vs TypeScript (o el JSON de UCI)
npm run figuras                     # docs/figuras/fig1…fig11 (png + svg)
npm run seed:demo -- --uid <pulso_uid> --limpiar          # usuario demo en la base
```

## 8. Limitaciones que conviene decir antes de que las pregunten

- El índice no es una escala clínica ni estima probabilidad absoluta de eventos.
- NHANES es transversal (antecedente, no incidencia), con desenlace autorreportado, PHQ-9 como aproximación al estrés, sin ponderadores muestrales y de población estadounidense.
- La evaluación de pronóstico es sintética; falta un dataset real de series diarias.
- El dataset UCI tiene 297 pacientes: los intervalos de confianza de los coeficientes son anchos y la cohorte tiene sesgo de derivación.
- `thalach` (FC máxima en esfuerzo) no es la FC en reposo que registra Pulso; la ablación "solo lo que Pulso captura" es una aproximación.
- Las cartas de control no modelan la estacionalidad semanal.
- Los intervalos de Theil-Sen reutilizan la fórmula de OLS (aproximación declarada).
- No hay caché: el informe se recalcula en cada carga (~100–300 ms).

## 9. Glosario rápido

- **Backtesting rolling-origin**: validación cruzada para series temporales; se pronostica hacia adelante desde orígenes sucesivos.
- **MASE**: error absoluto medio escalado por el del naïve; < 1 = mejor que el naïve.
- **Intervalo de predicción**: rango que debería contener el valor futuro con una probabilidad dada (80 %, 95 %).
- **Cobertura empírica**: fracción de valores reales que cayeron dentro del intervalo; mide la calibración.
- **IRLS**: mínimos cuadrados iterativamente reponderados; es Newton-Raphson para la regresión logística.
- **AUC-ROC**: probabilidad de que el modelo ordene un enfermo por encima de un sano; 0.5 azar, 1 perfecto.
- **Validación cruzada estratificada**: particiones que conservan la proporción de positivos.
- **Odds ratio**: cuánto multiplica una variable las chances del evento; IC 95 % que no incluye 1 = significativo.
- **CUSUM / EWMA**: cartas de control que acumulan o suavizan desvíos respecto de una línea base para detectar cambios sostenidos.
- **Winsorización**: recortar valores extremos a un límite (±3σ) para que un outlier no domine.
- **Riesgo relativo (RR)**: razón entre el riesgo con el factor y sin él; el índice suma logaritmos de RR.
