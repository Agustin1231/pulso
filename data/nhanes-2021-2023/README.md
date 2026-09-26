# NHANES agosto 2021 – agosto 2023

`muestra-analitica.csv`: 5.043 adultos con las mismas variables que registra Pulso y el antecedente
cardiovascular autorreportado (597 casos, 11,8 %). Es la fuente con la que se entrena y evalúa el
estimador de riesgo (`npm run entrenar:nhanes`) y con la que se valida el índice del motor.

- **Fuente:** Centers for Disease Control and Prevention, National Center for Health Statistics.
  *National Health and Nutrition Examination Survey*, ciclo agosto 2021 – agosto 2023,
  https://wwwn.cdc.gov/nchs/nhanes/continuousnhanes/default.aspx?Cycle=2021-2023
  (archivos descargados el 2026-09-26 desde `https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/`).
- **Licencia:** dominio público (datos del gobierno de los Estados Unidos).
- **Cita:** Centers for Disease Control and Prevention, National Center for Health Statistics. (2024).
  *National Health and Nutrition Examination Survey: August 2021 – August 2023 data files*.

## Cómo se reproduce

```bash
npm run nhanes:descargar   # baja los 7 .xpt a data/nhanes-2021-2023/xpt/ (no se versionan)
npm run nhanes:muestra     # .xpt → muestra-analitica.csv y flujo.json (lector XPORT propio)
npm run entrenar:nhanes -- --json docs/entrenamiento-nhanes.json
python3 scripts/verificar-logistica.py docs/entrenamiento-nhanes.json
```

`flujo.json` guarda el flujo de exclusiones y el SHA-256 de cada archivo fuente: si el CDC publica una
revisión de algún archivo, la huella deja de coincidir y se nota.

## Archivos y criterios

| Archivo | Variables usadas |
|---|---|
| `DEMO_L` | edad (`RIDAGEYR`, las edades ≥ 80 vienen agrupadas en 80) y sexo (`RIAGENDR`) |
| `BPXO_L` | pulso en reposo, primera lectura oscilométrica (`BPXOPLS1`) |
| `BMX_L` | peso (`BMXWT`) e IMC (`BMXBMI`), medidos |
| `SLQ_L` | horas de sueño en días laborables (`SLD012`) |
| `DPQ_L` | PHQ-9, ítems `DPQ010`–`DPQ090` (0–3; 7 y 9 = rehusó / no sabe) |
| `MCQ_L` | antecedente de falla cardíaca, enfermedad coronaria, angina, infarto o ACV (`MCQ160B`–`MCQ160F`) |
| `SMQ_L` | tabaquismo (`SMQ020`, `SMQ040`) |

Flujo: 11.933 participantes → 8.153 adultos de 18 años o más → 6.123 con pulso → 6.061 con peso e IMC →
6.003 con horas de sueño → 5.282 con los nueve ítems del PHQ-9 → **5.043 con desenlace conocido**.

- **Desenlace** (`evento`): 1 si respondió "sí" a alguna de las cinco preguntas `MCQ160B–F`; 0 si ninguna
  fue "sí" y al menos una fue "no"; desconocido (excluido) en otro caso.
- **PHQ-9** (`phq9`): suma de los nueve ítems; se exige que los nueve tengan respuesta válida. Para
  evaluar el índice se lleva a la escala de estrés de la app como `redondeo(1 + 9·PHQ/27)`.
- **Fumador actual** (`fumador`): `SMQ020 = 1` (al menos 100 cigarrillos en la vida) y `SMQ040 ∈ {1, 2}`
  (fuma todos o algunos días). Desconocido en 7 participantes (`fumadorConocido = 0`): los modelos los
  codifican como no fumadores y el índice excluye el factor.

## Columnas del CSV

| Columna | Significado |
|---|---|
| `seqn` | identificador de participante de NHANES |
| `edad` | años |
| `hombre` | 1 = hombre, 0 = mujer |
| `fc` | pulso en reposo (lpm) |
| `peso` | kg |
| `imc` | kg/m² |
| `sueno` | horas en días laborables |
| `phq9` | puntaje total 0–27 |
| `fumador` | 1 = fumador actual |
| `fumadorConocido` | 1 = respondió las preguntas de tabaquismo |
| `evento` | 1 = antecedente cardiovascular autorreportado |

## Qué no es

La encuesta es **transversal**: el modelo aprende la asociación entre el estado actual y un evento que ya
ocurrió, no la incidencia futura. El desenlace es autorreportado, el PHQ-9 mide síntomas depresivos y no
estrés percibido, y no se aplican los ponderadores de muestreo complejo (los modelos sirven para comparar
métodos, no para estimar prevalencias poblacionales). Describe a la población de los Estados Unidos.
