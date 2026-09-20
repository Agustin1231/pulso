# Pulso — Plan de Producto

> Tu corazón, tus hábitos, tu vida.

App PWA de salud cardiovascular construida con IA. Ayuda a las personas a monitorear sus métricas, mejorar sus hábitos, descubrir recetas saludables y entrenar de forma segura — sin necesidad de cuenta ni datos personales.

---

## Visión

Las enfermedades cardiovasculares son la principal causa de muerte en el mundo. La mayoría de las personas no monitorean sus hábitos ni entienden cómo la dieta, el estrés y el sedentarismo impactan su corazón hasta que ya es tarde.

**Pulso** es una herramienta de bienestar y educación preventiva que combina tracking de métricas, recetas inteligentes, rutinas personalizadas y un calendario de hábitos — todo potenciado por IA para dar análisis y recomendaciones personalizadas.

### Usuario objetivo
- Personas de 25–65 años con interés en su salud
- Personas con factores de riesgo (sedentarismo, sobrepeso, estrés)
- Quienes ya tienen diagnóstico y quieren mejorar hábitos
- Familiares de personas con enfermedades cardiovasculares

---

## Decisiones de Producto

| Tema | Decisión |
|---|---|
| Tipo de app | PWA (instalable desde el browser, sin App Store) |
| Login | Sin login — UUID anónimo generado en el dispositivo |
| Idioma | Español (por ahora) |
| Modelo de negocio | Gratis en MVP — Freemium en el futuro |
| Disclaimers | 100% consumer/bienestar, nunca diagnóstico médico |
| Wearables MVP | Ingreso manual |
| Wearables v2 | Xiaomi Band 10 via Web Bluetooth (Android Chrome) |
| Wearables v3 | Apple Watch via React Native + HealthKit |

### Modelo Freemium (futuro)

**Free**
- Dashboard de métricas — ilimitado
- Calendario de hábitos — ilimitado
- Score de riesgo básico
- Recetas IA — 5 por día
- Rutinas IA — 2 por mes
- Análisis de métricas — semanal

**Premium**
- Todo lo anterior sin límites
- Recetas IA ilimitadas + imagen generada
- Rutinas IA ilimitadas + actualización semanal automática
- Análisis de métricas diario
- Resumen mensual detallado con IA
- Score de riesgo avanzado con proyecciones
- Sincronización wearables (v2)
- Historial ilimitado en la nube

---

## Identidad Visual

**Nombre:** Pulso — del español "pulse/latido", corto, memorable, directamente ligado al corazón.

**Filosofía:** Dark mode por defecto. Premium y moderno. Sin los verdes clichés del sector salud.

### Paleta de colores

| Nombre | Hex | Uso |
|---|---|---|
| Obsidian | `#0D1117` | Fondo principal |
| Coral Pulse | `#FF6B6B` | Color primario / CTA / Riesgo |
| Vital Teal | `#00D4AA` | Métricas positivas / Normal |
| Alert Amber | `#F0A500` | Alertas / Atención |
| Deep Purple | `#A371F7` | IA / análisis / tips |
| Vital Blue | `#58A6FF` | Secundario |
| Vital Green | `#3FB950` | Estado normal |
| Snow Text | `#E6EDF3` | Texto principal |

---

## Los 6 Módulos

### 1. Dashboard de Métricas Cardiovasculares ✅
Registro de 4 métricas clave, tarjetas con estado Normal/Atención/Riesgo, edición inline, gráficas de tendencia 30 días y análisis personalizado con Claude en streaming.

**Métricas activas (MVP):**
- Frecuencia cardíaca (bpm) — normal: 60–100
- Peso (kg)
- Horas de sueño — input en horas + minutos, normal: 7–9 h
- Nivel de estrés (1–10) — normal: 1–3

> Presión arterial removida del MVP — demasiado técnica para el usuario general sin contexto médico. Se retomará en v2 con contexto educativo mejorado.

### 2. Asistente de Recetas — Streaming + Imagen IA ✅
Chat donde el usuario escribe sus ingredientes. La respuesta llega en tiempo real via streaming (Vercel AI SDK + Claude). Al terminar, se genera automáticamente una imagen fotorrealista del plato con Gemini API. El agente tiene contexto del perfil cardiovascular del usuario.

