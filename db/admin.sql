-- Pulso — administración: roles, permisos, usuarios y registro de errores
--
-- Se aplica después de plataforma.sql (npm run setup-db). Es idempotente.
--
-- (integrador, puntos 5, 7, 8, 9, 10, 11 y 17)
--
--   * RBAC de la aplicación: un catálogo fijo de permisos, roles con sus
--     permisos, roles asignados a cada usuario y permisos directos del usuario.
--     Los permisos EFECTIVOS de un usuario son los de sus roles ∪ los directos.
--   * El rol de sistema "Administrador" tiene siempre todos los permisos: no se
--     borra, no se le quitan permisos y siempre queda al menos un usuario con él
--     (lo cuidan las funciones y, por si acaso, triggers).
--   * Todas las operaciones son funciones `pulso_admin_*(p_sesion_hash, …)`
--     security definer: el uid del que actúa sale del hash del token de sesión
--     (`pulso_uid_con_cuenta`), nunca de un parámetro. Cada una exige su permiso;
--     sin él responde `{"error": "sin_permiso"}` y deja la constancia en la
--     auditoría ('denegado'). Cada cambio se audita con su detalle legible:
--     quién, qué, a quién, antes y después (nunca una contraseña).
--   * No se puede otorgar lo que no se tiene: quien edita un rol o un usuario
--     tiene que tener todos los permisos que toca, y no puede tocar a alguien con
--     permisos que él no tiene (así `usuarios.editar` no alcanza para darse el
--     rol Administrador ni para cambiarle la contraseña a un administrador).
--   * Registro de errores (`errores`): lo escribe `pulso_registrar_error` desde
--     src/lib/seguridad/errores.ts y lo lee el panel con `errores.ver`.
--   * Configuración (db/plataforma.sql): el setter `pulso_admin_fijar_config`.
--
-- Las funciones devuelven jsonb: `{"ok": true, …}` o `{"error": "<código>"}`.
-- Un rechazo NO lanza una excepción: si lo hiciera, la fila de auditoría del
-- rechazo se desharía con la transacción.
--
-- Como las demás tablas de sistema, estas no tienen grants para `pulso_app`.
--
-- El correo del usuario se lee en UN solo lugar (`pulso_correo_de`) y viaja a la
-- app en un mapa `correos` aparte, para que el cambio al correo cifrado (C3) sea
-- una línea acá y una en src/lib/admin/servidor.ts (`correoVisible`).

-- ─── Catálogo de permisos ────────────────────────────────────────────────────
-- Fijo: lo siembra este archivo. La app solo lo lee.

create table if not exists permisos (
  clave       text primary key check (clave ~ '^[a-z]+\.[a-z]+$'),
  descripcion text not null,
  orden       int  not null default 0
);

insert into permisos (clave, descripcion, orden) values
  ('usuarios.ver',         'Ver los usuarios: correo, estado de la cuenta, roles, permisos y última actividad', 10),
  ('usuarios.editar',      'Asignar roles y permisos directos a un usuario y cambiarle la contraseña',           20),
  ('roles.gestionar',      'Crear, editar y borrar roles y elegir sus permisos',                                 30),
  ('auditoria.ver',        'Ver el registro de auditoría',                                                        40),
  ('errores.ver',          'Ver el registro de errores y forzar un error de prueba',                              50),
  ('configuracion.editar', 'Cambiar los tiempos de expiración del token y de la sesión por inactividad',          60)
on conflict (clave) do update set descripcion = excluded.descripcion, orden = excluded.orden;

-- ─── Roles ───────────────────────────────────────────────────────────────────

create table if not exists roles (
  id             bigint generated always as identity primary key,
  nombre         text not null check (char_length(nombre) between 2 and 60 and nombre = btrim(nombre)),
  descripcion    text not null default '' check (char_length(descripcion) <= 300),
  sistema        boolean not null default false,
  created_at     timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

-- "Soporte" y "soporte" son el mismo rol. Y hay un solo rol de sistema.
create unique index if not exists roles_nombre_idx on roles (lower(nombre));
create unique index if not exists roles_un_sistema_idx on roles (sistema) where sistema;

insert into roles (nombre, descripcion, sistema)
select 'Administrador', 'Rol del sistema: tiene todos los permisos. No se puede borrar ni quitarle permisos.', true
 where not exists (select 1 from roles where sistema);

create table if not exists rol_permisos (
  rol_id  bigint not null references roles (id) on delete cascade,
  permiso text   not null references permisos (clave) on delete cascade,
  primary key (rol_id, permiso)
);

-- El Administrador tiene todos los permisos, también los que se agreguen al
-- catálogo en una versión futura (este insert corre en cada setup-db).
insert into rol_permisos (rol_id, permiso)
select r.id, p.clave from roles r cross join permisos p where r.sistema
on conflict do nothing;

create table if not exists usuario_roles (
  uid          text   not null references identidades (uid) on delete cascade,
  rol_id       bigint not null references roles (id) on delete cascade,
  asignado_at  timestamptz not null default now(),
  asignado_por text,          -- uid de quien lo asignó; null = script del dueño
  primary key (uid, rol_id)
);

create index if not exists usuario_roles_rol_idx on usuario_roles (rol_id);

create table if not exists usuario_permisos (
  uid          text not null references identidades (uid) on delete cascade,
  permiso      text not null references permisos (clave) on delete cascade,
  asignado_at  timestamptz not null default now(),
  asignado_por text,
  primary key (uid, permiso)
);

-- ─── Defensa en la base: el rol de sistema ───────────────────────────────────
-- Las funciones ya lo impiden; los triggers cubren además un error en ellas o
-- un DML a mano del dueño.

create or replace function pulso_proteger_rol_sistema() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'roles' then
    if tg_op = 'DELETE' and old.sistema then
      raise exception using errcode = 'P0001', message = 'pulso_rol_de_sistema',
        detail = 'El rol Administrador no se puede borrar.';
    end if;
    if tg_op = 'UPDATE' and (old.sistema or new.sistema)
       and (new.nombre is distinct from old.nombre or new.sistema is distinct from old.sistema) then
      raise exception using errcode = 'P0001', message = 'pulso_rol_de_sistema',
        detail = 'El rol Administrador no se puede renombrar ni dejar de ser de sistema.';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- rol_permisos: al Administrador no se le quita ningún permiso.
  if exists (select 1 from roles r where r.id = old.rol_id and r.sistema) then
    raise exception using errcode = 'P0001', message = 'pulso_rol_de_sistema',
      detail = 'Al rol Administrador no se le quitan permisos.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists rol_sistema_protegido on roles;
create trigger rol_sistema_protegido
  before update or delete on roles
  for each row execute function pulso_proteger_rol_sistema();

drop trigger if exists rol_sistema_permisos on rol_permisos;
create trigger rol_sistema_permisos
  before update or delete on rol_permisos
  for each row execute function pulso_proteger_rol_sistema();

-- Al quitarle el rol Administrador a alguien tiene que quedar otro. Se mira al
-- final de la sentencia (con todas las filas quitadas) y solo si la identidad
-- sigue existiendo: si se borró la identidad entera (derecho de supresión, Ley
-- 1581) la membresía cae en cascada y eso no se puede impedir.
create or replace function pulso_proteger_ultimo_admin() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1
               from quitados q
               join roles r on r.id = q.rol_id and r.sistema
               join identidades i on i.uid = q.uid)
     and not exists (select 1
                       from usuario_roles ur
                       join roles r on r.id = ur.rol_id and r.sistema) then
    raise exception using errcode = 'P0001', message = 'pulso_ultimo_administrador',
      detail = 'Tiene que quedar al menos un usuario con el rol Administrador.';
  end if;
  return null;
