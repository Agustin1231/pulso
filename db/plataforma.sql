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
