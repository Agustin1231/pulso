import "server-only";
import { pool } from "@/lib/db/pool";
import { enviarDespues, urlDeLaApp, type Correo } from "@/lib/correo";
import { hashDeSesion } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { descifrar } from "@/lib/seguridad/cifrado";
import { anonimizarIp } from "@/lib/seguridad/red";
import { json } from "@/lib/seguridad/ruta";
import type { Correos } from "./tipos";

/**
 * Capa de servidor del panel de administración (integrador). Cada operación es
 * UNA llamada a una función `pulso_admin_*` de db/admin.sql con el hash del
 * token de sesión: la base resuelve quién actúa, exige el permiso, valida las
 * reglas y audita. Acá no se decide nada de permisos: solo se traduce la
 * respuesta a HTTP y se descifran los correos.
 *
 * La IP va anonimizada (/24, /48) para la auditoría que escribe la base.
 */

export type Resultado = { error?: string; correos?: Correos } & Record<string, unknown>;

/**
 * Correo para mostrar, a partir de lo que devuelve `pulso_correo_de` (C3).
 * Es el ÚNICO mapeo de correos de la administración. Sirve antes y después de
 * cifrar el correo: lo cifrado (`v1.…`, contexto "cuentas.email") se descifra
 * y lo que todavía está en claro pasa tal cual. Si no se puede descifrar (otra
 * clave, dato alterado), no se muestra.
 */
export function correoVisible(valor: string | null): string | null {
  if (!valor?.startsWith("v1.")) return valor;
  try {
    return descifrar(valor, "cuentas.email");
  } catch {
    // Un correo en claro también puede empezar con "v1.": lo delata la arroba.
    return valor.includes("@") ? valor : null;
  }
}

function mapearCorreos(correos: Correos): Correos {
  return Object.fromEntries(Object.entries(correos).map(([uid, valor]) => [uid, correoVisible(valor)]));
}

async function llamar(sql: string, params: readonly unknown[]): Promise<Resultado> {
  const sesion = await hashDeSesion();
  if (!sesion) return { error: "sin_sesion" };
  const { rows } = await pool.query<{ r: Resultado | null }>(sql, [sesion, ...params]);
  const r = rows[0]?.r;
  if (!r) throw new Error("La función de administración no devolvió nada");
  return r.correos ? { ...r, correos: mapearCorreos(r.correos) } : r;
}

/** Status HTTP de cada código de error de las funciones `pulso_admin_*`. */
function statusDe(error: string): number {
  switch (error) {
    case "sin_sesion":                return 401;
    case "sin_permiso":
    case "privilegios_insuficientes": return 403;
    case "no_encontrado":             return 404;
    case "nombre_en_uso":
    case "rol_de_sistema":
    case "ultimo_administrador":
    case "es_tu_cuenta":
    case "cuenta_sin_activar":        return 409;
    // datos_invalidos, permiso_desconocido, rol_desconocido, contrasena_invalida, fuera_de_rango
    default:                          return 400;
  }
}

/** La respuesta de una función `pulso_admin_*` como Response (el error, con su status). */
export function responder(r: Resultado): Response {
  if (typeof r.error === "string") return json(r, statusDe(r.error));
  return json(r);
}

/**
 * Un parámetro de la URL o del query string que no pasó zod. rutaProtegida
 * valida solo el cuerpo: esto deja el mismo rastro que sus rechazos.
 */
export async function entradaInvalida(uid: string, accion: string, ip: string | null, campos: string[]): Promise<Response> {
  await auditar({ uid, accion, resultado: "denegado", ip, detalle: { motivo: "datos_invalidos", campos } });
  return json({ error: "datos_invalidos" }, 400);
}

const anon = (ip: string | null) => anonimizarIp(ip);

// ─── Lecturas ─────────────────────────────────────────────────────────────────

export const misPermisos = () =>
  llamar("select pulso_admin_mis_permisos($1) as r", []);

