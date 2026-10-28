import { rutaLogin } from "@/lib/login";

export const runtime = "nodejs";

/**
 * Inicio de sesión de la app nativa: `/api/cuenta/login` sin cookies. La app
 * manda en `Authorization: Bearer` el token de la sesión que tiene (anónima,
 * casi siempre: sus datos se suman a la cuenta, como en la web) y recibe en
 * el cuerpo el token de la sesión nueva, `{ ok, token, sesiones_cerradas }`.
 * El anterior queda revocado. Los rechazos son los de la web: ver lib/login.ts.
 */
export const POST = rutaLogin("movil");
