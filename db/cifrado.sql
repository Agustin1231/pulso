-- Pulso — columnas cifradas de los datos de salud
--
-- Se aplica al final (npm run setup-db). Es idempotente.
--
-- Integrador, punto 19: la información sensible del usuario se guarda cifrada.
-- Los valores de las métricas y los campos del perfil se cifran en la app con
-- AES-256-GCM (src/lib/seguridad/cifrado.ts, formato en
-- src/lib/db/salud-cifrada.ts). La clave vive solo en el entorno de la app: la
-- base nunca ve el dato en claro y un volcado no alcanza para leerlo.
--
--   metricas  valor     → valor_cifrado      notas   → notas_cifrado
--   perfil    edad      → edad_cifrado       sexo    → sexo_cifrado
--             altura_cm → altura_cm_cifrado  fumador → fumador_cifrado
--
-- `tipo`, `unidad` y las fechas quedan en claro: la base filtra y ordena por
-- ellos. Los rangos que controlaban los CHECK de `perfil` pasan a zod
-- (`perfilSchema` y `metricaSchema` en src/lib/seguridad/validacion.ts).
--
-- Migración en dos pasos, sin perder datos (orden de deploy en
-- docs/integrador/cifrado.md):
--   1. Este archivo. En una base nueva las columnas ya vienen de schema.sql. En
--      una base de antes las agrega AL LADO de las columnas en claro, que siguen
--      ahí: la versión anterior de la app sigue andando.
--   2. scripts/migrar-cifrado-salud.mjs, que tiene la clave: cifra las filas,
--      verifica que todas se descifran y recién entonces borra las columnas en
--      claro.
-- Este archivo nunca borra datos: sin la clave no puede verificar nada.

alter table metricas
  add column if not exists valor_cifrado text,
  add column if not exists notas_cifrado text;

alter table perfil
  add column if not exists edad_cifrado      text,
  add column if not exists sexo_cifrado      text,
  add column if not exists altura_cm_cifrado text,
  add column if not exists fumador_cifrado   text;

-- El formato de `cifrar` es la versión y el base64url (`v1.…`). La base
-- rechaza cualquier otra cosa en una columna cifrada: un bug que se olvide de
-- cifrar falla con un error en vez de guardar el dato en claro.
do $$
declare
  c record;
begin
  for c in select * from (values
    ('metricas', 'valor_cifrado'), ('metricas', 'notas_cifrado'),
    ('perfil', 'edad_cifrado'), ('perfil', 'sexo_cifrado'),
    ('perfil', 'altura_cm_cifrado'), ('perfil', 'fumador_cifrado')
  ) as t(tabla, columna)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = c.tabla::regclass and conname = c.tabla || '_' || c.columna || '_formato') then
      execute format('alter table %I add constraint %I check (%I ~ %L)',
                     c.tabla, c.tabla || '_' || c.columna || '_formato', c.columna,
                     '^v[0-9]+\.[A-Za-z0-9_-]+$');
    end if;
    execute format('comment on column %I.%I is %L', c.tabla, c.columna,
                   'Cifrado por la app (AES-256-GCM, contexto "' || c.tabla || '.'
                   || replace(c.columna, '_cifrado', '') || '"). Ver db/cifrado.sql.');
  end loop;
end $$;

-- ─── Transición: mientras existan las columnas en claro ─────────────────────
-- Entre el paso 1 y el 2 conviven las columnas viejas y las nuevas y, durante
-- el deploy, también las dos versiones de la app: la vieja escribe en claro y
-- la nueva cifrado. Dos reglas para que el script sepa siempre cuál es el dato
-- vigente de cada fila:
--   * La versión nueva no escribe en claro: `metricas.valor` deja de ser
--     obligatorio.
--   * Gana la última escritura. Si se escribe lo cifrado, lo que había en claro
--     se borra (ya no vale y no tiene por qué quedar a la vista). Si se escribe
--     en claro (la versión vieja), se borra lo cifrado, y el script lo vuelve a
--     cifrar desde el claro.
-- Los triggers miran QUÉ columnas escribe el UPDATE, no si cambió el valor:
-- guardar el mismo perfil con la versión nueva también borra el claro.
-- El script los borra junto con las columnas; en una base ya migrada (o
-- nueva) el bloque de abajo no hace nada.

-- Pone en null las columnas de NEW que se le pasan como argumentos.
create or replace function pulso_anular_columnas() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_nulos jsonb := '{}';
  v_col   text;
begin
  foreach v_col in array tg_argv loop
    v_nulos := v_nulos || jsonb_build_object(v_col, null);
  end loop;
  new := jsonb_populate_record(new, v_nulos);
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'metricas' and column_name = 'valor') then
    alter table metricas alter column valor drop not null;
    drop trigger if exists metricas_cifrado_anula_claro on metricas;
    create trigger metricas_cifrado_anula_claro
      before update of valor_cifrado, notas_cifrado on metricas
      for each row execute function pulso_anular_columnas('valor', 'notas');
    drop trigger if exists metricas_claro_anula_cifrado on metricas;
    create trigger metricas_claro_anula_cifrado
      before update of valor, notas on metricas
      for each row execute function pulso_anular_columnas('valor_cifrado', 'notas_cifrado');
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'perfil' and column_name = 'edad') then
    drop trigger if exists perfil_cifrado_anula_claro on perfil;
    create trigger perfil_cifrado_anula_claro
      before update of edad_cifrado, sexo_cifrado, altura_cm_cifrado, fumador_cifrado on perfil
      for each row execute function pulso_anular_columnas('edad', 'sexo', 'altura_cm', 'fumador');
    drop trigger if exists perfil_claro_anula_cifrado on perfil;
    create trigger perfil_claro_anula_cifrado
      before update of edad, sexo, altura_cm, fumador on perfil
      for each row execute function pulso_anular_columnas('edad_cifrado', 'sexo_cifrado', 'altura_cm_cifrado', 'fumador_cifrado');
  end if;
end $$;
