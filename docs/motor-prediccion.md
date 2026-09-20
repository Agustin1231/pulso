# Motor de predicción e inferencia de Pulso

> Capítulo técnico. Código en `src/lib/ml/`, tests en `tests/ml/`, evaluación reproducible con `npm run evaluar`.
> Resultados de la última corrida: [`docs/evaluacion-sintetica.txt`](./evaluacion-sintetica.txt) y [`docs/evaluacion-sintetica.json`](./evaluacion-sintetica.json).

## 1. Por qué existe

Hasta esta versión, todo lo "inteligente" de Pulso eran llamadas a un modelo de lenguaje: ocho rutas de API que arman un prompt con las últimas métricas y le piden a Claude que redacte un análisis, una receta o una rutina. El único cálculo propio era el score de riesgo: una suma ponderada de tres factores con multiplicadores fijos (`normal = 1.0`, `atención = 0.55`, `riesgo = 0.15`), calculada en el cliente sobre **el último valor** de cada métrica. El historial de 30 días que la base ya devolvía solo servía para dibujar una línea. La "proyección" del score ("si mejorás X, tu score podría subir Y puntos en Z semanas") se la pedía literalmente al modelo de lenguaje: no la respaldaba ningún cálculo.

El motor invierte esa relación. Toma la serie temporal de cada métrica del usuario, ajusta modelos estadísticos, **los compara contra benchmarks por backtesting**, produce pronósticos con intervalos de predicción, calcula un índice de riesgo con coeficientes tomados de la literatura y detecta cambios de régimen con cartas de control. El modelo de lenguaje pasa a ser un **consumidor** del motor: recibe el informe con los números ya calculados y su procedencia, y redacta.

## 2. Qué es y qué no es

**No es un clasificador supervisado de riesgo cardiovascular.** No existe *ground truth*: nadie registra en Pulso "tuve un evento cardíaco". Sin etiquetas de resultado no hay nada que entrenar, y afirmar lo contrario sería sobrevender. Lo que sí es defendible y está implementado:

1. **Pronóstico de series temporales** por métrica y por usuario, con modelos ajustados sobre el propio historial y validados contra benchmarks canónicos.
2. **Índice de riesgo paramétrico**: un modelo log-lineal de riesgo relativo cuyos coeficientes salen de meta-análisis publicados. No se ajusta nada; se cita. No es una escala clínica validada (Framingham, SCORE) ni estima probabilidad absoluta de eventos.
3. **Detección estadística de cambios de régimen** (CUSUM y EWMA) sobre una línea base personal.

Los tres están implementados desde cero en TypeScript, sin dependencias: cada fórmula es auditable y se puede defender línea por línea.

## 3. Arquitectura

```
src/lib/ml/
  index.ts                 generarInforme(entrada) → Informe   (única API pública)
  tipos.ts                 contratos: Observacion, SerieDiaria, Prediccion, Informe, Alerta…
  estadistica.ts           media, mediana, sd, cuantiles, inversa normal, cuantil t, PRNG
  series.ts                grilla diaria, huecos, interpolación acotada, nivel robusto
  features.ts              tendencia clasificada, z-score personal, adherencia, deltas
  modelos/
    base.ts                interfaz Modelo/Ajuste y armado de intervalos
    naive.ts               naïve · naïve estacional (m=7) · media móvil · drift   ← benchmarks
    lineal.ts              OLS + intervalo de predicción + significancia de la pendiente
    robusta.ts             Theil-Sen
    holt.ts                Holt con tendencia amortiguada (α, β*, φ por grilla)
    holt-winters.ts        Holt-Winters aditivo, período 7
    registro.ts            candidatos en orden de complejidad
  evaluacion/
    metricas.ts            MAE, RMSE, MAPE, MASE, cobertura empírica de intervalos
    backtest.ts            rolling-origin con ventana expansiva
    seleccion.ts           corre el backtesting a todos los candidatos y elige por MASE
  riesgo/
    factores.ts            funciones de riesgo continuas por factor, con fuente
    indice.ts              L = Σ logRR, score, atribución exacta por factor, contexto
    proyeccion.ts          score a 30 días alimentado por los pronósticos
  anomalias/
    base.ts                línea base auto-iniciada, winsorización, severidad, consolidación
    cusum.ts               CUSUM tabular
    ewma.ts                carta EWMA
  sintetico.ts             cohorte sintética con verdad conocida
  resumen.ts               resumen textual del informe para los prompts del LLM
  supervisado/
    logistica.ts           regresión logística por IRLS, desde cero, con errores estándar
    knn.ts                 k vecinos más cercanos (comparador)
    metricas.ts            AUC, accuracy, F1, log-loss, Brier, curva ROC, calibración
    validacion.ts          validación cruzada estratificada reproducible
    uci.ts                 carga y codificación del dataset UCI Heart Disease
    algebra.ts             resolver e invertir sistemas chicos (Gauss con pivoteo)
src/lib/db/informe.ts      único punto donde el motor toca la base (server action)
data/uci-heart-disease/    dataset público (CC BY 4.0) para el experimento supervisado
tests/ml/*.test.ts         63 tests, `node --test`
scripts/evaluar.ts         evaluación completa sobre la cohorte sintética
scripts/entrenar.ts        experimento supervisado (validación cruzada, coeficientes)
scripts/verificar-logistica.py  reimplementación independiente en numpy para verificar
scripts/figuras.py         figuras del informe (matplotlib) a partir de los JSON
scripts/seed-demo.ts       usuario de demostración con datos sintéticos en la base
docs/sustentacion.md       guía para la defensa: preguntas del jurado, demo, glosario
```

Reglas de diseño:

- **El motor es puro.** `src/lib/ml/` no importa la base, React, Next ni el alias `@/`. Se compila con `tsc -p tsconfig.ml.json` a CommonJS y corre en Node sin Next, que es lo que permite testearlo y evaluarlo en segundos.
- **Toda salida trae incertidumbre y procedencia.** Cada pronóstico lleva intervalos del 80 % y 95 %; cada métrica del informe dice qué modelo la pronosticó, con qué MASE y con qué confianza.
- **Los benchmarks compiten en igualdad.** Naïve, naïve estacional, media móvil y drift implementan la misma interfaz que los demás modelos y entran en la selección. Que un modelo "aprenda" no le da ventaja: tiene que ganar en backtesting.
- **Con pocos datos, degradar explícitamente.** Flags `confianza: "baja"`, `insuficiente`, factores excluidos, frases de limitación listas para mostrar o para el prompt. Nunca inventar.

Flujo de `generarInforme`, por métrica: serie diaria → tendencia (OLS) → selección de modelo por backtesting → pronóstico a 30 días desde hoy → alertas (CUSUM + EWMA). Con los niveles actuales se calcula el índice; con los pronósticos, su proyección.

## 4. Preparación de las series

- **Grilla diaria continua** desde la primera observación hasta hoy (`construirSerie`). Los días sin registro quedan como `null`: la app no obliga a registrar todos los días, y el motor trabaja con eso en vez de suponer regularidad. Si hubiera dos registros el mismo día se queda el último (el upsert diario de la app ya lo impide; es defensa).
- **Día local.** Las fechas con hora (`created_at`, en UTC) se convierten al día en la zona horaria del proceso, el mismo criterio con que la app decide "hoy" al guardar.
- **Modelos sobre `(t, y)` con huecos.** OLS, Theil-Sen y los benchmarks operan sobre los días observados con `t` = índice en la grilla; no necesitan imputación.
- **Interpolación acotada solo para los modelos recursivos.** Holt y Holt-Winters exigen grilla regular: los huecos interiores de hasta 3 días se interpolan linealmente y se toma el último tramo contiguo. Si más del 40 % de los puntos serían imputados, esos modelos no compiten para esa serie (se ve en la evaluación: en los perfiles "disperso" aparecen solo seis modelos).
- **Nivel actual robusto**: mediana de los últimos 7 días (último valor si hay menos de 3). Es lo que entra al índice de riesgo, para que una noche rara no lo mueva.

## 5. Modelos de pronóstico

Interfaz común: `ajustar(puntos) → { predecir(h), residuos, sigma, parametros }`. Fórmulas de media e intervalos (Hyndman & Athanasopoulos, *FPP3*):

| Modelo | Media a h pasos | σ_h | Mínimo n |
|---|---|---|---|
| Naïve | y_n | σ·√h | 2 |
| Media móvil (k = 7) | media de las últimas k | σ·√(1 + 1/k) | 3 |
| Drift | y_n + h·(y_n − y_1)/(t_n − t_1) | σ·√(h·(1 + h/(n−1))) | 3 |
| Naïve estacional (m = 7) | y del mismo día de la semana anterior | σ·√(⌊(h−1)/m⌋ + 1) | 8 |
| OLS | a + b·t | s·√(1 + 1/n + (t−t̄)²/Sxx), cuantil t con n−2 gl | 5 |
| Theil-Sen | mediana de pendientes por pares | como OLS con sus propios residuos (aproximación declarada) | 5 |
| Holt amortiguado | ℓ + (φ + … + φʰ)·b | σ·√(1 + Σ_(j<h) (α + α·β*·φ_j)²) | 10 |
| Holt-Winters aditivo | ℓ + h·b + s_(h−m(k+1)) | σ·√(1 + Σ_(j<h) (α + α·β*·j + γ·𝟙[j mod m = 0])²) | 21 |

Detalles que importan:

- **Naïve con observaciones irregulares**: la varianza de una caminata aleatoria crece con los días transcurridos, así que cada diferencia y_i − y_(i−1) se normaliza por √Δt antes de estimar σ.
- **OLS** reporta además `pendienteSemanal`, R² y si la pendiente es significativa (|b / SE(b)| > t_(0.975, n−2)). Con ajuste perfecto (s = 0) el estadístico se acota a 10⁶ para sobrevivir a JSON.
- **Theil-Sen** (Theil 1950; Sen 1968): la mediana de las pendientes de todos los pares. Un outlier mueve una fracción chica de los pares y no toca la mediana; OLS se tuerce con un solo día raro (una noche de 12 h, un pesaje mal cargado). Está testeado exactamente así.
- **Holt** (Holt 1957) con amortiguación (Gardner & McKenzie 1985): α, β* ∈ [0.05, 0.95] y φ ∈ {0.80, 0.85, 0.90, 0.95, 0.98} por búsqueda en grilla minimizando la suma de errores a un paso. Con φ < 1 el pronóstico a 30 días queda acotado, que es lo razonable en fisiología. El estado inicial sale de un OLS sobre los primeros 14 puntos: con ruido, el clásico b₀ = y₁ − y₀ arranca con una pendiente espuria del orden de √2·σ.
- **Holt-Winters aditivo** con m = 7 captura patrones como "duermo más los fines de semana". Región admisible γ ≤ 1 − α.
- **Cuantiles**: normal por el algoritmo de Acklam (error relativo < 1.2·10⁻⁹); t de Student por la expansión de Cornish-Fisher (Abramowitz & Stegun 26.7.5), error < 1 % para gl ≥ 3.

## 6. Evaluación y selección

