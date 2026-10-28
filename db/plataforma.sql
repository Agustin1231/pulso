-- Pulso — configuración de la plataforma
--
-- Se aplica después de seguridad.sql (npm run setup-db). Es idempotente.
--
-- Valores que el administrador puede cambiar desde la app sin un deploy. Por
-- ahora, los dos tiempos de inactividad de la sesión:
--   * token_inactividad_minutos  — el token de autenticación deja de servir si
--     pasa este tiempo sin ninguna petición autenticada (por defecto 180 días).
--   * sesion_inactividad_minutos — la sesión en la app se cierra si el usuario
--     pasa este tiempo sin interactuar (por defecto 30 minutos).
--
-- Como las demás tablas de sistema, `configuracion` no tiene grants para
-- `pulso_app`: se lee con `pulso_config` y se cambia con las funciones de
-- administración (db/admin.sql), que exigen el permiso y dejan auditoría.

create table if not exists configuracion (
  clave           text primary key,
  valor           int not null,
  minimo          int not null,
  maximo          int not null,
  actualizada_at  timestamptz not null default now(),
  actualizada_por text,
  check (valor between minimo and maximo)
);

insert into configuracion (clave, valor, minimo, maximo) values
  ('token_inactividad_minutos',  259200, 1, 525600),
  ('sesion_inactividad_minutos', 30,     1, 1440)
on conflict (clave) do nothing;

-- Valor de una clave de configuración, o null si no existe.
create or replace function pulso_config(p_clave text)
returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select c.valor from configuracion c where c.clave = p_clave
$$;

revoke execute on function pulso_config(text) from public;
grant execute on function pulso_config(text) to pulso_app;

-- ─── Sesión: vencimiento del token e inactividad (integrador, puntos 10, 11, 16 y 18) ─
-- Las funciones de sesión de db/seguridad.sql (crear, resolver, renovar, rotar,
-- revocar) pasan todas por `pulso_sesion_vigente`, así que las dos reglas de
-- acá valen igual para cada ruta, cada server action y la app nativa, y leen
-- la configuración EN CADA PETICIÓN: un cambio del administrador rige desde la
-- petición siguiente, sin deploy ni caché.
--
--   * Token (punto 10): deja de servir cuando pasan `token_inactividad_minutos`
--     sin ninguna petición autenticada (`ultimo_uso`). Cada petición corre el
--     vencimiento.
--   * Sesión en la app (punto 11): una sesión con cuenta se cierra cuando
--     pasan `sesion_inactividad_minutos` sin que el usuario toque la app
--     (`actividad_at`). Esa columna la mueve solo el latido del cliente, que se
--     manda únicamente si hubo mouse, teclado, toques o scroll (y abrir o
--     recargar la página, o abrir la app nativa o volver a ella): las
--     peticiones de fondo no cuentan. Así, cerrar el navegador (o dejar el
--     teléfono) y volver después también pide entrar de nuevo.
--     Vale para los dos clientes: la app nativa manda el mismo latido que la
--     web (`POST /api/sesion/latido`, solo si el usuario tocó la pantalla).
--     Hasta el 27-oct-2026 la app nativa no tenía cuentas ni latido y sus
--     sesiones (`cliente = 'movil'`) quedaban afuera de esta regla.
--
-- `revocada_motivo` (db/seguridad.sql) guarda por qué se cerró cada sesión; el
-- navegador que la tenía se entera con `pulso_motivo_sesion` y /acceso se lo
-- explica al usuario.

alter table sesiones
  add column if not exists cliente      text not null default 'web' check (cliente in ('web', 'movil')),
  add column if not exists actividad_at timestamptz not null default now();

-- Cuánto puede pasar el token sin ninguna petición autenticada.
create or replace function pulso_vigencia_token() returns interval
language sql stable set search_path = public, pg_temp as $$
  select make_interval(mins => coalesce(pulso_config('token_inactividad_minutos'), 259200))
$$;

-- Cuánto puede pasar una sesión con cuenta sin que el usuario interactúe.
create or replace function pulso_inactividad_sesion() returns interval
language sql stable set search_path = public, pg_temp as $$
  select make_interval(mins => coalesce(pulso_config('sesion_inactividad_minutos'), 30))
$$;

-- La fila de la sesión del token si todavía sirve; si no, una fila vacía
-- (todos los campos en null: se pregunta por `uid is null`). Al notar que una
-- sesión dejó de servir, lo deja escrito y en la auditoría, una sola vez:
--   * token vencido: fija `expira_at` en el momento en que venció (la purga y
--     las demás funciones lo miran) → 'sesion.vencer';
--   * sesión con cuenta inactiva (web o app nativa): la revoca con motivo
--     'inactividad' → 'sesion.revocar'.
--     La activación de la cuenta cuenta como actividad: quien la activa desde
--     el enlace del correo y vuelve a la pestaña donde se registró no tiene
--     que entrar de nuevo.
-- Con `p_deslizar`, la petición corre el vencimiento del token. Para no
-- escribir en cada petición, se escribe solo si el último uso tiene más de un
-- vigésimo de la vigencia, y como mucho un minuto: con 180 días, una escritura
-- por minuto de uso; con 1 minuto, una cada 3 segundos. Un token rotado (fila
-- 7) no se desliza: le quedan sus 2 minutos de gracia.
create or replace function pulso_sesion_vigente(p_token_hash text, p_deslizar boolean)
returns sesiones
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s         sesiones;
  v_vacia     sesiones;
  v_token     interval := pulso_vigencia_token();
  v_actividad timestamptz;
