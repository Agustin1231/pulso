# Administración: roles, permisos, auditoría y errores

Proyecto Integrador, puntos **5, 7, 8, 9 y 17**, y la pantalla de los puntos
**10 y 11** (los aplica la sesión, ver `docs/integrador/sesion.md`).

## Qué se hizo

### Roles y permisos en la base (`db/admin.sql`)

La base es la autoridad, igual que en el resto de Pulso. Cinco tablas de
sistema, sin grants para `pulso_app`:

| Tabla | Qué guarda |
|---|---|
| `permisos` | Catálogo fijo, sembrado por `admin.sql` (abajo). La app solo lo lee. |
| `roles` | Nombre (único sin importar mayúsculas), descripción y `sistema`. |
| `rol_permisos` | Los permisos de cada rol. |
| `usuario_roles` | Los roles de cada usuario (quién y cuándo se los dio). |
| `usuario_permisos` | Los permisos **directos** de cada usuario. |

**Permisos efectivos = los de sus roles ∪ los directos** (`pulso_permisos_de`).

| Permiso | Qué habilita |
|---|---|
| `usuarios.ver` | Ver los usuarios: correo, estado, roles, permisos y última actividad |
| `usuarios.editar` | Asignar roles y permisos directos y cambiar la contraseña de otro usuario |
| `roles.gestionar` | Crear, editar y borrar roles |
| `auditoria.ver` | Ver el registro de auditoría |
| `errores.ver` | Ver el registro de errores y forzar un error de prueba |
| `configuracion.editar` | Cambiar los dos tiempos de inactividad de la sesión |

Reglas que impone la base (las funciones, y triggers por si acaso):

- **Rol de sistema "Administrador"**: tiene siempre todos los permisos (también
  los que se agreguen al catálogo), no se borra, no se renombra y no se le quitan
  permisos. Ni el dueño de la base lo rompe con un `delete` a mano.
- **Siempre queda al menos un administrador.** Quitarle el rol al último se
  rechaza (`ultimo_administrador`). La única excepción es el derecho de
  supresión (Ley 1581): si el último administrador borra todos sus datos, su
  identidad se va entera y el rol con ella; se vuelve a asignar con el script.
- **No se otorga lo que uno no tiene.** Quien crea o edita un rol, o cambia los
  roles y permisos de un usuario, tiene que tener todos los permisos que toca,
  y no puede tocar a alguien con permisos que él no tiene
  (`privilegios_insuficientes`). Así `usuarios.editar` solo no alcanza para
  darse el rol Administrador ni para cambiarle la contraseña a un administrador.

### Las operaciones: funciones `pulso_admin_*`

Todas son `security definer` con `search_path` fijo, reciben el **hash del
token de sesión** (nunca un uid de quien actúa) y lo resuelven con
`pulso_uid_con_cuenta`. Devuelven `jsonb`: `{"ok": true, …}` o
`{"error": "<código>"}`. Un rechazo no lanza una excepción a propósito: si lo
hiciera, la fila de auditoría del rechazo se desharía con la transacción.

| Función | Permiso | Audita |
|---|---|---|
| `pulso_admin_mis_permisos` | (ninguno: los propios) | no (se consulta en cada carga) |
| `pulso_admin_usuarios` | `usuarios.ver` | el rechazo |
| `pulso_admin_roles` | `roles.gestionar` o `usuarios.ver` | el rechazo |
| `pulso_admin_auditoria` (filtros, paginada) | `auditoria.ver` | el rechazo |
| `pulso_admin_errores` (paginada) | `errores.ver` | el rechazo |
| `pulso_admin_config` | `configuracion.editar` | el rechazo |
| `pulso_admin_crear_rol` / `editar_rol` / `borrar_rol` | `roles.gestionar` | cambio con antes/después, y cada rechazo |
| `pulso_admin_fijar_acceso` (todos los roles y permisos directos) | `usuarios.editar` | antes/después de roles, directos y efectivos |
| `pulso_admin_cambiar_contrasena` | `usuarios.editar` | a quién y cuántas sesiones se cerraron (nunca la contraseña) |
| `pulso_admin_fijar_config` (contrato C1) | `configuracion.editar` | clave, valor anterior y nuevo |
| `pulso_admin_comprobar` | el que se pida | el rechazo |
| `pulso_admin_asignar_rol_sistema` | solo el dueño (script) | a quién, sin actor |

