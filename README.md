# Pulso — Tu corazón, tus hábitos, tu vida.

App de salud cardiovascular potenciada por IA. Monitorea tus métricas, descubre recetas cardioprotectoras, genera rutinas de ejercicio y construye hábitos saludables — sin cuenta y sin datos identificatorios.

> **Sobre los datos:** no se pide nombre, email, teléfono ni contraseña. La identidad es un UUID anónimo generado en el dispositivo. Aun así la app **sí almacena datos de salud** que vos ingresás (peso, frecuencia cardíaca, horas de sueño, nivel de estrés) asociados a ese UUID.

---

## Estado del proyecto

| # | Módulo | Estado | Detalles |
|---|--------|--------|----------|
| 1 | Dashboard de Métricas | ✅ Completo | 4 métricas, gráfica 30d, análisis IA en streaming, edición inline, upsert diario |
| 2 | Asistente de Recetas + Mercado | ✅ Completo | Streaming, imagen generada, chat sobre la receta, guardado, estrellas, lista de compras |
| 3 | Generador de Rutinas | ✅ Completo | Cuestionario de 4 pasos, sesión guiada con timer, rutinas guardadas |
| 4 | Calendario de Hábitos | ✅ Completo | Rutina diaria fija + hábitos custom con frecuencia/hora/lugar, vista semana |
| 5 | Score de Riesgo Cardiovascular | ✅ Completo | Score ponderado propio sobre las 4 métricas + análisis IA |
| 6 | Centro de Tips Personalizados | ✅ Completo | Artículos por categoría generados según tus métricas |
| 7 | Motor de predicción | ✅ Completo | Pronóstico por métrica con benchmarks, índice de riesgo con fuentes, detección de cambios de régimen; integrado en `/score`, `/dashboard` y en los prompts de IA |