**Flujo:**
1. Usuario escribe ingredientes
2. Claude responde en streaming con la receta cardioprotectora
3. Al finalizar el texto, Gemini genera la imagen del plato (~3s)
4. La receta se puede guardar con su imagen en el volumen de medios (servido por /api/img)

**Tab Mercado:**
- Lista de compras generada por IA con ingredientes de la receta
- Checklist interactivo con estado persistido en localStorage (sobrevive cierre de app)
- Contexto histórico de listas anteriores para no repetir compras

### 3. Generador de Rutinas de Ejercicio ✅
Cuestionario conversacional con Claude: edad, condición física, tiempo disponible, equipamiento, lesiones, objetivos. Genera una rutina semanal cardiovascular progresiva (HIIT, cardio moderado, fuerza) adaptada al perfil de riesgo.

**Características:**
- Vista guiada paso a paso con timer de descanso configurable
- Contexto de las últimas 5 rutinas para evitar repetición de ejercicios
- Plan progresivo que evoluciona con las métricas del usuario

### 4. Calendario de Hábitos ✅
Tres tabs: **Hoy**, **Semana**, **Gestionar**. Hábitos fijos del sistema más hábitos personalizados del usuario con frecuencia configurable.

**Hábitos fijos del sistema:**
- Ejercicio, Alimentación, Sueño, Medicamento, Hidratación
- Integración con la rutina de ejercicio activa (muestra ejercicios del día)

**Hábitos personalizados:**
- Nombre + emoji propios
- Frecuencia: diario / semanal (días específicos) / mensual (día del mes)
- Hora y lugar opcionales
- Edición inline desde tab Hoy y desde Gestionar
- Historial semanal de adherencia

### 5. Score de Riesgo Cardiovascular ✅
Índice 0–100 calculado por el motor de predicción (`src/lib/ml/riesgo`): modelo log-lineal de riesgo relativo con coeficientes de meta-análisis publicados. Desglose por factor con puntos perdidos y fuente, riesgo relativo vs. referencia, contexto de edad/sexo aparte, proyección a 30 días con intervalo (alimentada por los pronósticos), alertas de cambio sostenido y perfil anónimo editable. Siempre con disclaimer médico visible.

**Factores del índice (modificables):** frecuencia cardíaca en reposo, horas de sueño, nivel de estrés, IMC (peso + altura del perfil), tabaquismo. La edad y el sexo se muestran como contexto y no entran al score.

**Cálculo:** `score = 100 · (1 − Σ logRR_i / Σ logRR_max_i)` sobre los factores con datos; la atribución por factor es exacta y aditiva. No es una escala clínica validada. Ver `docs/motor-prediccion.md`.
**Análisis IA:** Claude streaming genera 4 secciones (qué está bien, qué mejorar, plan semanal, proyección) **redactando sobre el informe del motor**, sin inventar números.

### 6. Centro de Tips Personalizados ✅
Dos secciones integradas en una sola pantalla.

**"Para ti hoy" — IA personalizada:**
- Claude genera 3 tips accionables basados en las métricas actuales del usuario
- Streaming con efecto typewriter
- Se personaliza según métricas en "atención" o "riesgo"
- Botón de regenerar

**"Artículos de salud" — contenido curado:**
- 8 artículos sobre Corazón, Nutrición, Movimiento, Sueño y Estrés
- Filtro por categoría (chips horizontales deslizables)
- Cada artículo expandible inline con contenido completo en markdown
- Fuente y tiempo de lectura visible

---

## Stack Tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | Next.js 15 (App Router) | SSR + PWA + API routes |
| UI | Tailwind CSS 4 + shadcn/ui | Dark mode nativo |
| IA Texto | Claude API (`claude-sonnet-4-6`) | Via Vercel AI SDK |
| IA Streaming | Vercel AI SDK | streaming + typewriter word-by-word |
| IA Imágenes | `gemini-3.1-flash-image-preview` | Google AI SDK `@google/genai` — imágenes de recetas |
| Base de datos | PostgreSQL 17 (`pg`, sin ORM) | `uid` anónimo como columna de propietario |
| Gráficas | Recharts | Tendencias de métricas |
| Deploy | Coolify (self-hosted) | Hetzner VPS |
| PWA | Web App Manifest + Service Worker manual | Instalable en iOS/Android |
| Wearables (v2) | Web Bluetooth API | Xiaomi Band 10 en Android |
| App nativa (v3) | Expo (React Native) | HealthKit + Google Fit |

