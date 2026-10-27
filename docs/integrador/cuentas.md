# Cuentas y contraseñas — ronda de seguridad del integrador (A1)

Puntos de la lista: **2, 3, 4, 6, 12, 13, 14, 16, 19 (correo cifrado) y 20**.

Todo vive en la sección "Cuentas con correo y contraseña" de `db/seguridad.sql`
(funciones `pulso_*` security definer, como el resto) y en `src/lib/cuenta.ts`,
`src/lib/seguridad/contrasena.ts`, las rutas `src/app/api/cuenta/**` y los
componentes `src/components/cuenta/**`.

## Qué se hizo

| Punto | Qué | Dónde |
|---|---|---|
| 13 | Regla de contraseñas: 10 caracteres a 72 bytes, mayúscula, minúscula, número y símbolo; sin secuencias de 4 (`1234`, `abcd`, `4321`), sin 4 iguales seguidos (`aaaa`), no una común (`Password1!`, `Qwerty123!`, `Pulso2026!`), no la parte local del correo. **La misma regla, con los mismos textos, en TypeScript y en la base**; la UI la muestra con check en vivo. El login NO la aplica (las cuentas viejas entran con su contraseña de siempre). | `src/lib/seguridad/contrasena.ts`, `contrasenaSchema` en `validacion.ts`, `pulso_contrasena_fallas` / `pulso_contrasena_valida`, `reglas-contrasena.tsx` |
| 4 | 5 fallos seguidos → bloqueo de 15 minutos; ni la contraseña correcta entra. Se cuenta **por correo** (su índice ciego), exista o no la cuenta. El contador vuelve a 0 al acertar, al restablecer y cuando vence el bloqueo (y un fallo de hace más de un día no suma). Cuentan el login y la contraseña actual equivocada del perfil. 429 `{ error: "cuenta_bloqueada", minutos }`; aviso por correo al dueño; `cuenta.bloquear` en la auditoría. | tabla `intentos_acceso`, `pulso_registrar_fallo`, `pulso_bloqueo_restante`, `avisarBloqueo` |
| 12 | `123456789012345` en el login → "Correo o contraseña incorrectos. Te quedan N intentos…" y suma al bloqueo. | `api/cuenta/login` |
| 2 | Un "correo" de 15 caracteres especiales → 400 `datos_invalidos` (zod, antes de tocar la base), auditado; el formulario es `noValidate` y muestra "Ese correo no es válido. Escríbelo completo, como nombre@ejemplo.com." en vez del globo del navegador. | `emailSchema`, `comun.tsx` |
| 16 | Iniciar sesión cierra las demás sesiones de la cuenta con `revocada_motivo = 'otro_inicio'`; queda solo la del navegador nuevo. `cuenta.login` audita `sesiones_cerradas`. | `pulso_iniciar_sesion_cuenta` |
| 20 | `/cuenta`: "Cambiar contraseña" (actual + nueva + repetir; regla; cierra las demás sesiones con 'contrasena'; esta sigue; correo de aviso) y "Cambiar correo" (contraseña actual + correo nuevo → enlace al correo NUEVO y aviso al viejo; el cambio rige al confirmar en `/acceso/confirmar-correo`; si el correo nuevo es de otra cuenta, misma respuesta y no se cambia nada). | `api/cuenta/contrasena`, `api/cuenta/correo`, `api/cuenta/confirmar-correo`, `perfil-cuenta.tsx`, `confirmar-correo-client.tsx` |
| 19 | `cuentas` ya no tiene el correo en claro: `email_hmac` (HMAC-SHA256, único) + `email_cifrado` (AES-256-GCM, `v1.…`), con claves que salen de `PULSO_CLAVE_DATOS` y que la base no tiene. La app descifra para mostrar y para mandar correos. Los sujetos de los límites por correo pasaron de SHA-256 a HMAC. Migración para las cuentas existentes. | `src/lib/cuenta.ts`, `scripts/migrar-cifrado-cuentas.mjs` |
| 6 | Índice único sobre `email_hmac`; el correo se normaliza (`trim` + minúsculas) antes del HMAC, así que `Ana@X.com ` y `ana@x.com` chocan. El registro responde lo mismo y el texto ahora es honesto: "Si el correo no tenía cuenta, te llegará el enlace de activación; si ya la tenía, te avisamos por correo." | `cuentas_email_hmac_idx`, `cuenta-client.tsx` |
| 3 | "Olvidé mi contraseña" de punta a punta con la regla nueva (la del correo la revisa el servidor, que sabe de qué cuenta es el enlace); restablecer cierra todas las sesiones ('contrasena') y levanta el bloqueo. | `api/cuenta/recuperar`, `api/cuenta/restablecer` |
| 14 | Todos los campos de contraseña son `CampoContrasena`: `type="password"`, sin botón de mostrar, y `onCopy` / `onCut` / `onDragStart` con `preventDefault`. Pegar sí se deja (gestores de contraseñas). | `comun.tsx` |
| — | En `/acceso/activar`, `/acceso/restablecer` y `/acceso/confirmar-correo` el token sale de la URL apenas se lee (`history.replaceState`), y las páginas van con `referrer: no-referrer`. | |

