# La app nativa con cuentas: lo que pone el servidor

Ronda "las 20 pruebas en la app nativa" (27-oct-2026), área **S**. La app Android (Kotlin + Compose,
repo `Pulso - celular`) hasta ahora solo creaba sesiones anónimas: desde que los datos exigen una
cuenta activada, contra producción no podía leer ni guardar nada. Acá está lo mínimo que necesitaba
del servidor para entrar con correo y contraseña y mostrar en el teléfono las mismas pruebas que la
web. Las pantallas de la app y su guion están en el repo de la app (`docs/integrador/video-app/`).

La app no tiene cookies: manda el token en `Authorization: Bearer <43 caracteres base64url>`, sin
`Origin`, y lo guarda cifrado con el Keystore. Es la misma sesión de la web (mismo hash en la base,
misma rotación, mismos vencimientos y motivos), marcada `cliente = 'movil'`.

## Contratos nuevos

### C1 · `POST /api/movil/v1/cuenta/login`

El login de la web (`POST /api/cuenta/login`) para la app: **el mismo manejador**
(`rutaLogin` en `src/lib/login.ts`; las dos rutas son una línea). Cambia solo cómo viaja el token.

- Cuerpo: `{ "email", "password" }` (mismo `loginSchema`). Header: el Bearer de la sesión que la
  app tiene (casi siempre anónima: lo guardado en el teléfono se suma a la cuenta, como en la web).
  Sin Bearer también entra. **Una cookie no cuenta** como la sesión del teléfono: ni se revoca ni
  se suma.
- `200 { ok: true, token, sesiones_cerradas }`: la app guarda `token` en lugar del anterior, que
  queda revocado (si era anónimo, se borra con su identidad al sumarse a la cuenta). La sesión nueva
  es `cliente = 'movil'`. No se pone ninguna cookie.
- Rechazos, iguales a la web:

| Status | Cuerpo | Cuándo |
|---|---|---|
| 400 | `{ error: "datos_invalidos", campos: ["email"] }` | El correo no es un correo (punto 2) o falta algo. `campos` solo en la ruta de la app (la web valida en el formulario y no cambió). |
| 401 | `{ error: "credenciales_invalidas", intentos_restantes }` | Correo o contraseña mal, sin decir cuál (puntos 4 y 12). |
| 403 | `{ error: "cuenta_sin_activar" }` | Contraseña bien, cuenta sin activar. |
| 429 | `{ error: "cuenta_bloqueada", minutos }` + `Retry-After` en segundos | 5 fallos seguidos: 15 minutos (punto 4). Ni la correcta entra. |
| 429 | `{ error: "demasiadas_peticiones" }` + `Retry-After: 3600` | Límite por correo (10/h) o por IP (30/h). |
| 403 | `{ error: "origen_no_permitido" }` | Con un `Origin` de otro sitio (la app no manda). |

- Punto 16 entre clientes: entrar en el teléfono cierra la sesión del navegador (y la de otro
  teléfono) con `otro_inicio`, y al revés.
- Auditoría: cada evento `cuenta.login` (también los rechazos de validación y de límite) lleva
  `cliente: "movil"` o `"web"`. En el panel de Auditoría se ve en la línea del evento
  ("cliente: movil · datos sumados: true · sesiones cerradas: 1").

En la base, `pulso_iniciar_sesion_cuenta` tiene un parámetro más, `p_cliente text default 'web'`
(la firma de 4 parámetros se borra; los grants van a la de 5). Con el valor por defecto, la app
vieja sigue funcionando contra la base nueva.

### C2 · `POST /api/movil/v1/sesion` trae `motivo` y `cuenta`

La app lo llama al abrir y al volver de segundo plano. Respuesta:

```json
{ "ok": true, "origen": "existente", "token": "…", "bloqueo": { "activo": false, "bloqueada": false },
  "motivo": null, "cuenta": { "email": "ana@ejemplo.com", "verificada": true } }
```

