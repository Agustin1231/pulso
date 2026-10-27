import { contrasenaSchema } from "@/lib/seguridad/validacion";

/**
 * Qué reglas no cumple una contraseña, en español (integrador, punto 7).
 *
 * La usan el formulario del panel (validación en el cliente, en vivo) y la
 * ruta del servidor, con el mismo `contrasenaSchema` del registro; la base la
 * vuelve a validar con `pulso_contrasena_valida`. Lista vacía = cumple.
 *
 * C4: cuando esté `reglasContrasena` (src/lib/seguridad/contrasena.ts), esta
 * función pasa a devolver sus mensajes de las reglas que fallan.
 */
export function problemasContrasena(password: string): string[] {
  const r = contrasenaSchema.safeParse(password);
  if (r.success) return [];
  const mensajes = r.error.issues.map((i) => {
    if (i.code === "too_small") return `Tiene que tener al menos ${String(i.minimum)} caracteres.`;
    if (i.code === "too_big")   return `Tiene que tener como máximo ${String(i.maximum)} caracteres.`;
    if (i.code === "invalid_type") return "Escribe una contraseña.";
    const m = i.message.trim();
    return m ? m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".") : "No cumple las reglas de seguridad.";
  });
  return [...new Set(mensajes)];
}