end $$;

drop trigger if exists ultimo_admin on usuario_roles;
create trigger ultimo_admin
  after delete on usuario_roles
  referencing old table as quitados
  for each statement execute function pulso_proteger_ultimo_admin();

-- ─── Registro de errores (punto 17) ──────────────────────────────────────────
-- Lo que falló en el servidor: cuándo, dónde (origen: la ruta o la acción),
-- el mensaje y el stack recortados, el uid si había sesión y la IP anonimizada
-- (/24 o /48, como la auditoría). Sin el detalle de pg (`err.detail` trae los
-- valores de la fila) ni el cuerpo de la petición. Se conserva 90 días.

create table if not exists errores (
  id          bigint generated always as identity primary key,
  ocurrido_at timestamptz not null default now(),
  origen      text not null check (char_length(origen) <= 120),
  mensaje     text not null check (char_length(mensaje) <= 1000),
  stack       text check (char_length(stack) <= 4000),
  uid         text,
  ip          text,
  detalle     jsonb
);

create index if not exists errores_fecha_idx on errores (ocurrido_at desc);

-- Devuelve false si no se guardó porque ese origen pasó su tope por hora: un
-- error en bucle no llena el disco (los primeros 300 quedan).
create or replace function pulso_registrar_error(
  p_origen text, p_mensaje text, p_stack text, p_uid text, p_ip text, p_detalle jsonb
)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_origen text := left(coalesce(nullif(btrim(p_origen), ''), 'desconocido'), 120);
begin
  if not pulso_consumir_tasa('errores:' || v_origen, 300, 3600) then
    return false;
  end if;

  insert into errores (origen, mensaje, stack, uid, ip, detalle)
  values (v_origen,
          left(coalesce(nullif(btrim(p_mensaje), ''), '(sin mensaje)'), 1000),
          left(p_stack, 4000),
          left(p_uid, 64),
          left(p_ip, 64),
          case when p_detalle is not null and pg_column_size(p_detalle) <= 4000 then p_detalle end);

  -- limpieza oportunista, como en pulso_consumir_tasa
  if random() < 0.01 then
    delete from errores where ocurrido_at < now() - interval '90 days';
  end if;
  return true;
end $$;

-- ─── Funciones internas (solo las llaman las de abajo) ───────────────────────

-- Correo de una cuenta, tal como está guardado. ÚNICO lugar donde se lee el
-- correo para la administración (C3). Sirve en los tres estados del esquema:
--   * hoy: `cuentas.email` en claro;
--   * durante la migración al correo cifrado: `email_cifrado` si ya se migró
--     esa fila, si no el `email` en claro;
--   * después: solo `email_cifrado`.
-- Lo cifrado (`v1.…`) lo descifra la app en `correoVisible`
-- (src/lib/admin/servidor.ts): la clave no está en la base. La consulta es
-- dinámica porque un `select c.email` fijo no compilaría cuando la columna ya
-- no exista, y setup-db tiene que correr en los tres estados.
create or replace function pulso_correo_de(p_uid text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cifrado boolean;
  v_claro   boolean;
  v_correo  text;
begin
  select bool_or(a.attname = 'email_cifrado'), bool_or(a.attname = 'email')
    into v_cifrado, v_claro
    from pg_attribute a
   where a.attrelid = 'public.cuentas'::regclass and a.attnum > 0 and not a.attisdropped;

  if v_cifrado and v_claro then
    execute 'select coalesce(c.email_cifrado, c.email) from cuentas c where c.uid = $1' into v_correo using p_uid;
  elsif v_cifrado then
    execute 'select c.email_cifrado from cuentas c where c.uid = $1' into v_correo using p_uid;
  else
    execute 'select c.email from cuentas c where c.uid = $1' into v_correo using p_uid;
  end if;
  return v_correo;
end $$;

-- Mapa { uid: correo } para los uids dados (los que no tienen cuenta no salen).
create or replace function pulso_admin_correos(p_uids text[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(u.uid, pulso_correo_de(u.uid)), '{}'::jsonb)
    from (select distinct x as uid from unnest(p_uids) x where x is not null) u
   where pulso_correo_de(u.uid) is not null
$$;

-- Permisos efectivos de un usuario: los de sus roles ∪ los directos, ordenados.
create or replace function pulso_permisos_de(p_uid text) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct t.permiso order by t.permiso), '{}')
    from (select rp.permiso
            from usuario_roles ur
            join rol_permisos rp on rp.rol_id = ur.rol_id
           where ur.uid = p_uid
          union all
          select up.permiso from usuario_permisos up where up.uid = p_uid) t
