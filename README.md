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

Además, `src/lib/ml/supervisado/` implementa desde cero **regresión logística (IRLS)**, **gradient boosting**, **k-NN** y un lector del formato **SAS XPORT** del CDC, y los usa en dos experimentos con datos reales:

- **NHANES 2021-2023** (5.043 adultos con las mismas variables que registra la app, 597 con antecedente cardiovascular): el índice del motor, **sin entrenar**, logra AUC 0.611 con los factores modificables (la heurística anterior, 0.564) y 0.799 con el contexto de edad y sexo, frente a 0.805 de una logística entrenada ahí (diferencia no significativa). Entrenar con las mismas variables no mejora al índice, y recalibrar sus pesos tampoco (0.801), así que la app mantiene los coeficientes publicados.
- **UCI Heart Disease** (297 pacientes): AUC 0.904 ± 0.032 con las 13 variables clínicas; valida la implementación.

Coeficientes verificados contra numpy (10⁻¹⁵ en NHANES, 10⁻¹⁴ en UCI). El documento de la tesis con todos los resultados está en [`docs/documento/pulso-seminario-1-v5.pdf`](docs/documento/pulso-seminario-1-v5.pdf).

```bash
npm run test:ml      # 70 tests con node --test (compila con tsconfig.ml.json)
npm run evaluar      # evaluación reproducible sobre una cohorte sintética con verdad conocida
npm run nhanes:descargar && npm run nhanes:muestra   # archivos del CDC → muestra analítica (versionada)
npm run entrenar:nhanes -- --json docs/entrenamiento-nhanes.json   # índice vs. modelos entrenados sobre NHANES
npm run entrenar     # experimento supervisado sobre UCI: validación cruzada + coeficientes
npm run figuras      # figuras del informe (matplotlib) en docs/figuras/
npm run seed:demo -- --uid <pulso_uid> --limpiar   # usuario demo con 90 días sintéticos (para probar o presentar)
```

El `pulso_uid` es el UUID anónimo que la app guarda en `localStorage` (consola del navegador: `localStorage.getItem("pulso_uid")`).

