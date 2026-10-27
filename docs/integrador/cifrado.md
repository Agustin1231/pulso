# Cifrado de los datos de salud en reposo (integrador, punto 19)

> Punto 19 del video: *"En la base, las contraseñas y la información sensible
> del usuario están cifradas."* Este documento cubre la **información de
> salud** (métricas y perfil). La contraseña (bcrypt) y el correo (cifrado con
> índice ciego) son de la parte de cuentas: ver `docs/integrador/cuentas.md`.

## Qué se hizo

Antes, la tabla `metricas` guardaba el número (`valor double precision`) y las
notas en claro, y `perfil` la edad, el sexo, la altura y si la persona fuma. Con
un volcado de la base, o con el usuario dueño, se leía la salud de todos.

Ahora esos seis datos se guardan **cifrados por la app** con AES-256-GCM
(`src/lib/seguridad/cifrado.ts`). La clave (`PULSO_CLAVE_DATOS`) vive solo en
el entorno de la app: la base nunca ve el dato en claro.

| Tabla | Antes (en claro) | Ahora (cifrado) | Contexto del cifrado |
|---|---|---|---|
| `metricas` | `valor` | `valor_cifrado` (obligatorio) | `metricas.valor` |
| `metricas` | `notas` | `notas_cifrado` | `metricas.notas` |
| `perfil` | `edad` | `edad_cifrado` | `perfil.edad` |
| `perfil` | `sexo` | `sexo_cifrado` | `perfil.sexo` |
| `perfil` | `altura_cm` | `altura_cm_cifrado` | `perfil.altura_cm` |
| `perfil` | `fumador` | `fumador_cifrado` | `perfil.fumador` |

`tipo`, `unidad` y las fechas quedan en claro: la base filtra y ordena por ellos
(últimas por tipo, historial por fechas) y no dicen nada de la salud de la
persona por sí solos.

**La capa de datos descifra al leer** (`src/lib/db/consultas.ts`). El motor de
predicción, el informe, el dashboard, la IA (tips, rutinas, análisis) y la API
móvil reciben exactamente los mismos números que antes: lo único que cambió son
las consultas SQL de `consultas.ts`, `metricas.ts` y `perfil.ts`.

### Detalles del diseño

- **Un contexto por columna** (dato asociado de GCM): un valor copiado de
  `metricas.valor` a `perfil.edad` no se descifra.
- **Relleno a largo fijo.** Se cifra el valor en JSON (vuelve con su tipo) y
  rellenado con espacios: todos los valores cortos miden 32 bytes y las notas
  van al múltiplo de 128 siguiente. Sin esto el largo del texto cifrado
  delataba el dato: `true`/`false` (fuma o no), `m`/`otro`, 95 o 120 de
  presión. Hoy todos los valores cortos cifrados miden 83 caracteres.
- **IV aleatorio**: el mismo valor cifrado dos veces da textos distintos.
- **Un dato ilegible no tumba la página.** Si un valor fue alterado, es de otra
  columna o se cifró con otra clave, la capa de datos lo descarta (la métrica
  no se muestra; el campo del perfil queda vacío) y deja una línea en el log
  del servidor con el id de la fila y el motivo, nunca el dato:
  `[cifrado] metricas <id>: metricas.valor: no se pudo descifrar (…); se descarta el dato`.
- **La base rechaza un dato en claro en una columna cifrada**: cada columna
  tiene un `CHECK` de formato (`v1.` + base64url). Un bug que se olvide de
  cifrar falla con un error en vez de guardar el dato a la vista.
- **Los rangos pasan a zod.** Los `CHECK` de `perfil` (edad 18–120, altura
  100–250, sexo m/f/otro) se van con las columnas en claro; ya estaban
  duplicados en `perfilSchema` y los de las métricas en `metricaSchema`
  (`src/lib/seguridad/validacion.ts`). Confirmado: las dos validaciones ya
  existían y se aplican en toda escritura (web y API móvil); las pruebas de
  bordes de `tests/funcionales/api-movil.test.mjs` las cubren.
