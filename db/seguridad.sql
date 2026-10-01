-- Pulso — controles de seguridad sobre el schema base
--
-- Se aplica DESPUÉS de schema.sql y con el rol dueño de la base (el superusuario
-- que crea Coolify). Es idempotente, igual que schema.sql:
--   npm run setup-db
--
-- Qué resuelve (filas de la plantilla del Proyecto Integrador):
--   * Fila 1 y 7 — identidad: la sesión la emite el servidor. El token vive en
--     una cookie httpOnly y acá solo se guarda su hash; el `uid` deja de ser una
--     credencial.
--   * RBAC en la base: la app se conecta con `pulso_app` (solo DML, sujeta a
--     RLS); la auditoría la lee `pulso_auditor`; el DDL queda para el dueño.
--   * RLS en todas las tablas de datos: cada transacción fija `app.uid` y las
--     políticas filtran por él. Sin `app.uid` no se ve ni se escribe nada.
--   * Fila 5 — auditoría append-only (un trigger bloquea update/delete/truncate).
--   * Fila 3 — consentimiento para mandar datos de salud a la IA (Ley 1581).
--   * Fila 6 — límites de tasa por sesión e IP.
--   * Fila 7 — rotación: el token se reemplaza por uno nuevo cada día de uso.
--   * Fila 9 — bloqueo opcional con passkey (huella / Face ID / PIN del equipo):
--     con el bloqueo activo, una sesión sin desbloquear no resuelve a ningún
--     uid, así que el servidor no entrega ni un dato aunque la cookie sea válida.
--
-- Las tablas de sistema (identidades, sesiones, uids_legado, limites_tasa) no
-- tienen grants para `pulso_app`: solo se tocan a través de las funciones
-- `pulso_*` (security definer), así la app no puede leer sesiones ajenas ni
-- crear una sesión para un uid que elija.
--
-- La contraseña de `pulso_app` NO está acá: la fija setup-db desde
-- PULSO_APP_PASSWORD, para que nunca quede en el repo.

-- ─── Roles ───────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select from pg_roles where rolname = 'pulso_app') then
    create role pulso_app nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'pulso_auditor') then
    create role pulso_auditor nologin;
  end if;
end $$;

-- Nadie crea objetos en `public` salvo el dueño (PG15+ ya lo hace por defecto;
-- se deja explícito por si la base viene de una versión anterior).
revoke create on schema public from public;
grant usage on schema public to pulso_app, pulso_auditor;

-- ─── Identidad y sesiones ────────────────────────────────────────────────────

-- Un uid por usuario anónimo. Lo genera el servidor (origen 'nueva') o sale de
-- un UUID viejo del localStorage reclamado una sola vez (origen 'legado').
create table if not exists identidades (
  uid        text primary key,
  origen     text not null check (origen in ('nueva', 'legado')),
  created_at timestamptz not null default now()
);

-- Los uids que ya tenían datos antes de esta migración. Se pueden reclamar una
-- sola vez (la fila se borra al reclamar) y durante 90 días.
create table if not exists uids_legado (
  uid        text primary key,
  created_at timestamptz not null default now()
);

insert into uids_legado (uid)
select uid from (
  select uid from metricas
  union select uid from habitos
  union select uid from habitos_definicion
  union select uid from habitos_registro
  union select uid from recetas_guardadas
  union select uid from listas_mercado
  union select uid from rutinas
  union select uid from suscripciones_push
  union select uid from perfil
) todos
where uid not in (select uid from identidades)
on conflict (uid) do nothing;

-- El token de sesión nunca se guarda: solo su SHA-256. Si se filtra la tabla,
-- no sirve para entrar.
create table if not exists sesiones (
  token_hash  text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  uid         text not null references identidades (uid) on delete cascade,
  created_at  timestamptz not null default now(),
  ultimo_uso  timestamptz not null default now(),
  expira_at   timestamptz not null,
  revocada_at timestamptz
);

create index if not exists sesiones_uid_idx on sesiones (uid);