### Funciones SQL (todas `security definer`, `search_path` fijo, solo `pulso_app`)

| Función | Cambio |
|---|---|
| `pulso_registrar_cuenta(sesion, email_hmac, email_cifrado, email, password, token)` | antes `(sesion, email, password, token)`; `email` (normalizado) es solo para la regla |
| `pulso_iniciar_sesion_cuenta(email_hmac, password, nuevo, dias, actual)` | devuelve además `minutos, intentos_restantes, bloqueo_nuevo, sesiones_cerradas` y `uid_cuenta` también en los rechazos (para la auditoría) |
| `pulso_cuenta_de_sesion(sesion)` | devuelve `(email_cifrado, verificada)` |
| `pulso_reenviar_activacion` | devuelve el correo cifrado |
| `pulso_solicitar_recuperacion(email_hmac, token)` | por índice ciego |
| `pulso_correo_de_recuperacion(token)` | nueva: correo (cifrado) de un enlace de recuperación vigente |
| `pulso_restablecer_contrasena(token, password, email)` | devuelve `(resultado, sesiones_cerradas)` |
| `pulso_cambiar_contrasena(sesion, actual, nueva, email)` | nueva |
| `pulso_solicitar_cambio_correo(sesion, password, nuevo_hmac, nuevo_cifrado, token)` | nueva |
| `pulso_confirmar_cambio_correo(token)` | nueva |
| `pulso_contrasena_fallas(password, email default null)` | nueva: una fila `(regla, mensaje)` por regla que no se cumple |
| `pulso_contrasena_valida(password, email default null)` | antes `(password)`; se sigue pudiendo llamar con un solo argumento |

Auxiliares sin grant (las llaman las de arriba): `pulso_registrar_fallo`,
`pulso_bloqueo_restante`, `pulso_limpiar_fallos`, `pulso_turno_de_acceso` (un
intento a la vez por correo, con `pg_advisory_xact_lock`, para que 5 intentos
en paralelo no lean el mismo contador) y `pulso_correo_retenido`.

`tokens_cuenta` admite el tipo `'cambio_correo'`, con `nuevo_email_hmac` y
`nuevo_email_cifrado` (también cifrado).

### Rutas

| Ruta | Respuestas |
|---|---|
| `POST /api/cuenta/login` | 200 `{ ok, sesiones_cerradas }` · 401 `credenciales_invalidas` + `intentos_restantes` · 429 `cuenta_bloqueada` + `minutos` (y `Retry-After`) · 403 `cuenta_sin_activar` · 400 `datos_invalidos` |
| `POST /api/cuenta/registro` | 200 `{ ok }` (también si el correo ya tenía cuenta) · 400 `contrasena_invalida` + `reglas` (textos) |
| `POST /api/cuenta/restablecer` | 200 · 400 `contrasena_invalida` + `reglas` · 400 `enlace_invalido` |
| `POST /api/cuenta/contrasena` (nueva) | `{ actual, nueva }` → 200 `{ ok, sesiones_cerradas }` · 400 `contrasena_actual_incorrecta` + `intentos_restantes` · 400 `contrasena_invalida` + `reglas` · 400 `misma_contrasena` · 429 `cuenta_bloqueada` |
| `POST /api/cuenta/correo` (nueva) | `{ email, password }` → 200 `{ ok }` (también si el correo es de otra cuenta) · 400 `contrasena_actual_incorrecta` · 400 `mismo_correo` · 429 `cuenta_bloqueada` |
| `POST /api/cuenta/confirmar-correo` (nueva, pública) | `{ token }` → 200 · 400 `enlace_invalido` · 409 `correo_en_uso` |

Límites nuevos en `tasa.ts`: `cambioContrasena` (10/h por usuario),
`cambioCorreo` (5/h) y `cambioCuentaIp` (30/h). Los de siempre (`login` 10/h
por correo, `loginIp` 30/h, etc.) siguen.

## Contratos con las otras áreas