$$;

-- true si `p_actor` tiene todos los permisos de la lista.
create or replace function pulso_admin_cubre(p_actor text, p_permisos text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_permisos, '{}') <@ pulso_permisos_de(p_actor)
$$;

-- Lista de permisos sin repetidos y ordenada, o null si trae uno que no está en el catálogo.
create or replace function pulso_admin_normalizar_permisos(p_permisos text[]) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when exists (select 1 from unnest(coalesce(p_permisos, '{}')) x
                         where x is null or not exists (select 1 from permisos p where p.clave = x))
             then null
           else array(select distinct x from unnest(coalesce(p_permisos, '{}')) x order by x)
         end
$$;

-- Fila de auditoría de una operación de administración.
create or replace function pulso_admin_auditar(
  p_actor text, p_accion text, p_resultado text, p_ip text,
  p_recurso text, p_recurso_id text, p_detalle jsonb
)
returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into auditoria (uid, accion, recurso, recurso_id, resultado, ip, detalle)
  values (p_actor, p_accion, p_recurso, p_recurso_id, p_resultado, p_ip, p_detalle)
$$;

-- Rechazo de una operación: lo audita y devuelve `{"error": motivo}`.
create or replace function pulso_admin_rechazo(
  p_actor text, p_accion text, p_ip text, p_motivo text,
  p_recurso text default null, p_recurso_id text default null, p_extra jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pulso_admin_auditar(p_actor, p_accion, 'denegado', p_ip, p_recurso, p_recurso_id,
                              jsonb_build_object('motivo', p_motivo) || coalesce(p_extra, '{}'::jsonb));
  return jsonb_build_object('error', p_motivo) || coalesce(p_extra, '{}'::jsonb);
end $$;

-- Quién actúa y si puede: el uid sale de la sesión (con cuenta activada) y
-- tiene que tener al menos uno de `p_permisos`. Si no, audita el rechazo y
-- devuelve el código en `o_error` ('sin_sesion' o 'sin_permiso').
create or replace function pulso_admin_exigir(
  p_sesion_hash text, p_permisos text[], p_accion text, p_ip text,
  out o_uid text, out o_error text
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  o_uid := pulso_uid_con_cuenta(p_sesion_hash);
  if o_uid is null then
    o_error := 'sin_sesion';
  elsif not (pulso_permisos_de(o_uid) && p_permisos) then
    o_error := 'sin_permiso';
  else
    return;
  end if;
  perform pulso_admin_auditar(o_uid, p_accion, 'denegado', p_ip, null, null,
                              jsonb_build_object('motivo', o_error, 'permiso', array_to_string(p_permisos, ' o ')));
end $$;

-- Roles (id y nombre), permisos directos y efectivos de un usuario, para el
-- antes y el después de la auditoría.
create or replace function pulso_admin_acceso_de(p_uid text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(r.nombre order by r.nombre)
                         from usuario_roles ur join roles r on r.id = ur.rol_id
                        where ur.uid = p_uid), '[]'::jsonb),
    'directos', to_jsonb(coalesce((select array_agg(up.permiso order by up.permiso)
                                     from usuario_permisos up where up.uid = p_uid), '{}'::text[])),
    'efectivos', to_jsonb(pulso_permisos_de(p_uid))
  )
$$;

-- Un usuario para el panel: estado de la cuenta, actividad, roles, permisos
-- directos y efectivos con su origen (cada rol que lo da, o "directo").
create or replace function pulso_admin_fila_usuario(p_uid text, p_actor text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'uid',               c.uid,
    'estado',            case when c.verificada_at is null then 'sin_activar' else 'activa' end,
    'creada_at',         c.created_at,
    'ultima_actividad',  (select max(s.ultimo_uso) from sesiones s where s.uid = c.uid),
    'sesiones_abiertas', (select count(*) from sesiones s
                           where s.uid = c.uid and s.revocada_at is null
                             and s.rotada_at is null and s.expira_at > now()),
    'es_tu_cuenta',      c.uid = p_actor,
    'roles',             coalesce((select jsonb_agg(ur.rol_id order by ur.rol_id)
                                     from usuario_roles ur where ur.uid = c.uid), '[]'::jsonb),
    'directos',          to_jsonb(coalesce((select array_agg(up.permiso order by up.permiso)
                                              from usuario_permisos up where up.uid = c.uid), '{}'::text[])),
    'efectivos',         coalesce((
      select jsonb_agg(jsonb_build_object('permiso', e.permiso, 'origenes', e.origenes) order by e.permiso)
        from (select o.permiso, jsonb_agg(o.origen order by o.orden, o.nombre) as origenes
                from (select rp.permiso, 0 as orden, r.nombre,
                             jsonb_build_object('tipo', 'rol', 'id', r.id, 'nombre', r.nombre) as origen
                        from usuario_roles ur
                        join roles r on r.id = ur.rol_id
                        join rol_permisos rp on rp.rol_id = r.id
                       where ur.uid = c.uid
                      union all
                      select up.permiso, 1, '', jsonb_build_object('tipo', 'directo')
                        from usuario_permisos up where up.uid = c.uid) o
               group by o.permiso) e), '[]'::jsonb)
  )
    from cuentas c
   where c.uid = p_uid