- **Backtesting rolling-origin con ventana expansiva** (*FPP3* §5.10). Para cada origen `o` (un día de la grilla) se ajusta con todo lo observado antes de `o`, se pronostican los 7 días siguientes y se puntúan **solo los días con registro real**. Nunca k-fold aleatorio: mezclaría futuro con pasado. Primer origen con ≥ 14 observaciones de entrenamiento.
- **Métricas**: MAE, RMSE, MAPE (ignorando ceros) y **MASE** (Hyndman & Koehler 2006): error absoluto dividido por el error absoluto medio del naïve a un paso dentro del entrenamiento de ese origen. MASE < 1 significa "mejor que repetir el último valor" y es comparable entre métricas con unidades distintas. También la **cobertura empírica** de los intervalos del 80 % y 95 %: un intervalo honesto cubre ≈ 80 % de los valores reales.
- **Selección**: gana el menor MASE entre los candidatos con al menos 5 pronósticos; ante empate, el más simple (orden del registro). Con menos de 21 registros no se compara: se devuelve la media móvil (o el naïve) con `confianza: "baja"` y la razón en texto. Confianza `alta` con n ≥ 45 y MASE < 0.9; `media` con n ≥ 21.
- El informe incluye la tabla completa del backtesting de cada métrica: la UI puede mostrar por qué se eligió cada modelo.

## 7. Índice de riesgo

### Forma funcional

Para cada factor modificable *i* con valor x_i, `logRR_i(x_i) ≥ 0` es el logaritmo del riesgo relativo respecto de un rango de referencia (vale 0 adentro) y es **continuo**: dormir 5 h no "salta" a otra categoría, pesa proporcionalmente más que dormir 6 h.

```
L      = Σ_i logRR_i(x_i)          (solo los factores con datos)
RR     = e^L                        riesgo relativo combinado vs. referencia
L_max  = Σ_i logRR_i(peor_i)        (los mismos factores)
score  = 100 · (1 − L / L_max)
```

El supuesto multiplicativo (los riesgos relativos se multiplican) es el estándar de los modelos de Cox y log-lineales. Como el score es lineal en L, **los puntos que pierde cada factor son exactos y aditivos**: `100 · logRR_i / L_max`. No hay que explicar interacciones que no existen. Umbrales de etiqueta iguales a los de la app (85/70/55/40) para no romper la UI.

### Factores modificables (entran al score)

| Factor | Forma | Referencia | Magnitud y fuente | Evidencia |
|---|---|---|---|---|
| FC en reposo | U asimétrica | 50–70 bpm | +ln(1.09) por cada +10 bpm sobre 70, tope 120 (Zhang et al. 2016, CMAJ, meta-análisis de 46 cohortes; Aune et al. 2017). Bajo 50: ln(1.10)/10 bpm | alta (sobre 70) / baja (bajo 50) |
| Sueño | U | 7–8 h | lineal en el déficit/exceso, calibrada a ln(1.48) en 5 h y ln(1.38) en 10 h (Cappuccio et al. 2011, Eur Heart J; dosis-respuesta de Yin et al. 2017, JAHA); topes 3 y 12 h | alta |
| Estrés (1–10) | monótona | ≤ 3 | ln(1.27) en 10 (Richardson et al. 2012, Am J Cardiol) | **baja**: escala autoreportada no validada contra ese estudio |
| IMC | J | 18.5–25 | +ln(1.39) por cada +5 kg/m² sobre 25, tope 40 (Global BMI Mortality Collaboration 2016, Lancet); bajo 18.5: ln(1.3)/3.5 unidades | alta (sobre 25) / baja (bajo 18.5) |
| Tabaquismo | binario | no fuma | ln(2.5) (INTERHEART, Yusuf et al. 2004, Lancet: OR 2.87; meta-análisis ≈ 2–3) | alta |

El estado categórico (normal / atención / riesgo) que acompaña a cada factor reutiliza los umbrales de `metricas-config.ts`, así la UI dice lo mismo en todos lados.

### Contexto no modificable (NO entra al score)

Edad y sexo se reportan aparte como **multiplicador de contexto**: `e^(logRR_edad + logRR_sexo)`, con el riesgo duplicándose por década a partir de los 40 (regla de las tablas de Framingham y SCORE) y ×1.5 para sexo masculino (constante conservadora; "otro" o desconocido ⇒ 1). Decisión de diseño: el score debe reflejar lo que la persona puede cambiar. Alguien de 70 años con hábitos perfectos no debe salir "en riesgo" por algo que no controla; el informe le dice "tu contexto multiplica el riesgo de referencia por X".

La adherencia a hábitos **no** entra al índice: no hay un β con fuente para ella. Se reporta como covariable descriptiva.

### Faltantes

Un factor sin datos se excluye de L y de L_max (la misma normalización que hacía el score anterior) y se reporta la cobertura. Con menos de dos factores el índice es `insuficiente`. Sin altura en el perfil el peso no se convierte a IMC y no entra; sin respuesta sobre tabaquismo, tampoco.

### Ejemplo numérico

Persona de 52 años, sexo masculino, FC en reposo 85 bpm, 6 h de sueño, estrés 5/10, IMC 27.5, no fumadora:

| Factor | logRR | Puntos perdidos / máximo |
|---|---|---|
| FC 85 | ln(1.09)·1.5 = 0.129 | 3.85 / 12.83 |
| Sueño 6 h | ln(1.48)/2 = 0.196 | 5.84 / 23.35 |
| Estrés 5 | ln(1.27)·2/7 = 0.068 | 2.03 / 7.12 |
| IMC 27.5 | ln(1.39)·0.5 = 0.165 | 4.90 / 29.42 |
| Tabaquismo | 0 | 0 / 27.29 |

L = 0.558 → RR = 1.75 respecto de la referencia; L_max = 3.358; **score = 83 ("Muy bueno")**, 16.6 puntos perdidos en total. Contexto: edad 52 ⇒ ×2.3, sexo masculino ⇒ ×1.5, multiplicador 3.45. (Verificado contra `calcularIndice`.)