- **Un solo módulo para el formato**: `src/lib/db/salud-cifrada.ts`. Lo usan la
  app, el seed de demo, el script de migración y el de carga, así todos cifran
  y verifican igual. No importa nada a propósito (recibe `cifrar`/`descifrar`):
  el script de migración corre con el Node de producción y
  `--experimental-strip-types`, que no resuelve imports sin extensión.

## Archivos

| Archivo | Qué |
|---|---|
| `db/schema.sql` | Una base nueva crea `metricas` y `perfil` ya con las columnas cifradas. |
| `db/cifrado.sql` | Paso 1 de la migración: agrega las columnas cifradas a una base vieja, los `CHECK` de formato y, mientras existan las columnas en claro, los triggers de transición. |
| `scripts/migrar-cifrado-salud.mjs` | Paso 2: cifra lo que quede en claro, verifica todo y recién entonces borra las columnas en claro. |
| `src/lib/db/salud-cifrada.ts` | Formato: contextos, relleno, validación del tipo al descifrar, descarte con log. |
| `src/lib/db/consultas.ts` | Instancia de la app (`salud`), lecturas que descifran (`ultimasMetricas`, `historialMetricas`, `perfilDe`). |
| `src/lib/db/metricas.ts`, `perfil.ts` | Escrituras que cifran; historial de un tipo que descifra. |
| `src/lib/db/types.ts` | Tipos de las filas cifradas (`MetricaCifradaRow`, `PerfilCifradoRow`). |
| `scripts/seed-demo.ts` | Cifra lo que siembra; acepta `--email` (cuenta activada) además de `--uid`; escribe bajo RLS si se conecta como `pulso_app`. |
| `tests/carga/preparar.mjs` | Genera los valores en JS y los cifra (antes los sorteaba la base). |
| `tests/integrador/cifrado.test.mjs` | Pruebas (abajo). |
| `tests/seguridad/{base,http}.test.mjs`, `tests/funcionales/api-movil.test.mjs` | Sus `insert into metricas` directos pasan a las columnas cifradas. |

## Migración en producción

Dos pasos, sin perder datos. Ninguno borra nada sin haber verificado antes.

1. **`db/cifrado.sql`** (lo aplica `npm run setup-db`). Agrega las columnas
   cifradas **al lado** de las viejas, que siguen ahí, y deja `valor` como
   opcional. La versión anterior de la app sigue andando igual.
   Mientras convivan las columnas (y, durante el deploy, las dos versiones de
   la app), dos triggers mantienen una regla simple: **gana la última
   escritura**. Si se escribe lo cifrado (versión nueva), lo que había en claro
   en esa fila se borra; si se escribe en claro (versión vieja), lo cifrado se
   borra y el script lo vuelve a cifrar.
2. **`scripts/migrar-cifrado-salud.mjs`**, en una sola transacción y con las dos
   tablas bloqueadas (son segundos):
   1. borra los triggers de transición;
   2. cifra, desde el claro, toda fila que todavía tenga un dato en claro;
   3. lee de vuelta **todas** las filas y las descifra con el mismo código que
      la app: cada métrica tiene que tener valor, todo tiene que descifrarse y,
      donde había claro, coincidir exactamente (el double vuelve idéntico);
   4. solo si nada falló, borra las columnas en claro, deja `valor_cifrado`
      obligatorio y deja una fila `datos.cifrar` en la auditoría.

   Si algo no cuadra (por ejemplo, otra `PULSO_CLAVE_DATOS`), hace rollback y
   lista las filas con problema (id y campo, nunca el dato). `--simular` hace
   todo y al final también deshace. Es idempotente: en una base ya migrada solo
   verifica (si encuentra datos que no se descifran, los lista y sale con error:
   sirve como chequeo). Usa `row_security = off`: si el rol estuviera sujeto a RLS, falla
   en vez de ver cero filas y dar la migración por hecha.

`setup-db` corre limpio en los tres estados: base nueva, base de producción
antes de migrar y base ya migrada (comprobado dos veces seguidas en cada uno).