- `origen`: `nueva` (no mandó token, o mandó uno que ya no sirve), `existente` o `rotada`.
- `token`: el que la app tiene que guardar. Con `existente` es el mismo que mandó; con `rotada` o
  `nueva`, uno distinto. `null` solo en el caso raro de un token recién rotado dentro de sus 2
  minutos de gracia: seguí con el que tenés.
- `motivo`: si la app mandó un token que ya no sirve, por qué: `cierre`, `otro_inicio`,
  `inactividad`, `contrasena`, `admin` o `vencida`. `null` si sigue sirviendo o si no había una cuenta
  que perder (anónima, inventado). Se informa **una sola vez**: la sesión anónima nueva ya no tiene
  motivo. Queda en la auditoría: `sesion.crear` con `{ cliente: "movil", anterior: <motivo> }`.
- `cuenta`: la de la sesión que queda, `{ email, verificada }`, o `null` si es anónima. Con eso la
  app decide: `null` → pantalla de acceso (con el aviso del `motivo`), `verificada: false` →
  esperando la activación, `true` → la app. Con el bloqueo con passkey de la web activo y sin
  desbloquear, `null` (no se entrega ni el correo) y `bloqueo.bloqueada` lo dice; iniciar sesión
  con la contraseña abre una sesión ya desbloqueada.

`GET /api/movil/v1/sesion` (estado sin renovar) también trae `motivo`. `DELETE
/api/movil/v1/sesion` acepta `?motivo=inactividad` como `DELETE /api/sesion`.

### C3 · La inactividad de la sesión también para la app

`sesion_inactividad_minutos` (punto 11) ahora cierra **las sesiones con cuenta de los dos
clientes**: en `pulso_sesion_vigente` y `pulso_inactividad_de_sesion` (db/plataforma.sql) se sacó la
condición `cliente = 'web'`. La actividad la mueven, como en la web:

- el latido: `POST /api/sesion/latido` con `{ "hace": <segundos desde el último toque> }`, solo si
  el usuario tocó la app, espaciado (un cuarto del menor de los dos tiempos, entre 5 s y 2 min,
  como `src/components/cuenta/vigia-sesion.tsx`);
- abrir la app o volver a ella (`POST /api/movil/v1/sesion`), como abrir o recargar la página.

Las lecturas y los guardados de fondo no cuentan. `GET /api/sesion` le da a la app el sondeo del
vigía: `{ estado, bloqueo, cuenta, motivo, config: { tokenMinutos, sesionMinutos, inactivaSeg } }`,
ahora con `inactivaSeg` también para `movil` (antes `null`). El aviso "¿Seguís ahí?" aparece cuando
falta la mitad del límite (entre 10 s y 1 minuto) y al llegar a cero la app cierra con `DELETE
/api/sesion?motivo=inactividad`. Si el servidor la cerró antes, se audita `sesion.revocar` con
`cliente: "movil"`. El token (punto 10) ya valía para los dos clientes.

Hasta esta versión la app nativa no tenía latido y quedaba afuera de la regla (estaba documentado
así en db/plataforma.sql, src/lib/sesion.ts y docs/integrador/sesion.md; se actualizó todo).

## C4 · Las rutas que ya existían, con la sesión de la app

Se comprobaron todas con Bearer y sin Origin (`tests/integrador/movil.test.mjs`, bloque C4). Andan
sin cambios, salvo un detalle de la API REST de la app:

- `/api/movil/v1/<datos>` con una sesión **anónima** respondía `401 sesion_requerida`; ahora
  `401 cuenta_requerida`, como `rutaProtegida` en el resto de la API. Sin token, con uno inventado
  o revocado sigue siendo `sesion_requerida`.

