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
-- `revocada_motivo` dice por qué se cerró, para que la app se lo explique al
-- usuario: 'cierre' (cerró sesión), 'otro_inicio' (entró en otro navegador),
-- 'inactividad', 'contrasena' (se cambió la contraseña) o 'admin'.
alter table sesiones
  add column if not exists rotada_at          timestamptz,
  add column if not exists desbloqueada_hasta timestamptz,
  add column if not exists desafio            text,
  add column if not exists desafio_tipo       text,
  add column if not exists desafio_expira     timestamptz,
  add column if not exists revocada_motivo    text;

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

-- ─── Purga de identidades inactivas (RP-10 / RL-09, Ley 1581 art. 4 y 11) ──
-- Una identidad anónima sin ninguna sesión utilizable ya no tiene quien vuelva
-- a entrar: no hay cuenta ni forma de recuperarla. Sus datos de salud
-- quedarían para siempre sin finalidad. Esta función borra:
--   * las identidades cuya última sesión dejó de servir (venció a los 180 días
--     sin uso, o se revocó) hace más de `p_dias` días;
--   * los uids legado que ya no se pueden reclamar (90 días) más `p_dias`;
--   * datos huérfanos: filas cuyo uid no es ni una identidad ni un legado.
-- Las identidades con una cuenta activada (correo y contraseña) no se purgan.
-- Es idempotente (correrla dos veces no borra nada más) y deja una fila en la
-- auditoría por uid. La corre el DUEÑO desde un cron (ver
-- scripts/purgar-inactivos.mjs); la app no tiene permiso. Devuelve los uids
-- borrados, para que el script borre también sus imágenes del disco.
-- La lista de tablas es la misma que la de pulso_eliminar_datos.
create or replace function pulso_purgar_inactivos(p_dias int default 30)
returns setof text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_gracia interval := make_interval(days => greatest(coalesce(p_dias, 30), 0));
  v_uid    text;
begin
  -- Enlaces de activación y recuperación usados o vencidos hace una semana.
  delete from tokens_cuenta where coalesce(usado_at, expira_at) < now() - interval '7 days';

  for v_uid in
    select i.uid
      from identidades i
      left join sesiones s on s.uid = i.uid
     -- Una cuenta activada no se purga: con el correo y la contraseña el dueño
     -- puede volver a entrar aunque todas sus sesiones hayan vencido.
     where not exists (select 1 from cuentas c where c.uid = i.uid and c.verificada_at is not null)
     group by i.uid, i.created_at
    having coalesce(max(least(s.expira_at, coalesce(s.revocada_at, s.expira_at))), i.created_at)
           < now() - v_gracia
    union
    select l.uid
      from uids_legado l
     where l.created_at < now() - interval '90 days' - v_gracia
    union
    select d.uid
      from (select uid from metricas
            union select uid from habitos
            union select uid from habitos_definicion
            union select uid from habitos_registro
            union select uid from recetas_guardadas
            union select uid from listas_mercado
            union select uid from rutinas
            union select uid from suscripciones_push
            union select uid from perfil) d
     where not exists (select 1 from identidades i where i.uid = d.uid)
       and not exists (select 1 from uids_legado l where l.uid = d.uid)
  loop
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
    -- en cascada: sesiones, consentimientos y passkeys
    delete from identidades        where uid = v_uid;

    insert into auditoria (uid, accion, resultado, detalle)
    values (v_uid, 'datos.purgar', 'ok', jsonb_build_object('motivo', 'inactividad', 'gracia_dias', extract(day from v_gracia)));
    return next v_uid;
  end loop;
end $$;

-- Solo el dueño: ni la app ni el auditor la pueden ejecutar.
revoke execute on function pulso_purgar_inactivos(int) from public;

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

-- ─── Cuotas de filas por usuario (AM-21) ─────────────────────────────────────
-- Sin tope, una sesión válida podía guardar recetas o listas de 20 000
-- caracteres sin límite de cantidad y llenar el disco. El trigger rechaza la
-- fila nueva cuando el usuario ya llegó al máximo de esa tabla; la app traduce
-- el error a un mensaje para el usuario (409 en la API móvil).
--
-- Cuenta TODAS las filas del usuario, también las dadas de baja lógica
-- (rutinas, hábitos): ocupan disco igual. El lock por usuario y tabla evita
-- que dos altas en paralelo cuenten N-1 y terminen en N+1. Corre con los
-- permisos de quien inserta: para `pulso_app`, RLS ya limita el conteo a sus
-- propias filas.
create or replace function pulso_cuota_filas() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_max   int := TG_ARGV[0]::int;
  v_filas int;
begin
  perform pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME || ':' || NEW.uid, 0));
  execute format('select count(*) from %I where uid = $1', TG_TABLE_NAME) into v_filas using NEW.uid;
  if v_filas >= v_max then
    raise exception using errcode = 'P0001', message = 'pulso_cuota_excedida', detail = TG_TABLE_NAME;
  end if;
  return NEW;
end $$;

-- Máximos holgados para un uso real (años de registros diarios) y chicos para
-- un abuso: con el límite de escrituras (300 por hora) tampoco se llega rápido.
do $$
declare
  c record;
begin
  for c in select * from (values
    ('recetas_guardadas',   200),
    ('listas_mercado',      100),
    ('rutinas',             300),
    ('habitos_definicion',  100),
    ('habitos',           10000),
    ('habitos_registro',  20000)
  ) as t(tabla, maximo)
  loop
    execute format('drop trigger if exists cuota_por_usuario on %I', c.tabla);
    execute format(
      'create trigger cuota_por_usuario before insert on %I
         for each row execute function pulso_cuota_filas(%L)',
      c.tabla, c.maximo::text
    );
  end loop;
end $$;

-- ─── Llaves foráneas de las tablas de datos a identidades (21-oct-2026) ─────
-- Las tablas de datos vienen de antes de `identidades`, cuando el uid lo
-- generaba el navegador, y se relacionaban por `uid` sin llave declarada. Se
-- agregan como NOT VALID: la base las exige para toda fila nueva o modificada,
-- pero no revisa las filas viejas de uids legado todavía sin reclamar, que no
-- están en `identidades` y que la purga borra al vencer su ventana de 90 días.
-- Cuando ya no queden, se puede correr `alter table ... validate constraint`.
-- Con `on delete cascade`, borrar una identidad borra sus datos (igual que hace
-- `pulso_eliminar_datos` tabla por tabla). `auditoria` queda sin llave a
-- propósito: es append-only y tiene que sobrevivir al borrado del usuario.
do $$
declare
  t text;
