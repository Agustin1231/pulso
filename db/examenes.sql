-- Pulso — exámenes médicos subidos por el usuario
--
-- Se aplica después de admin.sql (npm run setup-db). Es idempotente.
--
-- Módulo de carga seguro (integrador, punto 15). El usuario guarda sus
-- exámenes de laboratorio en PDF, JPG o PNG. La app valida cada archivo por la
-- firma de sus primeros bytes (no por la extensión ni por el MIME que declara
-- el navegador) y lo guarda CIFRADO en `MEDIA_DIR/examenes/<archivo>`, donde
-- `archivo` es un id aleatorio: la ruta en disco no depende del uid ni del
-- nombre. El nombre original va cifrado acá (`nombre_cifrado`, formato `v1.…`
-- de src/lib/seguridad/cifrado.ts): "VIH_resultado.pdf" ya es un dato de salud.
--
--   * RLS como las demás tablas de datos: cada usuario ve, baja y borra solo
--     lo suyo, aunque la app tenga un bug y olvide el filtro.
--   * FK a `identidades` con `on delete cascade`: la supresión
--     (pulso_eliminar_datos) y la purga (pulso_purgar_inactivos) borran las
--     filas al borrar la identidad; los archivos los borra la app
--     (/api/mis-datos) y scripts/purgar-inactivos.mjs.
--   * La fusión de identidad (pulso_fusionar_identidad, en seguridad.sql) pasa
--     los exámenes a la cuenta: como el archivo no depende del uid, basta con
--     cambiar el dueño de la fila.
--   * Cuota por usuario de filas Y de bytes, en un trigger: la base es la
--     autoridad aunque la app tenga un bug o dos subidas lleguen a la vez.
--   * `pulso_app` puede leer, insertar y borrar (no modificar: un examen no se
--     edita, se borra y se sube de nuevo).

create table if not exists examenes (
  id             uuid primary key default gen_random_uuid(),
  uid            text not null references identidades (uid) on delete cascade,
  -- Nombre del archivo cifrado en MEDIA_DIR/examenes/: 128 bits aleatorios.
  archivo        text not null unique check (archivo ~ '^[0-9a-f]{32}$'),
  nombre_cifrado text not null check (nombre_cifrado like 'v1.%' and char_length(nombre_cifrado) <= 1024),
  -- Tipo DETECTADO por la firma del contenido, no el declarado.
  tipo           text not null check (tipo in ('pdf', 'jpg', 'png')),
  -- Tamaño del original (antes de cifrar), máximo 10 MB.
  bytes          int  not null check (bytes between 1 and 10485760),
  created_at     timestamptz not null default now()
);

create index if not exists examenes_uid_created_idx on examenes (uid, created_at desc);

-- ─── Cuota por usuario ───────────────────────────────────────────────────────
-- Igual que `pulso_cuota_filas` (seguridad.sql), más un tope de bytes: con 50
-- archivos de 10 MB un usuario llegaría a 500 MB, así que el total se acota
-- aparte. El lock por usuario evita que dos subidas en paralelo cuenten las
-- dos N-1. Corre con los permisos de quien inserta: para `pulso_app`, RLS ya
-- limita el conteo a sus propias filas. La app traduce el error a un mensaje
-- según `detail` ('examenes' o 'examenes_bytes').
create or replace function pulso_cuota_examenes() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_max_filas int    := TG_ARGV[0]::int;
  v_max_bytes bigint := TG_ARGV[1]::bigint;
  v_filas     int;
  v_bytes     bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('examenes:' || NEW.uid, 0));
  select count(*), coalesce(sum(e.bytes), 0) into v_filas, v_bytes
    from examenes e where e.uid = NEW.uid;
  if v_filas >= v_max_filas then
    raise exception using errcode = 'P0001', message = 'pulso_cuota_excedida', detail = 'examenes';
  end if;
  if v_bytes + NEW.bytes > v_max_bytes then
    raise exception using errcode = 'P0001', message = 'pulso_cuota_excedida', detail = 'examenes_bytes';
  end if;
  return NEW;
end $$;

-- 50 exámenes y 100 MB por usuario: años de análisis de laboratorio (unos
-- cientos de KB cada uno) y poco para llenar el disco. Los mismos números
-- muestra la app (src/lib/examenes/reglas.ts).
drop trigger if exists cuota_por_usuario on examenes;
create trigger cuota_por_usuario before insert on examenes
  for each row execute function pulso_cuota_examenes('50', '104857600');

-- ─── Grants y RLS ────────────────────────────────────────────────────────────

revoke all on examenes from public;
grant select, insert, delete on examenes to pulso_app;

alter table examenes enable row level security;
alter table examenes force row level security;
drop policy if exists propietario on examenes;
create policy propietario on examenes to pulso_app
  using (uid = current_setting('app.uid', true))
  with check (uid = current_setting('app.uid', true));
