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
- Gráfica de tendencia de 30 días con Recharts — grafica los puntos existentes, no rellena días sin registro
- Análisis con Claude en streaming, sobre los **últimos valores** (no sobre el historial completo)
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

- Score ponderado **propio** sobre las 4 métricas registradas. **No implementa Framingham ni ninguna escala clínica validada.**
- Cada métrica aporta según su estado (normal / atención / riesgo)
- Análisis del resultado con Claude en streaming
- Disclaimer médico visible en el módulo

---

## Módulo 6 — Centro de Tips Personalizados

- Artículos generados con Claude según el estado de tus métricas
- Agrupados por categoría, con extracto expandible, fuente y tiempo de lectura

---

## Stack

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Frontend | Next.js 15 (App Router) | SSR + API routes + server actions |
| UI | Tailwind CSS 4 + shadcn/ui | Tema oscuro único (no hay toggle claro/oscuro) |
| IA Texto | Claude Sonnet 4.6 (`claude-sonnet-4-6`) | Vía Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), streaming |
| IA Imágenes | `gemini-3.1-flash-image-preview` | Google AI SDK `@google/genai` |
| Base de datos | PostgreSQL 17 | `pg` + SQL parametrizado, sin ORM |
| Storage | Volumen persistente en disco | Servido por `/api/img/[...path]` |
| Gráficas | Recharts | Tendencias de métricas |
| Push | `web-push` + VAPID | Ver limitaciones: la UI no está montada |
| Deploy | Coolify (self-hosted) | Hetzner VPS, auto-deploy desde `main` |

> `src/app/api/analisis-metricas/route.ts` usa `claude-sonnet-4-5` mientras las otras 7 rutas usan `claude-sonnet-4-6`. Ambos IDs son válidos; la inconsistencia es intencional de documentar, no un typo pendiente de arreglar.

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
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...

# Web Push — generá el par con: npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=mailto:tu@email.com
```

Las **9** variables las lee el código. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` tiene que estar disponible en **build time**: Next.js inyecta las `NEXT_PUBLIC_*` en el bundle del browser al compilar, no al arrancar.

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local     # y completá los valores
npm run setup-db               # crea las 8 tablas (idempotente)
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
  habitos.ts   /
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
- **El score no es una escala clínica.** Es una ponderación propia; no compararlo con Framingham, ASCVD ni similares.
- **El límite del día en el upsert de métricas usa la hora del servidor**, no la del browser. Fijá `TZ` en el contenedor para que coincida con tus usuarios.

---

> Pulso es una herramienta de bienestar personal y educación preventiva. La información proporcionada **no constituye diagnóstico médico**. Siempre consultá a un profesional de la salud.
