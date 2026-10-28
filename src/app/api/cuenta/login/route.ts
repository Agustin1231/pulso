import { rutaLogin } from "@/lib/login";

export const runtime = "nodejs";

/**
 * Inicia sesión con correo y contraseña desde el navegador: el token nuevo va
 * a la cookie. La lógica (bloqueo, límites, fusión, auditoría) es la misma que
 * la de la app nativa y vive en lib/login.ts.
 */
export const POST = rutaLogin("web");