export const comprobar = (permiso: string, accion: string, ip: string | null) =>
  llamar("select pulso_admin_comprobar($1, $2, $3, $4) as r", [permiso, accion, anon(ip)]);

export const usuarios = (ip: string | null) =>
  llamar("select pulso_admin_usuarios($1, $2) as r", [anon(ip)]);

export const roles = (ip: string | null) =>
  llamar("select pulso_admin_roles($1, $2) as r", [anon(ip)]);

export const auditoria = (filtros: Record<string, unknown>, ip: string | null) =>
  llamar("select pulso_admin_auditoria($1, $2, $3) as r", [JSON.stringify(filtros), anon(ip)]);

export const errores = (filtros: Record<string, unknown>, ip: string | null) =>
  llamar("select pulso_admin_errores($1, $2, $3) as r", [JSON.stringify(filtros), anon(ip)]);

export const configuracion = (ip: string | null) =>
  llamar("select pulso_admin_config($1, $2) as r", [anon(ip)]);

// ─── Cambios ──────────────────────────────────────────────────────────────────

export const crearRol = (rol: { nombre: string; descripcion: string; permisos: string[] }, ip: string | null) =>
  llamar("select pulso_admin_crear_rol($1, $2, $3, $4, $5) as r", [rol.nombre, rol.descripcion, rol.permisos, anon(ip)]);

export const editarRol = (id: number, rol: { nombre: string; descripcion: string; permisos: string[] }, ip: string | null) =>
  llamar("select pulso_admin_editar_rol($1, $2, $3, $4, $5, $6) as r", [id, rol.nombre, rol.descripcion, rol.permisos, anon(ip)]);

export const borrarRol = (id: number, ip: string | null) =>
  llamar("select pulso_admin_borrar_rol($1, $2, $3) as r", [id, anon(ip)]);

export const fijarAcceso = (uid: string, acceso: { roles: number[]; permisos: string[] }, ip: string | null) =>
  llamar("select pulso_admin_fijar_acceso($1, $2, $3, $4, $5) as r", [uid, acceso.roles, acceso.permisos, anon(ip)]);

export const cambiarContrasena = (uid: string, password: string, ip: string | null) =>
  llamar("select pulso_admin_cambiar_contrasena($1, $2, $3, $4) as r", [uid, password, anon(ip)]);

export const fijarConfig = (clave: string, valor: number, ip: string | null) =>
  llamar("select pulso_admin_fijar_config($1, $2, $3, $4) as r", [clave, valor, anon(ip)]);

// ─── Aviso al usuario ─────────────────────────────────────────────────────────

/** Correo al dueño de la cuenta cuando un administrador le cambió la contraseña. */
export function avisarCambioDeContrasena(correo: string): void {
  const url = urlDeLaApp("/acceso");
  const aviso: Correo = {
    asunto: "Un administrador cambió tu contraseña de Pulso",
    texto:
      "Un administrador de Pulso cambió la contraseña de tu cuenta y cerró todas tus sesiones.\n\n" +
      "Pídele la contraseña nueva, o crea una tú con \"Olvidé mi contraseña\" en la pantalla de acceso:\n\n" +
      `${url}\n\nSi no esperabas este cambio, avísanos respondiendo este correo.`,
    html:
      `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:520px">` +
      `<p style="margin:0 0 16px">Un administrador de Pulso cambió la contraseña de tu cuenta y cerró todas tus sesiones.</p>` +
      `<p style="margin:0 0 16px">Pídele la contraseña nueva, o crea una tú con «Olvidé mi contraseña» en la pantalla de acceso.</p>` +
      `<p style="margin:0 0 16px"><a href="${url}" style="display:inline-block;background:#ff6b6b;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px">Ir a Pulso</a></p>` +
      `<p style="margin:0;color:#666;font-size:13px">Si no esperabas este cambio, avísanos respondiendo este correo.</p></div>`,
  };
  enviarDespues(correo, aviso, "admin_contrasena");
}
