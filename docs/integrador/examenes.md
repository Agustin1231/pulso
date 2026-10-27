# Exámenes médicos: módulo de carga seguro (integrador, punto 15)

> **Prueba 15.** Renombrar un `.exe` a `.pdf` y subirlo en un módulo de carga: debe rechazarse.

Pulso tiene una página nueva, **Exámenes** (`/examenes`), para que el usuario guarde sus
exámenes de laboratorio en PDF, JPG o PNG (hasta 10 MB). Es el módulo de carga del punto 15:
el servidor revisa el **contenido real** de cada archivo (no el nombre ni el tipo que declara
el navegador), lo guarda **cifrado** y solo se lo entrega a su dueño.

## Qué se hizo

| Pieza | Dónde |
|---|---|
| Tabla `examenes` con RLS, FK a `identidades` (`on delete cascade`), cuota de filas y bytes, grants mínimos | `db/examenes.sql` |
| Fusión de identidad: los exámenes pasan a la cuenta | `pulso_fusionar_identidad` en `db/seguridad.sql` |
| Revisión del contenido: firmas, ejecutables y PDF con contenido activo | `src/lib/examenes/firma.ts` |
| Reglas y mensajes compartidos con el navegador | `src/lib/examenes/reglas.ts` |
| Esquemas zod (id, nombre) y saneo de nombres | `src/lib/examenes/esquemas.ts`, `nombres.ts` |
| Lectura del cuerpo con tope de tamaño | `src/lib/examenes/cuerpo.ts` |
| Consultas SQL (no son server actions) | `src/lib/db/examenes.ts` |
| Archivos cifrados en disco | `src/lib/media.ts` (sección "Exámenes médicos") |
| API: listar, subir, ver/bajar, borrar | `src/app/api/examenes/route.ts`, `src/app/api/examenes/[id]/route.ts` |
| Supresión de datos: borra también los archivos | `src/app/api/mis-datos/route.ts` |
| Purga de inactivos: borra los archivos y barre los huérfanos | `scripts/purgar-inactivos.mjs` |
| Límite de subidas y borrados (`examen`, `examenIp`) | `src/lib/seguridad/tasa.ts` |
| Página y componente | `src/app/(app)/examenes/page.tsx`, `src/components/examenes/examenes-client.tsx` |
| Link "Exámenes" (C6) | `sidebar.tsx`, `bottom-nav.tsx`, `header.tsx` |
| Pruebas (43) | `tests/integrador/examenes.test.mjs` |

## Cómo funciona

### Subida: `POST /api/examenes`

El navegador manda el archivo **tal cual como cuerpo** de la petición (no multipart) y el
nombre en el header `X-Nombre-Archivo` (con `encodeURIComponent`). Así no hace falta ninguna
librería nueva y el tamaño se controla antes de tener el archivo en memoria. La ruta usa
`rutaProtegida`: exige una cuenta activada, rechaza un `Origin` de otro sitio y consume el
límite `examen` (30 por hora por usuario, 90 por IP; cuentan también las rechazadas).

La validación va en este orden, y **cada rechazo queda en la auditoría** como
`examen.subir` / `denegado` con su motivo:

| # | Control | Respuesta |
|---|---|---|
| 1 | Nombre: una sola componente, sin caracteres de control ni de formato (U+202E, el que invierte el texto, no puede esconder un `.exe`) | 400 `nombre_invalido` |
| 2 | Extensión en la lista: `.pdf`, `.jpg`, `.jpeg`, `.png` | 415 `extension_no_permitida` |
| 3 | Tamaño: por `Content-Length` **sin leer un byte**; si no viene (chunked), se corta la lectura en el primer byte después de los 10 MB | 413 `archivo_demasiado_grande` |
| 4 | Vacío | 400 `archivo_vacio` |
| 5 | **Ejecutable**, por sus primeros bytes: `MZ` (Windows), `\x7fELF` (Linux/Android), Mach-O (macOS), `#!` (scripts) | 415 `archivo_ejecutable` |
| 6 | **Firma = extensión**: `%PDF-` para .pdf; `FF D8 FF` + marcador para .jpg/.jpeg; `89 50 4E 47 0D 0A 1A 0A` + bloque `IHDR` para .png | 415 `firma_no_coincide` |
| 7 | **PDF con contenido activo**: `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile(s)`, `/RichMedia`, `/Rendition`, `/XFA` | 415 `pdf_con_contenido_activo` |
| 8 | PDF que no se puede revisar (stream de objetos cifrado o con un filtro que no se infla) | 415 `pdf_no_verificable` |
| 9 | Cuota: 50 exámenes y 100 MB por usuario (trigger en la base) | 409 `cuota_excedida` |