-- Rotación (fila 7): cuando un token se reemplaza, `rotada_at` se marca y su
-- vencimiento se acorta a 2 minutos (gracia para peticiones en vuelo).
-- Bloqueo (fila 9): `desbloqueada_hasta` es la ventana de uso tras desbloquear.
-- Desafío WebAuthn: uno por sesión, de un solo uso y con vencimiento.
alter table sesiones
  add column if not exists rotada_at          timestamptz,
  add column if not exists desbloqueada_hasta timestamptz,
  add column if not exists desafio            text,
  add column if not exists desafio_tipo       text,
  add column if not exists desafio_expira     timestamptz;

-- ─── Consentimiento (Ley 1581 de 2012) ───────────────────────────────────────

create table if not exists consentimientos (
  uid         text not null references identidades (uid) on delete cascade,
  tipo        text not null check (tipo in ('ia_datos_salud')),
  version     text not null,
  otorgado_at timestamptz not null default now(),
  revocado_at timestamptz,
  primary key (uid, tipo)
);

-- ─── Bloqueo con passkey (fila 9) ────────────────────────────────────────────
-- Una fila por passkey registrada. Se guarda solo la clave PÚBLICA: la privada
-- nunca sale del autenticador del teléfono (huella, Face ID o PIN del equipo).

create table if not exists credenciales_bloqueo (
  id            text primary key,      -- credential id, base64url
  uid           text not null references identidades (uid) on delete cascade,
  clave_publica bytea not null,
  contador      bigint not null default 0,
  transportes   text[] not null default '{}',
  created_at    timestamptz not null default now(),
  ultimo_uso    timestamptz
);

create index if not exists credenciales_bloqueo_uid_idx on credenciales_bloqueo (uid);

-- ─── Auditoría append-only ───────────────────────────────────────────────────

create table if not exists auditoria (
  id          bigint generated always as identity primary key,
  ocurrido_at timestamptz not null default now(),
  uid         text,
  accion      text not null,
  recurso     text,
  recurso_id  text,
  resultado   text not null check (resultado in ('ok', 'denegado', 'error')),
  ip          text,      -- anonimizada: /24 en IPv4, /48 en IPv6
  detalle     jsonb
);

create index if not exists auditoria_uid_idx    on auditoria (uid, ocurrido_at desc);
create index if not exists auditoria_accion_idx on auditoria (accion, ocurrido_at desc);

create or replace function auditoria_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'auditoria es append-only: % no permitido', tg_op;
end $$;

drop trigger if exists auditoria_sin_cambios on auditoria;
create trigger auditoria_sin_cambios
  before update or delete on auditoria
  for each row execute function auditoria_inmutable();

drop trigger if exists auditoria_sin_truncate on auditoria;
create trigger auditoria_sin_truncate
  before truncate on auditoria
  for each statement execute function auditoria_inmutable();

-- ─── Límites de tasa ─────────────────────────────────────────────────────────

create table if not exists limites_tasa (
  clave   text not null,
  ventana timestamptz not null,
  conteo  int not null default 0,
  primary key (clave, ventana)
);

-- ─── Funciones de sesión (security definer) ──────────────────────────────────
-- Corren con los permisos del dueño. `search_path` fijo para que un objeto con
-- el mismo nombre en otro schema no las secuestre.

create or replace function pulso_dias_validos(p_dias int) returns int
language sql immutable as $$
  select least(greatest(coalesce(p_dias, 180), 1), 365)
$$;

-- Sesión para un usuario nuevo: el uid lo genera la base, no la app.
create or replace function pulso_crear_sesion(p_token_hash text, p_dias int)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := gen_random_uuid()::text;
begin
  insert into identidades (uid, origen) values (v_uid, 'nueva');
  insert into sesiones (token_hash, uid, expira_at)
  values (p_token_hash, v_uid, now() + make_interval(days => pulso_dias_validos(p_dias)));
  return v_uid;
end $$;