$$;

-- Un rol para el panel, con sus permisos y sus miembros (uids).
create or replace function pulso_admin_fila_rol(p_id bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id',             r.id,
    'nombre',         r.nombre,
    'descripcion',    r.descripcion,
    'sistema',        r.sistema,
    'created_at',     r.created_at,
    'actualizado_at', r.actualizado_at,
    'permisos',       to_jsonb(coalesce((select array_agg(rp.permiso order by rp.permiso)
                                           from rol_permisos rp where rp.rol_id = r.id), '{}'::text[])),
    'miembros',       to_jsonb(coalesce((select array_agg(ur.uid order by ur.asignado_at)
                                           from usuario_roles ur where ur.rol_id = r.id), '{}'::text[]))
  )
    from roles r
   where r.id = p_id
$$;

-- ─── Lecturas (las llama la app) ─────────────────────────────────────────────

-- Permisos efectivos del usuario de la sesión: para mostrar u ocultar el enlace
-- "Administración" y las pestañas. Mostrar no autoriza: cada operación vuelve a
-- exigir su permiso. No se audita (se consulta en cada carga de la app).
create or replace function pulso_admin_mis_permisos(p_sesion_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := pulso_uid_con_cuenta(p_sesion_hash);
begin
  if v_uid is null then
    return jsonb_build_object('error', 'sin_sesion');
  end if;
  return jsonb_build_object('permisos', to_jsonb(pulso_permisos_de(v_uid)));
end $$;

-- Para las rutas que hacen algo fuera de la base (forzar el error de prueba):
-- exige el permiso y audita el rechazo, igual que las demás.
create or replace function pulso_admin_comprobar(p_sesion_hash text, p_permiso text, p_accion text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text;
  v_error text;
begin
  select o_uid, o_error into v_actor, v_error from pulso_admin_exigir(p_sesion_hash, array[p_permiso], p_accion, p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Usuarios con cuenta (activada o no), los más nuevos primero.
create or replace function pulso_admin_usuarios(p_sesion_hash text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text;
  v_error text;
  v_uids  text[];
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['usuarios.ver'], 'admin.usuarios.ver', p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  v_uids := array(select c.uid from cuentas c order by c.created_at desc limit 1000);
  return jsonb_build_object(
    'usuarios', coalesce((select jsonb_agg(pulso_admin_fila_usuario(u.uid, v_actor) order by u.n)
                            from unnest(v_uids) with ordinality as u(uid, n)), '[]'::jsonb),
    'correos',  pulso_admin_correos(v_uids)
  );
end $$;

-- Roles con sus permisos y miembros, y el catálogo de permisos. Lo pueden ver
-- quien gestiona roles y quien ve usuarios (para saber qué da cada rol).
create or replace function pulso_admin_roles(p_sesion_hash text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text;
  v_error text;
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['roles.gestionar', 'usuarios.ver'], 'admin.roles.ver', p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  return jsonb_build_object(
    'roles',    coalesce((select jsonb_agg(pulso_admin_fila_rol(r.id) order by r.sistema desc, lower(r.nombre))
                            from roles r), '[]'::jsonb),
    'catalogo', coalesce((select jsonb_agg(jsonb_build_object('clave', p.clave, 'descripcion', p.descripcion)
                                           order by p.orden, p.clave)
                            from permisos p), '[]'::jsonb),
    'correos',  pulso_admin_correos(array(select ur.uid from usuario_roles ur))
  );
end $$;

-- Auditoría paginada (de la más nueva a la más vieja) y filtrable. Filtros, en
-- `p_filtros`: accion (prefijo, ej. "admin."), resultado, usuario (uid: los
-- eventos que hizo o que lo tuvieron de objetivo), desde y hasta (timestamptz,
-- hasta exclusivo), antes (id: la página siguiente) y limite (1 a 100).
create or replace function pulso_admin_auditoria(p_sesion_hash text, p_filtros jsonb, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor     text;
  v_error     text;
  v_accion    text;
  v_resultado text;
  v_usuario   text;
  v_desde     timestamptz;
  v_hasta     timestamptz;
  v_antes     bigint;
  v_limite    int;
  v_eventos   jsonb;
  v_hay_mas   boolean;
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['auditoria.ver'], 'admin.auditoria.ver', p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  begin
    v_accion    := nullif(btrim(p_filtros->>'accion'), '');
    v_resultado := nullif(p_filtros->>'resultado', '');
    v_usuario   := nullif(p_filtros->>'usuario', '');
    v_desde     := (nullif(p_filtros->>'desde', ''))::timestamptz;
    v_hasta     := (nullif(p_filtros->>'hasta', ''))::timestamptz;
    v_antes     := (nullif(p_filtros->>'antes', ''))::bigint;
    v_limite    := least(greatest(coalesce((nullif(p_filtros->>'limite', ''))::int, 50), 1), 100);
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
      or numeric_value_out_of_range then
      return jsonb_build_object('error', 'datos_invalidos');
  end;

  with pagina as (
    select a.*
      from auditoria a
     where (v_accion is null or starts_with(a.accion, v_accion))
       and (v_resultado is null or a.resultado = v_resultado)
       and (v_usuario is null or a.uid = v_usuario
            or (a.recurso = 'usuario' and a.recurso_id = v_usuario))
       and (v_desde is null or a.ocurrido_at >= v_desde)
       and (v_hasta is null or a.ocurrido_at < v_hasta)
       and (v_antes is null or a.id < v_antes)
     order by a.id desc
     limit v_limite + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id desc), '[]'::jsonb) into v_eventos from pagina p;

  v_hay_mas := jsonb_array_length(v_eventos) > v_limite;
  if v_hay_mas then
    v_eventos := v_eventos - v_limite;   -- sobra la última: solo decía que hay más
  end if;

  return jsonb_build_object(
    'eventos',   v_eventos,
    'siguiente', case when v_hay_mas then v_eventos -> (v_limite - 1) -> 'id' end,
    'correos',   pulso_admin_correos(array(
                   select e->>'uid' from jsonb_array_elements(v_eventos) e
                   union
                   select e->>'recurso_id' from jsonb_array_elements(v_eventos) e where e->>'recurso' = 'usuario'
                   union
                   select m from jsonb_array_elements(v_eventos) e,
                                 jsonb_array_elements_text(coalesce(e->'detalle'->'antes'->'miembros', '[]'::jsonb)) m
                 ))
  );
end $$;

-- Errores registrados, del más nuevo al más viejo. Filtros: origen (prefijo),
-- antes (id) y limite (1 a 100).
create or replace function pulso_admin_errores(p_sesion_hash text, p_filtros jsonb, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor   text;
  v_error   text;
  v_origen  text;
  v_antes   bigint;
  v_limite  int;
  v_filas   jsonb;
  v_hay_mas boolean;
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['errores.ver'], 'admin.errores.ver', p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  begin
    v_origen := nullif(btrim(p_filtros->>'origen'), '');
    v_antes  := (nullif(p_filtros->>'antes', ''))::bigint;
    v_limite := least(greatest(coalesce((nullif(p_filtros->>'limite', ''))::int, 50), 1), 100);
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('error', 'datos_invalidos');
  end;

  with pagina as (
    select e.*
      from errores e
     where (v_origen is null or starts_with(e.origen, v_origen))
       and (v_antes is null or e.id < v_antes)
     order by e.id desc
     limit v_limite + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id desc), '[]'::jsonb) into v_filas from pagina p;

  v_hay_mas := jsonb_array_length(v_filas) > v_limite;
  if v_hay_mas then
    v_filas := v_filas - v_limite;
  end if;

  return jsonb_build_object(
    'errores',   v_filas,
    'siguiente', case when v_hay_mas then v_filas -> (v_limite - 1) -> 'id' end,
    'correos',   pulso_admin_correos(array(select e->>'uid' from jsonb_array_elements(v_filas) e))
  );
end $$;

-- Valores de configuración (db/plataforma.sql) con sus límites y quién los cambió.
create or replace function pulso_admin_config(p_sesion_hash text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text;
  v_error text;
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['configuracion.editar'], 'admin.configuracion.ver', p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  return jsonb_build_object(
    'configuracion', coalesce((select jsonb_agg(to_jsonb(c) order by c.clave) from configuracion c), '[]'::jsonb),
    'correos',       pulso_admin_correos(array(select c.actualizada_por from configuracion c))
  );
end $$;

-- ─── Roles: crear, editar, borrar (puntos 5 y 8) ─────────────────────────────

-- Nombre de rol normalizado (espacios colapsados), o null si no es válido.
create or replace function pulso_admin_nombre_rol(p_nombre text) returns text
language sql immutable as $$
  select case
           when n is null or char_length(n) not between 2 and 60 or n ~ '[[:cntrl:]]' then null
           else n
         end
    from (select btrim(regexp_replace(p_nombre, '\s+', ' ', 'g')) as n) t
$$;

create or replace function pulso_admin_crear_rol(
  p_sesion_hash text, p_nombre text, p_descripcion text, p_permisos text[], p_ip text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_accion   constant text := 'admin.rol.crear';
  v_actor    text;
  v_error    text;
  v_nombre   text := pulso_admin_nombre_rol(p_nombre);
  v_desc     text := btrim(coalesce(p_descripcion, ''));
  v_permisos text[] := pulso_admin_normalizar_permisos(p_permisos);
  v_id       bigint;
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['roles.gestionar'], v_accion, p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  if v_nombre is null or char_length(v_desc) > 300 then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'datos_invalidos', 'rol');
  end if;
  if v_permisos is null then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'permiso_desconocido', 'rol');
  end if;
  if not pulso_admin_cubre(v_actor, v_permisos) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'privilegios_insuficientes', 'rol', null,
                               jsonb_build_object('nombre', v_nombre));
  end if;
  if exists (select 1 from roles r where lower(r.nombre) = lower(v_nombre)) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'nombre_en_uso', 'rol', null,
                               jsonb_build_object('nombre', v_nombre));
  end if;

  insert into roles (nombre, descripcion) values (v_nombre, v_desc) returning id into v_id;
  insert into rol_permisos (rol_id, permiso) select v_id, x from unnest(v_permisos) x;

  perform pulso_admin_auditar(v_actor, v_accion, 'ok', p_ip, 'rol', v_id::text,
    jsonb_build_object('despues', jsonb_build_object('nombre', v_nombre, 'descripcion', v_desc,
                                                     'permisos', to_jsonb(v_permisos))));
  return jsonb_build_object('ok', true, 'rol', pulso_admin_fila_rol(v_id));
exception
  when unique_violation then
    -- dos altas con el mismo nombre a la vez: gana la primera
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'nombre_en_uso', 'rol', null,
                               jsonb_build_object('nombre', v_nombre));
end $$;

create or replace function pulso_admin_editar_rol(
  p_sesion_hash text, p_rol_id bigint, p_nombre text, p_descripcion text, p_permisos text[], p_ip text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_accion   constant text := 'admin.rol.editar';
  v_actor    text;
  v_error    text;
  v_rol      roles%rowtype;
  v_nombre   text := pulso_admin_nombre_rol(p_nombre);
  v_desc     text := btrim(coalesce(p_descripcion, ''));
  v_permisos text[] := pulso_admin_normalizar_permisos(p_permisos);
  v_antes    text[];
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['roles.gestionar'], v_accion, p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  select * into v_rol from roles r where r.id = p_rol_id for update;
  if not found then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'no_encontrado', 'rol', p_rol_id::text);
  end if;
  if v_rol.sistema then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'rol_de_sistema', 'rol', p_rol_id::text,
                               jsonb_build_object('nombre', v_rol.nombre));
  end if;
  if v_nombre is null or char_length(v_desc) > 300 then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'datos_invalidos', 'rol', p_rol_id::text);
  end if;
  if v_permisos is null then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'permiso_desconocido', 'rol', p_rol_id::text);
  end if;

  v_antes := coalesce((select array_agg(rp.permiso order by rp.permiso) from rol_permisos rp where rp.rol_id = v_rol.id), '{}');
  -- Ni dar ni quitar lo que uno no tiene: sus miembros lo tienen por este rol.
  if not pulso_admin_cubre(v_actor, v_antes || v_permisos) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'privilegios_insuficientes', 'rol', p_rol_id::text,
                               jsonb_build_object('nombre', v_rol.nombre));
  end if;
  if exists (select 1 from roles r where lower(r.nombre) = lower(v_nombre) and r.id <> v_rol.id) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'nombre_en_uso', 'rol', p_rol_id::text,
                               jsonb_build_object('nombre', v_nombre));
  end if;

  update roles set nombre = v_nombre, descripcion = v_desc, actualizado_at = now() where id = v_rol.id;
  delete from rol_permisos rp where rp.rol_id = v_rol.id and not (rp.permiso = any (v_permisos));
  insert into rol_permisos (rol_id, permiso) select v_rol.id, x from unnest(v_permisos) x on conflict do nothing;

  perform pulso_admin_auditar(v_actor, v_accion, 'ok', p_ip, 'rol', v_rol.id::text,
    jsonb_build_object(
      'antes',   jsonb_build_object('nombre', v_rol.nombre, 'descripcion', v_rol.descripcion, 'permisos', to_jsonb(v_antes)),
      'despues', jsonb_build_object('nombre', v_nombre, 'descripcion', v_desc, 'permisos', to_jsonb(v_permisos)),
      'miembros_afectados', (select count(*) from usuario_roles ur where ur.rol_id = v_rol.id)));
  return jsonb_build_object('ok', true, 'rol', pulso_admin_fila_rol(v_rol.id));