begin
  foreach t in array array['metricas', 'habitos', 'habitos_definicion', 'habitos_registro',
                           'recetas_guardadas', 'listas_mercado', 'rutinas', 'perfil',
                           'suscripciones_push']
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = t::regclass and conname = t || '_uid_fkey') then
      execute format('alter table %I add constraint %I foreign key (uid)
                        references identidades (uid) on delete cascade not valid',
                     t, t || '_uid_fkey');
    end if;
  end loop;
end $$;

-- ─── Cuentas con correo y contraseña (21-oct-2026) ──────────────────────────
-- Opcionales: la app se sigue usando sin cuenta, como antes. Crear una cuenta
-- le pone correo y contraseña a la identidad de la sesión actual, así que todo
-- lo que ya había guardado queda en la cuenta. Con la cuenta se puede volver a
-- entrar desde otro equipo o después de borrar las cookies.
--
--   * La contraseña se guarda con bcrypt (pgcrypto, costo 12), nunca en claro.
--     Se compara acá adentro: la app no puede leer los hashes ni abrir una
--     sesión para una cuenta sin la contraseña correcta.
--   * Los enlaces de activación y de recuperación llevan un token aleatorio de
--     256 bits; acá se guarda solo su SHA-256, como con las sesiones. Son de un
--     solo uso y vencen (24 horas la activación, 1 hora la recuperación).
--   * Hasta activar la cuenta con el enlace del correo no se puede iniciar
--     sesión con ella.
--   * Como las demás tablas de sistema, `cuentas` y `tokens_cuenta` no tienen
--     grants para `pulso_app`: solo se tocan con las funciones de abajo.
--
-- Ronda de seguridad del integrador (oct-2026):
--   * Punto 19 — el correo ya no se guarda en claro: `email_hmac` (índice
--     ciego, HMAC-SHA256 con una clave que solo tiene la app) sirve para
--     buscar y para exigir unicidad, y `email_cifrado` (AES-256-GCM) para
--     mostrarlo y mandar correos. La base no tiene la clave: no puede leerlo.
--     Ver src/lib/cuenta.ts (`hmacCorreo`, `cifrarCorreo`) y la migración
--     scripts/migrar-cifrado-cuentas.mjs.
--   * Punto 13 — regla de contraseñas (`pulso_contrasena_fallas`), la misma
--     que src/lib/seguridad/contrasena.ts.
--   * Punto 4 — bloqueo de 15 minutos a los 5 intentos fallidos seguidos,
--     contado por correo (`intentos_acceso`), exista la cuenta o no.
--   * Punto 16 — iniciar sesión cierra las demás sesiones de la cuenta.
--   * Punto 20 — cambio de contraseña y de correo desde el perfil.

create extension if not exists pgcrypto;

create table if not exists cuentas (
  uid            text primary key references identidades (uid) on delete cascade,
  email_hmac     text not null check (email_hmac ~ '^[0-9a-f]{64}$'),
  email_cifrado  text not null check (email_cifrado like 'v1.%'),
  password_hash  text not null,
  verificada_at  timestamptz,
  created_at     timestamptz not null default now(),
  actualizada_at timestamptz not null default now()
);

-- Una base que viene del esquema con el correo en claro (`email`) recibe acá
-- las columnas nuevas. Mientras no se corra la migración, `email` deja de ser
-- obligatorio (las cuentas nuevas ya no lo llenan); la migración cifra las
-- filas viejas, comprueba que se descifran y recién entonces borra `email`.
-- Después de migrar (o en una base nueva), las dos columnas son obligatorias.
alter table cuentas
  add column if not exists email_hmac    text check (email_hmac ~ '^[0-9a-f]{64}$'),
  add column if not exists email_cifrado text check (email_cifrado like 'v1.%');

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'cuentas' and column_name = 'email') then
    alter table cuentas alter column email drop not null;
  else
    alter table cuentas alter column email_hmac set not null, alter column email_cifrado set not null;
  end if;
end $$;

-- Duplicados (punto 6): el correo se normaliza (sin espacios y en minúsculas)
-- antes del HMAC, así que "Ana@X.com " y "ana@x.com" chocan acá.
create unique index if not exists cuentas_email_hmac_idx on cuentas (email_hmac);

-- Enlaces de un solo uso. 'cambio_correo' (punto 20) lleva el correo nuevo,
-- también cifrado, hasta que se confirma desde ese correo.
create table if not exists tokens_cuenta (
  token_hash          text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  uid                 text not null references identidades (uid) on delete cascade,
  tipo                text not null,
  expira_at           timestamptz not null,
  usado_at            timestamptz,
  created_at          timestamptz not null default now(),
  nuevo_email_hmac    text check (nuevo_email_hmac ~ '^[0-9a-f]{64}$'),
  nuevo_email_cifrado text check (nuevo_email_cifrado like 'v1.%')
);

alter table tokens_cuenta
  add column if not exists nuevo_email_hmac    text check (nuevo_email_hmac ~ '^[0-9a-f]{64}$'),
  add column if not exists nuevo_email_cifrado text check (nuevo_email_cifrado like 'v1.%');

alter table tokens_cuenta drop constraint if exists tokens_cuenta_tipo_check;
alter table tokens_cuenta add constraint tokens_cuenta_tipo_check
  check (tipo in ('activacion', 'recuperacion', 'cambio_correo'));
alter table tokens_cuenta drop constraint if exists tokens_cuenta_cambio_check;
alter table tokens_cuenta add constraint tokens_cuenta_cambio_check
  check ((tipo = 'cambio_correo') = (nuevo_email_hmac is not null and nuevo_email_cifrado is not null));

create index if not exists tokens_cuenta_uid_idx on tokens_cuenta (uid);