- **C3 (correo cifrado)** — `src/lib/cuenta.ts` exporta `normalizarCorreo`,
  `hmacCorreo`, `cifrarCorreo` y `descifrarCorreo` (contexto `"cuentas.email"`).
  Después de la migración **no existe `cuentas.email`**: lo que A2 lea con
  `cuentas.email` (su única función SQL y su único mapeo en TS, y
  `scripts/asignar-admin.mjs`) pasa a leer `email_cifrado` y descifrarlo en TS
  con `descifrarCorreo`; para buscar por correo, `where email_hmac = $1` con
  `hmacCorreo(correo)`. En `asignar-admin.mjs` (script de node, sin `@/`):
  `indiceCiego(correo.trim().toLowerCase(), "cuentas.email")` importando
  `../src/lib/seguridad/cifrado.ts` con `--experimental-strip-types`.
- **C4 (regla de contraseñas)** — `reglasContrasena(password, email?)` y
  `fallasContrasena` en `src/lib/seguridad/contrasena.ts` (TS puro, cliente y
  servidor); `<ReglasContrasena password email? />` en
  `src/components/cuenta/reglas-contrasena.tsx`. `contrasenaSchema` ya aplica
  la regla completa (cada regla que falla es un issue con su texto en
  `message`); `contrasenaParaCorreo(email)` la arma con la regla del correo y
  `fallasDeContrasena(password, email?)` devuelve `{ regla, texto }[]`. En SQL,
  `pulso_contrasena_valida(p)` sigue sirviendo con un argumento y
  `pulso_contrasena_fallas(p)` da los mensajes. Para el cambio de contraseña
  del admin (punto 7) alcanza con `contrasenaSchema` + `pulso_contrasena_valida`.
- **C2 (motivo)** — pongo `'otro_inicio'` en las demás sesiones al iniciar
  sesión, y `'contrasena'` al cambiar (las demás) o restablecer (todas). La
  sesión anónima que el login reemplaza en el mismo navegador queda revocada
  sin motivo: no es un cierre que haya que explicarle a nadie.
- **C8** — de `src/lib/sesion.ts` solo cambié `iniciarSesionConCuenta` y su
  tipo `ResultadoLogin`: ahora recibe el **índice ciego** del correo
  (`iniciarSesionConCuenta(hmacCorreo(email), password)`). En
  `pulso_iniciar_sesion_cuenta` no toqué la expresión del vencimiento del
  `insert into sesiones` (es de A3), pero la función se reescribe alrededor y
  ahora hace `drop function` antes de crearse (cambió el tipo de retorno): si
  A3 le cambia la firma, el `drop` y los `grant`/`revoke` del final de la
  sección tienen que usar la firma nueva.
- La página `/acceso` (de A3) sigue renderizando `AccesoClient`, que está en
  `cuenta-client.tsx` (mío); el aviso del motivo de A3 puede ir encima.

## Orden de deploy (producción, con cuentas existentes)

Producción corre el esquema del commit `b7ccd69`, con `cuentas.email` en
claro. `setup-db` corre limpio en los tres estados (base nueva, esquema viejo
con datos, ya migrado); entre el paso 1 y el 3 iniciar sesión o crear una
cuenta falla (las funciones ya buscan por índice ciego y el código viejo las
llama con la firma vieja), pero quien ya entró sigue usando la app: hacerlo
seguido, en pocos minutos.

1. **Respaldo** de la base.
2. `npm run setup-db` con el código nuevo: agrega `email_hmac` y
   `email_cifrado`, deja `email` opcional, crea `intentos_acceso` y las funciones.
3. `npm run migrar-cifrado-cuentas -- --simular` y después sin `--simular`, con
   `DATABASE_ADMIN_URL` y **la misma `PULSO_CLAVE_DATOS` que tiene la app** en
   Coolify (si es otra, nadie podría entrar; el script lo detecta en la
   verificación y no cambia nada). En una transacción: cifra, verifica que
   todo se descifra y coincide y recién entonces borra `cuentas.email`. Con
   Node 22.11: `node --experimental-strip-types scripts/migrar-cifrado-cuentas.mjs`.
4. Deploy de la app.
5. `npm run setup-db` otra vez (fija `email_hmac` y `email_cifrado` como NOT NULL;
   el script ya lo hace, esto lo confirma).

Probado: esquema de `b7ccd69` + una cuenta activada con métricas → setup-db →
(cuenta nueva creada ya cifrada) → migración con otra clave (falla y no toca
nada) → migración → otra vez la migración → setup-db ×2; la cuenta vieja entra
con su contraseña de siempre y `pulso_app` con RLS lee sus métricas (ver la
última prueba de `tests/integrador/cuentas.test.mjs`). También a mano con la
imagen `node:22.11.0-alpine`.