### Proyección

`proyectarIndice` evalúa el mismo índice sobre el pronóstico a 30 días de cada métrica (la mediana del modelo elegido). Como las funciones son en U, el intervalo del score se obtiene evaluando todas las combinaciones de extremos del IC 80 % (2^k con k ≤ 4: 16 evaluaciones). La proyección deja de ser texto del modelo de lenguaje.

## 8. Detección de cambios de régimen

Dos cartas de control clásicas sobre una línea base personal, ambas con `k`, `h`, `λ` y `L` en los valores estándar de Montgomery (*Introduction to Statistical Quality Control*):

- **CUSUM tabular** (Page 1954): S⁺_t = max(0, S⁺_(t−1) + z_t − k), S⁻_t = max(0, S⁻_(t−1) − z_t − k), con k = 0.5 y alarma cuando supera h = 5. Detecta desvíos chicos pero sostenidos ("la FC subió 8 bpm y se quedó ahí") que un umbral sobre valores individuales nunca ve. El día del cambio se estima como el último en que el acumulado estaba en cero.
- **EWMA** (Roberts 1959): Z_t = λ·y_t + (1−λ)·Z_(t−1), límites μ₀ ± L·σ₀·√(λ/(2−λ)·(1−(1−λ)^(2t))), λ = 0.2, L = 3.

Tres decisiones que salieron de la evaluación, no del manual:

1. **Línea base auto-iniciada** (Hawkins 1987). Con 14 observaciones el σ̂ tiene ±20 % de error y eso desploma el ARL en control: la primera versión daba 22 alarmas en 12 series estables. La base arranca con 14 observaciones y sigue absorbiendo **todas** las siguientes (media y varianza corrientes por Welford) hasta la primera alarma; después se congela, y el desvío se sigue confirmando contra el régimen anterior. Absorber solo las observaciones "tranquilas" (S = 0) parecía razonable pero sesga σ̂ hacia abajo; se descartó por eso.
2. **Winsorización de z a ±3** (Hawkins & Olwell 1998): un outlier aislado de 5σ no puede cargar la carta de un saque.
3. **Consolidación**: un desvío que persiste vuelve a disparar la carta cada pocos días. Las alarmas consecutivas del mismo método y dirección se funden en una sola con `desde` (inicio estimado), `detectadaEn` (primera detección) y `hasta` (última confirmación). El informe considera "reciente" una alerta cuya última confirmación tiene ≤ 14 días.

La severidad combina la magnitud en σ con la dirección clínicamente adversa por métrica (FC ↑, sueño ↓, estrés ↑, peso ↑): una baja sostenida de FC en reposo es informativa, no una alerta. Con menos de 15 registros no se emiten alertas. Un σ mínimo por métrica (1.5 bpm, 0.25 h, 0.5 puntos, 0.3 kg) evita alarmas por variaciones triviales en series casi constantes.

## 9. Cohorte sintética y resultados

No hay historial real con el que evaluar, y aunque lo hubiera no tendría "verdad" contra la cual medir. La cohorte se genera con parámetros **conocidos** y semilla fija: para cada métrica (FC, sueño, estrés, peso) siete perfiles de 90 días con rangos fisiológicos y 15 % de días sin registro:

| Perfil | Qué tiene |
|---|---|
| estable | solo ruido |
| tendencia_suave / tendencia_fuerte | deriva lineal (p. ej. FC +0.05 / +0.15 bpm por día) |
| estacional | patrón semanal (sueño +1.2 h los domingos, +0.9 los sábados) |
| cambio_regimen | salto sostenido el día 45 (FC +8, sueño −1.2, estrés +3, peso +2.5) |
| ruidoso | σ doble y 5 % de outliers gruesos |
| disperso | 40 % de días sin registro y deriva suave |

`npm run evaluar` corre, por serie, la selección completa (backtesting de los 8 modelos, horizonte 7), mide cuánto se acercan OLS/Theil-Sen/Holt a la pendiente real y Holt-Winters a la amplitud semanal real, y el retraso con que CUSUM y EWMA detectan el cambio de régimen. Resumen de la última corrida (semilla 42):

```
━━ Resumen por modelo (sobre las series con backtesting)
┌────────────────────────────────────┬────────┬────────────┬──────────────┬────────────┬──────┐
│ Modelo                             │ series │ MASE medio │ MASE mediana │ IC80 medio │ ganó │
├────────────────────────────────────┼────────┼────────────┼──────────────┼────────────┼──────┤
│ Naïve (benchmark)                  │     28 │       1.11 │         1.10 │       93 % │    0 │
│ Media móvil (7) (benchmark)        │     28 │       0.88 │         0.87 │       81 % │    8 │
│ Drift (benchmark)                  │     28 │       1.17 │         1.13 │       93 % │    0 │
│ Naïve estacional (7 d) (benchmark) │     28 │       1.11 │         1.07 │       78 % │    0 │
│ Regresión lineal (OLS)             │     28 │       0.88 │         0.86 │       78 % │    8 │
│ Theil-Sen                          │     28 │       0.88 │         0.86 │       78 % │    6 │
│ Holt amortiguado                   │     27 │       0.90 │         0.87 │       74 % │    5 │
│ Holt-Winters (7 d)                 │     27 │       1.04 │         1.01 │       80 % │    1 │
└────────────────────────────────────┴────────┴────────────┴──────────────┴────────────┴──────┘

Modelo seleccionado con MASE < 1 (le gana al naïve): 23/28
Modelo seleccionado que no es un benchmark: 20/28
Cambios de régimen detectados: CUSUM 4/4 (retraso medio 4.5 d) · EWMA 4/4 (retraso medio 5.8 d)
Falsas alarmas en perfiles estables (estable/ruidoso): 5 en 8 series
Alertas en perfiles estacionales: 0 en 4 series (las cartas no modelan el patrón semanal: un fin de semana de +2σ puede dispararlas)
```