Ver **[Limitaciones conocidas](#limitaciones-conocidas)** al final: hay features a medio cablear que conviene saber antes de tocar el código.

---

## Módulo 1 — Dashboard de Métricas

| Métrica | Normal | Atención |
|---------|--------|----------|
| Frecuencia cardíaca | 60–100 bpm | 100–120 |
| Peso | — (sin rangos) | — |
| Horas de sueño | 7–9 h (input h + min) | 6–7 |
| Nivel de estrés | 1–3 /10 | 4–6 |

- Tarjetas con estado **Normal / Atención / Riesgo / Sin datos**
- Edición inline con el ícono de lápiz (solo el lápiz abre la edición, no el cuerpo de la tarjeta)
- Gráfica de 30 días con Recharts — grafica los puntos existentes, no rellena días sin registro — más el **pronóstico a 30 días** del motor, punteado y con bandas del 80 % y 95 %
- Debajo de la gráfica: tendencia (OLS, con significancia), pronóstico a 7 y 30 días, modelo elegido con su MASE y la tabla de backtesting, y alertas de cambio sostenido. Las tarjetas marcan con un punto rojo la métrica con alerta.
- Análisis con Claude en streaming, que redacta sobre el informe del motor (tendencias, pronósticos, alertas), no solo sobre los últimos valores
- Un registro por métrica y por día: volver a guardar actualiza el del día en curso

> Presión arterial quedó fuera del MVP por la complejidad de interpretación para el usuario general.

---

## Módulo 2 — Asistente de Recetas + Mercado

**Tab Recetas**

1. Escribís los ingredientes que tenés
2. Claude genera una receta cardioprotectora en streaming (efecto typewriter palabra por palabra)
3. Al terminar el texto se genera una foto del plato con Gemini (~5 s)
4. Se puede guardar con imagen; el archivo va al volumen de medios y se sirve por `/api/img/...`
5. Vista "Guardadas" con detalle full-screen (`createPortal`) y botón para volver
6. Calificación con estrellas
7. Chat sobre la receta generada: sustituciones, dudas de preparación

**Tab Mercado**

- Lista de compras generada con IA a partir del texto de la receta
- Checklist interactivo, persistido en `localStorage`
- Toma como contexto las 2 listas anteriores para no repetir lo ya comprado

> El contexto de recetas guardadas solo se envía si visitaste el sub-tab "Guardadas" en esa misma sesión.

**Markdown soportado:** `**negrita**`, `*cursiva*`, `---`, `> tips`

---

## Módulo 3 — Generador de Rutinas

1. Cuestionario de **4 pasos con botones predefinidos** (no es conversacional con la IA): condición física, tiempo disponible, lugar/equipamiento y limitaciones
2. Claude genera **una sesión de entrenamiento** con tres bloques: Calentamiento / Parte principal / Vuelta a la calma
3. Recibe como contexto tus métricas de sueño y estrés, y cuántas rutinas completaste (para estimar en qué semana del plan vas y progresar la carga)
4. Sesión guiada paso a paso con timer de descanso entre ejercicios
5. Pestaña "Mis rutinas": guardar, listar, abrir y borrar

---

## Módulo 4 — Calendario de Hábitos

- Rutina diaria fija: ejercicio, alimentación, sueño, medicamento, hidratación
- Hábitos personalizados con emoji, frecuencia (diario / semanal / mensual), hora, lugar, días de la semana o día del mes
- Edición y baja lógica de hábitos custom
- Vista de semana con el progreso de cada día
- Los ejercicios de la rutina del día también se pueden tildar acá

---

## Módulo 5 — Score de Riesgo Cardiovascular

- Índice de riesgo calculado por el [motor de predicción](#motor-de-predicción): modelo log-lineal de riesgo relativo con coeficientes de meta-análisis (FC en reposo, sueño, estrés, IMC, tabaquismo). **No es Framingham ni ninguna escala clínica validada**, y la pantalla lo dice.
- Gauge 0–100, riesgo relativo vs. referencia, contexto de edad/sexo aparte (no entra al score), desglose por factor con puntos perdidos y **fuente** expandible, evidencia débil marcada.
- Perfil anónimo opcional (edad, sexo, altura, fumador) editable en la misma pantalla.
- Proyección a 30 días con intervalo, calculada con los pronósticos de cada métrica — no estimada por la IA.
- Cambios sostenidos detectados (CUSUM/EWMA) y sección "Cómo se calcula" con las limitaciones del informe.
- Análisis con Claude en streaming, que **redacta sobre el informe del motor** (recibe el `uid`, el servidor calcula el informe).
- Disclaimer médico visible en el módulo

---

## Módulo 6 — Centro de Tips Personalizados

- Artículos generados con Claude según el estado de tus métricas
- Agrupados por categoría, con extracto expandible, fuente y tiempo de lectura

---

## Motor de predicción

Está en `src/lib/ml/` y es la parte del proyecto que no depende de ninguna API externa: TypeScript puro, sin dependencias, implementado desde cero. Toma el historial de cada métrica y produce un `Informe` con:

- **Pronóstico a 30 días** por métrica, con intervalos del 80 % y 95 %. El modelo se elige por usuario y por métrica con **backtesting rolling-origin** entre 8 candidatos: cuatro benchmarks (naïve, naïve estacional, media móvil, drift) y cuatro modelos (OLS, Theil-Sen, Holt amortiguado, Holt-Winters). Gana el de menor MASE; si un benchmark es lo mejor, se dice.
- **Índice de riesgo**: modelo log-lineal de riesgo relativo con coeficientes de meta-análisis publicados (FC en reposo, sueño, estrés, IMC, tabaquismo), atribución exacta de puntos por factor, contexto de edad/sexo aparte y proyección del score alimentada por los pronósticos. No es una escala clínica; está documentado por qué.
- **Alertas de cambio de régimen** con CUSUM y EWMA sobre una línea base personal auto-iniciada ("tu FC en reposo subió ~8 bpm de forma sostenida desde el 16 jul").
- **Limitaciones en texto**, listas para el disclaimer y para el prompt.

El modelo de lenguaje pasa a ser consumidor de este informe: `/api/score-analisis`, `/api/analisis-metricas` y `/api/tips` reciben solo `{ uid }`, calculan el informe en el servidor (`getInforme` en `src/lib/db/informe.ts`) y le pasan a Claude el resumen de `src/lib/ml/resumen.ts` con la instrucción de no inventar números. `/score` y `/dashboard` consumen el mismo informe.

Además, para demostrar entrenamiento supervisado con datos reales, `src/lib/ml/supervisado/` implementa desde cero una **regresión logística (IRLS)** y **k-NN**, entrenados y validados por validación cruzada estratificada 5×10 sobre el dataset público **UCI Heart Disease** (297 pacientes): AUC 0.904 ± 0.032, coeficientes verificados contra numpy a 10⁻¹⁴. Los coeficientes aprendidos **no** se usan en el índice de la app, y el capítulo explica por qué con datos (cohorte de derivación).

```bash
npm run test:ml      # 63 tests con node --test (compila con tsconfig.ml.json)
npm run evaluar      # evaluación reproducible sobre una cohorte sintética con verdad conocida
npm run entrenar     # experimento supervisado sobre UCI: validación cruzada + coeficientes
npm run figuras      # figuras del informe (matplotlib) en docs/figuras/
npm run seed:demo -- --uid <pulso_uid> --limpiar   # usuario demo con 90 días sintéticos (para probar o presentar)
```

El `pulso_uid` es el UUID anónimo que la app guarda en `localStorage` (consola del navegador: `localStorage.getItem("pulso_uid")`).

Capítulo técnico completo, con fórmulas, fuentes y resultados: **[`docs/motor-prediccion.md`](docs/motor-prediccion.md)**. Guía para la defensa (preguntas del jurado, demo, glosario): **[`docs/sustentacion.md`](docs/sustentacion.md)**. Resultados: [`docs/evaluacion-sintetica.txt`](docs/evaluacion-sintetica.txt), [`docs/entrenamiento-uci.txt`](docs/entrenamiento-uci.txt). Figuras: [`docs/figuras/`](docs/figuras/). Capturas de la app: [`docs/capturas/`](docs/capturas/).

---

## Stack

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Frontend | Next.js 15 (App Router) | SSR + API routes + server actions |
| UI | Tailwind CSS 4 + shadcn/ui | Tema oscuro único (no hay toggle claro/oscuro) |
| IA Texto | Claude Sonnet 4.6 (`claude-sonnet-4-6`) | Vía Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), streaming. Dos modos de auth — ver abajo |
| IA Imágenes | `gemini-3.1-flash-image-preview` | Google AI SDK `@google/genai` |
| Base de datos | PostgreSQL 17 | `pg` + SQL parametrizado, sin ORM |
| Storage | Volumen persistente en disco | Servido por `/api/img/[...path]` |
| Predicción | TypeScript propio (`src/lib/ml`) | Sin dependencias. Backtesting, OLS/Theil-Sen/Holt/Holt-Winters, índice de riesgo, CUSUM/EWMA |
| Gráficas | Recharts | Tendencias de métricas |
| Push | `web-push` + VAPID | Ver limitaciones: la UI no está montada |
| Deploy | Coolify (self-hosted) | Hetzner VPS, auto-deploy desde `main` |

Las 7 rutas de IA de texto usan el mismo modelo (`claude-sonnet-4-6`), y todas lo obtienen del mismo lugar: `modeloClaude()` en `src/lib/ai/provider.ts`. Ninguna ruta instancia el proveedor por su cuenta.

---

## Auth de Claude: `apikey` vs `oauth`

`CLAUDE_AUTH_MODE` decide contra qué se resuelven las peticiones de IA.

| Modo | Cómo resuelve | Contra qué se cobra |
|---|---|---|
| `apikey` (default) | `ANTHROPIC_API_KEY` directo a `api.anthropic.com` | La API, por token |
| `oauth` | Un proxy externo que habla el protocolo de la Messages API y resuelve con el CLI de Claude Code | La suscripción de Claude |

En modo `oauth` hacen falta `CLAUDE_PROXY_URL` y `CLAUDE_PROXY_TOKEN`; si falta cualquiera de las dos, `provider.ts` tira error en vez de arrancar con una credencial vacía.

**El proxy no vive en este repo.** Es un servicio aparte, y quien monte el proyecto desde cero no lo tiene: por eso el default es `apikey`.

**Fallback.** En modo `oauth`, si el proxy da un error de red o un 5xx, la misma petición se reintenta contra `api.anthropic.com` con `ANTHROPIC_API_KEY`, y queda un `console.warn`. Por eso conviene dejar la API key puesta incluso en modo `oauth`. Dos límites del fallback, a propósito:

- **No cubre 4xx.** Un 401/403 (token mal configurado) o un 429 (suscripción agotada) se propagan tal cual: taparlos los volvería invisibles y movería el gasto a la API sin que nadie se enterara.
- **Solo actúa antes de las cabeceras de respuesta.** Si el proxy responde 200 y se corta a mitad del stream, ya no hay vuelta atrás.
- **No hay timeout de fetch.** Estas peticiones son streaming y pueden durar minutos legítimamente; un timeout cortaría respuestas válidas. Un proxy colgado es problema de su propia supervisión.

> Una suscripción de Claude cubre el uso interactivo de quien la paga. Servir con ella el backend de una app a terceros es el caso de uso de la API, no de la suscripción. El modo `oauth` está documentado porque existe en el código, no porque sea el camino recomendado para producción.

---

## Variables de entorno

Creá un `.env.local` en la raíz (partí de `.env.example`):

```bash
# PostgreSQL
DATABASE_URL=postgres://usuario:password@host:5432/pulso
PGSSL=                    # "require" solo si tu Postgres exige TLS
PGPOOL_MAX=10             # opcional

# Archivos subidos (imágenes de recetas)
MEDIA_DIR=/data           # en dev cae a ./.data

# El upsert diario de métricas usa la hora del servidor
TZ=America/Argentina/Buenos_Aires

# IA
CLAUDE_AUTH_MODE=apikey   # apikey (default) | oauth
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...

# Solo en modo oauth. El proxy escucha en la red interna del host:
# lo alcanza cualquier contenedor que esté en la misma red Docker,
# así que CLAUDE_PROXY_TOKEN es el único límite real.
CLAUDE_PROXY_URL=
CLAUDE_PROXY_TOKEN=

# Web Push — generá el par con: npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=mailto:tu@email.com
```

El código lee **12** variables (más `TZ`, que la usa Node y no el código):

- **Requeridas:** `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- **Con default, se pueden omitir:** `MEDIA_DIR`, `PGSSL`, `PGPOOL_MAX`, `CLAUDE_AUTH_MODE`
- **Solo si `CLAUDE_AUTH_MODE=oauth`:** `CLAUDE_PROXY_URL`, `CLAUDE_PROXY_TOKEN`
- **Solo para push:** las tres de VAPID — y hoy el push no está montado, ver [Limitaciones conocidas](#limitaciones-conocidas)

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` tiene que estar disponible en **build time**: Next.js inyecta las `NEXT_PUBLIC_*` en el bundle del browser al compilar, no al arrancar.

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local     # y completá los valores
npm run setup-db               # crea las 9 tablas (idempotente)
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000).

