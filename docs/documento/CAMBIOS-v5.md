# Cambios v4 → v5 (2026-09-26)

Motivo: el v4 hablaba sobre todo de la PWA y de sus módulos funcionales. El v5 pone en el centro el
motor de predicción propio, su entrenamiento y su evaluación contra benchmarks, con la misma portada,
la misma tipografía, el mismo encabezado y el mismo formato APA de tablas y citas.

Regla aplicada: **cada cifra del documento sale de un script del repositorio**. Ninguna se tomó de
memoria ni de la versión anterior sin reproducirla.

De 18 a 41 páginas: 14 tablas, 8 figuras y 45 referencias (antes 1 tabla y 15 referencias).

## Lo primero: reproducir las cifras del v4

Las cifras de NHANES del v4 (5.043 adultos, AUC 0,605 / 0,812) no tenían código ni datos en el repo.
Se reconstruyó el experimento desde cero:

- `src/lib/ml/supervisado/xpt.ts`: lector del formato SAS XPORT v5 (coma flotante IBM, faltantes SAS).
- `src/lib/ml/supervisado/nhanes.ts`: construcción de la muestra con flujo de exclusiones.
- `src/lib/ml/supervisado/boosting.ts`: gradient boosting desde cero (para la fila de boosting del v4).
- `scripts/nhanes-muestra.ts`, `scripts/entrenar-nhanes.ts`, `data/nhanes-2021-2023/`.

Resultado: la muestra coincide **exactamente** (5.043 adultos, 597 casos, edad media 53,6, FC 70,8,
IMC 29,7, sueño 7,7). Con la especificación del v4 (FC, peso, IMC, sueño, PHQ-9):

| | v4 reportado | v5 reproducido |
|---|---|---|
| Heurística | 0,565 | 0,5645 (muestra completa) |
| Logística, 4 de la app (VC) | 0,600 | 0,603 |
| Logística, + edad y sexo (VC) | 0,802 | 0,803 |
| Boosting, + edad y sexo (VC) | 0,787 | 0,789 |
| Logística, 4 de la app (partición 30 %) | 0,605 | 0,615 |
| Logística, + edad y sexo (partición 30 %) | 0,812 | 0,795 |

Las medias de validación cruzada coinciden; la partición única difiere dentro de su variabilidad
(desvío entre particiones ≈ 0,025 y 0,014). Por eso el v5 reporta validación cruzada 5 × 10 y no una
partición única. La especificación principal del v5 cambia peso + IMC por IMC + tabaquismo, lo que
elimina la colinealidad peso/IMC que el v4 tenía que explicar.

## Resultados nuevos que entran al documento

- **El índice que corre en la app, sin entrenar, sobre 5.043 adultos reales:** AUC 0,611, frente a
  0,564 de la heurística anterior (ΔAUC +0,046 [0,016; 0,075]).
- **Entrenar no mejora al índice:** logística con las mismas variables 0,608 (Δ −0,001 [−0,022; 0,019]).
- **Con edad y sexo:** índice + contexto 0,799 frente a logística entrenada 0,805 (Δ +0,007
  [−0,001; 0,015], no significativa). Las variables de la app aportan sobre edad y sexo solas: +0,037
  [0,025; 0,049].
- **Calibración** de la logística: pendiente 0,99, intercepto −0,02, Brier 0,091 vs. 0,104.
- **Recalibración del índice:** los pesos aprendidos de FC, sueño e IMC son compatibles con la
  literatura; estrés (PHQ-9), edad y sexo pesan más; tabaquismo menos (compatible con el diseño
  transversal). Reajustar los siete pesos lleva el AUC de 0,799 a 0,801: no hay motivo para cambiar
  los coeficientes publicados.
- **Boosting no le gana a la logística** (−0,010 [−0,018; −0,001]).
- Coeficientes verificados contra numpy: 6·10⁻¹⁵ en NHANES, 2·10⁻¹⁴ en UCI.
- Pronóstico y detección (cohorte sintética, ya estaban en el repo): 23/28 series con MASE < 1,
  CUSUM 4/4 con 4,5 días de retraso medio.

## Estructura

| v4 | v5 |
|---|---|
| 1 Introducción | 1 Introducción (separa "integrar un LLM" de "tener capacidad predictiva") |
| 2 Planteamiento | 2 Planteamiento (dos brechas: acceso y rigor) + cuatro preguntas de ingeniería P1–P4 + antecedentes de pronóstico, control estadístico y calibración |
| 3 Justificación | 3 Justificación (relevancia teórica con resultados medidos) |
| 4 Alcance y limitaciones (+ 4.3 resultados preliminares) | 4 Objetivos (reenfocados en el motor) |
| 5 Objetivos | 5 Alcance y limitaciones (el módulo 2 pasa a ser el motor; limitaciones reescritas) |
| — | **6 Diseño del motor** (principios, arquitectura con diagrama, series, 8 modelos, índice, CUSUM/EWMA, supervisado, integración con el LLM, verificación) |
| — | **7 Datos y protocolo** (cohorte sintética, flujo y caracterización de NHANES, UCI, protocolo) |
| — | **8 Resultados** (pronóstico, detección, NHANES, UCI, consecuencias de diseño) |
| 6 Conclusiones | 9 Conclusiones (con cifras) |
| Referencias (15) | Referencias (45) |
| — | Anexo A: comandos de reproducción y SHA-256 de los archivos de NHANES |

Se mantienen sin cambios: portada, dedicatoria, epidemiología, antecedentes de nutrición, ejercicio y
PWA, y las 15 referencias originales.

## Correcciones que salieron de la revisión

- **Valores p del experimento UCI.** La función de distribución normal de `scripts/entrenar.ts` usaba la
  aproximación de erf de Abramowitz & Stegun sin dividir por √2, y subestimaba los valores p. Corregida
  (`cdfNormal` en `src/lib/ml/estadistica.ts`, con test). La edad pasa de p = 0,32 a p = 0,38; las
  conclusiones de significancia no cambian. Actualizados `docs/entrenamiento-uci.*`,
  `docs/motor-prediccion.md` y `docs/sustentacion.md`.
- El v4 decía que UCI no comparte variables con la app; con el perfil comparte edad y sexo. El v5 lo
  dice así y aclara que su FC es la máxima en esfuerzo.
- El v4 afirmaba que el prototipo implementaba "un modelo heurístico ponderado": ya lo reemplazó el
  motor.

## Lo que sigue pendiente (no es del documento)

- El alcance sigue declarando PWA instalable, offline y con notificaciones push como parte del
  proyecto; en el v4 figuraban como no funcionales en el repo y en esta revisión no se verificaron.
- La validación del pronóstico con series reales de dispositivos portátiles.

## Cómo se compila

La máquina no tiene TeX Live; se compiló con Tectonic (motor XeTeX, fuentes Latin Modern, las mismas
formas que Computer Modern):

```bash
cd docs/documento && tectonic -X compile pulso-seminario-1-v5.tex
```

Las figuras se toman de `docs/figuras/` (`\graphicspath{{../figuras/}}`). Con XeTeX y `fontenc` T1, los
caracteres fuera de Latin-1 hay que escribirlos como comando (`\S`, `\textsuperscript{a}`); el `§` y la
`ª` literales salen como otro glifo.