Lectura:

- **El modelo elegido le gana al naïve en 23 de 28 series** y en 20 de 28 no es un benchmark. Las cinco restantes son series donde el ruido domina y un benchmark es, honestamente, lo mejor que hay: el motor lo reconoce en vez de forzar un modelo "inteligente".
- **Las coberturas empíricas del IC 80 % rondan el 74–81 %** en los modelos con tendencia (calibración correcta); el naïve y el drift sobrecubren (93 %), es decir, sus intervalos son demasiado anchos: por eso pierden.
- **Recuperación de parámetros**: en las series con tendencia, OLS y Theil-Sen estiman la pendiente real con error del orden del ruido; Holt-Winters recupera la amplitud semanal real (p. ej. 1.60 h → 1.76 h en sueño). El detalle por serie está abajo.
- **Detección**: los cuatro cambios de régimen se detectan, con retraso medio de 4.5 días (CUSUM) y 5.8 (EWMA). Falsas alarmas: 5 en 8 series estables/ruidosas de 90 días (0.6 por serie; el perfil "ruidoso" incluye outliers de ±5σ a propósito). Las series con tendencia también disparan alertas: es correcto, una deriva sostenida *es* un cambio de régimen.

Resultados por serie:

| Métrica | Perfil | n (cobertura) | Modelo elegido | MASE | Recuperación de la verdad / detección |
|---|---|---|---|---|---|
| frecuencia_cardiaca | estable | 76 (84 %) | Media móvil (7) | 0.86 | alertas: CUSUM 0 · EWMA 0 |
| frecuencia_cardiaca | tendencia_suave | 76 (84 %) | Regresión lineal (OLS) | 0.85 | pendiente/día real 0.050 → OLS 0.077 · Theil-Sen 0.079 · Holt 0.121; alertas: CUSUM 2 · EWMA 1 |
| frecuencia_cardiaca | tendencia_fuerte | 78 (87 %) | Regresión lineal (OLS) | 0.76 | pendiente/día real 0.150 → OLS 0.160 · Theil-Sen 0.167 · Holt 0.176; alertas: CUSUM 1 · EWMA 1 |
| frecuencia_cardiaca | estacional | 78 (87 %) | Media móvil (7) | 0.88 | amplitud semanal real 4.00 → Holt-Winters 4.62; alertas: CUSUM 0 · EWMA 0 |
| frecuencia_cardiaca | cambio_regimen | 78 (87 %) | Media móvil (7) | 0.80 | cambio de régimen el 2026-07-16 → CUSUM +5 d · EWMA +5 d |
| frecuencia_cardiaca | ruidoso | 79 (88 %) | Holt amortiguado | 0.70 | alertas: CUSUM 0 · EWMA 0 |
| frecuencia_cardiaca | disperso | 47 (52 %) | Regresión lineal (OLS) | 1.00 | pendiente/día real 0.050 → OLS 0.076 · Theil-Sen 0.070 · Holt -0.005; alertas: CUSUM 1 · EWMA 1 |
| horas_sueno | estable | 74 (82 %) | Media móvil (7) | 1.09 | alertas: CUSUM 1 · EWMA 0 |
| horas_sueno | tendencia_suave | 72 (80 %) | Regresión lineal (OLS) | 0.71 | pendiente/día real -0.010 → OLS -0.007 · Theil-Sen -0.006 · Holt 0.005; alertas: CUSUM 1 · EWMA 0 |
| horas_sueno | tendencia_fuerte | 77 (86 %) | Holt amortiguado | 0.75 | pendiente/día real -0.030 → OLS -0.029 · Theil-Sen -0.030 · Holt -0.028; alertas: CUSUM 2 · EWMA 1 |
| horas_sueno | estacional | 75 (83 %) | Holt-Winters (7 d) | 0.61 | amplitud semanal real 1.60 → Holt-Winters 1.76; alertas: CUSUM 0 · EWMA 0 |
| horas_sueno | cambio_regimen | 73 (81 %) | Holt amortiguado | 0.75 | cambio de régimen el 2026-07-16 → CUSUM +9 d · EWMA +12 d |
| horas_sueno | ruidoso | 74 (82 %) | Regresión lineal (OLS) | 1.11 | alertas: CUSUM 2 · EWMA 0 |
| horas_sueno | disperso | 54 (60 %) | Media móvil (7) | 0.70 | pendiente/día real -0.010 → OLS -0.010 · Theil-Sen -0.008 · Holt -0.006; alertas: CUSUM 1 · EWMA 0 |
| nivel_estres | estable | 72 (80 %) | Theil-Sen | 0.75 | alertas: CUSUM 0 · EWMA 0 |
| nivel_estres | tendencia_suave | 80 (89 %) | Theil-Sen | 0.68 | pendiente/día real 0.020 → OLS 0.016 · Theil-Sen 0.000 · Holt 0.019; alertas: CUSUM 2 · EWMA 2 |
| nivel_estres | tendencia_fuerte | 72 (80 %) | Regresión lineal (OLS) | 1.01 | pendiente/día real 0.050 → OLS 0.048 · Theil-Sen 0.048 · Holt 0.030; alertas: CUSUM 2 · EWMA 1 |
| nivel_estres | estacional | 75 (83 %) | Theil-Sen | 0.75 | amplitud semanal real 2.30 → Holt-Winters 2.23; alertas: CUSUM 0 · EWMA 0 |
| nivel_estres | cambio_regimen | 72 (80 %) | Holt amortiguado | 1.04 | cambio de régimen el 2026-07-16 → CUSUM +2 d · EWMA +4 d |
| nivel_estres | ruidoso | 77 (86 %) | Theil-Sen | 0.87 | alertas: CUSUM 0 · EWMA 0 |
| nivel_estres | disperso | 49 (54 %) | Theil-Sen | 0.80 | pendiente/día real 0.020 → OLS 0.016 · Theil-Sen 0.000 · Holt 0.032; alertas: CUSUM 0 · EWMA 0 |
| peso | estable | 83 (92 %) | Media móvil (7) | 0.73 | alertas: CUSUM 1 · EWMA 1 |
| peso | tendencia_suave | 81 (90 %) | Theil-Sen | 0.80 | pendiente/día real -0.030 → OLS -0.031 · Theil-Sen -0.031 · Holt -0.021; alertas: CUSUM 1 · EWMA 1 |
| peso | tendencia_fuerte | 81 (90 %) | Regresión lineal (OLS) | 0.76 | pendiente/día real -0.080 → OLS -0.080 · Theil-Sen -0.080 · Holt -0.060; alertas: CUSUM 1 · EWMA 1 |
| peso | estacional | 76 (84 %) | Media móvil (7) | 0.80 | amplitud semanal real 0.40 → Holt-Winters 0.40; alertas: CUSUM 0 · EWMA 0 |
| peso | cambio_regimen | 79 (88 %) | Holt amortiguado | 1.01 | cambio de régimen el 2026-07-16 → CUSUM +2 d · EWMA +2 d |
| peso | ruidoso | 75 (83 %) | Media móvil (7) | 0.82 | alertas: CUSUM 0 · EWMA 0 |
| peso | disperso | 43 (48 %) | Regresión lineal (OLS) | 0.90 | pendiente/día real -0.030 → OLS -0.027 · Theil-Sen -0.026 · Holt —; alertas: CUSUM 2 · EWMA 1 |

