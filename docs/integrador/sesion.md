# Sesión: token, inactividad, pestañas y motivos

Área A3 de la ronda de seguridad del Proyecto Integrador. Cubre los puntos **1** (persistencia de la
autenticación), **10** (vencimiento del token por inactividad), **11** (cierre de la sesión por
inactividad del usuario), **18** (cerrar sesión en una pestaña y navegar en otra) y el **aviso** del
punto 16 (por qué se cerró la sesión).

> **27-oct-2026:** la app nativa ya tiene cuentas (`POST /api/movil/v1/cuenta/login`) y manda el mismo
> latido que la web, así que la regla de inactividad del punto 11 ahora vale también para sus
> sesiones. Contratos y guion de la app en [movil.md](movil.md).

## Qué se hizo

### En la base (la autoridad)

Los dos tiempos viven en la tabla `configuracion` (db/plataforma.sql) y la base los lee **en cada
petición**: un cambio del administrador rige desde la petición siguiente, sin caché ni deploy.

| Clave | Qué controla | Valor inicial | Límites |
|---|---|---|---|
| `token_inactividad_minutos` | Cuánto puede pasar el token sin **ninguna petición autenticada** | 259 200 (180 días) | 1 – 525 600 |
| `sesion_inactividad_minutos` | Cuánto puede pasar una sesión con cuenta (web o app nativa) sin que **el usuario interactúe** | 30 | 1 – 1440 |

- `sesiones` suma dos columnas: `cliente` (`'web'` o `'movil'`) y `actividad_at` (última interacción
  del usuario). `revocada_motivo` (de la base común) guarda por qué se cerró cada sesión.
- **`pulso_sesion_vigente(hash, deslizar)`** es el único lugar que decide si una sesión sirve. Todas
  las funciones de sesión de db/seguridad.sql pasan por ella (`pulso_resolver_sesion`,
  `pulso_uid_de_token`, `pulso_estado_sesion`, `pulso_renovar_o_rotar`, …), así que las reglas valen
  igual para cada ruta, cada server action, la web y la app nativa:
  1. **Token** (punto 10): si `ultimo_uso` tiene más de `token_inactividad_minutos`, la sesión venció.
     Se deja escrito (`expira_at` en el momento en que venció) y se audita `sesion.vencer`.
  2. **Sesión con cuenta** (punto 11), de la web o de la app nativa: si la última interacción
     (`actividad_at`, o la activación de la cuenta si es más reciente) tiene más de
     `sesion_inactividad_minutos`, se **revoca** con motivo `'inactividad'` y se audita
     `sesion.revocar` (con `cliente`). No se aplica a las anónimas (no tienen nada que proteger).
     Hasta el 27-oct-2026 tampoco se aplicaba a la app nativa, que no tenía latido.
  3. **Deslizamiento**: cada petición autenticada corre el vencimiento del token, con escrituras
     espaciadas (como mucho una cada 1/20 de la vigencia, tope 1 minuto: con 180 días, una por minuto
     de uso; con 1 minuto, una cada 3 s). Consultar el estado (`GET /api/sesion`) **no** es uso.
- `actividad_at` la mueve solo **`pulso_latido`** (el latido del cliente, que se manda únicamente si
  hubo mouse, teclado, toques, rueda o scroll) y abrir o recargar la página, o abrir la app nativa o
  volver a ella (`pulso_renovar_o_rotar`). Las lecturas, los guardados y los sondeos de fondo no la
  tocan.
- `pulso_motivo_sesion(hash)` dice por qué dejó de servir una sesión con cuenta: `cierre`,
  `otro_inicio`, `inactividad`, `contrasena`, `admin` o `vencida`.
- `pulso_revocar_sesion(hash, motivo)` (cerrar sesión) guarda `'cierre'` o `'inactividad'`; el
  cliente no puede elegir los demás motivos.
- Se sacaron la constante de 180 días y el parámetro `p_dias`: `pulso_crear_sesion(hash, cliente)`,
  `pulso_reclamar_legado(hash, uid)`, `pulso_renovar_sesion(hash)`, `pulso_renovar_o_rotar(viejo,
  nuevo)`; el vencimiento de la creación, la rotación y el inicio de sesión
  (`pulso_iniciar_sesion_cuenta`) es `now() + pulso_vigencia_token()`. Las firmas viejas y
  `pulso_dias_validos` se borran en setup-db.