begin
  select * into v_s
    from sesiones s
   where s.token_hash = p_token_hash
     and s.revocada_at is null
     and s.expira_at > now();
  if not found then
    return v_vacia;
  end if;

  if v_s.ultimo_uso <= now() - v_token then
    update sesiones s set expira_at = v_s.ultimo_uso + v_token
     where s.token_hash = p_token_hash and s.expira_at > now();
    if found then
      insert into auditoria (uid, accion, resultado, detalle)
      values (v_s.uid, 'sesion.vencer', 'ok',
              jsonb_build_object('motivo', 'vencida', 'cliente', v_s.cliente,
                                 'minutos', (extract(epoch from v_token) / 60)::int));
    end if;
    return v_vacia;
  end if;

  -- Sin una cuenta activada `v_actividad` queda en null y la regla no aplica:
  -- una sesión anónima no tiene nada que proteger.
  select greatest(v_s.actividad_at, c.verificada_at) into v_actividad
    from cuentas c
   where c.uid = v_s.uid and c.verificada_at is not null;
  if v_actividad <= now() - pulso_inactividad_sesion() then
    update sesiones s set revocada_at = now(), revocada_motivo = 'inactividad'
     where s.token_hash = p_token_hash and s.revocada_at is null;
    if found then
      insert into auditoria (uid, accion, resultado, detalle)
      values (v_s.uid, 'sesion.revocar', 'ok',
              jsonb_build_object('motivo', 'inactividad', 'cliente', v_s.cliente,
                                 'minutos', (extract(epoch from pulso_inactividad_sesion()) / 60)::int));
    end if;
    return v_vacia;
  end if;

  if p_deslizar and v_s.rotada_at is null
     and v_s.ultimo_uso < now() - least(v_token / 20, interval '1 minute') then
    update sesiones s set ultimo_uso = now(), expira_at = now() + v_token
     where s.token_hash = p_token_hash;
    v_s.ultimo_uso := now();
    v_s.expira_at  := now() + v_token;
  end if;
  return v_s;
end $$;

-- Por qué dejó de servir la sesión de este token, para que /acceso se lo
-- explique al usuario (punto 16 y los demás): 'cierre', 'otro_inicio',
-- 'inactividad', 'contrasena', 'admin' o 'vencida'. null si sigue sirviendo,
-- si el token no existe (inventado, o de una identidad borrada) o si la sesión
-- no tenía una cuenta activada: no había nada que perder ni que explicar.
create or replace function pulso_motivo_sesion(p_token_hash text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s sesiones;
begin
  if (pulso_sesion_vigente(p_token_hash, false)).uid is not null then
    return null;
  end if;
  select * into v_s from sesiones s where s.token_hash = p_token_hash;
  if not found
     or not exists (select 1 from cuentas c where c.uid = v_s.uid and c.verificada_at is not null) then
    return null;
  end if;
  if v_s.revocada_at is not null then
    return coalesce(v_s.revocada_motivo, 'cierre');
  end if;
  return 'vencida';
end $$;

-- Lo que necesita el vigía de sesión del cliente (punto 11), sin mover nada:
-- si la sesión sirve, hace cuántos segundos fue la última interacción que
-- registró el servidor (null si la regla no aplica: sesión sin cuenta) y
-- los dos tiempos vigentes. Con varias pestañas, la cuenta regresiva de cada
-- una se ancla en este valor: una pestaña que estuvo congelada en segundo plano
-- no cierra la sesión que el usuario está usando en otra.
create or replace function pulso_inactividad_de_sesion(p_token_hash text)
returns table (vigente boolean, inactiva_seg int, token_minutos int, sesion_minutos int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s         sesiones := pulso_sesion_vigente(p_token_hash, false);
  v_actividad timestamptz;
begin
  if v_s.uid is not null then
    select greatest(v_s.actividad_at, c.verificada_at) into v_actividad
      from cuentas c
     where c.uid = v_s.uid and c.verificada_at is not null;
  end if;
  return query select
    v_s.uid is not null,
    (extract(epoch from now() - v_actividad))::int,
    (extract(epoch from pulso_vigencia_token()) / 60)::int,
    (extract(epoch from pulso_inactividad_sesion()) / 60)::int;
end $$;

-- Latido del cliente (web o app nativa): el usuario interactuó con la app hace `p_hace_seg`
-- segundos (el cliente los junta y manda un latido cada tanto, no uno por
-- evento). Corre `actividad_at` sin ir nunca hacia atrás y, como toda petición
-- autenticada, el vencimiento del token. Escritura espaciada: no más de una
-- cada 5 segundos por sesión. Devuelve lo mismo que pulso_inactividad_de_sesion.
create or replace function pulso_latido(p_token_hash text, p_hace_seg int)
returns table (vigente boolean, inactiva_seg int, token_minutos int, sesion_minutos int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s        sesiones := pulso_sesion_vigente(p_token_hash, true);
  v_cuando   timestamptz := now() - make_interval(secs => least(greatest(coalesce(p_hace_seg, 0), 0), 3600));
begin
  if v_s.uid is not null then
    update sesiones s set actividad_at = v_cuando
     where s.token_hash = p_token_hash
       and s.actividad_at < v_cuando - interval '5 seconds';
  end if;
  return query select * from pulso_inactividad_de_sesion(p_token_hash);
end $$;

revoke execute on function
  pulso_vigencia_token(),
  pulso_inactividad_sesion(),
  pulso_sesion_vigente(text, boolean),
  pulso_motivo_sesion(text),
  pulso_inactividad_de_sesion(text),
  pulso_latido(text, int)
from public;

grant execute on function
  pulso_motivo_sesion(text),
  pulso_inactividad_de_sesion(text),
  pulso_latido(text, int)
to pulso_app;