| Ruta | Para qué en la app | Notas |
|---|---|---|
| `GET /api/sesion`, `DELETE /api/sesion?motivo=cierre\|inactividad`, `POST /api/sesion/latido` | Vigía y cerrar sesión | El DELETE responde además un `Set-Cookie` que borra la cookie: OkHttp sin cookie jar lo ignora. |
| `GET /api/cuenta` | `{ cuenta: { email, verificada } \| null }` | Sondeo de la espera de activación. |
| `POST /api/cuenta/registro` `{ email, password }` | Crear cuenta (sobre la sesión anónima) | 400 `contrasena_invalida` con `reglas` (textos). Con un correo registrado responde lo mismo (punto 6). |
| `POST /api/cuenta/reenviar` | Otro enlace de activación | 409 `sin_cuenta_pendiente` si ya está activada. |
| `POST /api/cuenta/recuperar` `{ email }` | Olvidé mi contraseña | Siempre `{ ok: true }`. |
| `POST /api/cuenta/contrasena` `{ actual, nueva }` | Perfil (punto 20) | 400 `contrasena_actual_incorrecta` con `intentos_restantes`, 400 `contrasena_invalida` con `reglas`, 400 `misma_contrasena`, 429 `cuenta_bloqueada`. La sesión del teléfono sigue; las demás se cierran con `contrasena`. |
| `POST /api/cuenta/correo` `{ email, password }` | Perfil (punto 20) | El correo cambia recién al confirmar desde el enlace. |
| `GET/POST /api/examenes`, `GET/DELETE /api/examenes/{id}` | Punto 15 | La subida **no es multipart**: el cuerpo es el archivo tal cual, el nombre va en `X-Nombre-Archivo` (con `encodeURIComponent`) y el `Content-Type` declarado solo se audita. 201 `{ ok, examen }`. |
| `/api/admin/*` | Administración | Con el rol Administrador (`npm run asignar-admin -- correo`). |

Los enlaces de los correos (activar, restablecer, confirmar el correo nuevo) abren páginas web
públicas (`/acceso/...`) que no necesitan sesión: desde el teléfono se abren en el navegador y
funcionan; después se entra en la app con la cuenta.

## Cómo probarlo

Con un servidor y una base descartables (ver el brief: `entorno-agente.sh <n> <repo>`):

```bash
set -a; . entornos/ag5.env; set +a
npx next dev -p 3205 -H 0.0.0.0 &
BASE_URL=http://127.0.0.1:3205 MAILPIT_URL=http://127.0.0.1:18025 \
  node --test --test-concurrency=1 tests/integrador/movil.test.mjs
```

`tests/integrador/movil.test.mjs` (29 casos) crea cuentas reales (registro → enlace en Mailpit →
activación), bloquea correos, le da el rol Administrador a una cuenta de prueba con
`scripts/asignar-admin.mjs`, cambia los tiempos de `configuracion` (y los restaura) y mueve fechas de
`sesiones` para simular el paso del tiempo. Cubre:

- **C1**: token en el cuerpo y sin cookies, sesión `movil`, token anterior fuera, identidad anónima
  sumada, auditoría con `cliente`; punto 16 entre web y app en los dos sentidos; una cookie no cuenta;
  400 con `campos` (y la web sin cambios); intentos restantes, bloqueo con `Retry-After` y la
  correcta rechazada; sin activar; límite por correo; Origin ajeno.
- **C2**: `cuenta` para anónima, sin activar y activada; con rotación, la del token nuevo; los seis
  motivos (provocados de verdad: cerrar sesión, login en la web, inactividad, token vencido, cambio
  de contraseña desde el navegador, y `admin` en la base), una sola vez y auditados; sin motivo para
  tokens inventados o anónimos; el GET también.
- **C3**: sin latido se cierra y se audita con `cliente: movil`; el latido con Bearer la mantiene y
  `inactivaSeg` llega; abrir la app es actividad; volver después del límite trae `inactividad`;
  `?motivo=inactividad` por las dos rutas; una anónima no se cierra.