La respuesta de error trae `{ error, mensaje }` y la página muestra `mensaje` tal cual. El de
un ejecutable es: *"El archivo es un programa ejecutable con la extensión cambiada. Solo se
aceptan PDF, JPG o PNG reales."*

El **MIME declarado** (`Content-Type`) no se usa para decidir nada: se anota en la auditoría
(`mime_declarado`) para que se vea que el navegador decía `application/pdf` y el servidor
encontró un `windows_pe`. El **nombre del archivo nunca va a la auditoría**: puede decir de qué
es el examen.

**Cómo se revisa un PDF** (`revisarPdf` en `firma.ts`). Las acciones de un PDF se declaran con
nombres (`/S /JavaScript /JS (código)`), así que se buscan esos nombres, con tres cuidados:

1. Los nombres admiten escapes (`/J#61vaScript` es `/JavaScript`): se decodifican antes de comparar.
2. Desde PDF 1.5 los objetos pueden ir comprimidos dentro de un *stream de objetos*: esos se
   inflan (con tope de 16 MB por stream y 48 MB en total, contra las bombas de compresión) y se
   revisan. Si uno no se puede inflar, el PDF se rechaza: lo que no se puede revisar no se acepta.
3. Un visor llega a los objetos por la tabla xref, así que un atacante puede esconder uno dentro
   de los datos de otro stream. Por eso los nombres largos se buscan en todo el archivo, y cada
   aparición de `obj` se lee con un analizador léxico de verdad (cadenas, comentarios,
   diccionarios anidados) que no se deja engañar por un `(obj)` dentro de una cadena.

Se probó con PDF reales (pdfTeX/Tectonic con streams de objetos comprimidos, los PDF exportados
de los `.docx` del proyecto, Ghostscript, imágenes escaneadas guardadas con Pillow, y los de CUPS
y matplotlib: ninguno rechazado), con 30 PDF de 9,9 MB de datos aleatorios (ningún falso
positivo) y con PDF armados para colgar el analizador (todos rechazados en menos de 300 ms).

### Guardado cifrado

- El contenido se cifra con `cifrarBytes(…, "examenes.archivo")` (AES-256-GCM, la clave
  `PULSO_CLAVE_DATOS`) y se escribe en `MEDIA_DIR/examenes/<archivo>`, donde `archivo` son 128
  bits aleatorios: **la ruta no depende del uid ni del nombre**. Permisos `0600` (carpeta
  `0700`) y nunca se pisa un archivo existente.
- El nombre original va en la base, cifrado con `cifrar(…, "examenes.nombre")` (`v1.…`).
- La fila se inserta primero (el trigger de cuota toma un lock por usuario), después se escribe
  el archivo, todo en la misma transacción. Si algo falla, se borra el archivo.

### Ver, bajar y borrar: `/api/examenes/{id}`

- Solo el dueño: la fila se busca con RLS (`app.uid`) y además por uid. Un examen ajeno
  responde **404**, igual que uno que no existe (no se confirma que el id sea de alguien), y el
  intento queda en la auditoría como `denegado` con el id.
- `GET` descifra (si el archivo fue alterado, GCM lo detecta: 500 genérico y auditoría `error`),
  vuelve a comprobar la firma y responde con el Content-Type **detectado**,
  `X-Content-Type-Options: nosniff`, `Content-Disposition` con el nombre saneado y la extensión
  del tipo real (`inline` para ver, `attachment` con `?descargar=1`), `Cache-Control: no-store`
  y una CSP `default-src 'none'` (más `sandbox` en las imágenes). Cada descarga se audita.
- `DELETE` borra la fila (auditado) y, después del commit, el archivo.

### Supresión, purga y fusión

- **Borrar mis datos** (`DELETE /api/mis-datos`): anota los archivos de los exámenes antes de
  borrar las filas, y después del borrado en la base los elimina del disco.