### Orden de deploy

1. **Respaldo** de la base (`pg_dump`) y de `PULSO_CLAVE_DATOS` **por separado**:
   sin esa clave, lo cifrado no se puede recuperar nunca.
2. Confirmar que la app de producción tiene `PULSO_CLAVE_DATOS` (32 bytes en
   base64). Desde este cambio la app la necesita para leer y guardar métricas.
3. `npm run setup-db` con el código nuevo (paso 1). No rompe la versión que
   está corriendo.
4. Deploy de la app nueva. Desde acá todo lo que se guarda va cifrado. Hasta el
   paso 5, las filas viejas todavía sin cifrar **no se muestran** (no se
   pierden: siguen en las columnas en claro; el log avisa
   `sin cifrar (falta correr scripts/migrar-cifrado-salud.mjs)`).
5. Enseguida, en el contenedor de la app (tiene la clave y el Node 22.11):

   ```bash
   # primero en seco
   DATABASE_ADMIN_URL=postgres://<dueño>@<host>/pulso \
     node --experimental-strip-types scripts/migrar-cifrado-salud.mjs --simular
   # y de verdad
   DATABASE_ADMIN_URL=postgres://<dueño>@<host>/pulso \
     node --experimental-strip-types scripts/migrar-cifrado-salud.mjs
   ```

   Es lo mismo que `npm run migrar:cifrado-salud -- --simular`.
   `PULSO_CLAVE_DATOS` y `PGSSL`/`PGSSL_CA` se toman del entorno del contenedor.
   El script no lee `.env.local`: las variables van explícitas.
6. `npm run setup-db` otra vez (no hace nada nuevo: comprueba que queda limpio).

Para volver atrás después del paso 5 hay que restaurar el respaldo: las
columnas en claro ya no existen.

## Guion para el video (punto 19, datos de salud)

Lo que se ve: el mismo dato, en la app como número y en la base como `v1.…`.

1. **En la app**, con una cuenta activada, abrir *Métricas* y registrar, por
   ejemplo, peso **72.5 kg** (tarjeta *Peso* → lápiz → *Guardar*). Abrir
   *Mi Score* → perfil: edad, altura, sexo y "¿Fumás actualmente?" → guardar. Se ve el
   72.5 en la tarjeta y el IMC calculado en *Mi Score*.
2. **En la base**, como dueño (en local:
   `docker exec -it <contenedor-db> psql -U postgres -d pulso`; en producción,
   por el túnel SSH):

   ```sql
   \d metricas
   -- no hay columna `valor`: solo valor_cifrado / notas_cifrado
   select tipo, valor_cifrado, notas_cifrado, created_at
     from metricas order by created_at desc limit 3;
   -- peso | v1.qiLGu0k-FefyPrCbKK1N0uYl29r… | …  ← no aparece el 72.5
   select edad_cifrado, sexo_cifrado, altura_cm_cifrado, fumador_cifrado
     from perfil order by actualizado_at desc limit 1;
   -- cuatro v1.… del mismo largo: ni siquiera el largo dice si fuma
   ```

   Evidencia: el número no está en ningún lado; todos los valores miden lo mismo.
3. **Mostrar que la base no acepta un dato en claro:**

   ```sql
   update metricas set valor_cifrado = '72.5' where tipo = 'peso';
   -- ERROR: new row for relation "metricas" violates check constraint "metricas_valor_cifrado_formato"
   ```
4. **Mostrar que un valor alterado no se lee** (opcional, en local): correr las
   pruebas y mostrar el `✔`:

   ```bash
   node --experimental-strip-types --test tests/integrador/cifrado.test.mjs
   # ✔ un valor alterado no se descifra, y la app lo descarta sin romperse
   # ✔ como dueño de la base se ve v1.… y no el número ni las notas
   ```
5. Cerrar con la parte de cuentas (`docs/integrador/cuentas.md`): en `cuentas`,
   la contraseña es un hash bcrypt y el correo está cifrado.

## Pruebas