Las lecturas que salen bien no se auditan (sería ruido, igual que en el resto
de la app); los rechazos sí, todos. Cada evento lleva quién (`uid`), qué
(`accion`), a quién (`recurso` = `usuario`, `recurso_id` = su uid) y el
detalle. El correo **no** se guarda en la auditoría (es append-only y
sobreviviría al borrado de la cuenta): la pantalla lo resuelve al mostrarla.

### Cambio de contraseña por el administrador (punto 7)

Tres capas con la misma regla que el registro: el formulario (en vivo), zod en
el servidor (`contrasenaSchema`) y la base (`pulso_contrasena_valida`). Si no
cumple, la respuesta es `400 contrasena_invalida` con `reglas`: qué regla falla,
en español. Si se cambia, la base cierra **todas** las sesiones del usuario con
`revocada_motivo = 'admin'`, invalida sus enlaces de recuperación pendientes, y
la app le manda un correo avisándole. La propia contraseña no se cambia por acá
(`es_tu_cuenta`): para eso está el perfil, que pide la actual.

### Registro de errores (punto 17)

- Tabla `errores`: cuándo, origen (la ruta o la acción), mensaje (1000
  caracteres) y stack (4000) recortados, código de pg o de Node, uid si había
  sesión e IP anonimizada (/24, /48). Sin el cuerpo de la petición, sin el
  query string (los enlaces del correo llevan el token ahí) y sin `err.detail`
  de pg. Los correos y los tokens que aparezcan en un mensaje se reemplazan.
  Se conserva 90 días y cada origen guarda como mucho 300 por hora (un error en
  bucle no llena el disco).
- La escribe `registrarError(origen, err, { uid, ip })`
  (`src/lib/seguridad/errores.ts`, contrato C5) a través de
  `pulso_registrar_error`: la app puede escribir pero no leer la tabla. Nunca
  tira.
- La llaman los catch genéricos de `rutaProtegida`, `rutaPublica`,
  `escritura` y `lectura`, y `onRequestError` en `src/instrumentation.ts` para
  lo que nadie atrapó (Next 15). Cualquier ruta nueva con `rutaProtegida` queda
  cubierta sola.

### Pantalla `/admin`

