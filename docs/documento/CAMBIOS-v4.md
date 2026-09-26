# Cambios v3 → v4 (2026-08-16)

Motivo: el v3 declaraba que el proyecto no entrenaba ningún modelo, porque en ese
momento el único dataset disponible era UCI Heart Disease (1988), sin ninguna
variable en común con lo que la app captura. Con NHANES 2021-2023 esa premisa
cambió, y el v4 incorpora un estimador entrenado y evaluado sobre datos reales.

De 16 a 18 páginas. La página adicional corresponde a la nueva Sección 4.3.

## Secciones modificadas

**Resumen y Abstract.** El modelo pasa de "heurístico ponderado" a modelo
supervisado entrenado sobre NHANES 2021-2023. Se incorporan la muestra (5.043
adultos, 11,8 % de prevalencia) y las cifras de desempeño (AUC 0,812 con edad y
sexo, 0,605 sin ellos). UCI, Framingham y WHO GHO quedan como fundamento
bibliográfico y epidemiológico.

**Introducción.** La mención al alcance limitado del prototipo ahora remite a la
Sección 4.3, donde se cuantifica, en lugar de al apartado de limitaciones.

**3.2 Relevancia Teórica.** El aporte metodológico pasa de ser una discusión
cualitativa sobre la distancia entre datasets clínicos y datos de usuario, a un
resultado medido: los indicadores de estilo de vida discriminan poco por sí
solos, y la ganancia decisiva viene de dos variables demográficas.

**4.1 Alcance, módulo 2.** Se declara que el prototipo implementa hoy la
heurística y que el trabajo incorpora el entrenamiento del modelo supervisado que
será la base del estimador definitivo.

**4.2 Limitaciones.** Reescrita. NHANES es la fuente de entrenamiento. Se
mantiene el estado verificado de los tres datasets originales y se agregan las
cuatro restricciones de NHANES: diseño transversal (no hay predicción
prospectiva), PHQ-9 como aproximación al estrés, desenlace autorreportado y
omisión de ponderadores de muestreo complejo. Se añade la validación externa en
población colombiana como línea posterior.

**4.3 Resultados Preliminares del Estimador.** Sección nueva. Construcción de la
muestra, correspondencia variable por variable entre la app y la encuesta, Tabla
1 con los cinco modelos evaluados, odds ratio estandarizados, y la lectura de
diseño: el factor limitante era la ausencia de edad y sexo, no la de exámenes de
laboratorio. Incluye las dos precisiones sobre colinealidad peso/IMC y sobre el
OR del sueño.

**5.2 Objetivos Específicos.** El tercer objetivo incorpora la evaluación sobre
datos poblacionales con métricas de discriminación y calibración, además de las
pruebas de usabilidad que ya estaban.

**6. Conclusiones.** El párrafo sobre la restricción metodológica ahora reporta
las cifras concretas en lugar de afirmar de forma general que los datasets exigen
laboratorio.

**Referencias.** De 14 a 15. Se agrega CDC/NCHS (2024) para NHANES, en su
posición alfabética. Se mantienen todas las anteriores.

## Lo que NO cambió

El documento sigue prometiendo notificaciones push y PWA instalable, y ninguna de
las dos funciona en el repositorio actual (falta montar `PushManager` en un
layout y faltan los íconos de 192 y 512 px del manifest). Es código, así que
queda como decisión y desarrollo de Agustin.

## Pendiente que abre el v4

La Sección 4.3 declara que se incorpora la solicitud de edad y sexo al registro
inicial. Eso todavía no existe en la app. Si el jurado abre Pulso el 7 de
septiembre y el onboarding no los pide, la afirmación queda expuesta.