## 9b. Experimento supervisado con datos reales: regresión logística entrenada desde cero

El pronóstico y el índice no tienen etiquetas con las que entrenar un clasificador. Para demostrar la
capacidad de **entrenar y validar** un modelo supervisado —y para poner a prueba, con datos, las
decisiones de diseño del índice— se usa el dataset público **UCI Heart Disease (Cleveland)**: 303
pacientes derivados a evaluación cardiológica, 13 variables clínicas y un diagnóstico de enfermedad
coronaria (`data/uci-heart-disease/README.md`; CC BY 4.0). Se descartan 6 filas con faltantes: n = 297,
137 positivos (46 %).

**Modelos, todos implementados en `src/lib/ml/supervisado/`:**

- *Regresión logística* ajustada por IRLS (Newton-Raphson) con una penalización ridge pequeña
  (λ = 0.01, intercepto sin penalizar) para garantizar la invertibilidad de la hessiana. Errores
  estándar a partir de la información observada (diagonal de H⁻¹). Las variables categóricas (tipo de
  dolor, ECG, pendiente del ST, talasemia) van one-hot dejando afuera la primera categoría; las
  numéricas se estandarizan con los estadísticos del entrenamiento de cada partición, nunca del test.
- *k-NN* (k = 7, distancia euclídea sobre variables estandarizadas): comparador no paramétrico.
- *Baseline* que predice la prevalencia.

**Protocolo:** validación cruzada estratificada de 5 particiones, repetida 10 veces con semillas
distintas (50 ajustes por modelo); se reportan media ± desvío. Curva ROC y diagrama de confiabilidad
sobre las predicciones fuera de muestra de la primera repetición.

**Tres conjuntos de variables**, para una ablación con significado para Pulso:

| Conjunto | Variables | AUC | Accuracy | F1 | log-loss | Brier |
|---|---|---|---|---|---|---|
| Baseline (prevalencia) | — | 0.500 ± 0.000 | 0.539 | 0.000 | 0.690 | 0.249 |
| Logística · solo lo que Pulso captura | edad, sexo, FC (máx.) | 0.785 ± 0.058 | 0.710 | 0.677 | 0.560 | 0.190 |
| Logística · clínico básico | + PA sistólica, colesterol, glucemia | 0.795 ± 0.056 | 0.710 | 0.672 | 0.549 | 0.185 |
| **Logística · completo** | 13 variables (18 columnas) | **0.904 ± 0.032** | **0.836** | **0.815** | **0.407** | **0.124** |
| k-NN · completo | 13 variables | 0.880 ± 0.042 | 0.809 | 0.789 | 0.962 | 0.139 |

Lectura:

- **AUC 0.90 con validación cruzada** es el desempeño de referencia publicado para modelos lineales en
  este dataset: la implementación desde cero está a la altura de las librerías estándar.
- **Verificación independiente:** `scripts/verificar-logistica.py` reimplementa IRLS en numpy sobre los
  mismos datos; los coeficientes y errores estándar coinciden con los del motor con diferencia máxima
  de 2·10⁻¹⁴.
- **La logística le gana a k-NN** (0.90 vs 0.88) y está calibrada (Fig. 5), mientras que k-NN tiene un
  log-loss alto porque sus probabilidades son fracciones gruesas: no hay evidencia de no linealidades que
  justifiquen un modelo más flexible con n = 297.
- **La ablación cuantifica una decisión de producto.** Con solo edad, sexo y frecuencia cardíaca el AUC
  es 0.79; las variables de ECG y ergometría aportan el resto. Es la razón, con números, por la que el
  índice de Pulso no pretende ser un clasificador clínico y por la que se documenta que sin presión
  arterial ni colesterol no se puede implementar una ecuación validada.