## Guiones para el video

Antes de grabar: una cuenta activada (ej. `demo@…` con `Cafe-Lunar#93x`) y,
para las consultas, una terminal con `psql` como dueño de la base. La
auditoría también se ve en la pestaña "Auditoría" de Administración (A2).

### 2 — 15 caracteres especiales en el correo del login
1. `/acceso` → en **Correo** escribir `!#$%&/()=?¡¿*+{` (15) y cualquier contraseña → **Entrar**.
2. Se ve: "Ese correo no es válido. Escríbelo completo, como nombre@ejemplo.com." (no el globo del navegador).
3. En DevTools → Red: `POST /api/cuenta/login` → **400** `{"error":"datos_invalidos"}`.
4. Auditoría: `cuenta.login · denegado · {"motivo":"datos_invalidos","campos":["email"]}`.

### 3 — Restablecer con "Olvidé mi contraseña"
1. `/acceso` → **Olvidé mi contraseña** → correo de la cuenta → **Mandar enlace**. Mensaje: "Si ese correo tiene una cuenta, te llegó un enlace…".
2. Abrir el correo "Restablece tu contraseña de Pulso" → botón. La barra queda en `/acceso/restablecer` (sin el token).
3. Escribir `123456789012345`: la lista marca en rojo lo que falta; **Guardar** → "La contraseña no cumple: …".
4. Escribir una que cumpla → "Listo, tu contraseña cambió y la cuenta quedó desbloqueada…". Entrar con la nueva; la vieja da "Correo o contraseña incorrectos".
5. Evidencia: `select revocada_motivo, count(*) from sesiones where uid = '<uid>' group by 1;` → `contrasena`.

### 4 — 5 contraseñas incorrectas seguidas
1. `/acceso` con el correo de la cuenta y una contraseña mala, 5 veces. Cada vez: "Correo o contraseña incorrectos. Te quedan 4… 3… 2… 1 intento".
2. Al 5.º: "La cuenta está bloqueada por 15 minutos…" y un botón **Olvidé mi contraseña**.
3. Escribir la contraseña **correcta** → sigue bloqueada (429).
4. Llega el correo "Bloqueamos tu cuenta de Pulso por unos minutos".
5. Evidencia: `select fallos, bloqueada_hasta from intentos_acceso;` y en la auditoría `cuenta.bloquear · ok · {"minutos":15,"origen":"login","cuenta_existe":true}` y los `cuenta.login · denegado`.
6. (Opcional) Lo mismo con un correo que no existe: mismo bloqueo, ningún correo enviado.

### 6 — Dos usuarios con el mismo correo
1. Navegador A: crear la cuenta `prueba@…` y activarla.
2. Navegador B (otra ventana privada): **Crear una cuenta** con `  PRUEBA@…  ` (mayúsculas y espacios) → la misma pantalla "Revisa tu correo: si no tenía cuenta… si ya la tenía, te avisamos".
3. Al correo llega "Ya tienes una cuenta en Pulso" (no un enlace de activación).
4. Evidencia: `select count(*) from cuentas;` no aumentó; `\d cuentas` muestra `cuentas_email_hmac_idx UNIQUE (email_hmac)`; auditoría `cuenta.registrar · denegado · {"motivo":"email_en_uso"}`.

### 12 — Secuencia 1 al 15 en la contraseña del login
1. `/acceso` → correo de la cuenta, contraseña `123456789012345` → **Entrar**.
2. "Correo o contraseña incorrectos. Te quedan 4 intentos antes de que la cuenta se bloquee 15 minutos." (el login no aplica la regla, así que es un fallo más y cuenta para el bloqueo).

### 13 — Crear usuario con `123456789012345`
1. `/acceso` → **Crear una cuenta** → correo nuevo; en **Contraseña** escribir `123456789012345`: la lista en vivo marca ✗ mayúscula, minúscula, símbolo y secuencias.
2. **Crear cuenta** → "La contraseña no cumple: al menos una letra mayúscula; al menos una letra minúscula; al menos un símbolo…; sin secuencias de 4 o más…". Red: 400 `contrasena_invalida` con `reglas`.
3. Evidencia de que la base también la rechaza aunque se saltee la app:
   `select * from pulso_contrasena_fallas('123456789012345');` → 4 filas con los mismos textos.