```bash
BASE_URL=http://127.0.0.1:3205 DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55445/pulso \
MAILPIT_URL=http://127.0.0.1:18025 PULSO_CLAVE_DATOS=<la del servidor> \
  node --experimental-strip-types --test tests/integrador/cifrado.test.mjs
```

Se niegan a correr contra `agustinynatalia.site` y se saltean sin las
variables. La parte de la migración crea una base temporal en el mismo servidor
(`create database`, hace falta un dueño que pueda crear bases) con el esquema
de producción de hoy, sacado del commit `b7ccd69` con `git show`, y la borra al
final.

| Prueba | Qué demuestra |
|---|---|
| esquema | Base nueva/migrada: sin columnas en claro, `valor_cifrado` obligatorio, sin triggers de transición. |
| como dueño se ve `v1.…` | La app guarda cifrado: el número y las notas no aparecen en la base; con la clave se leen. |
| el largo no delata el dato | Todos los valores cortos cifrados miden lo mismo; dos cifrados del mismo valor difieren. |
| la app devuelve los mismos números | Últimas, historial y perfil vuelven con el número exacto; el motor calcula el IMC, el tabaquismo y el contexto de edad con los datos descifrados. |
| upsert del día | Reemplaza el valor cifrado sin duplicar la fila. |
| lo que cifra un script la app lo lee | El módulo compartido (seed, carga, migración) produce lo mismo que la app. |
| la base rechaza un dato en claro | `CHECK` de formato en las columnas cifradas. |
| un valor alterado no se descifra | Un carácter cambiado o un valor copiado a otra columna: no se descifra; la app responde 200, descarta ese dato y lee los demás. |
| migración, paso 1 | `setup-db` sobre el esquema de producción con datos: agrega lo cifrado sin tocar el claro (dos veces). |
| transición | Gana la última escritura entre la versión vieja y la nueva de la app. |
| otra clave | La verificación falla, rollback, la columna en claro sigue. |
| `--simular` | Verifica y no cambia nada. |
| paso 2 | Cifra, verifica, borra el claro; cada valor queda exacto (incluido `0.1 + 0.2`); queda la auditoría. |
| después | `setup-db` y la migración vuelven a correr limpias. |

Además se comprobó a mano (ver el reporte de A5):

- `npm run test:ml`: las mismas 71 pruebas, mismos resultados.
- La API devuelve **byte a byte lo mismo** (informe completo, últimas,
  historial de 90 días de los 8 tipos y perfil) para el usuario del seed demo:
  con el código anterior en claro, después de migrar esa misma base, y con una
  base nueva sembrada por el seed nuevo.
- Con el esquema de producción (`b7ccd69`), una cuenta creada y activada con
  sus funciones y datos en claro: setup-db ×2 → migración con **Node 22.11**
  (`--simular`, real, otra vez) → setup-db ×2 → la cuenta entra con su misma
  contraseña y sus métricas, notas y perfil se leen exactos.
- `tests/seguridad/base.test.mjs` 20/20 con el esquema nuevo.

## Límites y riesgos residuales

- **La clave vive en el entorno de la app.** Cifrar en la app protege de un
  volcado de la base, de un respaldo filtrado y del rol dueño de la base, no de
  quien controle el contenedor de la app (tiene la clave y el código). Perder la
  clave es perder los datos: va respaldada aparte.
- **Metadatos en claro**: qué tipo de métrica registró alguien y cuándo, y el
  largo aproximado de sus notas (en bloques de 128 bytes).
- **El contexto es por columna, no por fila**: quien pueda escribir en la base
  podría mover un valor cifrado de una fila a otra de la misma columna. No lo
  puede leer ni fabricar uno nuevo. Atarlo a la fila no sirve con el `uid`
  (cambia al fusionar una identidad anónima con su cuenta).
- **Sin rotación de clave todavía.** El formato lleva versión (`v1.`) y los
  `CHECK` aceptan `v<n>.`, así que se puede agregar una `v2` con otra clave y
  re-cifrar con un script como el de la migración.