Si tu Postgres no es local sino que corre en el VPS y no está expuesto, abrí un túnel:

```bash
ssh -N -L 5433:<ip-del-contenedor>:5432 <tu-host-ssh>
# y en .env.local: DATABASE_URL=postgres://pulso:...@localhost:5433/pulso
```

---

## Base de datos

El schema completo está en **`db/schema.sql`** y se aplica con `npm run setup-db`. Es idempotente (todo `if not exists`), así que se puede correr en cada deploy.

| Tabla | Para qué |
|---|---|
| `metricas` | Registros de métricas (un upsert por tipo y día) |
| `habitos` | Hábitos fijos por día — único `(uid, fecha, tipo)` |
| `habitos_definicion` | Hábitos personalizados (baja lógica vía `activo`) |
| `habitos_registro` | Completados de hábitos custom y ejercicios — único `(uid, fecha, tipo, ref_id)` |
| `recetas_guardadas` | Recetas con imagen, ingredientes y calificación |
| `listas_mercado` | Listas de compras generadas |
| `rutinas` | Sesiones generadas (`contenido` jsonb, baja lógica vía `activa`) |
| `suscripciones_push` | Suscripciones Web Push — único `(uid, endpoint)` |
| `perfil` | Perfil anónimo (edad, sexo, altura, fumador) para el motor de riesgo — `uid` es la PK, una fila por usuario |

