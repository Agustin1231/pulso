# Seguridad de Pulso

Controles implementados sobre la matriz de activos del Proyecto Integrador
(`Plantilla_PI_Pulso.xlsx`). Cada fila de la plantilla describe una
vulnerabilidad del estado anterior; acá está qué se hizo con cada una, dónde
vive en el código y cómo se prueba.

## El problema de fondo

La identidad era un UUID generado en el navegador, guardado en `localStorage`
y enviado en cada llamada. El servidor lo usaba tal cual, sin verificar nada:
**conocer el UUID de alguien equivalía a ser esa persona**. Además, editar y
borrar iba solo por el `id` de la fila, sin chequear el dueño, así que ni
siquiera hacía falta el UUID.

Ahora la sesión la emite el servidor y la base de datos impone el aislamiento
entre usuarios, sin depender solo del código de la app.

## Fila por fila

| # | Activo | Vulnerabilidad (antes) | Control (ahora) | OWASP Mobile | ISO 27002 |
|---|---|---|---|---|---|
| 1 | Métricas de salud | El server action leía y modificaba las métricas de cualquier `uid` que recibiera | El uid sale de la sesión; ninguna acción lo recibe. RLS en la base | M3 | 8.3 |
| 2 | Recetas con IA | Ingredientes al prompt sin validar; historial del chat con roles arbitrarios | Validación con zod (largo, tipos); historial solo `user`/`assistant`; datos del usuario envueltos en `<datos_usuario>` | M4 | 8.28 |
| 3 | Rutinas y contexto de salud | Sueño y estrés a Anthropic sin consentimiento ni minimización | Consentimiento explícito y versionado (Ley 1581); el servidor lee de la base solo lo que la rutina usa; respuestas cerradas del cuestionario | M6 | 5.34 |
| 4 | Hábitos y push | `/api/notificaciones/enviar` sin auth, con título, cuerpo y URL libres | Solo a tus propios dispositivos; texto acotado; URL interna (validada en el servidor y en el service worker); límite por hora | M8 | 8.9 |
| 5 | Score de riesgo | Ningún registro: imposible investigar un incidente o rebatir un reclamo | Tabla `auditoria` append-only (trigger); cada llamada a la IA guarda el hash del informe que la generó | M8 | 8.15 |
| 6 | Claves de IA | Los 7 endpoints de IA sin auth ni límite (DoS económico) | Sesión obligatoria; límites por sesión **y** por IP en Postgres; las imágenes con límite propio | M1 | 8.6 |
| 7 | UUID en localStorage | Permanente, legible por cualquier script, filtrado en las URLs de las imágenes | Cookie `__Host-` httpOnly, Secure, SameSite=Strict; token de 256 bits; la base guarda solo su hash; vencimiento por inactividad; imágenes en carpeta derivada y servidas solo al dueño | M9 | 5.17 |
| 8 | VPS, Coolify y base | Secretos y base alcanzables desde la red Docker compartida; dependencias vulnerables | La app se conecta con un rol sin privilegios (`pulso_app`), no con el superusuario; la base no está publicada; `next-pwa` y `uuid` (sin uso) eliminados; Next actualizado. **Pendiente:** red Docker dedicada (ver Riesgos residuales) | M2 | 8.22 |
| 9 | Teléfono con la PWA | Quien tenga el equipo entra directo; datos en caché | La sesión vence; "Borrar mis datos" limpia la base, las imágenes, la cookie, el storage, la caché del SW y la suscripción push | M9 | 7.9 |
| 10 | Comunicación entre capas | Sin headers de seguridad | CSP con nonce por petición, HSTS, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy, COOP; `X-Powered-By` apagado; `no-store` en la API | M5 | 8.20 |

### Además de la plantilla

Cosas que aparecieron al revisar el código y no estaban en la matriz:

- **IDOR por id**: `eliminarReceta`, `calificarReceta`, `editarHabitoDefinicion`, `eliminarRutina` y `eliminarListaMercado` operaban con el `id` solo. Ahora exigen `id` y dueño, y un intento sobre una fila ajena queda en la auditoría como `denegado`.
- **Subida arbitraria de archivos**: `uploadRecetaImagen` era una server action que escribía en disco cualquier data URL. Se eliminó: la imagen la guarda el servidor al generarla, verificando los bytes del formato (PNG, JPEG o WebP).
- **Fuga de detalles internos**: los mensajes de error de Postgres llegaban al cliente, y `/api/recetas/imagen` devolvía el stack completo. Ahora el cliente recibe un mensaje genérico y el detalle va al log.
- **Caché pública de imágenes**: se servían con `Cache-Control: public`. Ahora es `private`.

## RBAC en la base de datos

| Rol | Puede | No puede |
|---|---|---|
| dueño (superusuario de Coolify) | DDL, migraciones, backups | — (se usa solo para `setup-db` y backups) |
| `pulso_app` | SELECT/INSERT/UPDATE/DELETE en las tablas de datos, **solo sobre las filas de su `app.uid`** (RLS); INSERT en `auditoria`; ejecutar las funciones `pulso_*` | Crear o borrar tablas; leer `sesiones`, `identidades`, `uids_legado` o `limites_tasa`; leer o modificar `auditoria` |
| `pulso_auditor` | SELECT en `auditoria` | Todo lo demás |

Cómo funciona RLS: cada operación corre en una transacción que fija
`app.uid` (`conUsuario` en `src/lib/db/pool.ts`). Las políticas comparan
`uid = current_setting('app.uid')`. Sin `app.uid`, la comparación da falso y
no se ve ninguna fila. **Fallar cerrado** es la propiedad importante: un
bug que olvide el filtro devuelve nada, no los datos de todos.