-- Intentos fallidos de acceso (punto 4), por correo y no por cuenta: un correo
-- sin cuenta se bloquea igual, así el bloqueo no delata quién está registrado.
-- La clave es el mismo índice ciego que `cuentas.email_hmac`.
create table if not exists intentos_acceso (
  email_hmac      text primary key check (email_hmac ~ '^[0-9a-f]{64}$'),
  fallos          int not null default 0,
  ultimo_fallo_at timestamptz not null default now(),
  bloqueada_hasta timestamptz
);

-- ─── Regla de contraseñas (punto 13) ─────────────────────────────────────────
-- La misma que src/lib/seguridad/contrasena.ts, con los mismos textos: mínimo
-- 10 caracteres y máximo 72 bytes (bcrypt solo mira los primeros 72: más
-- largo, dos contraseñas distintas serían la misma), mayúscula, minúscula,
-- número y símbolo; sin secuencias de 4 (1234, abcd, 4321), sin 4 caracteres
-- iguales seguidos, que no sea una contraseña común y que no contenga la parte
-- local del correo. Las letras y las minúsculas salen de tablas fijas, no del
-- locale, para que dé exactamente lo mismo que en la app.
-- Devuelve una fila por regla que NO se cumple (vacía = la contraseña sirve).
drop function if exists pulso_contrasena_valida(text);

create or replace function pulso_contrasena_fallas(p_password text, p_email text default null)
returns table (regla text, mensaje text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  c_may    constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑ';
  c_min    constant text := 'abcdefghijklmnopqrstuvwxyzáéíóúüñ';
  c_dig    constant text := '0123456789';
  c_esp    constant text := E' \t\n\r';
  c_alnum  constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  c_comunes constant text[] := array[
    'password', 'contrasena', 'contraseña', 'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl',
    'zxcvbnm', 'qweasd', 'iloveyou', 'teamo', 'admin', 'administrador', 'usuario', 'pulso',
    'colombia', 'bogota', 'welcome', 'bienvenido', 'letmein', 'monkey', 'dragon', 'football',
    'futbol', 'superman', 'batman', 'princesa', 'sunshine', 'master', 'secreto', 'clave',
    'miclave', 'hola', 'holamundo', 'abc', 'abcabc'];
  v_p      text := coalesce(p_password, '');
  v_bajas  text := translate(v_p, c_may, c_min);
  v_n      int  := char_length(v_p);
  v_local  text;
  v_sec    boolean := false;
  v_rep    boolean := false;
  v_paso   int;
  v_ok     boolean;
  i        int;
  j        int;
begin
  for i in 1 .. v_n - 3 loop
    -- Repetidos: 4 iguales seguidos (en minúsculas: "aAaA" también cuenta).
    if not v_rep and substr(v_bajas, i, 1) = substr(v_bajas, i + 1, 1)
       and substr(v_bajas, i, 1) = substr(v_bajas, i + 2, 1)
       and substr(v_bajas, i, 1) = substr(v_bajas, i + 3, 1) then
      v_rep := true;
    end if;
    -- Secuencias: 4 letras sin tilde o dígitos que suben o bajan de a uno.
    if not v_sec and strpos(c_alnum, substr(v_bajas, i, 1)) > 0 then
      v_paso := ascii(substr(v_bajas, i + 1, 1)) - ascii(substr(v_bajas, i, 1));
      if v_paso in (1, -1) then
        v_ok := true;
        for j in 1 .. 3 loop
          if strpos(c_alnum, substr(v_bajas, i + j, 1)) = 0
             or ascii(substr(v_bajas, i + j, 1)) - ascii(substr(v_bajas, i + j - 1, 1)) <> v_paso then
            v_ok := false;
          end if;
        end loop;
        v_sec := v_ok;
      end if;
    end if;
  end loop;

  if v_n < 10 then
    return query select 'largo'::text, 'Al menos 10 caracteres'::text;
  end if;
  if octet_length(v_p) > 72 then
    return query select 'maximo'::text, 'Como máximo 72 bytes (las tildes y los emojis ocupan más de uno)'::text;
  end if;
  if char_length(translate(v_p, c_may, '')) = v_n then
    return query select 'mayuscula'::text, 'Al menos una letra mayúscula'::text;
  end if;
  if char_length(translate(v_p, c_min, '')) = v_n then
    return query select 'minuscula'::text, 'Al menos una letra minúscula'::text;
  end if;
  if char_length(translate(v_p, c_dig, '')) = v_n then
    return query select 'numero'::text, 'Al menos un número'::text;
  end if;
  if char_length(translate(v_p, c_may || c_min || c_dig || c_esp, '')) = 0 then
    return query select 'simbolo'::text, 'Al menos un símbolo, como ! ? # * -'::text;
  end if;
  if v_sec then
    return query select 'secuencia'::text, 'Sin secuencias de 4 o más, como 1234, abcd o 4321'::text;
  end if;
  if v_rep then
    return query select 'repetidos'::text, 'Sin 4 o más caracteres iguales seguidos, como aaaa'::text;
  end if;
  -- Común: solo sus letras ("Password1!" → "password").
  if regexp_replace(v_bajas, '[^abcdefghijklmnopqrstuvwxyzáéíóúüñ]', '', 'g') = any (c_comunes) then
    return query select 'comun'::text, 'Que no sea una contraseña común, como Password o Qwerty'::text;
  end if;
  if p_email is not null then
    v_local := split_part(translate(btrim(p_email, c_esp), c_may, c_min), '@', 1);
    -- Con 3 letras o menos ("ana@…") la regla rechazaría medio diccionario.
    if char_length(v_local) >= 4 and strpos(v_bajas, v_local) > 0 then
      return query select 'correo'::text, 'Que no contenga tu correo'::text;
    end if;
  end if;
end $$;

-- true si la contraseña cumple la regla. Es la que usan las funciones de
-- cuentas (y la administración) antes de guardar un hash.
create or replace function pulso_contrasena_valida(p_password text, p_email text default null) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_password is not null and not exists (select 1 from pulso_contrasena_fallas(p_password, p_email))
$$;

-- ─── Bloqueo por intentos fallidos (punto 4) ─────────────────────────────────
-- 5 fallos seguidos bloquean el correo 15 minutos: mientras tanto ni la
-- contraseña correcta entra. El contador vuelve a 0 al acertar, al restablecer
-- la contraseña y cuando vence un bloqueo; un fallo de hace más de un día
-- tampoco suma (si no, cuatro errores de hace meses y uno de hoy bloquearían).
-- Las usan solo las funciones de abajo: la app no las puede ejecutar.

create or replace function pulso_max_intentos() returns int
language sql immutable as $$ select 5 $$;

create or replace function pulso_minutos_bloqueo_cuenta() returns int
language sql immutable as $$ select 15 $$;

-- Minutos que le faltan al bloqueo de ese correo (redondeado hacia arriba), o
-- null si no está bloqueado.
create or replace function pulso_bloqueo_restante(p_email_hmac text) returns int
language sql stable set search_path = public, pg_temp as $$
  select greatest(ceil(extract(epoch from (i.bloqueada_hasta - now())) / 60), 1)::int
    from intentos_acceso i
   where i.email_hmac = p_email_hmac
     and i.bloqueada_hasta > now()
$$;

-- Suma un fallo. `restantes` es cuántos intentos quedan antes del bloqueo;
-- `bloqueada` es true si este fallo fue el que bloqueó.
create or replace function pulso_registrar_fallo(p_email_hmac text)
returns table (restantes int, bloqueada boolean)
language plpgsql set search_path = public, pg_temp as $$
declare
  v_fallos int;
begin
  insert into intentos_acceso as i (email_hmac, fallos, ultimo_fallo_at)
  values (p_email_hmac, 1, now())
  on conflict (email_hmac) do update
     set fallos = case
                    when i.bloqueada_hasta <= now() or i.ultimo_fallo_at < now() - interval '1 day' then 1
                    else i.fallos + 1
                  end,
         bloqueada_hasta = case when i.bloqueada_hasta > now() then i.bloqueada_hasta end,
         ultimo_fallo_at = now()
  returning i.fallos into v_fallos;

  -- limpieza oportunista de correos que ya no están en juego
  if random() < 0.01 then
    delete from intentos_acceso
     where ultimo_fallo_at < now() - interval '2 days'
       and (bloqueada_hasta is null or bloqueada_hasta < now());
  end if;

  if v_fallos >= pulso_max_intentos() then
    update intentos_acceso
       set bloqueada_hasta = now() + make_interval(mins => pulso_minutos_bloqueo_cuenta())
     where email_hmac = p_email_hmac;
    return query select 0, true;
  else
    return query select pulso_max_intentos() - v_fallos, false;
  end if;
end $$;

create or replace function pulso_limpiar_fallos(p_email_hmac text) returns void
language sql set search_path = public, pg_temp as $$
  delete from intentos_acceso where email_hmac = p_email_hmac
$$;

-- Un intento a la vez por correo (login, cambio de contraseña o de correo):
-- sin esto, varios intentos en paralelo leerían el mismo contador y pasarían
-- más de 5. El lock es de la transacción, así que se suelta solo.
create or replace function pulso_turno_de_acceso(p_email_hmac text) returns void
language sql set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended('pulso_acceso:' || coalesce(p_email_hmac, ''), 0))
$$;

