/**
 * Tipos y textos de la administración (integrador, puntos 5, 7, 8, 9, 10, 11
 * y 17), compartidos por el servidor y el panel /admin.
 *
 * Sin "server-only": lo importa el cliente. Que algo se muestre no autoriza
 * nada: cada operación la autoriza la base (`pulso_admin_*` en db/admin.sql).
 */

/** Catálogo fijo de permisos: el mismo que siembra db/admin.sql. */
export const PERMISOS = [
  "usuarios.ver",
  "usuarios.editar",
  "roles.gestionar",
  "auditoria.ver",
  "errores.ver",
  "configuracion.editar",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export function esPermiso(p: unknown): p is Permiso {
  return typeof p === "string" && (PERMISOS as readonly string[]).includes(p);
}

/** Nombre corto para mostrar (la descripción larga viene del catálogo de la base). */
export function nombrePermiso(p: string): string {
  switch (p) {
    case "usuarios.ver":         return "Ver usuarios";
    case "usuarios.editar":      return "Editar usuarios";
    case "roles.gestionar":      return "Gestionar roles";
    case "auditoria.ver":        return "Ver auditoría";
    case "errores.ver":          return "Ver errores";
    case "configuracion.editar": return "Editar la sesión";
    default:                     return p;
  }
}

/** { uid: correo } que acompaña cada respuesta que menciona usuarios. */
export type Correos = Record<string, string | null>;

export type OrigenPermiso = { tipo: "rol"; id: number; nombre: string } | { tipo: "directo" };

export interface UsuarioAdmin {
  uid:               string;
  estado:            "activa" | "sin_activar";
  creada_at:         string;
  ultima_actividad:  string | null;
  sesiones_abiertas: number;
  es_tu_cuenta:      boolean;
  /** ids de sus roles */
  roles:             number[];
  directos:          Permiso[];
  efectivos:         { permiso: Permiso; origenes: OrigenPermiso[] }[];
}

export interface RolAdmin {
  id:             number;
  nombre:         string;
  descripcion:    string;
  sistema:        boolean;
  created_at:     string;
  actualizado_at: string;
  permisos:       Permiso[];
  /** uids */
  miembros:       string[];
}

export interface PermisoCatalogo {
  clave:       Permiso;
  descripcion: string;
}

export interface EventoAuditoria {
  id:          number;
  ocurrido_at: string;
  uid:         string | null;
  accion:      string;
  recurso:     string | null;
  recurso_id:  string | null;
  resultado:   "ok" | "denegado" | "error";
  ip:          string | null;
  detalle:     Record<string, unknown> | null;
}

export interface ErrorRegistrado {
  id:          number;
  ocurrido_at: string;
  origen:      string;
  mensaje:     string;
  stack:       string | null;
  uid:         string | null;
  ip:          string | null;
  detalle:     Record<string, unknown> | null;
}

export interface ValorConfig {
  clave:           string;
  valor:           number;
  minimo:          number;
  maximo:          number;
  actualizada_at:  string;
  actualizada_por: string | null;
}

// ─── Pestañas del panel ───────────────────────────────────────────────────────

export type IdPestana = "usuarios" | "roles" | "auditoria" | "errores" | "sesion";

/** Cada pestaña se muestra si el usuario tiene AL MENOS uno de sus permisos. */
export const PESTANAS: { id: IdPestana; titulo: string; requiere: Permiso[] }[] = [
  { id: "usuarios",  titulo: "Usuarios",  requiere: ["usuarios.ver"] },
  { id: "roles",     titulo: "Roles",     requiere: ["roles.gestionar"] },
  { id: "auditoria", titulo: "Auditoría", requiere: ["auditoria.ver"] },
  { id: "errores",   titulo: "Errores",   requiere: ["errores.ver"] },
  { id: "sesion",    titulo: "Sesión",    requiere: ["configuracion.editar"] },
];

export function pestanasVisibles(permisos: readonly string[]): typeof PESTANAS {
  return PESTANAS.filter((p) => p.requiere.some((r) => permisos.includes(r)));
}

// ─── Mensajes ─────────────────────────────────────────────────────────────────

/** Mensaje para el usuario según el código de error de /api/admin/*. */
export function mensajeAdmin(codigo: string | undefined): string {
  switch (codigo) {
    case "sin_permiso":               return "No tienes permiso para hacer esto.";
    case "sin_sesion":
    case "sesion_requerida":
    case "cuenta_requerida":          return "Tu sesión no es válida. Vuelve a iniciar sesión.";
    case "privilegios_insuficientes": return "No puedes otorgar ni modificar permisos que tú no tienes.";
    case "no_encontrado":             return "No se encontró. Recarga la página.";
    case "nombre_en_uso":             return "Ya existe un rol con ese nombre.";
    case "rol_de_sistema":            return "El rol Administrador es del sistema: no se puede borrar ni cambiar sus permisos.";
    case "ultimo_administrador":      return "Tiene que quedar al menos un usuario con el rol Administrador.";
    case "es_tu_cuenta":              return "Tu propia contraseña se cambia desde tu perfil, no desde acá.";
    case "cuenta_sin_activar":        return "La cuenta todavía no está activada: no se le pueden asignar roles ni permisos.";
    case "permiso_desconocido":       return "Uno de los permisos no existe.";
    case "rol_desconocido":           return "Uno de los roles ya no existe. Recarga la página.";
    case "contrasena_invalida":       return "La contraseña no cumple las reglas de seguridad.";
    case "fuera_de_rango":            return "El valor está fuera de los límites permitidos.";
    case "datos_invalidos":           return "Los datos enviados no son válidos.";
    case "demasiadas_peticiones":     return "Hiciste demasiados cambios seguidos. Espera un rato.";
    case "sesion_bloqueada":          return "Desbloquea Pulso para seguir.";
    default:                          return "No se pudo completar. Intenta de nuevo.";
  }
}
