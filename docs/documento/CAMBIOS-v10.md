# Cambios v10 (1-nov-2026), respuesta a las observaciones del profesor sobre v9

Base: Pulso-version-corta-v9-USB.docx (igual al PDF que revisó el profesor). Cifras: scripts/analisis-v10/ (opcionA.py, subgrupos.py, umbral_pesos.py; los .xpt de DEMO y MCQ de NHANES van en data/nhanes-2021-2023/xpt/ y no se versionan).

1. Población 40-69: párrafo y Tabla VII nueva (desempeño por grupo de edad). AUC 40-69 0,748 ± 0,025, pendiente 1,02; entrenado solo con 40-69 0,744; aporte del estilo de vida en 40-69 +0,070 [0,045; 0,096]. Resumen, abstract y conclusión actualizados.
2. Umbral y VPP: el umbral de Youden se elige en cada partición solo con entrenamiento. Tabla VIII (antes VII) con resultado global y en 40-69, fila nueva de VPP (criterio ≥ 0,20; 0,241 y 0,216). Párrafo del VPP reescrito: resultado en cuatro niveles con su frecuencia observada y aviso de que no es riesgo a 10 años. Se declara que en 40-69 la sensibilidad (0,713) y el VPN (0,945) quedan bajo sus criterios.
3. Interfaz: en Limitaciones, el texto del aviso ("Probabilidad estimada según tu perfil; no corresponde a una estimación del riesgo cardiovascular a 10 años") y la advertencia de betabloqueadores junto a la frecuencia cardíaca. FALTA implementarlo en la app.
4. Casos completos y pesos: párrafo nuevo después de la Tabla III (38,1 % excluidos, comparación incluidos/excluidos, AUC con WTMEC2YR 0,841 y 0,771).
5. SUS: el resultado principal es el puntaje medio con IC 95 % (t de Student); el alfa de Cronbach queda como referencia.
6. Conclusión: "Nadie las había juntado" pasa a "En el benchmarking realizado no encontramos una herramienta que las reúna".
Tablas VII, VIII, IX renumeradas a VIII, IX, X. Tabla de contenido recalculada.