### En el servidor (Next)

- `POST /api/sesion`: si la cookie es de una sesión que ya no sirve, devuelve `motivo` **antes** de
  crear la sesión anónima nueva. Devuelve también `config: { tokenMinutos, sesionMinutos,
  inactivaSeg }`.
- `GET /api/sesion`: estado sin renovar nada, con `motivo` si la sesión terminó y la `config`.
- `DELETE /api/sesion?motivo=inactividad`: el vigía del cliente cierra por inactividad (sin
  parámetro, `'cierre'`). Se audita `sesion.cerrar` con el motivo.
- `POST /api/sesion/latido` `{ hace }`: única petición que mueve la actividad; responde la `config`
  vigente (o 401 con el `motivo` si la sesión ya no sirve).
- `src/app/(app)/layout.tsx`: sin una sesión con cuenta activada **el servidor ni manda la app**:
  responde 307 a `/acceso`.
- `accion.ts`: una server action sin sesión, además de su error, deja la cookie
  `pulso_aviso_sesion` (sin datos, 60 s, solo si la petición trae `Next-Action`: la API de la app
  nativa no la recibe) para que la pestaña vaya enseguida a `/acceso`.
- La cookie de sesión dura en el navegador el máximo configurable (365 días); quien decide si sirve
  es la base. Así, cuando ya no sirve, el navegador todavía la manda y se le puede explicar por qué.

### En el cliente

- **`VigiaSesion`** (src/components/cuenta/vigia-sesion.tsx, montado en el layout de la app):
  - Actividad compartida entre pestañas (localStorage + evento `storage`): la interacción en
    cualquier pestaña de Pulso cuenta para todas.
  - Aviso **"¿Sigues ahí?"** con cuenta regresiva cuando falta la mitad del límite (entre 10 s y
    1 minuto), en todas las pestañas a la vez. "Seguir conectado" en una lo cierra en todas. Con el
    aviso a la vista, un roce del mouse no cuenta: hay que confirmar.
  - Al vencer, confirma con el servidor (una pestaña congelada en segundo plano no cierra la sesión
    que el usuario usa en otra) y cierra con motivo `inactividad`.
  - Latido espaciado (un cuarto del menor de los dos tiempos, entre 5 s y 2 min) solo si hubo
    interacción.
  - Revisa la sesión (sin renovarla) al navegar, al volver a la pestaña o al foco, al recuperar la
    conexión, al volver con "atrás" (caché del navegador) y cada 20 s.
- **`use-sesion.ts`**: canal entre pestañas (BroadcastChannel, o `storage` si no hay), salida única
  `salirDeLaSesion` (desmonta la app, revoca si corresponde, avisa a las demás pestañas, limpia el
  equipo y va a `/acceso` con recarga completa reemplazando la entrada del historial) y vigilancia
  de **todas** las respuestas: un 401 `sesion_requerida`/`cuenta_requerida` o la cookie de aviso
  de una server action llevan a `/acceso`. Si la pestaña misma cierra sesión (`DELETE /api/sesion`,
  el botón de /cuenta o el de la pantalla de bloqueo), desde ese instante no muestra nada.
- **`GuardiaCuenta`**: mientras la sesión se cierra no renderiza nada: los datos salen del DOM.
- **`/acceso`** (`AvisoMotivo`): aviso arriba de la pantalla con el motivo, una sola vez.

| Motivo | Lo pone | Aviso en /acceso |
|---|---|---|
| `otro_inicio` | A1, al iniciar sesión en otro navegador | "Iniciaste sesión en otro navegador" |
| `inactividad` | A3 (servidor o vigía) | "Tu sesión se cerró por inactividad — Pasó N minutos sin que usaras Pulso" |
| `vencida` | A3 (token sin peticiones) | "Tu sesión venció — Pasó más de N … sin que este navegador usara tu sesión" |
| `cierre` | A3, al cerrar sesión | En las otras pestañas: "Cerraste sesión en otra pestaña o ventana de este navegador" |
| `contrasena` | A1, cambio o restablecimiento | "Se cambió la contraseña de tu cuenta" |
| `admin` | A2 | "Un administrador cerró tu sesión" |

