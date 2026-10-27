import { conUsuario, mensajeError } from "@/lib/db/pool";
import { cuotaExcedida, insertarExamen, listarExamenes } from "@/lib/db/examenes";
import { leerCuerpoBinario, SubidaIncompleta, tamanoDeclarado } from "@/lib/examenes/cuerpo";
import { nombreArchivoSchema } from "@/lib/examenes/esquemas";
import { revisarContenido } from "@/lib/examenes/firma";
import {
  extensionDe,
  MAX_BYTES_EXAMEN,
  MAX_BYTES_USUARIO,
  MAX_EXAMENES,
  MENSAJE_CUOTA_BYTES,
  mensajeRechazo,
  tipoPorExtension,
  type Examen,
  type MotivoRechazo,
} from "@/lib/examenes/reglas";
import { borrarArchivosExamen, guardarArchivoExamen, nuevoArchivoExamen } from "@/lib/media";
import { auditar, auditarEn } from "@/lib/seguridad/auditoria";
import { cifrar, descifrar } from "@/lib/seguridad/cifrado";
import { CuerpoDemasiadoGrande, json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Exámenes médicos (integrador, punto 15).
 *
 *   GET  /api/examenes   los exámenes del usuario y su cuota
 *   POST /api/examenes   sube uno: el cuerpo es el archivo tal cual y el nombre
 *                        va en `X-Nombre-Archivo` (con encodeURIComponent)
 *
 * La subida se valida en este orden, y cada rechazo queda en la auditoría
 * (`examen.subir`, 'denegado', con el motivo; nunca el nombre del archivo,
 * que puede decir de qué es el examen):
 *   1. nombre válido y extensión en la lista (.pdf, .jpg, .jpeg, .png);
 *   2. tamaño: por `Content-Length` sin leer nada, y con tope al leer (10 MB);
 *   3. contenido: no es un ejecutable, la firma de los primeros bytes coincide
 *      con la extensión y, si es PDF, no tiene contenido activo (firma.ts);
 *   4. cuota del usuario (trigger de db/examenes.sql).
 * El MIME que declara el navegador (`Content-Type`) no se usa para nada: solo
 * se anota en la auditoría, para que se vea que no coincidía.
 *
 * Lo aceptado se guarda cifrado en disco con un nombre aleatorio, y el nombre
 * original, cifrado en la base.
 */

const CONTEXTO_NOMBRE = "examenes.nombre";

export const GET = rutaProtegida({ nombre: "examen.listar", cuerpo: null }, async ({ uid }) => {
  const filas = await conUsuario(uid, (db) => listarExamenes(db, uid));
  const examenes: Examen[] = filas.map((f) => {
    let nombre = "(nombre no disponible)";
    try {
      nombre = descifrar(f.nombre_cifrado, CONTEXTO_NOMBRE);
    } catch (err) {
      console.error("[api] examen.listar: no se pudo descifrar un nombre:", mensajeError(err));
    }
    return { id: f.id, nombre, tipo: f.tipo, bytes: f.bytes, created_at: f.created_at };
  });
  return json({
    examenes,
    cuota: {
      examenes:    filas.length,
      maxExamenes: MAX_EXAMENES,
      bytes:       filas.reduce((s, f) => s + f.bytes, 0),
      maxBytes:    MAX_BYTES_USUARIO,
    },
  });
});

export const POST = rutaProtegida(
  {
    nombre: "examen.subir",
    cuerpo: null, // el cuerpo es el archivo: lo lee el manejador, con tope
    limites: (uid, ip) => [limite("examen", uid), limite("examenIp", ip)],
  },
  async ({ req, uid, ip }) => {
    const mimeDeclarado = (req.headers.get("content-type") ?? "").slice(0, 100) || null;
    const rechazar = async (
      status: number,
      motivo: MotivoRechazo,
      detalle: Record<string, unknown> = {},
      mensaje = mensajeRechazo(motivo)
    ) => {
      await auditar({
        uid, accion: "examen.subir", recurso: "examenes", resultado: "denegado", ip,
        detalle: { motivo, mime_declarado: mimeDeclarado, ...detalle },
      });
      return json({ error: motivo, mensaje }, status);
    };

    // 1. Nombre y extensión: antes de leer el cuerpo.
    let crudo: string;
    try {
      crudo = decodeURIComponent(req.headers.get("x-nombre-archivo") ?? "");
    } catch {
      return rechazar(400, "nombre_invalido");
    }
    const nombre = nombreArchivoSchema.safeParse(crudo);
    if (!nombre.success) return rechazar(400, "nombre_invalido");
    const extension = extensionDe(nombre.data);
    const esperado = tipoPorExtension(nombre.data);
    if (!esperado) return rechazar(415, "extension_no_permitida", { extension: extension.slice(0, 10) || null });

    // 2. Tamaño.
    let bytes: Buffer;
    try {
      bytes = await leerCuerpoBinario(req, MAX_BYTES_EXAMEN);
    } catch (err) {
      if (err instanceof CuerpoDemasiadoGrande) {
        return rechazar(413, "archivo_demasiado_grande", { extension, bytes_declarados: tamanoDeclarado(req) });
      }
      if (err instanceof SubidaIncompleta) return rechazar(400, "subida_incompleta", { extension });
      throw err;
    }

    // 3. Contenido.
    const revision = revisarContenido(bytes, extension, esperado);
    if (!revision.ok) {
      return rechazar(
        revision.motivo === "archivo_vacio" ? 400 : 415,
        revision.motivo,
        { extension, bytes: bytes.length, ...revision.detalle },
        revision.mensaje
      );
    }

    // 4. Guardar: la fila primero (el trigger controla la cuota con un lock
    // por usuario), después el archivo, todo en la misma transacción. Si algo
    // falla, se borra el archivo: no quedan archivos sin fila ni filas sin archivo.
    const archivo = nuevoArchivoExamen();
    try {
      const fila = await conUsuario(uid, async (db) => {
        const f = await insertarExamen(db, uid, {
          archivo,
          nombreCifrado: cifrar(nombre.data, CONTEXTO_NOMBRE),
          tipo: revision.tipo,
          bytes: bytes.length,
        });
        await guardarArchivoExamen(archivo, bytes);
        await auditarEn(db, {
          uid, accion: "examen.subir", recurso: "examenes", recursoId: f.id, resultado: "ok", ip,
          detalle: { tipo: revision.tipo, bytes: bytes.length, mime_declarado: mimeDeclarado },
        });
        return f;
      });
      const examen: Examen = { id: fila.id, nombre: nombre.data, tipo: revision.tipo, bytes: bytes.length, created_at: fila.created_at };
      return json({ ok: true, examen }, 201);
    } catch (err) {
      await borrarArchivosExamen([archivo]).catch(() => {});
      const cuota = cuotaExcedida(err);
      if (cuota) {
        return rechazar(409, "cuota_excedida", { cuota }, cuota === "examenes_bytes" ? MENSAJE_CUOTA_BYTES : undefined);
      }
      throw err; // rutaProtegida: 500 genérico y auditoría 'error'
    }
  }
);