-- Registro: la cuenta queda sobre la identidad de la sesión (desbloqueada),
-- con todos sus datos. Devuelve:
--   'ok'                  cuenta creada, falta activarla con el token
--   'sin_sesion'          no hay sesión utilizable
--   'ya_tiene_cuenta'     esta identidad ya tiene una cuenta
--   'email_en_uso'        el correo es de otra cuenta (la app no lo dice: le
--                         avisa por correo al dueño, para no revelar quién está registrado)
--   'contrasena_invalida'
-- Un registro que nunca se activó no retiene el correo: cuando su enlace
-- vence, el correo se libera para quien lo pida de nuevo.
-- El correo llega como índice ciego y cifrado (punto 19); `p_email` (ya
-- normalizado) es solo para la regla "que no contenga tu correo": no se guarda.
drop function if exists pulso_registrar_cuenta(text, text, text, text);

create or replace function pulso_registrar_cuenta(
  p_sesion_hash text, p_email_hmac text, p_email_cifrado text, p_email text, p_password text, p_token_hash text
)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   text := pulso_resolver_sesion(p_sesion_hash);
  v_otro  cuentas%rowtype;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not pulso_contrasena_valida(p_password, p_email) then
    return 'contrasena_invalida';
  end if;
  if exists (select 1 from cuentas c where c.uid = v_uid) then
    return 'ya_tiene_cuenta';
  end if;

  select * into v_otro from cuentas c where c.email_hmac = p_email_hmac for update;
  if found then
    if v_otro.verificada_at is not null
       or exists (select 1 from tokens_cuenta t
                   where t.uid = v_otro.uid and t.tipo = 'activacion'
                     and t.usado_at is null and t.expira_at > now()) then
      return 'email_en_uso';
    end if;
    delete from tokens_cuenta t where t.uid = v_otro.uid;
    delete from cuentas c where c.uid = v_otro.uid;
  end if;

  insert into cuentas (uid, email_hmac, email_cifrado, password_hash)
  values (v_uid, p_email_hmac, p_email_cifrado, crypt(p_password, gen_salt('bf', 12)));
  insert into tokens_cuenta (token_hash, uid, tipo, expira_at)
  values (p_token_hash, v_uid, 'activacion', now() + interval '24 hours');
  return 'ok';
exception
  when unique_violation then
    -- dos registros con el mismo correo a la vez: gana el primero
    return 'email_en_uso';
end $$;