exception
  when unique_violation then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'nombre_en_uso', 'rol', p_rol_id::text,
                               jsonb_build_object('nombre', v_nombre));
end $$;

create or replace function pulso_admin_borrar_rol(p_sesion_hash text, p_rol_id bigint, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_accion   constant text := 'admin.rol.borrar';
  v_actor    text;
  v_error    text;
  v_rol      roles%rowtype;
  v_permisos text[];
  v_miembros text[];
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['roles.gestionar'], v_accion, p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  select * into v_rol from roles r where r.id = p_rol_id for update;
  if not found then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'no_encontrado', 'rol', p_rol_id::text);
  end if;
  if v_rol.sistema then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'rol_de_sistema', 'rol', p_rol_id::text,
                               jsonb_build_object('nombre', v_rol.nombre));
  end if;

  v_permisos := coalesce((select array_agg(rp.permiso order by rp.permiso) from rol_permisos rp where rp.rol_id = v_rol.id), '{}');
  if not pulso_admin_cubre(v_actor, v_permisos) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'privilegios_insuficientes', 'rol', p_rol_id::text,
                               jsonb_build_object('nombre', v_rol.nombre));
  end if;
  v_miembros := coalesce((select array_agg(ur.uid order by ur.asignado_at) from usuario_roles ur where ur.rol_id = v_rol.id), '{}');

  delete from roles where id = v_rol.id;   -- en cascada: sus permisos y sus asignaciones

  perform pulso_admin_auditar(v_actor, v_accion, 'ok', p_ip, 'rol', v_rol.id::text,
    jsonb_build_object('antes', jsonb_build_object(
      'nombre', v_rol.nombre, 'descripcion', v_rol.descripcion,
      'permisos', to_jsonb(v_permisos), 'miembros', to_jsonb(v_miembros))));
  return jsonb_build_object('ok', true);