### Variables de entorno requeridas

```
# PostgreSQL
DATABASE_URL=postgres://usuario:password@host:5432/pulso
MEDIA_DIR=/data

# IA
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

```

---

## Arquitectura de Datos

### Estrategia anónima
1. Primera visita → se genera UUID v4 aleatorio en el browser
2. Se guarda en `localStorage` del dispositivo
3. Todos los datos en PostgreSQL se vinculan solo a ese UUID
4. Sin email, sin nombre, sin datos personales
5. Si el usuario borra la caché → pierde el historial (aceptable en MVP)
6. Futuro: opción de "guardar progreso" vinculando un email al UUID

### Tablas en PostgreSQL

| Tabla | Descripción |
|---|---|
| `metricas` | Registros diarios de métricas cardiovasculares (upsert por día) |
| `habitos` | Hábitos fijos por día: ejercicio, alimentacion, sueno, medicamento, hidratacion |
| `habitos_definicion` | Hábitos personalizados: nombre, emoji, frecuencia (diario/semanal/mensual), hora, lugar, dias_semana[], dia_mes |
| `habitos_registro` | Completados diarios de hábitos custom + ejercicios de rutina del día |
| `recetas_guardadas` | Recetas guardadas con imagen, calificación de estrellas |
| `listas_mercado` | Listas de compras generadas por IA (checklist persistido en localStorage) |
| `rutinas` | Planes de ejercicio semanales generados por IA (JSON con ejercicios por bloque) |
| `perfil` | Perfil anónimo para el motor de riesgo: edad, sexo, altura, fumador (una fila por `uid`) |

### Schema `habitos_definicion`
```sql
create table habitos_definicion (
  id uuid default gen_random_uuid() primary key,
  uid text not null,
  nombre text not null,
  emoji text not null default '✅',
  frecuencia text not null default 'diario', -- 'diario' | 'semanal' | 'mensual'
  hora text,                                  -- '08:00'
  lugar text,                                 -- 'Gimnasio', 'Casa', etc.
  dias_semana text[] default '{}',            -- ['lun','mie','vie'] para semanal
  dia_mes int,                                -- 1-31 para mensual
  activo boolean default true,
  created_at timestamptz default now()
);
```

---

## Infraestructura

```
Usuario (iOS/Android/Web)
        ↓
   Coolify (Traefik + SSL automático)
        ↓
   Next.js App (Docker container en Hetzner VPS)
        ↓
   ┌─────────────┬──────────────┬─────────────┐
   PostgreSQL  Claude API    Gemini API
   (Coolify)    (Anthropic)   (Google)
```

**CI/CD:** Push a `main` en GitHub → Coolify auto-deploy

---

## Aviso Médico (Disclaimer)

> Pulso es una herramienta de bienestar personal y educación preventiva. La información y análisis proporcionados **no constituyen diagnóstico médico**, consejo clínico ni tratamiento. Siempre consulta a un médico o profesional de la salud certificado antes de tomar decisiones sobre tu salud cardiovascular.

- Aparece obligatorio en el onboarding (no se puede saltar)
- Visible en el módulo de Score
- Claude está instruido para no diagnosticar ni recetar, y recomendar al médico ante síntomas urgentes

---

## Roadmap

### Semana 1–2 — Fundación ✅
- [x] Next.js 15 + Tailwind 4 + shadcn/ui
- [x] Paleta dark mode Pulso
- [x] Layout mobile-first: sidebar (desktop) + bottom nav (móvil)
- [x] Sistema UUID anónimo (localStorage + PostgreSQL)
- [x] Tablas en PostgreSQL (`db/schema.sql`)
- [x] PWA manifest + Service Worker
- [x] Onboarding con disclaimer médico obligatorio
- [x] Deploy en Coolify con CI/CD automático

### Semana 3–4 — Core de Salud ✅
- [x] Dashboard de métricas (formulario de registro)
- [x] Tarjetas de resumen con estado Normal/Atención/Riesgo
- [x] Gráficas de tendencias 30 días (Recharts)
- [x] Análisis IA con Claude streaming
- [x] API route `/api/analisis-metricas`
- [x] Edición inline de métricas directamente en las tarjetas
- [x] Input de sueño en horas + minutos