Las tablas de sesión no tienen grants para la app. Solo se tocan a través de
funciones `security definer` (`db/seguridad.sql`). Así la app no puede leer
sesiones ajenas, ni crear una sesión para un uid que elija: el uid nuevo lo
genera la base.

## Flujo de la sesión

1. Al abrir la app, `useSesion` llama a `POST /api/sesion`.
2. Con una cookie vigente, se renueva (vence a los 180 días sin uso).
3. Sin cookie, se crea una identidad nueva. Si el navegador tiene el UUID de
   la versión anterior, se manda una vez para **reclamar** ese historial.
   Cada UUID viejo se reclama una sola vez y durante 90 días; después de
   reclamado, conocerlo ya no sirve para nada.
4. Un lock entre pestañas (`navigator.locks`) evita que dos pestañas
   abiertas juntas se pisen la cookie durante el reclamo.

## Consentimiento (Ley 1581 de 2012)

Los datos de salud son datos sensibles (art. 5) y su tratamiento requiere
autorización explícita (art. 6). Las rutas que mandan métricas, perfil o
informe a Anthropic (análisis, score, tips y rutinas) responden 403 hasta que
el usuario autoriza. El diálogo se abre en el momento de uso y explica qué se
envía, a quién y para qué. Recetas y mercado no lo piden porque solo envían
ingredientes, y Gemini solo recibe el título de la receta.

El consentimiento tiene versión (`VERSION_CONSENTIMIENTO_IA`): si cambia el
texto, el anterior deja de valer. Se revoca desde `/privacidad`, donde
también está el derecho de supresión (art. 8): borrar todo.

## Cómo se prueba

```bash
# 1. Base descartable (nunca la de producción)
docker run -d --rm --name pulso-test-db -e POSTGRES_PASSWORD=... -e POSTGRES_DB=pulso \
  -p 127.0.0.1:55432:5432 postgres:17-alpine

# 2. Schema viejo + usuarios legado, después la migración
#    (ver la cabecera de tests/seguridad/base.test.mjs)
DATABASE_ADMIN_URL=postgres://postgres:...@127.0.0.1:55432/pulso \
PULSO_APP_PASSWORD=... npm run setup-db

# 3. Pruebas de la base: RLS, roles, sesiones, auditoría, tasa, supresión
DATABASE_ADMIN_URL=... DATABASE_URL=postgres://pulso_app:...@127.0.0.1:55432/pulso \
  node --test tests/seguridad/base.test.mjs

# 4. Pruebas HTTP contra la app corriendo
BASE_URL=http://127.0.0.1:3000 DATABASE_ADMIN_URL=... node --test tests/seguridad/http.test.mjs
```

`http.test.mjs` sin `DATABASE_ADMIN_URL` corre solo las pruebas que no
preparan datos, así que también sirve contra producción
(`BASE_URL=https://pulso.agustinynatalia.site`).

| Prueba | Qué demuestra |
|---|---|
| `base.test.mjs` (13) | La app no es superusuario ni puede hacer DDL; RLS aísla usuarios y cierra por defecto; un uid legado se reclama una vez; sesiones revocadas o vencidas no sirven; la auditoría es inmutable incluso para el dueño; el límite de tasa corta; la supresión borra solo lo propio |
| `http.test.mjs` (13) | Headers y CSP con nonce en cada script; cookie httpOnly/SameSite; 401 sin sesión en las 11 rutas; cookie inventada rechazada; Origin ajeno rechazado; consentimiento exigido; push con URL externa rechazado; 429 al pasar el límite; respuestas del cuestionario cerradas; IDOR de imágenes da 404; la supresión deja la sesión inválida; todos los rechazos auditados |

## Riesgos residuales

Lo que queda abierto, a propósito o por alcance:

- **Inyección de prompt**: se acota (roles filtrados, datos etiquetados, valores cerrados en rutinas), pero no hay forma de eliminarla del todo con un LLM. El impacto queda limitado al propio usuario: el modelo no tiene herramientas ni acceso a datos de otros.
- **Sin bloqueo local en la PWA** (fila 9): quien tenga el teléfono desbloqueado y la app abierta ve los datos. Un bloqueo con passkey (WebAuthn) es el siguiente paso natural.
- **Dependencias con fix mayor pendiente**: `postcss` dentro de Next (solo build, procesa nuestro propio CSS) pide Next 16; `jsondiffpatch` y `@ai-sdk/*` piden AI SDK 7; `uuid` dentro de `gaxios` (dependencia de Google) no usa la función afectada. Ninguna se ejecuta con entrada del usuario.
- **Reclamo de UUID viejos**: durante 90 días, quien conozca un UUID viejo **todavía no reclamado** puede reclamarlo antes que su dueño. El dueño lo reclama solo al abrir la app por primera vez después del deploy.
- **El dueño de la base** sigue teniendo acceso total. Queda auditado lo que hace la app, no lo que haga un operador con el superusuario.
- **Red compartida** (fila 8): `pulso-db` y la app siguen en la red `coolify`, junto con unos 30 contenedores más del servidor. Un contenedor vecino comprometido llega al puerto 5432, aunque necesita credenciales: la app ya no usa el superusuario, y `pulso_app` no puede hacer DDL ni ver datos sin `app.uid`. Hacerlo bien en Coolify implica crear un destino con su propia red, recrear la base ahí restaurando el backup, mover la app y que el proxy se conecte a la red nueva. Como el proxy es compartido con los demás servicios del servidor, conviene hacerlo en una ventana de mantenimiento, no como parte de este cambio.