end $$;

-- ─── Usuarios: roles y permisos directos (puntos 5 y 8) ──────────────────────

-- Fija TODOS los roles y TODOS los permisos directos de un usuario (lo que no
-- viene en las listas se le quita). Audita el antes y el después, incluidos
-- los permisos efectivos que resultan.
create or replace function pulso_admin_fijar_acceso(
  p_sesion_hash text, p_uid text, p_roles bigint[], p_permisos text[], p_ip text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_accion    constant text := 'admin.usuario.acceso';
  v_actor     text;
  v_error     text;
  v_cuenta    cuentas%rowtype;
  v_sistema   bigint;
  v_roles     bigint[] := array(select distinct x from unnest(coalesce(p_roles, '{}')) x where x is not null order by x);
  v_permisos  text[] := pulso_admin_normalizar_permisos(p_permisos);
  v_antes     jsonb;
  v_nuevos    text[];
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['usuarios.editar'], v_accion, p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  select * into v_cuenta from cuentas c where c.uid = p_uid;
  if not found then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'no_encontrado', 'usuario', p_uid);
  end if;
  if v_cuenta.verificada_at is null then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'cuenta_sin_activar', 'usuario', p_uid);
  end if;
  if v_permisos is null then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'permiso_desconocido', 'usuario', p_uid);
  end if;
  if cardinality(v_roles) <> (select count(*) from roles r where r.id = any (v_roles)) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'rol_desconocido', 'usuario', p_uid);
  end if;

  -- Serializa los cambios del rol de sistema: dos administradores que se lo
  -- quitan uno al otro a la vez no pueden dejar cero.
  select r.id into v_sistema from roles r where r.sistema for update;

  v_antes  := pulso_admin_acceso_de(p_uid);
  v_nuevos := array(select distinct x from (
                select rp.permiso from rol_permisos rp where rp.rol_id = any (v_roles)
                union all
                select unnest(v_permisos)) t(x) order by x);

  -- No se otorga lo que no se tiene, y no se toca a quien tiene más que uno.
  if not pulso_admin_cubre(v_actor, pulso_permisos_de(p_uid) || v_nuevos) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'privilegios_insuficientes', 'usuario', p_uid);
  end if;

  if exists (select 1 from usuario_roles ur where ur.uid = p_uid and ur.rol_id = v_sistema)
     and not (v_sistema = any (v_roles))
     and not exists (select 1 from usuario_roles ur
                       join cuentas c on c.uid = ur.uid and c.verificada_at is not null
                      where ur.rol_id = v_sistema and ur.uid <> p_uid) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'ultimo_administrador', 'usuario', p_uid);
  end if;

  delete from usuario_roles ur where ur.uid = p_uid and not (ur.rol_id = any (v_roles));
  insert into usuario_roles (uid, rol_id, asignado_por)
  select p_uid, x, v_actor from unnest(v_roles) x on conflict do nothing;

  delete from usuario_permisos up where up.uid = p_uid and not (up.permiso = any (v_permisos));
  insert into usuario_permisos (uid, permiso, asignado_por)
  select p_uid, x, v_actor from unnest(v_permisos) x on conflict do nothing;

  perform pulso_admin_auditar(v_actor, v_accion, 'ok', p_ip, 'usuario', p_uid,
    jsonb_build_object('objetivo', p_uid, 'antes', v_antes, 'despues', pulso_admin_acceso_de(p_uid)));
  return jsonb_build_object('ok', true,
                            'usuario', pulso_admin_fila_usuario(p_uid, v_actor),
                            'correos', pulso_admin_correos(array[p_uid]));