Dentro de la app (con la guardia de cuenta y de bloqueo), con una pestaña por
área que aparece solo si el usuario tiene su permiso: **Usuarios**, **Roles**,
**Auditoría**, **Errores** y **Sesión**. El enlace "Administración" aparece en
la barra lateral y en el header (también en el celular) solo con algún permiso
de administración (`GET /api/admin/permisos`). Que se vea o no es solo la
interfaz: cada operación la vuelve a autorizar la base.

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/admin/permisos` | GET | Permisos efectivos del usuario de la sesión |
| `/api/admin/usuarios` | GET | Usuarios con sus roles y permisos (correos en `correos`) |
| `/api/admin/usuarios/{uid}/acceso` | PUT | `{ roles, permisos }`: TODOS sus roles y permisos directos |
| `/api/admin/usuarios/{uid}/contrasena` | POST | `{ password }` |
| `/api/admin/roles` | GET, POST | Roles, catálogo; crear `{ nombre, descripcion, permisos }` |
| `/api/admin/roles/{id}` | PUT, DELETE | Editar o borrar un rol |
| `/api/admin/auditoria` | GET | `accion`, `resultado`, `usuario`, `desde`, `hasta`, `antes`, `limite` |
| `/api/admin/errores` | GET | `origen`, `antes`, `limite` |
| `/api/admin/errores/forzar` | POST | `{ tipo: "manejado" \| "no_manejado" }` |
| `/api/admin/configuracion` | GET, PUT | `{ clave, valor }` |

Todas pasan por `rutaProtegida` (origen, sesión con cuenta, límites de
escritura, cuerpo con tope y zod). Códigos: 401 sin sesión, 403 `sin_permiso`
o `privilegios_insuficientes`, 404 `no_encontrado`, 409 `nombre_en_uso`,
`rol_de_sistema`, `ultimo_administrador`, `es_tu_cuenta`, 400 el resto.

### Primer administrador

```bash
DATABASE_ADMIN_URL=postgres://dueño@… npm run asignar-admin -- correo@dominio.com
```

Le da el rol Administrador a la cuenta **activada** de ese correo y lo deja en la
auditoría (`admin.rol.asignar_sistema`, sin actor). Se puede repetir. Con el
correo cifrado (C3) busca por el índice ciego, por eso corre con
`--experimental-strip-types` (importa `src/lib/seguridad/cifrado.ts`) y necesita
`PULSO_CLAVE_DATOS`.

## Archivos

- `db/admin.sql` — tablas, triggers y funciones.
- `src/lib/admin/` — `servidor.ts` (llamadas a la base y el único mapeo de
  correos), `esquemas.ts` (zod), `tipos.ts` (tipos, pestañas, mensajes),
  `contrasena.ts` (qué regla falla).
- `src/app/api/admin/**` — las rutas de arriba.
- `src/app/(app)/admin/page.tsx` y `src/components/admin/**` — el panel.
- `src/lib/seguridad/errores.ts`, `src/instrumentation.ts`, y una línea en los
  catch genéricos de `ruta.ts` y `accion.ts`.
- `src/components/layout/sidebar.tsx` y `header.tsx` — el enlace (C6).
- `scripts/asignar-admin.mjs` y su script en `package.json`.
- `tests/integrador/admin.test.mjs`.

## Cómo se prueba

```bash
BASE_URL=http://127.0.0.1:3202 \
DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55442/pulso \
MAILPIT_URL=http://127.0.0.1:18022 \
node --test --test-concurrency=1 tests/integrador/admin.test.mjs
```

Crean cuentas por el camino real (registro → enlace del correo en Mailpit →
activar → iniciar sesión) y las borran al final. Sin esas variables se
saltean; contra `agustinynatalia.site` se niegan a correr.

| Prueba | Qué demuestra |
|---|---|
| asignar-admin | Da el rol, lo audita sin actor, se puede repetir, falla con un correo sin cuenta |
| sin permiso | Sin sesión 401; con sesión y sin permiso 403 `sin_permiso` en las 9 operaciones, cada una auditada; nada cambió |
| punto 5 | Rol nuevo, nombre duplicado rechazado, asignado a 2 usuarios con 2 permisos directos distintos; efectivos y origen correctos; rigen en la próxima petición; auditado con antes/después |
| punto 8 | 2 roles a un usuario y después TODOS sus permisos cambiados; un permiso que dan dos roles muestra los dos orígenes; editar un rol cambia a sus miembros |
| rol de sistema | No se borra ni se edita (API y DML del dueño); no se puede quitar el último administrador (función y trigger); con dos, sí; la supresión de datos no queda bloqueada |
| escalada | Con `usuarios.editar` no se puede dar el rol Administrador, dar un permiso que no se tiene, tocar a quien tiene más ni cambiarle la contraseña a un administrador |
| punto 7 (rechazo) | Contraseña de 1 carácter: 400 con la regla; directo a la base como `pulso_app` (sin zod) también se rechaza; la contraseña no cambia; la propia no se cambia por acá |
| punto 7 (cambio) | Todas las sesiones del usuario quedan revocadas con motivo `admin`; la sesión vieja da 401; entra con la nueva y no con la vieja; la contraseña no está en la auditoría; llega el correo de aviso |
| punto 17 | El error forzado responde 500 sin detalle; está en `errores` con stack, uid e IP anonimizada y primero en el panel; el no manejado lo registra `onRequestError` |
| registro de errores | Recorta mensaje y stack; la app escribe pero no lee |
| C1 | Fuera de límites rechazado; el valor nuevo lo ve `pulso_config` enseguida; auditado con antes y después |
| punto 9 | Filtros por acción, usuario (hecho o recibido), resultado y fechas; paginación; correos del actor y del afectado; filtro inválido 400 |
| tablas | `pulso_app` no lee ni escribe las tablas de administración ni ejecuta las funciones internas |

## Guion para el video

**Preparación** (una vez): tres cuentas activadas, por ejemplo
`admin@…`, `ana@…` y `beto@…` (crear cuenta → enlace del correo). Al
administrador se le da el rol con `npm run asignar-admin -- admin@…`. Iniciar
sesión como administrador: en la barra lateral aparece **Gestión →
Administración** (con una cuenta común no aparece).

### Punto 5 — Rol nuevo, 2 usuarios, 2 permisos distintos para cada uno

1. Administración → pestaña **Roles** → **Nuevo rol**. Nombre `Soporte`,
   descripción, marcar *Ver usuarios* y *Ver auditoría* → **Crear rol**.
   Se ve: «Se creó el rol «Soporte»» y la tarjeta del rol con 0 miembros.
2. (Opcional) Crear otro con el mismo nombre en minúsculas: «Ya existe un rol
   con ese nombre».
3. Pestaña **Usuarios** → `ana@…`. En *Roles* marcar **Soporte**; en *Permisos
   directos* marcar **Ver errores** y **Editar la sesión**. La tabla *Permisos
   efectivos* se actualiza en vivo ("Vista previa: sin guardar") y dice de
   dónde sale cada uno: *Rol: Soporte* o *Directo*. **Guardar roles y permisos**
   → «Cambios guardados».
4. `beto@…`: marcar **Soporte** y como directos **Gestionar roles** y **Editar
   usuarios** → Guardar. Se ve que sus efectivos son distintos a los de Ana.
5. Volver a **Roles**: la tarjeta de Soporte dice *2 miembros* con sus correos.
6. Evidencia de que rige: cerrar sesión y entrar como Ana: ve
   *Administración* con las pestañas Usuarios, Auditoría, Errores y Sesión (no
   Roles), y en Usuarios todo está en solo lectura («te falta el permiso
   Editar usuarios»).

### Punto 8 — Dos roles a un usuario y todos sus permisos

1. En Roles, crear `Auditor` con *Ver auditoría* y *Ver errores*.
2. Usuarios → `beto@…`: marcar **Soporte** y **Auditor** → la tabla muestra
   *Ver auditoría* con dos orígenes (*Rol: Auditor* y *Rol: Soporte*). Guardar.
3. Cambiar la totalidad: desmarcar Soporte, desmarcar todos los directos que
   tenía y marcar otros (por ejemplo *Editar la sesión*). La tabla muestra qué
   gana y qué pierde antes de guardar. Guardar.
4. En **Auditoría** (filtro *Administración*), el evento «Cambió roles y
   permisos de un usuario» muestra, para Beto, los roles, los directos y los
   efectivos con lo agregado (+, verde) y lo quitado (−, tachado).

### Punto 7 — Contraseña de un solo carácter

1. Usuarios → `ana@…` → **Cambiar contraseña**. Escribir `a`: debajo aparece en
   rojo «✗ Tiene que tener al menos 10 caracteres.» (validación en vivo).
2. **Cambiar contraseña** → «La contraseña no cumple las reglas: …». No se
   cambió nada.
3. Lo mismo lo rechaza el servidor (zod) y la base (`pulso_contrasena_valida`)
   aunque alguien se saltee el formulario: lo comprueban las pruebas
   automáticas (prueba "punto 7 (rechazo)", que llama a la función de la base
   directamente como `pulso_app`).
4. (Complemento) Con una contraseña válida: «Listo: la contraseña de ana@…
   cambió. Se cerró 1 sesión suya y le avisamos por correo.» En el navegador de
   Ana la sesión deja de servir (motivo `admin`), y en Mailpit está el aviso.
5. Seleccionar la propia cuenta: el panel dice que la propia contraseña se cambia
   desde el perfil.

### Punto 9 — La auditoría registra los cambios del administrador

1. Pestaña **Auditoría** → atajo **Administración**. Cada cambio de los puntos
   anteriores aparece con: resultado (*Correcto* / *Denegado* / *Error*), qué
   hizo («Creó un rol», «Cambió roles y permisos de un usuario», «Cambió la
   configuración de la sesión»…), **por quién** (el correo del administrador),
   a quién, fecha y hora, IP recortada y el antes → después.
2. Filtrar por **Usuario** = `ana@…`: quedan los eventos que hizo Ana y los que
   la tuvieron de objetivo. Filtrar por **Resultado** = *Denegado* para ver los
   intentos rechazados (por ejemplo, una cuenta sin permisos que pide
   `/api/admin/usuarios` a mano: «Rechazado: no tiene el permiso (hace falta Ver
   usuarios)»).
3. **Detalle técnico** muestra el JSON tal como está en la tabla `auditoria`,
   que es append-only (ni el dueño de la base la puede modificar).

### Punto 17 — Forzar un fallo y verlo en el registro de errores

1. Pestaña **Errores** → **Forzar un error de prueba**. Aviso: «El servidor
   respondió 500 (error_interno), sin ningún detalle para el navegador, y el
   error quedó registrado». En la lista aparece primero, resaltado como
   *Nuevo*: origen `api:admin.errores.forzar`, mensaje, usuario, IP recortada y
   el stack (desplegable).
2. **Forzar un error no manejado**: el error sale de la ruta sin que nadie lo
   atrape; lo captura Next (`onRequestError` en `src/instrumentation.ts`) y
   aparece con origen `route:/api/admin/errores/forzar` y la etiqueta *No
   manejado*.
3. (Opcional) En Auditoría, el evento «Forzó un error de prueba» con resultado
   *Error*.

### Puntos 10 y 11 — Pantalla de los tiempos de inactividad

Pestaña **Sesión**: dos tarjetas con la explicación, el valor actual, quién y
cuándo lo cambió, atajos y un campo con unidad (minutos, horas, días) que
respeta los límites.

- **Punto 10 — Expiración del token por inactividad**: atajo **1 minuto** →
  **Guardar** → «Guardado: 180 días → 1 minuto. Ya está rigiendo.» (cómo deja
  de servir el token lo muestra el guion de `sesion.md`). Volver a **180 días**
  al terminar.
- **Punto 11 — Cierre de la sesión por inactividad del usuario**: atajo **1
  hora** (o el valor que se quiera mostrar) → **Guardar**.
- Un valor fuera de los límites (por ejemplo 2 días para la sesión) no se
  puede guardar, y si se fuerza, el servidor responde `fuera_de_rango`.
- Cada cambio queda en Auditoría: «Cambió el cierre de la sesión por
  inactividad: 30 minutos → 1 hora».

## Contratos con las otras áreas

- **C1** — `pulso_admin_fijar_config(p_sesion_hash, p_clave, p_valor, p_ip
  default null)`: exige `configuracion.editar`, valida `minimo`/`maximo`,
  guarda `actualizada_por` y audita antes/después. Quien aplica los tiempos los
  lee con `pulso_config` en cada petición.
- **C2** — El cambio de contraseña por el administrador revoca las sesiones con
  `revocada_motivo = 'admin'`.
- **C3** — El correo se lee en un solo lugar de SQL (`pulso_correo_de`) y uno
  de TS (`correoVisible`), que ya funcionan en los tres estados del esquema (en
  claro, migrando y cifrado: se probó en una base aparte). `asignar-admin`
  busca por `email_hmac` si existe.
- **C4** — El panel valida con `contrasenaSchema` y la base con
  `pulso_contrasena_valida(p_password)`. Las reglas en español salen de
  `problemasContrasena` (`src/lib/admin/contrasena.ts`), el único lugar a
  cambiar por `reglasContrasena`.
- **C5** — `registrarError(origen, err, { uid, ip, detalle })` en
  `src/lib/seguridad/errores.ts`; nunca tira.
- **C6** — "Administración" en `sidebar.tsx` y `header.tsx` (el header es lo que
  se ve en el celular; la barra de abajo no se tocó).

## Despliegue

1. Deploy normal: `setup-db` aplica `admin.sql` (idempotente; siembra el
   catálogo y el rol Administrador).
2. Con el dueño de la base: `npm run asignar-admin -- <correo de la cuenta de
   Agustin>` (cuenta ya activada).
3. Entrar a `/admin` con esa cuenta.

## Riesgos y decisiones

- Las lecturas exitosas del panel no se auditan (como el resto de la app); los
  rechazos y todos los cambios sí.
- El derecho de supresión puede dejar el sistema sin administradores (si el
  último borra sus datos). Se resuelve con `asignar-admin`; bloquearlo iría
  contra la Ley 1581.
- En los errores no manejados la IP queda vacía: Next corre `onRequestError`
  fuera del contexto de la petición y la regla de la IP real (Cloudflare,
  Traefik) vive en `red.ts`, que lee los headers de ese contexto.
- El estado "bloqueada" (5 intentos fallidos) todavía no se muestra en la lista
  de usuarios: depende del esquema de cuentas nuevo.