- **Purga** (`scripts/purgar-inactivos.mjs`): antes de `pulso_purgar_inactivos` anota qué
  archivos tiene cada identidad (con `row_security = off`, que hace FALLAR la consulta si RLS la
  filtrara, en vez de devolver una lista vacía); después del commit borra los de las identidades
  purgadas y **barre los huérfanos** de más de una hora (los que dejó un borrado que no pudo
  tocar el disco o una subida cortada). `--seco` solo cuenta.
- **Fusión** (`pulso_fusionar_identidad`): `update examenes set uid = cuenta`. Como el archivo no
  depende del uid, no hay nada que mover en disco.
- Las filas también se van solas con la identidad (`on delete cascade`).

## Guion para el video (prueba 15)

**Preparación (antes de grabar)**

1. Una cuenta activada en Pulso y un PDF real de un examen (cualquier PDF de laboratorio).
2. El `.exe` renombrado:
   - **Windows:** en el Explorador, *Vista → Mostrar → Extensiones de nombre de archivo*.
     Copiar `C:\Windows\System32\notepad.exe` al Escritorio y renombrarlo a
     `resultados-laboratorio.pdf` (aceptar el aviso de Windows). El ícono pasa a ser el de PDF.
   - **macOS / Linux:** `cp /bin/ls ~/Desktop/resultados-laboratorio.pdf` (un Mach-O o un ELF:
     el mensaje es el mismo).
3. Opcional, para mostrar más casos: una foto `.jpg` renombrada a `.pdf`, y un PDF con
   JavaScript:
   ```bash
   node -e 'require("fs").writeFileSync("con-javascript.pdf", "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")'
   ```

**Grabación**

| Paso | Acción | Qué se ve |
|---|---|---|
| 1 | Iniciar sesión e ir a **Exámenes** (menú lateral o barra de abajo en el teléfono) | La página con la zona "Sube un examen", la lista "Mis exámenes" y la cuota (`0 de 50 · 0 B de 100 MB`) |
| 2 | Mostrar el archivo en el Explorador: se llama `resultados-laboratorio.pdf` y tiene ícono de PDF | El sistema operativo "cree" que es un PDF |
| 3 | Arrastrarlo a la zona de carga (o clic y elegirlo) | Aviso rojo **"Archivo rechazado"** con el nombre, el mensaje *"El archivo es un programa ejecutable con la extensión cambiada. Solo se aceptan PDF, JPG o PNG reales."* y `Código: archivo_ejecutable`. No aparece nada en la lista |
| 4 | (Opcional) La foto `.jpg` renombrada a `.pdf` | *"El archivo es en realidad un JPG, pero su extensión es .pdf…"* (`firma_no_coincide`) |
| 5 | (Opcional) `con-javascript.pdf` | *"El PDF tiene contenido activo (JavaScript…)"* (`pdf_con_contenido_activo`) |
| 6 | Subir el PDF real | Aviso verde **"Examen guardado"**; aparece en la lista con nombre, `PDF`, tamaño y fecha; sube la cuota |
| 7 | **Ver** y **Descargar** | El PDF se abre en otra pestaña y se descarga con su nombre |
| 8 | Evidencia en la auditoría: pestaña **Auditoría** del panel de administración (A2), filtrando la acción `examen.subir` — o, como dueño de la base, la consulta de abajo | Una fila `denegado` con `motivo: archivo_ejecutable`, `detectado: windows_pe`, `mime_declarado: application/pdf`, `extension: pdf`; y otra `ok` con `tipo: pdf` |
| 9 | (Opcional) Evidencia del cifrado: en el servidor, `ls -l $MEDIA_DIR/examenes` y `head -c 48 $MEDIA_DIR/examenes/<archivo> \| xxd`; en la base, `select archivo, nombre_cifrado, tipo, bytes from examenes` | Nombres aleatorios de 32 caracteres, bytes ilegibles (no empiezan con `%PDF-`); el nombre original como `v1.…` |

```sql
select ocurrido_at, accion, resultado, detalle
  from auditoria
 where accion like 'examen.%'
 order by id desc
 limit 10;
```

## Pruebas

```bash
set -a; . <entorno>/ag4.env; set +a      # o node --env-file=…
BASE_URL=http://127.0.0.1:3204 node --test --test-concurrency=1 tests/integrador/examenes.test.mjs
```