-- Activación con el token del correo. true si se activó.
create or replace function pulso_activar_cuenta(p_token_hash text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text;
begin
  update tokens_cuenta t
     set usado_at = now()
   where t.token_hash = p_token_hash
     and t.tipo = 'activacion'
     and t.usado_at is null
     and t.expira_at > now()
  returning t.uid into v_uid;

  if v_uid is null then
    return false;
  end if;
  update cuentas c
     set verificada_at = coalesce(c.verificada_at, now()), actualizada_at = now()
   where c.uid = v_uid;
  return found;
end $$;

-- Nuevo enlace de activación para la cuenta (sin activar) de la sesión. Los
-- anteriores dejan de servir. Devuelve el correo (cifrado: lo descifra la
-- app) al que mandarlo, o null.
create or replace function pulso_reenviar_activacion(p_sesion_hash text, p_token_hash text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   text := pulso_resolver_sesion(p_sesion_hash);
  v_email text;
begin
  select c.email_cifrado into v_email from cuentas c where c.uid = v_uid and c.verificada_at is null;
  if v_email is null then
    return null;
  end if;
  update tokens_cuenta t set usado_at = now()
   where t.uid = v_uid and t.tipo = 'activacion' and t.usado_at is null;
  insert into tokens_cuenta (token_hash, uid, tipo, expira_at)
  values (p_token_hash, v_uid, 'activacion', now() + interval '24 hours');
  return v_email;
end $$;

-- Cuenta de la sesión (desbloqueada), para mostrarla en la app. El correo va
-- cifrado: lo descifra la app.
drop function if exists pulso_cuenta_de_sesion(text);

create or replace function pulso_cuenta_de_sesion(p_sesion_hash text)
returns table (email_cifrado text, verificada boolean)
language sql security definer set search_path = public, pg_temp as $$
  select c.email_cifrado, c.verificada_at is not null
    from cuentas c
   where c.uid = pulso_resolver_sesion(p_sesion_hash)
$$;

-- Pasa los datos de una identidad sin cuenta a otra y borra la primera. La
-- usa el inicio de sesión: lo que se guardó en este equipo antes de entrar se
-- suma a la cuenta. Cuando hay choque (el mismo hábito del mismo día, el
-- perfil, la misma suscripción push) gana lo que ya tenía la cuenta. Las
-- imágenes de recetas pasan a la carpeta de la cuenta: acá se reescriben las
-- URLs y la app mueve los archivos (ver `moverImagenes` en src/lib/media.ts).
-- Los exámenes (db/examenes.sql) pasan con solo cambiar el dueño: su archivo
-- cifrado no depende del uid.
-- No se pasan el consentimiento ni las passkeys: son de quien los dio, y la
-- cuenta tiene los suyos. Solo la llaman otras funciones: la app no la puede
-- ejecutar.
create or replace function pulso_fusionar_identidad(p_de text, p_a text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_url_uid  text := '/api/img/recetas/' || p_de || '/';
  v_url_hash text := '/api/img/recetas/' || substr(encode(digest('pulso-media:' || p_de, 'sha256'), 'hex'), 1, 32) || '/';
  v_url_a    text := '/api/img/recetas/' || substr(encode(digest('pulso-media:' || p_a, 'sha256'), 'hex'), 1, 32) || '/';
begin
  update metricas set uid = p_a where uid = p_de;
  update habitos h set uid = p_a
   where h.uid = p_de
     and not exists (select 1 from habitos x where x.uid = p_a and x.fecha = h.fecha and x.tipo = h.tipo);
  update habitos_definicion set uid = p_a where uid = p_de;
  update habitos_registro h set uid = p_a
   where h.uid = p_de
     and not exists (select 1 from habitos_registro x
                      where x.uid = p_a and x.fecha = h.fecha and x.tipo = h.tipo
                        and x.ref_id is not distinct from h.ref_id);
  update recetas_guardadas
     set uid = p_a,
         imagen_url = case
           when starts_with(imagen_url, v_url_uid)  then v_url_a || substr(imagen_url, char_length(v_url_uid) + 1)
           when starts_with(imagen_url, v_url_hash) then v_url_a || substr(imagen_url, char_length(v_url_hash) + 1)
           else imagen_url
         end
   where uid = p_de;
  update listas_mercado set uid = p_a where uid = p_de;
  update rutinas set uid = p_a where uid = p_de;
  update suscripciones_push s set uid = p_a
   where s.uid = p_de
     and not exists (select 1 from suscripciones_push x where x.uid = p_a and x.endpoint = s.endpoint);
  update perfil set uid = p_a
   where uid = p_de
     and not exists (select 1 from perfil x where x.uid = p_a);
  -- Exámenes (integrador, punto 15): sin choques posibles. La tabla la crea
  -- examenes.sql, que setup-db aplica después; plpgsql la resuelve al correr.
  update examenes set uid = p_a where uid = p_de;

  -- Lo que no se pudo pasar (los choques) se borra con la identidad.
  delete from metricas           where uid = p_de;
  delete from habitos            where uid = p_de;
  delete from habitos_definicion where uid = p_de;
  delete from habitos_registro   where uid = p_de;
  delete from recetas_guardadas  where uid = p_de;
  delete from listas_mercado     where uid = p_de;
  delete from rutinas            where uid = p_de;
  delete from suscripciones_push where uid = p_de;
  delete from perfil             where uid = p_de;
  delete from uids_legado        where uid = p_de;
  -- en cascada: sesiones, consentimientos y passkeys
  delete from identidades        where uid = p_de;

  insert into auditoria (uid, accion, resultado, detalle)
  values (p_a, 'cuenta.fusionar', 'ok', jsonb_build_object('de', p_de));
end $$;

-- Inicio de sesión con correo y contraseña. Si la contraseña es correcta y la
-- cuenta está activada, crea una sesión nueva para la cuenta (ya desbloqueada:
-- la contraseña es la prueba), revoca la de este equipo y cierra las demás
-- sesiones de la cuenta (punto 16: queda solo la del equipo que acaba de
-- entrar). Si la sesión de este equipo era de una identidad sin cuenta, sus
-- datos pasan a la cuenta.
-- El correo llega como índice ciego (`p_email_hmac`, punto 19).
-- `resultado`: 'ok', 'credenciales' (correo o contraseña mal, sin decir
-- cuál), 'sin_verificar' o 'bloqueada' (punto 4: `minutos` que faltan).
--   * `uid_cuenta`: la cuenta, si el correo tiene una (también en los rechazos,
--     para la auditoría; la app no se lo dice al cliente).
--   * `uid_fusionado`: la identidad que se sumó, para que la app mueva sus imágenes.
--   * `intentos_restantes`: antes del bloqueo, tras un fallo.
--   * `bloqueo_nuevo`: este fallo bloqueó el correo (la app avisa al dueño).
--   * `sesiones_cerradas`: cuántas sesiones de la cuenta se cerraron.
drop function if exists pulso_iniciar_sesion_cuenta(text, text, text, int, text);

create or replace function pulso_iniciar_sesion_cuenta(
  p_email_hmac text, p_password text, p_nuevo_hash text, p_dias int, p_actual_hash text
)
returns table (resultado text, uid_cuenta text, uid_fusionado text, minutos int,
               intentos_restantes int, bloqueo_nuevo boolean, sesiones_cerradas int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c        cuentas%rowtype;
  v_actual   text;
  v_minutos  int;
  v_fallo    record;
  v_cerradas int;
begin
  perform pulso_turno_de_acceso(p_email_hmac);
  select * into v_c from cuentas c where c.email_hmac = p_email_hmac;

  -- Bloqueado: no se mira la contraseña (ni la correcta entra) ni suma fallos.
  v_minutos := pulso_bloqueo_restante(p_email_hmac);
  if v_minutos is not null then
    return query select 'bloqueada'::text, v_c.uid, null::text, v_minutos, 0, false, 0;
    return;
  end if;

  if v_c.uid is null then
    -- El mismo trabajo que con una cuenta real: que el tiempo de respuesta no
    -- diga si el correo está registrado.
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 12));
  end if;
  if v_c.uid is null or p_password is null or crypt(p_password, v_c.password_hash) <> v_c.password_hash then
    select * into v_fallo from pulso_registrar_fallo(p_email_hmac);
    return query select case when v_fallo.bloqueada then 'bloqueada' else 'credenciales' end::text,
                        v_c.uid, null::text,
                        case when v_fallo.bloqueada then pulso_minutos_bloqueo_cuenta() end::int,
                        v_fallo.restantes::int, v_fallo.bloqueada::boolean, 0;
    return;
  end if;

  -- La contraseña es correcta: el contador vuelve a 0 (aunque falte activar).
  perform pulso_limpiar_fallos(p_email_hmac);
  if v_c.verificada_at is null then
    return query select 'sin_verificar'::text, v_c.uid, null::text, null::int, null::int, false, 0;
    return;
  end if;

  if p_actual_hash is not null then
    -- Solo una sesión desbloqueada aporta sus datos: si la identidad tiene
    -- bloqueo con passkey, iniciar sesión no puede ser la forma de saltarlo.
    -- Esta sesión no lleva motivo: la reemplaza la nueva en el mismo equipo.
    v_actual := pulso_resolver_sesion(p_actual_hash);
    update sesiones s set revocada_at = now()
     where s.token_hash = p_actual_hash and s.revocada_at is null;
    if v_actual is not null and v_actual <> v_c.uid
       and not exists (select 1 from cuentas c where c.uid = v_actual) then
      perform pulso_fusionar_identidad(v_actual, v_c.uid);
    else
      v_actual := null;
    end if;
  end if;

  -- Una sola sesión por cuenta: las de otros navegadores o teléfonos se
  -- cierran con el motivo, para que la app le explique al otro equipo por qué
  -- salió.
  update sesiones s set revocada_at = now(), revocada_motivo = 'otro_inicio'
   where s.uid = v_c.uid and s.revocada_at is null;
  get diagnostics v_cerradas = row_count;

  insert into sesiones (token_hash, uid, expira_at, desbloqueada_hasta)
  values (p_nuevo_hash, v_c.uid,
          now() + make_interval(days => pulso_dias_validos(p_dias)),
          now() + make_interval(mins => pulso_minutos_desbloqueo()));
  return query select 'ok'::text, v_c.uid, v_actual, null::int, null::int, false, v_cerradas;
end $$;

-- Pide el enlace de recuperación. Los anteriores dejan de servir. true si el
-- correo es de una cuenta (la app responde lo mismo en los dos casos).
drop function if exists pulso_solicitar_recuperacion(text, text);

create or replace function pulso_solicitar_recuperacion(p_email_hmac text, p_token_hash text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text;
begin
  select c.uid into v_uid from cuentas c where c.email_hmac = p_email_hmac;
  if v_uid is null then
    return false;
  end if;
  update tokens_cuenta t set usado_at = now()
   where t.uid = v_uid and t.tipo = 'recuperacion' and t.usado_at is null;
  insert into tokens_cuenta (token_hash, uid, tipo, expira_at)
  values (p_token_hash, v_uid, 'recuperacion', now() + interval '1 hour');
  return true;
end $$;

-- Correo (cifrado) de la cuenta de un enlace de recuperación vigente, o null.
-- La app lo necesita para aplicar la regla "que no contenga tu correo" antes
-- de restablecer: quien tiene el enlace ya tiene ese correo.
create or replace function pulso_correo_de_recuperacion(p_token_hash text)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select c.email_cifrado
    from tokens_cuenta t
    join cuentas c on c.uid = t.uid
   where t.token_hash = p_token_hash
     and t.tipo = 'recuperacion'
     and t.usado_at is null
     and t.expira_at > now()
$$;

-- Contraseña nueva con el token de recuperación. Cierra todas las sesiones de
-- la cuenta con el motivo 'contrasena' (si alguien entró con la contraseña
-- vieja, queda afuera), anula los demás enlaces (también un cambio de correo
-- pendiente), levanta el bloqueo por intentos fallidos y, como el enlace llegó
-- al correo, deja la cuenta activada.
-- `resultado`: 'ok', 'enlace_invalido' o 'contrasena_invalida'.
-- `p_email` (normalizado, el de `pulso_correo_de_recuperacion`) es solo para la regla.
drop function if exists pulso_restablecer_contrasena(text, text);

create or replace function pulso_restablecer_contrasena(p_token_hash text, p_password text, p_email text)
returns table (resultado text, sesiones_cerradas int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid      text;
  v_cerradas int;
begin
  if not pulso_contrasena_valida(p_password, p_email) then
    return query select 'contrasena_invalida'::text, 0;
    return;
  end if;
  update tokens_cuenta t
     set usado_at = now()
   where t.token_hash = p_token_hash
     and t.tipo = 'recuperacion'
     and t.usado_at is null
     and t.expira_at > now()
  returning t.uid into v_uid;

  if v_uid is null then
    return query select 'enlace_invalido'::text, 0;
    return;
  end if;
  update cuentas c
     set password_hash  = crypt(p_password, gen_salt('bf', 12)),
         verificada_at  = coalesce(c.verificada_at, now()),
         actualizada_at = now()
   where c.uid = v_uid;
  update tokens_cuenta t set usado_at = now() where t.uid = v_uid and t.usado_at is null;
  delete from intentos_acceso i using cuentas c where c.uid = v_uid and i.email_hmac = c.email_hmac;
  update sesiones s set revocada_at = now(), revocada_motivo = 'contrasena'
   where s.uid = v_uid and s.revocada_at is null;
  get diagnostics v_cerradas = row_count;
  return query select 'ok'::text, v_cerradas;
end $$;

-- Cambio de contraseña desde el perfil (punto 20): la contraseña actual, la
-- nueva y la sesión. La actual equivocada cuenta para el bloqueo, como en el
-- inicio de sesión. Si sale bien, cierra las DEMÁS sesiones de la cuenta con
-- el motivo 'contrasena' (la de este equipo sigue) y anula los enlaces de
-- recuperación pendientes.
-- `resultado`: 'ok', 'sin_cuenta', 'credenciales', 'bloqueada',
-- 'contrasena_invalida' o 'misma' (la nueva es igual a la actual).
-- `p_email` (normalizado) es solo para la regla.
create or replace function pulso_cambiar_contrasena(p_sesion_hash text, p_actual text, p_nueva text, p_email text)
returns table (resultado text, minutos int, intentos_restantes int, bloqueo_nuevo boolean, sesiones_cerradas int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid      text := pulso_uid_con_cuenta(p_sesion_hash);
  v_c        cuentas%rowtype;
  v_minutos  int;
  v_fallo    record;
  v_cerradas int;
begin
  if v_uid is null then
    return query select 'sin_cuenta'::text, null::int, null::int, false, 0;
    return;
  end if;
  select * into v_c from cuentas c where c.uid = v_uid;
  perform pulso_turno_de_acceso(v_c.email_hmac);

  v_minutos := pulso_bloqueo_restante(v_c.email_hmac);
  if v_minutos is not null then
    return query select 'bloqueada'::text, v_minutos, 0, false, 0;
    return;
  end if;
  if p_actual is null or crypt(p_actual, v_c.password_hash) <> v_c.password_hash then
    select * into v_fallo from pulso_registrar_fallo(v_c.email_hmac);
    return query select case when v_fallo.bloqueada then 'bloqueada' else 'credenciales' end::text,
                        case when v_fallo.bloqueada then pulso_minutos_bloqueo_cuenta() end::int,
                        v_fallo.restantes::int, v_fallo.bloqueada::boolean, 0;
    return;
  end if;
  perform pulso_limpiar_fallos(v_c.email_hmac);

  if not pulso_contrasena_valida(p_nueva, p_email) then
    return query select 'contrasena_invalida'::text, null::int, null::int, false, 0;
    return;
  end if;
  if crypt(p_nueva, v_c.password_hash) = v_c.password_hash then
    return query select 'misma'::text, null::int, null::int, false, 0;
    return;
  end if;

  update cuentas c
     set password_hash = crypt(p_nueva, gen_salt('bf', 12)), actualizada_at = now()
   where c.uid = v_uid;
  update tokens_cuenta t set usado_at = now()
   where t.uid = v_uid and t.tipo = 'recuperacion' and t.usado_at is null;
  update sesiones s set revocada_at = now(), revocada_motivo = 'contrasena'
   where s.uid = v_uid and s.token_hash <> p_sesion_hash and s.revocada_at is null;
  get diagnostics v_cerradas = row_count;
  return query select 'ok'::text, null::int, null::int, false, v_cerradas;
end $$;

-- true si otra cuenta tiene ese correo y lo retiene: activada, o sin activar
-- con su enlace de activación todavía vigente (igual que en el registro).
create or replace function pulso_correo_retenido(p_email_hmac text, p_uid text)
returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from cuentas c
     where c.email_hmac = p_email_hmac
       and c.uid <> p_uid
       and (c.verificada_at is not null
            or exists (select 1 from tokens_cuenta t
                        where t.uid = c.uid and t.tipo = 'activacion'
                          and t.usado_at is null and t.expira_at > now())))
$$;

-- Pedido de cambio de correo desde el perfil (punto 20): la contraseña actual
-- (cuenta para el bloqueo) y el correo nuevo, cifrado y con su índice ciego.
-- No cambia nada todavía: guarda un enlace de 24 horas que la app manda al
-- correo NUEVO; el cambio rige al abrirlo (`pulso_confirmar_cambio_correo`).
-- Los pedidos anteriores dejan de servir.
-- `resultado`: 'ok', 'en_uso' (el correo nuevo es de otra cuenta: la app
-- responde lo mismo que con 'ok' y no se guarda nada), 'mismo', 'sin_cuenta',
-- 'credenciales' o 'bloqueada'.
create or replace function pulso_solicitar_cambio_correo(
  p_sesion_hash text, p_password text, p_nuevo_hmac text, p_nuevo_cifrado text, p_token_hash text
)
returns table (resultado text, minutos int, intentos_restantes int, bloqueo_nuevo boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     text := pulso_uid_con_cuenta(p_sesion_hash);
  v_c       cuentas%rowtype;
  v_minutos int;
  v_fallo   record;
begin
  if v_uid is null then
    return query select 'sin_cuenta'::text, null::int, null::int, false;
    return;
  end if;
  select * into v_c from cuentas c where c.uid = v_uid;
  perform pulso_turno_de_acceso(v_c.email_hmac);

  v_minutos := pulso_bloqueo_restante(v_c.email_hmac);
  if v_minutos is not null then
    return query select 'bloqueada'::text, v_minutos, 0, false;
    return;
  end if;
  if p_password is null or crypt(p_password, v_c.password_hash) <> v_c.password_hash then
    select * into v_fallo from pulso_registrar_fallo(v_c.email_hmac);
    return query select case when v_fallo.bloqueada then 'bloqueada' else 'credenciales' end::text,
                        case when v_fallo.bloqueada then pulso_minutos_bloqueo_cuenta() end::int,
                        v_fallo.restantes::int, v_fallo.bloqueada::boolean;
    return;
  end if;
  perform pulso_limpiar_fallos(v_c.email_hmac);

  if p_nuevo_hmac = v_c.email_hmac then
    return query select 'mismo'::text, null::int, null::int, false;
    return;
  end if;
  if pulso_correo_retenido(p_nuevo_hmac, v_uid) then
    return query select 'en_uso'::text, null::int, null::int, false;
    return;
  end if;

  update tokens_cuenta t set usado_at = now()
   where t.uid = v_uid and t.tipo = 'cambio_correo' and t.usado_at is null;
  insert into tokens_cuenta (token_hash, uid, tipo, expira_at, nuevo_email_hmac, nuevo_email_cifrado)
  values (p_token_hash, v_uid, 'cambio_correo', now() + interval '24 hours', p_nuevo_hmac, p_nuevo_cifrado);
  return query select 'ok'::text, null::int, null::int, false;
end $$;

-- Confirma el cambio de correo con el enlace que llegó al correo nuevo. No
-- pide sesión: el enlace se puede abrir en otro equipo, y es la prueba de que
-- el correo es de quien lo pidió.
-- `resultado`: 'ok', 'enlace_invalido' o 'en_uso' (mientras tanto el correo
-- pasó a ser de otra cuenta). `uid` es la cuenta, para la auditoría.
create or replace function pulso_confirmar_cambio_correo(p_token_hash text)
returns table (resultado text, uid text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_t tokens_cuenta%rowtype;
begin
  update tokens_cuenta t
     set usado_at = now()
   where t.token_hash = p_token_hash
     and t.tipo = 'cambio_correo'
     and t.usado_at is null
     and t.expira_at > now()
  returning t.* into v_t;

  if v_t.uid is null then
    return query select 'enlace_invalido'::text, null::text;
    return;
  end if;
  if pulso_correo_retenido(v_t.nuevo_email_hmac, v_t.uid) then
    return query select 'en_uso'::text, v_t.uid;
    return;
  end if;

  -- Un registro con ese correo que nunca se activó y ya venció no lo retiene.
  delete from tokens_cuenta t
   using cuentas c
   where c.email_hmac = v_t.nuevo_email_hmac and c.uid <> v_t.uid and t.uid = c.uid;
  delete from cuentas c where c.email_hmac = v_t.nuevo_email_hmac and c.uid <> v_t.uid;

  update cuentas c
     set email_hmac = v_t.nuevo_email_hmac, email_cifrado = v_t.nuevo_email_cifrado, actualizada_at = now()
   where c.uid = v_t.uid;
  return query select 'ok'::text, v_t.uid;
exception
  when unique_violation then
    -- otro registro con el mismo correo justo ahora: gana el primero
    return query select 'en_uso'::text, null::text;
end $$;

-- Las auxiliares (regla, intentos) solo las llaman las funciones de arriba.
revoke execute on function
  pulso_contrasena_fallas(text, text),
  pulso_contrasena_valida(text, text),
  pulso_bloqueo_restante(text),
  pulso_registrar_fallo(text),
  pulso_limpiar_fallos(text),
  pulso_turno_de_acceso(text),
  pulso_correo_retenido(text, text),
  pulso_registrar_cuenta(text, text, text, text, text, text),
  pulso_activar_cuenta(text),
  pulso_reenviar_activacion(text, text),
  pulso_cuenta_de_sesion(text),
  pulso_fusionar_identidad(text, text),
  pulso_iniciar_sesion_cuenta(text, text, text, int, text),
  pulso_solicitar_recuperacion(text, text),
  pulso_correo_de_recuperacion(text),
  pulso_restablecer_contrasena(text, text, text),
  pulso_cambiar_contrasena(text, text, text, text),
  pulso_solicitar_cambio_correo(text, text, text, text, text),
  pulso_confirmar_cambio_correo(text)
from public;

grant execute on function
  pulso_registrar_cuenta(text, text, text, text, text, text),
  pulso_activar_cuenta(text),
  pulso_reenviar_activacion(text, text),
  pulso_cuenta_de_sesion(text),
  pulso_iniciar_sesion_cuenta(text, text, text, int, text),
  pulso_solicitar_recuperacion(text, text),
  pulso_correo_de_recuperacion(text),
  pulso_restablecer_contrasena(text, text, text),
  pulso_cambiar_contrasena(text, text, text, text),
  pulso_solicitar_cambio_correo(text, text, text, text, text),
  pulso_confirmar_cambio_correo(text)
to pulso_app;

-- ─── Cuenta obligatoria (21-oct-2026) ────────────────────────────────────────
-- Desde esta versión, para leer o guardar datos hace falta una cuenta activada.
-- La sesión anónima sigue existiendo, pero solo sirve para crear la cuenta (la
-- cuenta se pone sobre esa identidad) o iniciar sesión. La app saca el uid de
-- los datos con esta función, no con `pulso_resolver_sesion`: sin cuenta
-- activada devuelve null y no se entrega ni se guarda nada.
create or replace function pulso_uid_con_cuenta(p_token_hash text)
returns text
language sql security definer set search_path = public, pg_temp as $$
  select c.uid
    from cuentas c
   where c.uid = pulso_resolver_sesion(p_token_hash)
     and c.verificada_at is not null
$$;

-- Estado de la cuenta de la sesión para el cliente: 'ninguna', 'sin_activar' o
-- 'activa'. Ignora el bloqueo con passkey: no entrega datos, solo dice a qué
-- pantalla ir.
create or replace function pulso_estado_cuenta(p_token_hash text)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when c.uid is null           then 'ninguna'
           when c.verificada_at is null then 'sin_activar'
           else 'activa'
         end
    from (select pulso_uid_de_token(p_token_hash) as uid) s
    left join cuentas c on c.uid = s.uid
$$;

revoke execute on function pulso_uid_con_cuenta(text), pulso_estado_cuenta(text) from public;
grant execute on function pulso_uid_con_cuenta(text), pulso_estado_cuenta(text) to pulso_app;