**Coeficientes aprendidos** (modelo «clínico básico» sobre los 297 pacientes; Fig. 6):

| Variable | OR | IC 95 % | por | p |
|---|---|---|---|---|
| Edad | 1.17 | 0.82 – 1.66 | +10 años | 0.32 (n.s.) |
| Sexo | 6.00 | 3.08 – 11.68 | hombre vs. mujer | < 0.001 |
| PA sistólica | 1.25 | 1.06 – 1.47 | +10 mm Hg | 0.007 |
| Colesterol | 1.07 | 1.01 – 1.13 | +10 mg/dl | 0.011 |
| Glucemia > 120 | 0.74 | 0.35 – 1.58 | sí vs. no | 0.37 (n.s.) |
| FC máxima | 0.63 | 0.54 – 0.73 | +10 bpm | < 0.001 |

- La **edad no es significativa** y el **sexo tiene OR 6**: son las marcas de una cohorte de derivación
  (quién llega a cardiología), no de la población general, donde el riesgo se duplica por década. Por
  eso el índice usa coeficientes de meta-análisis poblacionales y no estos: haberlos entrenado y poder
  mostrar por qué no se usan es un argumento más fuerte que no haberlo intentado.
- PA sistólica y colesterol salen con el signo y la magnitud esperados (≈ +25 % de odds por 10 mm Hg;
  ≈ +7 % por 10 mg/dl), y la FC máxima alcanzada es protectora, como corresponde a una medida de
  capacidad funcional.

Figuras: `figuras/fig4-roc-uci.png`, `figuras/fig5-calibracion-uci.png`, `figuras/fig6-odds-ratios-uci.png`.
Salida completa: `docs/entrenamiento-uci.txt` y `.json`. Reproducir: `npm run entrenar`.

## 9c. Figuras del informe

Generadas con `npm run figuras` (exporta datos del motor y dibuja con matplotlib; PNG a 300 dpi y SVG):

| Figura | Archivo | Qué muestra |
|---|---|---|
| 1 | `figuras/fig1-mase-por-modelo` | MASE medio por modelo en la cohorte sintética, benchmarks en gris |
| 2 | `figuras/fig2-pronostico-bandas` | Pronóstico a 30 días de la FC del usuario demo con intervalos 80/95 % |
| 3 | `figuras/fig3-cusum-deteccion` | Salto de +8 bpm el día 30 y el estadístico S⁺ que lo detecta 2 días después |
| 4 | `figuras/fig4-roc-uci` | Curvas ROC fuera de muestra de los cuatro modelos sobre UCI |
| 5 | `figuras/fig5-calibracion-uci` | Diagrama de confiabilidad de la logística completa |
| 6 | `figuras/fig6-odds-ratios-uci` | Odds ratios con IC 95 % del modelo clínico básico |
| 7 | `figuras/fig7-pendientes-recuperadas` | Pendiente estimada vs. real (OLS, Theil-Sen, Holt) en 12 series con tendencia |

## 10. Limitaciones y trabajo pendiente

- **El índice no es una escala clínica.** Los coeficientes vienen de la literatura pero la combinación, la calibración de las curvas entre los puntos citados y la normalización por L_max son decisiones propias. El factor estrés es el de evidencia más débil. Sin presión arterial ni colesterol no se puede implementar una ecuación validada (Framingham no-lab necesita PA sistólica); esa fue una decisión de producto explícita.
- **Evaluación sintética.** Demuestra que la implementación es correcta y cómo se comporta bajo patrones conocidos; no demuestra desempeño sobre usuarios reales. Un dataset público de wearables sería la segunda fuente natural.
- **El experimento supervisado usa una cohorte chica y sesgada.** n = 297 da intervalos de confianza anchos, y `thalach` (FC máxima en ergometría) no es la FC en reposo que registra Pulso: la ablación "solo lo que Pulso captura" es una aproximación, no una evaluación del índice.
- **Series cortas e irregulares.** Con menos de 21 registros no hay selección; con menos de 15, no hay alertas. El motor lo dice; no lo tapa.
- **Las cartas no modelan la estacionalidad semanal**: un fin de semana muy distinto puede disparar CUSUM. No ocurrió en la cohorte, pero es una limitación estructural conocida.
- **Intervalos de Theil-Sen**: reutilizan la fórmula de OLS; es una aproximación declarada y su cobertura empírica se mide en cada backtesting.
- **Sin caché.** `getInforme` recalcula el backtesting en cada carga de pantalla (~100–300 ms con 90 días). Es aceptable para el MVP; con más uso conviene cachear por uid y día.

## 11. Integración en la app

El motor entra a la app por un solo lugar, `getInforme(uid)` (`src/lib/db/informe.ts`): carga 90 días de métricas, el perfil y la adherencia, y devuelve el `Informe`. Tres consumidores:

| Consumidor | Qué usa del informe |
|---|---|
| `/score` (`score-client.tsx`) | `riesgo` (gauge, etiqueta, riesgo relativo, contexto, factores con puntos perdidos y fuente), `proyeccion` (score a 30 días con intervalo), alertas de todas las métricas, `limitaciones` en "Cómo se calcula". Incluye el formulario de perfil (`perfil-form.tsx`) que escribe en la tabla `perfil`. |
| `/dashboard` (`dashboard-client.tsx`) | Por métrica seleccionada: `pronostico` dibujado punteado con bandas 80/95 % (`grafica-metrica.tsx`), `tendencia`, `modelo` con su tabla de backtesting y `alertas` (`pronostico-info.tsx`). Las tarjetas marcan con un punto rojo la métrica con alerta de severidad atención o alta. |
| Rutas de IA (`/api/score-analisis`, `/api/analisis-metricas`, `/api/tips`) | Reciben solo `{ uid }`; el servidor calcula el informe y le pasa a Claude el texto de `resumirInforme()` (`src/lib/ml/resumen.ts`), que contiene todos los números con su procedencia (modelo, MASE, confianza, intervalos). Los prompts prohíben inventar cifras o proyecciones y exigen citar "sin datos" o "confianza baja" cuando el informe lo dice. |

