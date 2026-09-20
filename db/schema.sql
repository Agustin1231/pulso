-- Pulso — schema PostgreSQL
--
-- Idempotente: se puede correr varias veces sin romper nada.
--   npm run setup-db
--
-- Notas de tipos (importan para que los tipos de fila de TS sigan valiendo):
--   * `valor` es double precision, NO numeric: node-postgres devuelve numeric
--     como string para no perder precisión, y los componentes esperan number.
--   * `created_at` es timestamptz y el pool lo parsea a ISO string, que es lo
--     que devolvía Supabase por JSON.
--   * `fecha` es date y se deja como YYYY-MM-DD, tal como lo escribe el código.

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ─── Métricas ────────────────────────────────────────────────────────────────
-- Un registro por usuario/tipo/día (el upsert diario lo resuelve la query).

create table if not exists metricas (
  id         uuid primary key default gen_random_uuid(),
  uid        text not null,
  tipo       text not null,
  valor      double precision not null,
  unidad     text not null,
  notas      text,
  created_at timestamptz not null default now()
);

create index if not exists metricas_uid_created_idx
  on metricas (uid, created_at desc);
create index if not exists metricas_uid_tipo_created_idx
  on metricas (uid, tipo, created_at desc);

-- ─── Hábitos fijos (predefinidos) ────────────────────────────────────────────

create table if not exists habitos (
  id         uuid primary key default gen_random_uuid(),
  uid        text not null,
  fecha      date not null,
  tipo       text not null,
  completado boolean not null default false,
  notas      text,
  created_at timestamptz not null default now(),
  unique (uid, fecha, tipo)
);

create index if not exists habitos_uid_fecha_idx on habitos (uid, fecha);

-- ─── Hábitos personalizados ──────────────────────────────────────────────────

create table if not exists habitos_definicion (
  id          uuid primary key default gen_random_uuid(),
  uid         text not null,
  nombre      text not null,
  emoji       text not null default '✅',
  frecuencia  text not null default 'diario'
              check (frecuencia in ('diario', 'semanal', 'mensual')),
  hora        text,                                  -- '08:00'
  lugar       text,                                  -- 'Gimnasio', 'Casa', …
  dias_semana text[] not null default '{}',          -- ['lun','mie','vie']
  dia_mes     int check (dia_mes between 1 and 31),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists habitos_definicion_uid_activo_idx
  on habitos_definicion (uid, activo, created_at);

-- ─── Completados de hábitos custom + ejercicios de rutina ────────────────────

create table if not exists habitos_registro (
  id         uuid primary key default gen_random_uuid(),
  uid        text not null,
  fecha      date not null,
  tipo       text not null,
  ref_id     text not null,
  created_at timestamptz not null default now(),
  unique (uid, fecha, tipo, ref_id)
);

create index if not exists habitos_registro_uid_fecha_idx
  on habitos_registro (uid, fecha);

-- ─── Recetas guardadas ───────────────────────────────────────────────────────

create table if not exists recetas_guardadas (
  id           uuid primary key default gen_random_uuid(),
  uid          text not null,
  titulo       text not null,
  contenido    text not null,
  imagen_url   text,
  ingredientes text[] not null default '{}',
  calificacion int check (calificacion between 0 and 5),
  created_at   timestamptz not null default now()
);

create index if not exists recetas_guardadas_uid_created_idx
  on recetas_guardadas (uid, created_at desc);

-- ─── Listas de mercado ───────────────────────────────────────────────────────

create table if not exists listas_mercado (
  id         uuid primary key default gen_random_uuid(),
  uid        text not null,
  nombre     text not null,
  periodo    text not null,
  contenido  text not null,
  created_at timestamptz not null default now()
);

create index if not exists listas_mercado_uid_created_idx
  on listas_mercado (uid, created_at desc);

-- ─── Rutinas ─────────────────────────────────────────────────────────────────

create table if not exists rutinas (
  id         uuid primary key default gen_random_uuid(),
  uid        text not null,
  nombre     text not null,
  contenido  jsonb not null,
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists rutinas_uid_activa_idx
  on rutinas (uid, activa, created_at desc);

-- ─── Suscripciones push (Web Push / VAPID) ───────────────────────────────────

create table if not exists suscripciones_push (
  id         uuid primary key default gen_random_uuid(),
  uid        text not null,
  endpoint   text not null,
  keys       jsonb not null,
  created_at timestamptz not null default now(),
  unique (uid, endpoint)
);

create index if not exists suscripciones_push_uid_idx on suscripciones_push (uid);

-- ─── Perfil anónimo (motor de riesgo) ────────────────────────────────────────
-- Una fila por usuario: por eso acá `uid` SÍ es la primary key (en el resto de
-- las tablas es solo la columna de propietario). Lo lee `lib/ml` para calcular
-- IMC (peso / altura²), el factor tabaquismo y el contexto edad/sexo del índice
-- de riesgo. Todo es opcional: el índice excluye lo que falte y lo reporta.
-- `fumador` admite null = "no respondió", distinto de false.

create table if not exists perfil (
  uid            text primary key,
  edad           int check (edad between 18 and 120),
  sexo           text check (sexo in ('m', 'f', 'otro')),
  altura_cm      int check (altura_cm between 100 and 250),
  fumador        boolean,
  actualizado_at timestamptz not null default now()
);