-- Reclamo de un UUID viejo del localStorage. Una sola vez por uid: la fila de
-- uids_legado se borra en el mismo statement. Devuelve null si no se puede.
create or replace function pulso_reclamar_legado(p_token_hash text, p_uid text, p_dias int)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text;
begin
  delete from uids_legado
   where uid = p_uid
     and created_at > now() - interval '90 days'
  returning uid into v_uid;

  if v_uid is null then
    return null;
  end if;

  insert into identidades (uid, origen) values (v_uid, 'legado');
  insert into sesiones (token_hash, uid, expira_at)
  values (p_token_hash, v_uid, now() + make_interval(days => pulso_dias_validos(p_dias)));
  return v_uid;
end $$;

/** Ventana de uso tras desbloquear: se corre con cada petición. */
create or replace function pulso_minutos_desbloqueo() returns int
language sql immutable as $$ select 15 $$;

-- uid de una sesión vigente y utilizable, o null.
-- Si el usuario activó el bloqueo, además tiene que estar desbloqueada: sin
-- eso devuelve null y el servidor no entrega datos (fila 9). La ventana es
-- deslizante: mientras se usa, se corre, pero solo se escribe cuando le
-- quedan menos de 10 minutos.
create or replace function pulso_resolver_sesion(p_token_hash text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   text;
  v_hasta timestamptz;
begin
  select s.uid, s.desbloqueada_hasta into v_uid, v_hasta
    from sesiones s
   where s.token_hash = p_token_hash
     and s.revocada_at is null
     and s.expira_at > now();

  if v_uid is null then
    return null;
  end if;
  if not exists (select 1 from credenciales_bloqueo c where c.uid = v_uid) then
    return v_uid;
  end if;
  if v_hasta is null or v_hasta <= now() then
    return null;
  end if;
  if v_hasta < now() + interval '10 minutes' then
    update sesiones
       set desbloqueada_hasta = now() + make_interval(mins => pulso_minutos_desbloqueo())
     where token_hash = p_token_hash;
  end if;
  return v_uid;
end $$;

-- Estado para el cliente: 'sin_sesion', 'bloqueada' o 'activa', y si el
-- usuario tiene el bloqueo activado. No desliza la ventana.
create or replace function pulso_estado_sesion(p_token_hash text)
returns table (estado text, bloqueo boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid   text;
  v_hasta timestamptz;
  v_bloq  boolean;
begin
  select s.uid, s.desbloqueada_hasta into v_uid, v_hasta
    from sesiones s
   where s.token_hash = p_token_hash
     and s.revocada_at is null
     and s.expira_at > now();

  if v_uid is null then
    return query select 'sin_sesion'::text, false;
    return;
  end if;
  v_bloq := exists (select 1 from credenciales_bloqueo c where c.uid = v_uid);
  if v_bloq and (v_hasta is null or v_hasta <= now()) then
    return query select 'bloqueada'::text, true;
  else
    return query select 'activa'::text, v_bloq;
  end if;
end $$;

-- uid de una sesión vigente IGNORANDO el bloqueo. Solo para el flujo de
-- desbloqueo, que necesita saber de quién son las passkeys a verificar.
create or replace function pulso_uid_de_token(p_token_hash text)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select uid
    from sesiones
   where token_hash = p_token_hash
     and revocada_at is null
     and expira_at > now()
$$;

-- Expiración deslizante: cada uso corre el vencimiento. Devuelve el uid o null.
create or replace function pulso_renovar_sesion(p_token_hash text, p_dias int)
returns text
language sql security definer set search_path = public, pg_temp as $$
  update sesiones
     set ultimo_uso = now(),
         expira_at  = now() + make_interval(days => pulso_dias_validos(p_dias))
   where token_hash = p_token_hash
     and revocada_at is null
     and rotada_at is null
     and expira_at > now()
  returning uid
$$;

-- Renueva la sesión y, si el token tiene más de un día, lo ROTA (fila 7):
-- crea una sesión nueva con `p_hash_nuevo` para el mismo uid (conserva la
-- ventana de desbloqueo) y deja al viejo 2 minutos de gracia para las
-- peticiones que ya estaban en vuelo. Un token ya rotado no se vuelve a rotar
-- ni a renovar: así un token robado deja de servir al día siguiente.
create or replace function pulso_renovar_o_rotar(p_hash_viejo text, p_hash_nuevo text, p_dias int)
returns table (uid text, rotada boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_s sesiones%rowtype;
begin
  select * into v_s
    from sesiones s
   where s.token_hash = p_hash_viejo
     and s.revocada_at is null
     and s.rotada_at is null
     and s.expira_at > now()
   for update;

  if not found then
    return;
  end if;

  if v_s.created_at > now() - interval '1 day' then
    update sesiones
       set ultimo_uso = now(),
           expira_at  = now() + make_interval(days => pulso_dias_validos(p_dias))
     where token_hash = p_hash_viejo;
    return query select v_s.uid, false;
    return;
  end if;

  insert into sesiones (token_hash, uid, expira_at, desbloqueada_hasta)
  values (p_hash_nuevo, v_s.uid,
          now() + make_interval(days => pulso_dias_validos(p_dias)),
          v_s.desbloqueada_hasta);

  update sesiones
     set rotada_at = now(),
         expira_at = least(expira_at, now() + interval '2 minutes')
   where token_hash = p_hash_viejo;

  return query select v_s.uid, true;
end $$;

-- Abre la ventana de uso después de verificar la passkey. La verificación la
-- hace la app (WebAuthn); esto solo registra el resultado.
create or replace function pulso_desbloquear(p_token_hash text)
returns boolean
language sql security definer set search_path = public, pg_temp as $$
  update sesiones
     set desbloqueada_hasta = now() + make_interval(mins => pulso_minutos_desbloqueo())
   where token_hash = p_token_hash
     and revocada_at is null
     and expira_at > now()
  returning true
$$;

-- "Bloquear ahora": cierra la ventana de uso de esta sesión.
create or replace function pulso_bloquear(p_token_hash text)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update sesiones
     set desbloqueada_hasta = null
   where token_hash = p_token_hash
$$;

-- Desafío WebAuthn de un solo uso, atado a la sesión, válido 5 minutos.
create or replace function pulso_fijar_desafio(p_token_hash text, p_tipo text, p_desafio text)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update sesiones
     set desafio = p_desafio, desafio_tipo = p_tipo, desafio_expira = now() + interval '5 minutes'
   where token_hash = p_token_hash
     and revocada_at is null
     and expira_at > now()
$$;

create or replace function pulso_consumir_desafio(p_token_hash text, p_tipo text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_desafio text;
begin
  select s.desafio into v_desafio
    from sesiones s
   where s.token_hash = p_token_hash
     and s.desafio_tipo = p_tipo
     and s.desafio_expira > now()
   for update;

  if v_desafio is null then
    return null;
  end if;

  update sesiones
     set desafio = null, desafio_tipo = null, desafio_expira = null
   where token_hash = p_token_hash;
  return v_desafio;
end $$;

create or replace function pulso_revocar_sesion(p_token_hash text)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update sesiones
     set revocada_at = now()
   where token_hash = p_token_hash
     and revocada_at is null
$$;

-- Supresión (Ley 1581): borra todos los datos del dueño de la sesión. El uid
-- sale del token, no de un parámetro, así que no se pueden borrar datos ajenos.
-- La auditoría se conserva (no tiene datos personales: el uid es aleatorio).
create or replace function pulso_eliminar_datos(p_token_hash text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := pulso_resolver_sesion(p_token_hash);
begin
  if v_uid is null then
    return null;
  end if;

  delete from metricas           where uid = v_uid;
  delete from habitos            where uid = v_uid;
  delete from habitos_definicion where uid = v_uid;
  delete from habitos_registro   where uid = v_uid;
  delete from recetas_guardadas  where uid = v_uid;
  delete from listas_mercado     where uid = v_uid;
  delete from rutinas            where uid = v_uid;
  delete from suscripciones_push where uid = v_uid;
  delete from perfil             where uid = v_uid;
  delete from uids_legado        where uid = v_uid;
  -- en cascada: sesiones y consentimientos
  delete from identidades        where uid = v_uid;
  return v_uid;
end $$;

-- Ventana fija: true si todavía hay cupo para `p_clave` en la ventana actual.
create or replace function pulso_consumir_tasa(p_clave text, p_max int, p_ventana_seg int)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ventana timestamptz;
  v_conteo  int;
begin
  v_ventana := to_timestamp(floor(extract(epoch from now()) / p_ventana_seg) * p_ventana_seg);

  insert into limites_tasa (clave, ventana, conteo)
  values (p_clave, v_ventana, 1)
  on conflict (clave, ventana) do update set conteo = limites_tasa.conteo + 1
  returning conteo into v_conteo;

  -- limpieza oportunista de ventanas viejas
  if random() < 0.01 then
    delete from limites_tasa where ventana < now() - interval '1 day';
  end if;

  return v_conteo <= p_max;
end $$;

-- Las funciones son ejecutables por PUBLIC por defecto: se cierra y se abre
-- solo a la app.
revoke execute on function
  pulso_crear_sesion(text, int),
  pulso_reclamar_legado(text, text, int),
  pulso_resolver_sesion(text),
  pulso_renovar_sesion(text, int),
  pulso_revocar_sesion(text),
  pulso_eliminar_datos(text),
  pulso_consumir_tasa(text, int, int),
  pulso_estado_sesion(text),
  pulso_uid_de_token(text),
  pulso_renovar_o_rotar(text, text, int),
  pulso_desbloquear(text),
  pulso_bloquear(text),
  pulso_fijar_desafio(text, text, text),
  pulso_consumir_desafio(text, text)
from public;

grant execute on function
  pulso_crear_sesion(text, int),
  pulso_reclamar_legado(text, text, int),
  pulso_resolver_sesion(text),
  pulso_renovar_sesion(text, int),
  pulso_revocar_sesion(text),
  pulso_eliminar_datos(text),
  pulso_consumir_tasa(text, int, int),
  pulso_estado_sesion(text),
  pulso_uid_de_token(text),
  pulso_renovar_o_rotar(text, text, int),
  pulso_desbloquear(text),
  pulso_bloquear(text),
  pulso_fijar_desafio(text, text, text),
  pulso_consumir_desafio(text, text)
to pulso_app;

-- ─── Grants (mínimo privilegio) ──────────────────────────────────────────────

revoke all on all tables in schema public from public;

grant select, insert, update, delete on
  metricas, habitos, habitos_definicion, habitos_registro,
  recetas_guardadas, listas_mercado, rutinas, suscripciones_push, perfil
to pulso_app;

grant select, insert, update on consentimientos to pulso_app;
grant select, insert, update, delete on credenciales_bloqueo to pulso_app;

-- La app escribe auditoría pero no la lee ni la modifica; la lee el auditor.
grant insert on auditoria to pulso_app;
grant select on auditoria to pulso_auditor;

-- ─── Row Level Security ──────────────────────────────────────────────────────
-- `current_setting('app.uid', true)` es null (o '') fuera de una transacción
-- de usuario, y la comparación da falso: sin uid no hay filas. FORCE hace que
-- la política aplique también a un dueño que no sea superusuario.

do $$
declare
  t text;
begin
  foreach t in array array[
    'metricas', 'habitos', 'habitos_definicion', 'habitos_registro',
    'recetas_guardadas', 'listas_mercado', 'rutinas', 'suscripciones_push',
    'perfil', 'consentimientos', 'credenciales_bloqueo'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists propietario on %I', t);
    execute format(
      'create policy propietario on %I to pulso_app
         using (uid = current_setting(''app.uid'', true))
         with check (uid = current_setting(''app.uid'', true))',
      t
    );
  end loop;
end $$;