Notas de diseño que importan si tocás el schema:

- `uid` **no es la primary key**: cada fila tiene su propio `id` uuid y `uid` es la columna de propietario. La excepción son los constraints únicos compuestos.
- `metricas.valor` es `double precision`, **no `numeric`**: `node-postgres` devuelve `numeric` como string para no perder precisión, y los componentes esperan `number`.
- Los `timestamptz` se parsean a ISO string en `src/lib/db/pool.ts` para mantener los tipos de fila que ya usaba el código.

---

## Arquitectura de datos

Toda la lógica de datos vive en `src/lib/db/` y corre **en el servidor**:

```
src/lib/db/
  pool.ts      pool de pg, perezoso, con los type parsers de fecha
  types.ts     tipos de fila y enums  ← el único importable desde el cliente
  metricas.ts  \
  recetas.ts    |  "use server" — server actions con SQL parametrizado
  mercado.ts    |
  rutinas.ts    |
  habitos.ts    |
  perfil.ts     |
  informe.ts   /   carga historial + perfil + adherencia y llama al motor (`lib/ml`)
```

`types.ts` está aparte porque un archivo `"use server"` solo puede exportar funciones async. Los componentes cliente importan las funciones de los módulos y los tipos de `types.ts`.

Las imágenes se guardan en `MEDIA_DIR` y se sirven por `src/app/api/img/[...path]/route.ts`, que valida la ruta para evitar path traversal.