Variables: `BASE_URL`, `DATABASE_ADMIN_URL` (base descartable; se niega a usar el puerto
5433), `MAILPIT_URL` (activa las cuentas por el camino real; sin él, las activa el dueño de la
base) y `MEDIA_DIR` (el del servidor, para mirar el disco). Sin `BASE_URL` o sin
`DATABASE_ADMIN_URL` se saltea todo; se niega a correr contra `agustinynatalia.site`.

Cubren (43 casos): PDF real aceptado y bajado byte por byte igual, con sus headers; `.exe`
renombrado a `.pdf` (y ELF a `.jpg`, script a `.png`) rechazado con el mensaje y auditado sin el
nombre del archivo; JPG con extensión `.pdf` rechazado; el MIME declarado ignorado; extensiones
fuera de la lista y el truco de U+202E; PDF con `/JavaScript`, con escapes, escondido en un
stream de objetos comprimido, `/Launch` y archivo incrustado; **demasiado grande sin leerlo
entero** (socket crudo: `Content-Length` de 50 MB mandando solo 256 KB, y chunked que no
termina: el servidor responde 413 sin esperar); otro usuario no lo ve, no lo baja ni lo borra
(404, auditado) y RLS en la base; sin sesión / sin cuenta / Origin ajeno; **en disco está
cifrado** (no empieza con `%PDF-`, tamaño + 28 bytes, permisos 600), ruta sin uid y nombre
`v1.…`; archivo alterado → 500; borrar; cuotas de filas y bytes; límite por hora; nombres
hostiles en `Content-Disposition`; supresión; fusión; purga (incluidos los huérfanos).

## Orden de deploy

1. Deploy del código y `npm run setup-db` (aplica `examenes.sql`; no hay datos que migrar). Se
   probó sobre el esquema de producción actual (`b7ccd69`) con una cuenta y datos: corre limpio
   dos veces seguidas, la cuenta entra con su contraseña y los datos quedan.
2. Requisitos que ya existen: `PULSO_CLAVE_DATOS` (sin ella la subida falla con 500) y
   `MEDIA_DIR` en un volumen persistente (`/data`). La carpeta `examenes/` se crea sola.
3. La tarea programada de la purga no cambia de comando; ahora también limpia los exámenes.

## Contratos y pendientes para el integrador

- **C6:** link "Exámenes" (ícono `FileHeart`, color teal) en `sidebar.tsx` (entre "Mi Score" y
  "Tips"), `bottom-nav.tsx` (7 ítems; se probó a 390 px) y el título en `header.tsx`.
- **tasa.ts:** límites nuevos `examen` (30/h) y `examenIp` (90/h), al final de `LIMITES`.
- **`db/seguridad.sql`:** solo `pulso_fusionar_identidad` (una línea `update examenes …` y el
  comentario). Hace referencia a `examenes`, que crea `examenes.sql` después: es plpgsql, así que
  se resuelve al ejecutarse.
- **Supresión:** el texto de `/privacidad` (`privacidad-client.tsx`, no es de esta área) dice
  "tus fotos de recetas"; convendría agregar "y tus exámenes".
- **Errores (C5):** las rutas nuevas usan `rutaProtegida`, así que el `registrarError` de A2 las
  cubre solo.
- **Headers:** `next.config.ts` pone `Cache-Control: no-store` a toda la API y gana sobre el
  `private, no-store` de la descarga; el resultado es igual de estricto (`no-store` ya impide
  guardarlo en cualquier caché).

## Riesgos residuales

- La revisión de PDF es estática: detecta las formas conocidas de ejecutar código o traer
  archivos, no reemplaza un antivirus. Un siguiente paso sería pasar cada archivo por ClamAV o
  re-generar el PDF en el servidor (rasterizar) antes de guardarlo.
- Se rechazan los PDF con streams de objetos cifrados (protegidos con contraseña de dueño): no
  se pueden revisar. El mensaje le dice al usuario cómo resolverlo ("Imprimir como PDF").
- Si se pierde `PULSO_CLAVE_DATOS`, los exámenes no se pueden recuperar (igual que el resto de
  lo cifrado): la clave se respalda aparte del volumen y de la base.
