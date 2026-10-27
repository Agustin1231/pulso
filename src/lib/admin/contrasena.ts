import { fallasDeContrasena } from "@/lib/seguridad/validacion";

/**
 * Qué reglas no cumple una contraseña, en español (integrador, punto 7).
 *
 * La usan el formulario del panel (validación en el cliente, en vivo) y la
 * ruta del servidor, con la misma regla del registro (`fallasDeContrasena`);
 * la base la vuelve a validar con `pulso_contrasena_valida`. Lista vacía =
 * cumple.
 *
 * `email` es el correo del usuario al que se le cambia: la regla rechaza una
 * contraseña que lo contenga. Lo pasa el formulario, que lo muestra; el
 * servidor y la base aplican el resto de las reglas, porque la base solo
 * guarda el correo cifrado.
 */
export function problemasContrasena(password: string, email?: string | null): string[] {
  return [...new Set(fallasDeContrasena(password, email).map((f) => f.texto))];
}