Capítulo técnico completo, con fórmulas, fuentes y resultados: **[`docs/motor-prediccion.md`](docs/motor-prediccion.md)**. Guía para la defensa (preguntas del jurado, demo, glosario): **[`docs/sustentacion.md`](docs/sustentacion.md)**. Resultados: [`docs/evaluacion-sintetica.txt`](docs/evaluacion-sintetica.txt), [`docs/entrenamiento-nhanes.txt`](docs/entrenamiento-nhanes.txt), [`docs/entrenamiento-uci.txt`](docs/entrenamiento-uci.txt). Figuras: [`docs/figuras/`](docs/figuras/). Capturas de la app: [`docs/capturas/`](docs/capturas/).

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
# PostgreSQL — la app usa el rol sin privilegios `pulso_app` (ver Seguridad)
DATABASE_URL=postgres://pulso_app:password@host:5432/pulso
DATABASE_ADMIN_URL=postgres://postgres:password@host:5432/pulso   # solo setup-db
PULSO_APP_PASSWORD=       # solo setup-db: habilita el login de pulso_app
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
- **Solo para `npm run setup-db`, nunca en la app:** `DATABASE_ADMIN_URL`, `PULSO_APP_PASSWORD`
- **Con default, se pueden omitir:** `MEDIA_DIR`, `PGSSL`, `PGPOOL_MAX`, `CLAUDE_AUTH_MODE`
- **Solo si `CLAUDE_AUTH_MODE=oauth`:** `CLAUDE_PROXY_URL`, `CLAUDE_PROXY_TOKEN`
- **Solo para push:** las tres de VAPID — y hoy el push no está montado, ver [Limitaciones conocidas](#limitaciones-conocidas)

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` tiene que estar disponible en **build time**: Next.js inyecta las `NEXT_PUBLIC_*` en el bundle del browser al compilar, no al arrancar.

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local     # y completá los valores
npm run setup-db               # tablas, roles y políticas (idempotente; usa DATABASE_ADMIN_URL)
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

El schema está en dos archivos que aplica `npm run setup-db`, en orden: **`db/schema.sql`** (las tablas de datos) y **`db/seguridad.sql`** (roles, RLS, sesiones, auditoría, consentimiento y límites). Los dos son idempotentes, así que se pueden correr en cada deploy. Necesitan el rol dueño (`DATABASE_ADMIN_URL`).

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

Y las de `db/seguridad.sql`, que la app no lee directo (salvo `consentimientos`):

| Tabla | Para qué |
|---|---|
| `identidades` | Un uid por usuario anónimo; lo genera la base |
| `sesiones` | Hash SHA-256 del token de sesión, vencimiento y revocación |
| `uids_legado` | UUIDs de la versión anterior, reclamables una sola vez |
| `consentimientos` | Autorización versionada para mandar datos de salud a la IA |
| `auditoria` | Registro append-only de escrituras, llamadas a la IA y accesos denegados |
| `limites_tasa` | Contadores por ventana para los límites por sesión e IP |

Notas de diseño que importan si tocás el schema:

- `uid` **no es la primary key**: cada fila tiene su propio `id` uuid y `uid` es la columna de propietario. La excepción son los constraints únicos compuestos.
- `metricas.valor` es `double precision`, **no `numeric`**: `node-postgres` devuelve `numeric` como string para no perder precisión, y los componentes esperan `number`.
- Los `timestamptz` se parsean a ISO string en `src/lib/db/pool.ts` para mantener los tipos de fila que ya usaba el código.

---

## Arquitectura de datos

Toda la lógica de datos vive en `src/lib/db/` y corre **en el servidor**:

```
src/lib/db/
  pool.ts            pool de pg perezoso + conUsuario (transacción con app.uid para RLS)
  types.ts           tipos de fila y enums  ← el único importable desde el cliente
  metricas.ts      \
  recetas.ts        |
  mercado.ts        |  "use server" — server actions. Ninguna recibe el uid:
  rutinas.ts        |  lo sacan de la sesión (lib/seguridad/accion.ts)
  habitos.ts        |
  perfil.ts         |
  consentimiento.ts |
  informe.ts       /
  consultas.ts       lecturas compartidas que reciben uid (server-only, NO "use server")
  calculo-informe.ts historial + perfil + adherencia → motor (`lib/ml`)

src/lib/sesion.ts    cookie de sesión, reclamo de uids legado, supresión
src/lib/seguridad/
  accion.ts          envoltorio de server actions: zod → sesión → RLS → auditoría
  ruta.ts            envoltorio de /api: origen → sesión → consentimiento → tasa → zod
  validacion.ts      esquemas zod de todo lo que entra del cliente
  auditoria.ts  tasa.ts  red.ts  consentimiento.ts
src/middleware.ts    CSP con nonce por petición
```

`types.ts` está aparte porque un archivo `"use server"` solo puede exportar funciones async. Por la misma razón, todo lo que recibe un uid vive en módulos `server-only` que no son `"use server"`: cada export de un archivo `"use server"` es un endpoint público.

Las imágenes se guardan en `MEDIA_DIR` y se sirven por `src/app/api/img/[...path]/route.ts`, que valida la ruta (path traversal) y exige la sesión del dueño.

---

## Deploy (Coolify)

1. Crear un recurso **PostgreSQL** y anotar su hostname interno
2. Correr el schema contra la base, con el rol dueño. `PULSO_APP_PASSWORD` habilita el login de `pulso_app`:
   ```bash
   cat db/schema.sql db/seguridad.sql | ssh <host> "docker exec -i <contenedor-db> psql -U <dueño> -d <base> -v ON_ERROR_STOP=1"
   # y aparte, sin dejar la contraseña en el historial:
   #   alter role pulso_app login password '<openssl rand -hex 24>';
   ```
3. En la app, setear las variables de entorno — `DATABASE_URL` con el usuario **`pulso_app`**, nunca el dueño, y `NEXT_PUBLIC_VAPID_PUBLIC_KEY` marcada como **build time**
4. Agregar un **volumen persistente** montado en `/data` (el valor de `MEDIA_DIR`). Sin esto, las imágenes de recetas se borran en cada deploy.
5. Push a `main` y **Deploy** en Coolify. Ojo: la app está conectada como *Public GitHub* (sin GitHub App), así que no hay webhook y el push solo **no** despliega, aunque el auto-deploy figure activado. Para que despliegue solo, instalar la GitHub App de Coolify o configurar el webhook manual del repo.

---

## Seguridad

Los controles están mapeados fila por fila contra la matriz de activos del Proyecto Integrador en **[docs/seguridad.md](docs/seguridad.md)**. En corto:

- **Sesión emitida por el servidor**: cookie `__Host-` httpOnly, Secure y SameSite=Strict; la base guarda solo el hash del token. Ninguna server action recibe el uid.
- **RBAC y RLS en Postgres**: la app es `pulso_app` (sin DDL); cada usuario ve solo sus filas, y sin sesión no se ve ninguna.
- **Auditoría append-only**, **consentimiento** para mandar datos de salud a la IA (Ley 1581) y **derecho de supresión** en `/privacidad`.
- **Límites de tasa** por sesión e IP en las rutas de IA y push; **validación con zod** de todo lo que entra.
- **CSP con nonce**, HSTS y el resto de los headers.

Pruebas: `npm run test:seguridad` contra una base descartable (ver el documento).

---

## Decisiones de diseño

- **Sin login, pero con sesión:** el usuario es anónimo (no hay email ni nombre), pero la identidad es una cookie httpOnly que emite el servidor, no un UUID en `localStorage`. Si el usuario borra las cookies, pierde el acceso a su historial. Detalle en [docs/seguridad.md](docs/seguridad.md).
- **Tema oscuro:** paleta Obsidian + Coral Pulse (`--color-coral: #ff6b6b`). Es un tema único, no un dark mode conmutable.
- **Disclaimer médico:** aparece en el onboarding y en el módulo de Score.
- **Mobile-first:** bottom nav en móvil, sidebar en desktop.
- **Modelo de negocio:** gratis en el MVP, freemium a futuro.

---

## Limitaciones conocidas

Cosas que existen en el código pero no funcionan end-to-end. Están acá para que no las descubras debuggeando:

- **Push: los recordatorios programados solo salen con la app abierta.** La suscripción y el envío funcionan (campana del header → panel de notificaciones; `/api/notificaciones/*`), pero el "recordatorio programado" es un `setTimeout` en el navegador, no un cron del servidor. Sin `NEXT_PUBLIC_VAPID_PUBLIC_KEY` en el build, el panel avisa que el push no está configurado.
- **Offline básico, no completo.** `public/sw.js` guarda las pantallas visitadas (red primero) y los estáticos de `/_next/static/` (caché primero); una pantalla nunca visitada muestra "Sin conexión". Los datos se leen con server actions (POST), así que sin red la interfaz abre pero los números necesitan conexión. Al cambiar `sw.js`, subir `VERSION`.
- **`htmlLimitedBots: /.*/` en `next.config.ts` no se toca.** Next 15.5 manda la metadata de las páginas dinámicas en streaming dentro del `<body>`, y Chrome solo reconoce el `<link rel="manifest">` en el `<head>`: sin esa línea la PWA deja de ser instalable ("no-manifest").
- **El service worker es `public/sw.js`, escrito a mano** (`next-pwa` se quitó: no se usaba y arrastraba dependencias vulnerables). Los íconos se regeneran con `python3 scripts/iconos.py`.
- **Toda la app se renderiza por petición** (`dynamic = "force-dynamic"` en el layout raíz): la CSP lleva un nonce distinto en cada respuesta y Next solo lo puede inyectar en páginas que no están pre-renderizadas. No sacar esa línea: sin nonce, el navegador bloquea los scripts y la app queda en blanco.
- **El índice de riesgo no es una escala clínica.** Cita de dónde sale cada coeficiente, pero eso no lo convierte en Framingham, ASCVD ni similares; no compararlo con ellas.
- **El pronóstico se evaluó sobre datos sintéticos.** Demuestra que la implementación es correcta bajo patrones conocidos, no desempeño sobre usuarios reales. El índice sí se validó con datos reales (NHANES 2021-2023), pero ese dataset es transversal: mide antecedente cardiovascular, no incidencia futura.
- **`getInforme` recalcula el backtesting en cada carga** de `/dashboard` y `/score` (~100–300 ms por usuario con 90 días). No hay caché; si crece el uso, cachear por uid y fecha.
- **Recharts + React 19: no usar fragmentos `<>…</>` como hijos de un chart.** Recharts los aplana con `isFragment` de `react-is@16`, que no reconoce los elementos de React 19, y descarta silenciosamente todo lo que hay adentro (así estuvieron invisibles las líneas de rango normal de la gráfica hasta que se corrigió). Cada `<Line>`, `<Area>` o `<ReferenceLine>` va como hijo directo, condicionado por separado.
- **El límite del día en el upsert de métricas usa la hora del servidor**, no la del browser. Fijá `TZ` en el contenedor para que coincida con tus usuarios.

---

> Pulso es una herramienta de bienestar personal y educación preventiva. La información proporcionada **no constituye diagnóstico médico**. Siempre consultá a un profesional de la salud.