## Guiones para el video

En producción los tiempos se cambian desde **Administración → Sesión** (pantalla de A2). En un
entorno local se puede hacer con el dueño de la base:
`update configuracion set valor = 1 where clave = 'sesion_inactividad_minutos';`
**Al terminar, volver a 30 minutos y 259 200 minutos (180 días).**

Conviene grabar con dos navegadores: el del administrador (que sigue usando la app) y el del
usuario. Si el administrador baja los tiempos y se queda quieto, a él también se le cierra.

### Punto 1 — Copiar la URL de la sesión activa en otro navegador

1. En el navegador A, iniciar sesión y entrar a **Recetas** (o cualquier pantalla con datos).
2. Mostrar la barra de direcciones: `https://…/recetas`, **sin ningún token**.
3. Abrir las herramientas de desarrollo → Aplicación → Cookies: `__Host-pulso_sesion` con
   **HttpOnly**, **Secure** y **SameSite=Strict**. En la consola, `document.cookie` no la muestra.
4. Copiar la URL y pegarla en el navegador B (u otra ventana privada).
5. **Evidencia:** B cae directo en **/acceso** ("Iniciar sesión"), sin ver ningún dato (el servidor
   responde 307; en la pestaña Red se ve la redirección). Sin aviso de motivo: ese navegador nunca
   tuvo sesión.

### Punto 10 — Reducir el tiempo de expiración del token

1. Navegador del usuario: iniciar sesión y dejar abierto el dashboard.
2. Navegador del administrador: **Administración → Sesión** → "Vencimiento del token por
   inactividad" en **1 minuto** → guardar.
3. En el navegador del usuario **no tocar nada** (ni mouse ni teclado) durante un poco más de un
   minuto.
4. **Evidencia:** la pestaña del usuario se va sola a /acceso con el aviso **"Tu sesión venció —
   Pasó más de 1 minuto sin que este navegador usara tu sesión"**. En **Administración →
   Auditoría**, el evento `sesion.vencer` con `minutos: 1`. Recargar o volver atrás no la recupera.
5. Volver el valor a 180 días.

### Punto 11 — Incrementar el tiempo de inactividad de la sesión

1. Navegador del usuario con sesión, con dos pestañas de Pulso abiertas.
2. Administración → Sesión → "Cierre de sesión por inactividad" en **1 minuto**.
3. El usuario no toca nada: a los 30 s aparece en **las dos pestañas** el aviso **"¿Sigues ahí?"**
   con la cuenta regresiva ("se cierra después de 1 minuto sin actividad").
4. Clic en **"Seguir conectado"** en una pestaña: el aviso desaparece en las dos.
5. **Incrementar**: en Administración subir el valor a **2 minutos** (o más). Sin recargar, el
   usuario vuelve a quedarse quieto: ahora el aviso aparece al minuto y dice "después de
   **2 minutos**" (el cambio rige en el próximo sondeo, como mucho 20 s).
6. Dejar que la cuenta llegue a cero. **Evidencia:** las dos pestañas van a /acceso con **"Tu
   sesión se cerró por inactividad — Pasaron 2 minutos sin que usaras Pulso"**; en Auditoría,
   `sesion.cerrar` con `motivo: inactividad` (o `sesion.revocar` si la cerró el servidor).
7. Extra (cerrar el navegador): con 1 minuto, iniciar sesión, cerrar el navegador entero, esperar
   más de un minuto y volver a abrir la URL → /acceso con el mismo aviso de inactividad.
8. Volver el valor a 30 minutos.

### Punto 16 — Mismo usuario en dos navegadores (el aviso)

(El cierre de la sesión vieja lo hace A1 al iniciar sesión; acá se ve cómo se entera.)

1. Navegador A: iniciar sesión con la cuenta y dejar abierto el dashboard.
2. Navegador B: iniciar sesión con la **misma** cuenta.
3. **Evidencia:** A, sin tocar nada, va solo a /acceso en menos de 20 s (al instante si se navega
   o se vuelve a la pestaña) con el aviso **"Iniciaste sesión en otro navegador — Tu cuenta solo
   puede tener una sesión abierta a la vez…"**. En Auditoría, el inicio de sesión de B y la sesión
   cerrada.