### 14 — Copiar la contraseña
1. En cualquier campo de contraseña escribir `ABC`: se ve `•••`, no hay botón de mostrar.
2. Seleccionar todo, Ctrl+C (o clic derecho → Copiar), y pegar en el bloc de notas: `ABC` no aparece; se
   pega lo que hubiera antes en el portapapeles (conviene copiar otra palabra antes, para que se note). El
   copiado está bloqueado en el campo; cortar (Ctrl+X) y arrastrar el texto, igual.

### 16 — Mismo usuario en dos navegadores
1. Navegador A: entrar con la cuenta; ir a `/cuenta`.
2. Navegador B: entrar con la misma cuenta.
3. Volver a A: en la próxima navegación (o el sondeo de A3) sale a `/acceso` con el aviso del motivo (A3).
4. Evidencia: `select created_at, revocada_at, revocada_motivo from sesiones where uid = '<uid>' order by created_at desc;` → una viva y la de A con `otro_inicio`; auditoría `cuenta.login · ok · {"sesiones_cerradas":1}`.

### 19 — Correo cifrado en la base
1. `select uid, email_hmac, email_cifrado, password_hash from cuentas;` → `email_hmac` es hex de 64, `email_cifrado` empieza con `v1.` y la contraseña con `$2a$12$` (bcrypt). No hay columna `email` (`\d cuentas`).
2. En la app, `/cuenta` muestra el correo: lo descifra el servidor con `PULSO_CLAVE_DATOS`, que no está en la base.
3. (Opcional) Cambiar un carácter de `email_cifrado` en una copia: la app no lo puede descifrar (GCM autentica).

### 20 — Actualizar contraseña y correo desde el perfil
1. `/cuenta` → **Cambiar contraseña**: con una actual equivocada, "La contraseña actual no es correcta. Te quedan 4 intentos…"; con una nueva débil, la lista en rojo y el mensaje de reglas; con todo bien, "Listo, tu contraseña cambió. Cerramos la otra sesión abierta… en este equipo sigues dentro." Llega "Cambiaste la contraseña de Pulso".
2. **Cambiar correo**: correo nuevo + contraseña actual → "Si nuevo@… no es de otra cuenta, te llegará ahí un enlace…; hasta entonces sigues entrando con viejo@…".
3. Al correo viejo llega "Pidieron cambiar el correo…" (con el nuevo enmascarado, `nu•••@…`); al nuevo, "Confirma tu correo nuevo" → `/acceso/confirmar-correo` → **Confirmar el correo nuevo** → "Listo, tu cuenta ya usa el correo nuevo".
4. `/cuenta` muestra el correo nuevo; entrar con el viejo ya no funciona.
5. Evidencia: auditoría `cuenta.cambiar_contrasena`, `cuenta.cambiar_correo` (`paso: solicitud`) y `cuenta.confirmar_correo`; `email_hmac` de la cuenta cambió.

## Pruebas

```bash
npm run test:integrador:cuentas   # con BASE_URL, DATABASE_ADMIN_URL, MAILPIT_URL,
                                  # PULSO_CLAVE_DATOS y PULSO_APP_PASSWORD del entorno descartable
```

25 pruebas en 11 suites: paridad TS ↔ SQL de la regla con 35 casos (tildes,
emojis, más de 72 bytes, secuencias ascendentes y descendentes, correo),
rechazo en la base aunque se saltee zod, correo inválido (400 y auditado),
bloqueo con y sin cuenta, reinicio del contador, duplicados, correo cifrado en
todas las tablas, sesiones simultáneas, cambio de contraseña y de correo
(incluido el bloqueo desde el perfil y el correo de otra cuenta), restablecer
de punta a punta, campos de contraseña y páginas, y la migración desde el
esquema de producción. Se saltean sin servidor/base/Mailpit y se niegan a
correr contra `agustinynatalia.site` o el puerto 5433.

## Riesgos residuales

- **Bloqueo como denegación de servicio**: quien conozca un correo puede
  bloquearlo 15 minutos cada vez (es el costo de bloquear por correo). Lo
  acotan los límites por IP y el aviso al dueño, y "Olvidé mi contraseña" lo
  levanta enseguida.
- **Una sola sesión por cuenta**: entrar en el teléfono cierra la del
  computador (y al revés). Es lo pedido en el punto 16.
- **La clave `PULSO_CLAVE_DATOS`** es ahora imprescindible para entrar: sin
  ella no se calcula el índice ciego. Guardarla aparte del respaldo de la base.
- La app nativa todavía no inicia sesión con cuenta: si lo hace con
  `/api/cuenta/login` y Bearer, la cookie nueva no le sirve (habría que
  devolverle el token en el cuerpo, como `/api/movil/v1/sesion`).