exception
  when sqlstate 'P0001' then
    -- El trigger del último administrador (por si la carrera pasó igual).
    if sqlerrm = 'pulso_ultimo_administrador' then
      return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'ultimo_administrador', 'usuario', p_uid);
    end if;
    raise;
end $$;

-- ─── Contraseña de otro usuario (punto 7) ────────────────────────────────────
-- La valida la base con la misma regla que el registro (`pulso_contrasena_valida`),
-- aunque la app ya la haya validado: si alguien se saltea zod, igual se rechaza.
-- Si se cambia, se cierran TODAS las sesiones del usuario ('admin') y dejan de
-- servir sus enlaces de recuperación pendientes. La propia no se cambia por acá
-- (para eso está el perfil, que pide la contraseña actual).
create or replace function pulso_admin_cambiar_contrasena(
  p_sesion_hash text, p_uid text, p_password text, p_ip text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_accion constant text := 'admin.usuario.contrasena';
  v_actor  text;
  v_error  text;
  v_n      int;
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['usuarios.editar'], v_accion, p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  if p_uid = v_actor then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'es_tu_cuenta', 'usuario', p_uid);
  end if;
  if not exists (select 1 from cuentas c where c.uid = p_uid) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'no_encontrado', 'usuario', p_uid);
  end if;
  if not pulso_admin_cubre(v_actor, pulso_permisos_de(p_uid)) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'privilegios_insuficientes', 'usuario', p_uid);
  end if;
  if not pulso_contrasena_valida(p_password) then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'contrasena_invalida', 'usuario', p_uid);
  end if;

  update cuentas c
     set password_hash = crypt(p_password, gen_salt('bf', 12)), actualizada_at = now()
   where c.uid = p_uid;
  update tokens_cuenta t
     set usado_at = now()
   where t.uid = p_uid and t.tipo = 'recuperacion' and t.usado_at is null;
  -- Con la contraseña nueva, el bloqueo por intentos fallidos (punto 4) ya no
  -- tiene sentido: igual que al restablecerla con el correo.
  delete from intentos_acceso i using cuentas c where c.uid = p_uid and i.email_hmac = c.email_hmac;
  update sesiones s
     set revocada_at = now(), revocada_motivo = 'admin'
   where s.uid = p_uid and s.revocada_at is null;
  get diagnostics v_n = row_count;

  perform pulso_admin_auditar(v_actor, v_accion, 'ok', p_ip, 'usuario', p_uid,
    jsonb_build_object('objetivo', p_uid, 'sesiones_revocadas', v_n));
  -- El correo va para avisarle al dueño de la cuenta (lo manda la app).
  return jsonb_build_object('ok', true, 'sesiones_revocadas', v_n, 'correos', pulso_admin_correos(array[p_uid]));
end $$;