### Punto 18 — Cerrar sesión en una pestaña e intentar navegar en otra

1. Iniciar sesión y hacer una consulta (por ejemplo, **Métricas** o **Recetas → Mis recetas**).
2. Copiar la URL y pegarla en una **pestaña nueva** del mismo navegador: muestra lo mismo (es la
   misma sesión).
3. En la primera pestaña: **Mi cuenta → Cerrar sesión**.
4. **Evidencia:** la segunda pestaña, sin tocarla, se va sola a /acceso en menos de un segundo con
   **"Se cerró la sesión — Cerraste sesión en otra pestaña o ventana de este navegador"**. Intentar
   navegar (clic en un menú, F5, "atrás", pegar otra vez la URL) siempre termina en /acceso y no
   queda ningún dato en pantalla.
5. Variante: si la sesión se cerró en otro lado y la pestaña hace una consulta (marcar un hábito,
   guardar una métrica), la respuesta sin sesión la lleva a /acceso en el acto.

## Pruebas

```bash
# Servidor y base descartables (ver el brief): BASE_URL, DATABASE_ADMIN_URL y MAILPIT_URL
node --test --test-concurrency=1 tests/integrador/sesion.test.mjs
```

`tests/integrador/sesion.test.mjs` (22 casos) crea cuentas reales (registro → enlace en Mailpit →
activación), cambia los dos tiempos en `configuracion` (y los restaura) y mueve fechas de `sesiones`
para simular el paso del tiempo. Un caso espera el minuto de verdad (~80 s): una sesión quieta vence
por token, una con lecturas de fondo y sin latido se cierra por inactividad, una con latido sigue, y
la app nativa en uso (con su latido) sigue mientras la que no se usa vence.

Cubre: atributos de la cookie y token fuera de la URL y del cuerpo; las pantallas sin cookie o con
una cookie inventada redirigen a /acceso; la configuración se lee en cada petición; el token vence a
1 minuto sin peticiones (con `sesion.vencer` en la auditoría); el deslizamiento es espaciado y el
sondeo no cuenta; la creación, la rotación y el login usan el valor configurado; la app nativa vence
igual y conserva `cliente = 'movil'` al rotar; las peticiones de fondo no cuentan como actividad y
pasado el límite la sesión se revoca con `inactividad`; el latido sí (respeta `hace` y no va hacia
atrás) y valida su cuerpo; la app nativa sin latido se cierra igual y con latido sigue; las sesiones
sin cuenta no se cierran por inactividad;
activar la cuenta cuenta como actividad; volver con una sesión inactiva informa el motivo y crea una
anónima; `DELETE ?motivo=` solo acepta `cierre`/`inactividad`; los motivos `cierre`, `otro_inicio`,
`contrasena` y `admin` se informan en GET y en POST (una sola vez); sin motivo para sesiones sin
cuenta o tokens inventados; la API móvil no recibe la cookie de aviso.

También se actualizaron las llamadas a las funciones de sesión en `tests/seguridad/base.test.mjs`
(firmas nuevas; sus 20 casos pasan). Las pantallas se probaron de punta a punta en un Chromium
headless: los seis guiones de arriba (ver el reporte de A3).

## Despliegue

1. `npm run setup-db` (idempotente; probado en base nueva y sobre el esquema de producción del commit
   `b7ccd69` con datos): agrega las columnas, cambia las funciones de sesión y borra las firmas
   viejas. Las sesiones existentes quedan como `'web'` y con `actividad_at` = el momento de la
   migración.
2. Redeploy de la app **inmediatamente después**: la app vieja llama a las funciones de sesión con
   la firma anterior, así que entre los dos pasos `/api/sesion` falla (los datos siguen leyéndose).
   Lo ideal es correr setup-db con la imagen nueva ya construida.
3. Con la configuración por defecto (180 días y 30 minutos) nadie nota el token; los usuarios web
   con cuenta que no interactúen 30 minutos tendrán que volver a entrar.