---

## Deploy (Coolify)

1. Crear un recurso **PostgreSQL** y anotar su hostname interno
2. En la app, setear las 9 variables de entorno — `NEXT_PUBLIC_VAPID_PUBLIC_KEY` marcada como **build time**
3. Agregar un **volumen persistente** montado en `/data` (el valor de `MEDIA_DIR`). Sin esto, las imágenes de recetas se borran en cada deploy.
4. Correr el schema contra la base:
   ```bash
   cat db/schema.sql | ssh <host> "docker exec -i <contenedor-db> psql -U pulso -d pulso"
   ```
5. Push a `main` → auto-deploy

---

## Decisiones de diseño

- **Sin login:** UUID anónimo generado en el dispositivo y guardado en `localStorage`. Si el usuario borra la caché, pierde el historial.
- **Tema oscuro:** paleta Obsidian + Coral Pulse (`--color-coral: #ff6b6b`). Es un tema único, no un dark mode conmutable.
- **Disclaimer médico:** aparece en el onboarding y en el módulo de Score.
- **Mobile-first:** bottom nav en móvil, sidebar en desktop.
- **Modelo de negocio:** gratis en el MVP, freemium a futuro.

---

## Limitaciones conocidas

Cosas que existen en el código pero no funcionan end-to-end. Están acá para que no las descubras debuggeando:

- **Push notifications: no están activas.** El backend (`/api/notificaciones/*`), el service worker y el componente `PushManager` existen y son correctos, pero `PushManager` **no está montado en ningún layout ni página**. Hasta que se monte, no hay suscripción ni envío posible.
- **La PWA no es instalable.** `public/manifest.json` referencia `/icons/icon-192.png` y `/icons/icon-512.png`, y **ninguno de los dos existe** en el repo. Chrome exige un ícono de 192px resoluble para ofrecer el prompt de instalación.
- **`next-pwa` está en `package.json` pero nunca se configura.** `next.config.ts` está vacío. El service worker es `public/sw.js`, escrito a mano, y solo maneja `install` / `activate` / `push` / `notificationclick`.
- **No hay soporte offline.** `sw.js` no tiene ningún listener de `fetch` y su `CACHE_NAME` nunca se usa.
- **El índice de riesgo no es una escala clínica.** Cita de dónde sale cada coeficiente, pero eso no lo convierte en Framingham, ASCVD ni similares; no compararlo con ellas.
- **El motor se evaluó sobre datos sintéticos.** Demuestra que la implementación es correcta bajo patrones conocidos, no desempeño sobre usuarios reales.
- **`getInforme` recalcula el backtesting en cada carga** de `/dashboard` y `/score` (~100–300 ms por usuario con 90 días). No hay caché; si crece el uso, cachear por uid y fecha.
- **Recharts + React 19: no usar fragmentos `<>…</>` como hijos de un chart.** Recharts los aplana con `isFragment` de `react-is@16`, que no reconoce los elementos de React 19, y descarta silenciosamente todo lo que hay adentro (así estuvieron invisibles las líneas de rango normal de la gráfica hasta que se corrigió). Cada `<Line>`, `<Area>` o `<ReferenceLine>` va como hijo directo, condicionado por separado.
- **El límite del día en el upsert de métricas usa la hora del servidor**, no la del browser. Fijá `TZ` en el contenedor para que coincida con tus usuarios.

---

> Pulso es una herramienta de bienestar personal y educación preventiva. La información proporcionada **no constituye diagnóstico médico**. Siempre consultá a un profesional de la salud.