-- ─── Configuración (puntos 10 y 11, contrato C1) ─────────────────────────────
-- Cambia un valor de `configuracion` dentro de su mínimo y máximo. Quien lo
-- aplica (db/plataforma.sql y la sesión) lo lee con `pulso_config` en cada
-- petición, así que rige enseguida.
create or replace function pulso_admin_fijar_config(
  p_sesion_hash text, p_clave text, p_valor int, p_ip text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_accion constant text := 'admin.configuracion.fijar';
  v_actor  text;
  v_error  text;
  v_c      configuracion%rowtype;
begin
  select o_uid, o_error into v_actor, v_error
    from pulso_admin_exigir(p_sesion_hash, array['configuracion.editar'], v_accion, p_ip);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  select * into v_c from configuracion c where c.clave = p_clave for update;
  if not found then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'no_encontrado', 'configuracion', left(p_clave, 64));
  end if;
  if p_valor is null or p_valor < v_c.minimo or p_valor > v_c.maximo then
    return pulso_admin_rechazo(v_actor, v_accion, p_ip, 'fuera_de_rango', 'configuracion', p_clave,
                               jsonb_build_object('valor', p_valor, 'minimo', v_c.minimo, 'maximo', v_c.maximo));
  end if;

  update configuracion c
     set valor = p_valor, actualizada_at = now(), actualizada_por = v_actor
   where c.clave = p_clave;

  perform pulso_admin_auditar(v_actor, v_accion, 'ok', p_ip, 'configuracion', p_clave,
    jsonb_build_object('clave', p_clave, 'antes', v_c.valor, 'despues', p_valor));
  return jsonb_build_object('ok', true,
                            'configuracion', (select to_jsonb(c) from configuracion c where c.clave = p_clave),
                            'correos',       pulso_admin_correos(array[v_actor]));
end $$;

-- ─── Primer administrador (scripts/asignar-admin.mjs) ────────────────────────
-- Solo el dueño: le da el rol Administrador a una cuenta activada y lo audita
-- (sin actor: lo hizo quien tiene el dueño de la base). Devuelve 'ok',
-- 'ya_tenia', 'sin_cuenta' o 'sin_activar'.
create or replace function pulso_admin_asignar_rol_sistema(p_uid text, p_via text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cuenta  cuentas%rowtype;
  v_sistema bigint;
begin
  select * into v_cuenta from cuentas c where c.uid = p_uid;
  if not found then
    return 'sin_cuenta';
  end if;
  if v_cuenta.verificada_at is null then
    return 'sin_activar';
  end if;
  select r.id into v_sistema from roles r where r.sistema;
  if exists (select 1 from usuario_roles ur where ur.uid = p_uid and ur.rol_id = v_sistema) then
    return 'ya_tenia';
  end if;

  insert into usuario_roles (uid, rol_id, asignado_por) values (p_uid, v_sistema, null);
  perform pulso_admin_auditar(null, 'admin.rol.asignar_sistema', 'ok', null, 'usuario', p_uid,
    jsonb_build_object('objetivo', p_uid, 'rol', 'Administrador', 'via', coalesce(p_via, 'dueño de la base')));
  return 'ok';
end $$;

-- ─── Permisos de ejecución ───────────────────────────────────────────────────

revoke execute on function
  pulso_proteger_rol_sistema(),
  pulso_proteger_ultimo_admin(),
  pulso_registrar_error(text, text, text, text, text, jsonb),
  pulso_correo_de(text),
  pulso_admin_correos(text[]),
  pulso_permisos_de(text),
  pulso_admin_cubre(text, text[]),
  pulso_admin_normalizar_permisos(text[]),
  pulso_admin_auditar(text, text, text, text, text, text, jsonb),
  pulso_admin_rechazo(text, text, text, text, text, text, jsonb),
  pulso_admin_exigir(text, text[], text, text),
  pulso_admin_acceso_de(text),
  pulso_admin_fila_usuario(text, text),
  pulso_admin_fila_rol(bigint),
  pulso_admin_nombre_rol(text),
  pulso_admin_mis_permisos(text),
  pulso_admin_comprobar(text, text, text, text),
  pulso_admin_usuarios(text, text),
  pulso_admin_roles(text, text),
  pulso_admin_auditoria(text, jsonb, text),
  pulso_admin_errores(text, jsonb, text),
  pulso_admin_config(text, text),
  pulso_admin_crear_rol(text, text, text, text[], text),
  pulso_admin_editar_rol(text, bigint, text, text, text[], text),
  pulso_admin_borrar_rol(text, bigint, text),
  pulso_admin_fijar_acceso(text, text, bigint[], text[], text),
  pulso_admin_cambiar_contrasena(text, text, text, text),
  pulso_admin_fijar_config(text, text, int, text),
  pulso_admin_asignar_rol_sistema(text, text)
from public;

-- La app: las operaciones del panel y escribir errores. Las internas y la del
-- primer administrador quedan para el dueño.
grant execute on function
  pulso_registrar_error(text, text, text, text, text, jsonb),
  pulso_admin_mis_permisos(text),
  pulso_admin_comprobar(text, text, text, text),
  pulso_admin_usuarios(text, text),
  pulso_admin_roles(text, text),
  pulso_admin_auditoria(text, jsonb, text),
  pulso_admin_errores(text, jsonb, text),
  pulso_admin_config(text, text),
  pulso_admin_crear_rol(text, text, text, text[], text),
  pulso_admin_editar_rol(text, bigint, text, text, text[], text),
  pulso_admin_borrar_rol(text, bigint, text),
  pulso_admin_fijar_acceso(text, text, bigint[], text[], text),
  pulso_admin_cambiar_contrasena(text, text, text, text),
  pulso_admin_fijar_config(text, text, int, text)
to pulso_app;

-- El auditor lee también los errores (como la auditoría: solo lectura).
grant select on errores to pulso_auditor;