- **C4**: registro, activación, reenviar, login, sesión, latido, contraseña y correo del perfil,
  cerrar sesión; recuperar (la página pública sin sesión, el restablecimiento y el aviso
  `contrasena` en la app); exámenes (PDF, `.exe` renombrado, ver, ajeno, borrar); administración
  completa (permisos, usuarios, roles, acceso, contraseña de un carácter, auditoría, errores,
  configuración) y el aviso `admin` en la app del usuario; los dos 401.

Con estos cambios también se corrieron, contra el mismo entorno: `tests/integrador/` completo
(sesion 22, cuentas 25, admin 14, cifrado 14, examenes 43, movil 29: todos pasan),
`tests/seguridad/base.test.mjs` (20/20, en una base con el esquema viejo y los dos usuarios legado),
`tests/funcionales/api-movil.test.mjs` (57/57) y la migración de la base de `main` a esta versión
(firma vieja borrada, grants solo a `pulso_app`, la llamada de 4 parámetros sigue andando, setup-db
dos veces seguidas).

`tests/funcionales/api-movil.test.mjs` fallaba desde que la cuenta es obligatoria (44 de 57 con 401):
`nuevoToken` (tests/funcionales/comun.mjs) ahora le pone una cuenta activada a cada identidad de
prueba, registrándola sobre su sesión como la app y activándola con el dueño de la base (o con el
enlace de Mailpit si no está la base); `nuevoTokenAnonimo` queda para lo anónimo. El caso del 413
usa `node:http`: el `fetch` de Node 26 da ECONNRESET cuando el servidor corta la subida.

Para probar a mano con curl como la app (sin Origin, con Bearer), el script del brief
`cuenta-de-prueba.mjs` deja el token de una cuenta activada en un archivo:

```bash
T=$(cat token.txt)
curl -s -X POST http://127.0.0.1:3205/api/movil/v1/cuenta/login \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"email":"ana@pulso.test","password":"…"}'
```

## Orden de deploy

1. **Base primero**: `npm run setup-db` (idempotente). Cambia `pulso_iniciar_sesion_cuenta` (firma
   de 5 parámetros con valor por defecto) y las dos funciones de inactividad. La app web vieja sigue
   andando contra la base nueva: llama con 4 parámetros y toma `'web'`.
2. **Después, la app web** (Next). Al revés no: la imagen nueva llama con 5 parámetros y contra la
   base vieja el login fallaría.
3. **Al final, la app nativa** nueva. La app nativa vieja no se rompe con el servidor nuevo (solo
   crea sesiones anónimas, como hasta ahora).

Efecto en producción al aplicar el paso 1: las sesiones con cuenta de la app nativa que ya existían
(cuentas creadas desde el teléfono) pasan a cerrarse por inactividad; con 30 minutos sin abrir la
app, la próxima vez se pide entrar.

## Decisiones

- `campos` en el 400 solo para la app (opción `camposEnRespuesta` de `rutaPublica`): la respuesta
  de la web la fija una prueba del punto 2 y no hacía falta tocarla.
- `cuenta` en C2 respeta el bloqueo con passkey (no entrega el correo a una sesión bloqueada), igual
  que `GET /api/cuenta`.
- Con `existente`, `token` sigue siendo el mismo que mandó la app (no `null`), como hasta ahora: la
  app ya lo maneja así y guardar el mismo valor no cambia nada.
- La auditoría de las rutas de sesión de la app ya llevaba `cliente: "movil"`; ahora también la del
  login (las dos rutas) y la de cerrar sesión lleva el `motivo`.

## Pendiente

- `tests/seguridad/http.test.mjs` falla igual que fallaba `api-movil.test.mjs` antes de este
  cambio (18 de 31 con 401): crea identidades anónimas y les pide datos. No es de esta ronda; el
  arreglo es el mismo (una cuenta activada por identidad de prueba).
- El deploy no se hizo (ver "Orden de deploy").