El cambio arquitectónico es ese: antes el cliente mandaba cuatro valores y el modelo de lenguaje inventaba tendencias y proyecciones; ahora el cliente manda un identificador, el motor calcula y el modelo de lenguaje redacta. Ningún número de la app sale del LLM.

Para probar o presentar sin esperar 90 días de registros: `npm run seed:demo -- --uid <pulso_uid> --limpiar` carga un usuario sintético (tendencia leve en FC, estacionalidad semanal en sueño, salto de estrés el día 60, pérdida de peso lenta) con fechas que terminan hoy.

Capturas con ese usuario (Chromium headless, base local): [`capturas/dashboard.png`](./capturas/dashboard.png) (historial, marca de hoy, pronóstico punteado con bandas 80/95 %, tendencia, modelo elegido y tabla de backtesting), [`capturas/dashboard-movil.png`](./capturas/dashboard-movil.png), [`capturas/score.png`](./capturas/score.png) (índice 92, riesgo relativo ×1.31, contexto ×2.1, proyección 84 [70–95], tres cambios detectados —el salto de estrés del día 60 detectado 5 días después—, desglose con fuentes y "cómo se calcula") y [`capturas/score-ia-sin-key.png`](./capturas/score-ia-sin-key.png) (sin key de Anthropic el análisis IA falla de forma controlada; los números del motor siguen ahí).

## 12. Cómo correrlo

```bash
npm run test:ml      # compila el motor con tsconfig.ml.json y corre los 63 tests (node --test)
npm run entrenar     # experimento supervisado sobre UCI (validación cruzada, coeficientes)
python3 scripts/verificar-logistica.py   # verificación independiente con numpy
npm run figuras      # figuras del informe en docs/figuras/
npm run evaluar      # evaluación completa sobre la cohorte sintética
npm run evaluar -- --json docs/evaluacion-sintetica.json --horizonte 7 --semilla 42 --metrica horas_sueno
npm test             # test:fallback + test:ml
npm run seed:demo -- --uid <pulso_uid> --limpiar   # usuario demo en la base apuntada por DATABASE_URL
```

Desde la app, `getInforme(uid)` en `src/lib/db/informe.ts` carga 90 días de métricas, el perfil (`tabla perfil`) y la adherencia diaria, y devuelve el `Informe` serializable definido en `src/lib/ml/tipos.ts`.

## Referencias

- Hyndman, R. J. & Athanasopoulos, G. *Forecasting: Principles and Practice*, 3.ª ed. (benchmarks §5.2, intervalos §5.5, validación cruzada temporal §5.10, suavizado exponencial cap. 8).
- Hyndman, R. J. & Koehler, A. B. (2006). Another look at measures of forecast accuracy. *Int. J. Forecasting* 22(4).
- Holt, C. C. (1957). Forecasting seasonals and trends by exponentially weighted moving averages. Gardner, E. S. & McKenzie, E. (1985). Forecasting trends in time series. *Management Science* 31(10).
- Theil, H. (1950); Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. *JASA* 63.
- Page, E. S. (1954). Continuous inspection schemes. *Biometrika* 41. Roberts, S. W. (1959). Control chart tests based on geometric moving averages. *Technometrics* 1.
- Hawkins, D. M. (1987). Self-starting CUSUM charts for location and scale. *The Statistician* 36. Hawkins, D. M. & Olwell, D. H. (1998). *Cumulative Sum Charts and Charting for Quality Improvement*.
- Montgomery, D. C. *Introduction to Statistical Quality Control*, cap. 9.
- Acklam, P. J. (2003). An algorithm for computing the inverse normal cumulative distribution function. Abramowitz, M. & Stegun, I. A. *Handbook of Mathematical Functions*, 26.7.5.
- Zhang, D. et al. (2016). Resting heart rate and all-cause and cardiovascular mortality in the general population: a meta-analysis. *CMAJ* 188(3). Aune, D. et al. (2017). Resting heart rate and the risk of cardiovascular disease, total cancer, and all-cause mortality. *Nutr Metab Cardiovasc Dis* 27(6).
- Cappuccio, F. P. et al. (2011). Sleep duration predicts cardiovascular outcomes. *Eur Heart J* 32(12). Yin, J. et al. (2017). Relationship of sleep duration with all-cause mortality and cardiovascular events. *JAHA* 6(9).
- Richardson, S. et al. (2012). Meta-analysis of perceived stress and its association with incident coronary heart disease. *Am J Cardiol* 110(12).
- Global BMI Mortality Collaboration (2016). Body-mass index and all-cause mortality. *Lancet* 388.
- Yusuf, S. et al. (2004). Effect of potentially modifiable risk factors associated with myocardial infarction in 52 countries (INTERHEART). *Lancet* 364.
- Janosi, A., Steinbrunn, W., Pfisterer, M. & Detrano, R. (1988). Heart Disease. *UCI Machine Learning Repository*. Detrano, R. et al. (1989). International application of a new probability algorithm for the diagnosis of coronary artery disease. *Am J Cardiol* 64(5).
- Hastie, T., Tibshirani, R. & Friedman, J. *The Elements of Statistical Learning* (regresión logística e IRLS §4.4; validación cruzada §7.10; k-NN §13.3).
- Hanley, J. A. & McNeil, B. J. (1982). The meaning and use of the area under a ROC curve. *Radiology* 143(1).
