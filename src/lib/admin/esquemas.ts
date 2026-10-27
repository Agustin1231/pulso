import { z } from "zod";
import { idSchema } from "@/lib/seguridad/validacion";
import { PERMISOS } from "./tipos";

/**
 * Entrada de las rutas /api/admin/* (integrador). Acota forma, tipo y largo;
 * las reglas de negocio (que el rol exista, que quede un administrador, que no
 * se otorgue lo que no se tiene) las impone la base en db/admin.sql.
 */

export const permisoSchema = z.enum(PERMISOS);

/** uid de una identidad (los genera la base con gen_random_uuid; los legado también son UUID). */
export const uidSchema = idSchema;

export const rolIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Nombre de rol: sin caracteres de control (se ven en la auditoría y en la UI). */
const nombreRolSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .refine((n) => !/\p{Cc}/u.test(n), "nombre inválido");

export const rolSchema = z.object({
  nombre:      nombreRolSchema,
  descripcion: z.string().trim().max(300).default(""),
  permisos:    z.array(permisoSchema).max(PERMISOS.length * 2),
});

/** Todos los roles y todos los permisos directos de un usuario: lo que no viene se le quita. */
export const accesoSchema = z.object({
  roles:    z.array(rolIdSchema).max(100),
  permisos: z.array(permisoSchema).max(PERMISOS.length * 2),
});

/**
 * La contraseña nueva se valida aparte (problemasContrasena), para responder
 * qué regla falla en vez de un "datos inválidos" a secas. Acá solo se acota.
 */
export const contrasenaAdminSchema = z.object({ password: z.string().max(200) });

export const configSchema = z.object({
  clave: z.string().regex(/^[a-z_]{1,64}$/),
  valor: z.number().int().min(0).max(10_000_000),
});

const fechaHora = z.string().datetime({ offset: true });

export const filtrosAuditoriaSchema = z.object({
  accion:    z.string().trim().max(60).regex(/^[a-z0-9._]*$/).optional(),
  resultado: z.enum(["ok", "denegado", "error"]).optional(),
  usuario:   uidSchema.optional(),
  desde:     fechaHora.optional(),
  hasta:     fechaHora.optional(),
  antes:     z.coerce.number().int().positive().optional(),
  limite:    z.coerce.number().int().min(1).max(100).optional(),
});

export const filtrosErroresSchema = z.object({
  origen: z.string().trim().max(120).regex(/^[A-Za-z0-9._:/[\]-]*$/).optional(),
  antes:  z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** "manejado": lo atrapa rutaProtegida. "no_manejado": sale de la ruta y lo atrapa onRequestError. */
export const forzarErrorSchema = z.object({ tipo: z.enum(["manejado", "no_manejado"]).default("manejado") });

/** Query string → objeto, sin los parámetros vacíos (un filtro vacío es "sin filtro"). */
export function parametros(req: Request): Record<string, string> {
  // fromEntries crea propiedades propias (un `__proto__` no toca el prototipo)
  // y zod descarta después las claves que no conoce.
  return Object.fromEntries([...new URL(req.url).searchParams].filter(([, valor]) => valor !== ""));
}