### Semana 5–6 — IA Conversacional ✅
- [x] Chat de recetas con streaming en tiempo real
- [x] Generación de imagen del plato al terminar (Gemini)
- [x] Guardar recetas favoritas con imagen (volumen persistente)
- [x] Vista de receta completa full-screen (createPortal)
- [x] Calificación de estrellas en recetas guardadas
- [x] Tab Mercado: lista de compras generada por IA
- [x] Checklist interactivo persistido en localStorage
- [x] Cuestionario conversacional para rutinas
- [x] Generación de rutina semanal con contexto de métricas e historial
- [x] Contexto de ejercicios previos para evitar repetición
- [x] Vista guiada paso a paso con timer de descanso

### Semana 7–8 — Hábitos + Score + Tips ✅
- [x] Calendario de hábitos — tabs Hoy / Semana / Gestionar
- [x] Hábitos fijos del sistema (ejercicio, alimentación, sueño, medicamento, hidratación)
- [x] Hábitos personalizados con nombre + emoji
- [x] Frecuencia configurable: diario / semanal / mensual
- [x] Hora y lugar por hábito
- [x] Edición inline desde Hoy y desde Gestionar
- [x] Integración rutina de ejercicio → hábitos del día
- [x] Score de riesgo cardiovascular 0–100 (gauge SVG animado)
- [x] Desglose por factor con barras de progreso
- [x] Análisis IA del score en streaming
- [x] Centro de Tips: tips IA personalizados por métricas
- [x] 8 artículos curados con filtro por categoría y expansión inline

### Motor de predicción — tanda 1 ✅ (19 de septiembre de 2026)
- [x] `src/lib/ml/`: motor puro en TypeScript, sin dependencias
- [x] Benchmarks (naïve, estacional, media móvil, drift) + OLS, Theil-Sen, Holt amortiguado, Holt-Winters
- [x] Backtesting rolling-origin, MAE/RMSE/MASE, cobertura de intervalos, selección por métrica y usuario
- [x] Índice de riesgo log-lineal con coeficientes de literatura, atribución por factor, contexto edad/sexo, proyección a 30 días
- [x] CUSUM + EWMA con línea base auto-iniciada, winsorización y consolidación de alertas
- [x] Cohorte sintética con verdad conocida, `npm run evaluar`, 53 tests con `node --test`
- [x] Tabla `perfil` + `getInforme(uid)` como seam para la UI
- [x] `docs/motor-prediccion.md` (capítulo técnico)

### Motor de predicción — tanda 2 (integración) ✅ (20 de septiembre de 2026)
- [x] Formulario de perfil (edad, sexo, altura, tabaquismo) en `/score`
- [x] `/score` consume `getInforme(uid)`: gauge, riesgo relativo, contexto, atribución por factor con fuentes, proyección con intervalo, alertas, "cómo se calcula"
- [x] `/dashboard`: pronóstico punteado con bandas 80/95 %, tendencia, modelo elegido con tabla de backtesting, alertas y punto rojo en la tarjeta
- [x] Prompts de `/api/score-analisis`, `/api/analisis-metricas`, `/api/tips` reciben `{ uid }`, calculan el informe en el servidor y redactan sobre `resumirInforme()`
- [x] `npm run seed:demo`: usuario de demostración con 90 días sintéticos
- [x] Experimento supervisado con datos reales (UCI Heart Disease): regresión logística IRLS y k-NN desde cero, validación cruzada 5×10, AUC 0.90, verificación con numpy
- [x] Figuras del informe (`npm run figuras`) y guía de defensa (`docs/sustentacion.md`)
- [ ] Dataset público real de series diarias (wearables) como segunda fuente de evaluación del pronóstico

### v2 — Wearables y Mejoras
- [ ] Xiaomi Band 10 via Web Bluetooth API (Android Chrome)
- [ ] Notificaciones push para recordatorios (VAPID / Web Push)
- [ ] Modo offline básico (caché con service worker)
- [ ] Activar sistema freemium con Stripe
- [ ] Heatmap de adherencia (estilo GitHub contributions)
- [ ] Resumen semanal de hábitos generado por Claude

### v3 — App Nativa
- [ ] React Native (Expo) con código compartido
- [ ] HealthKit (Apple Watch)
- [ ] Google Fit
- [ ] App Store + Play Store

---

## Equipo

| Quién | Rol |
|---|---|
| Agustín | Product owner, decisiones, testing |
| Claude (Sonnet 4.6) | Desarrollo completo |

---

*Última actualización: 20 de septiembre de 2026*
