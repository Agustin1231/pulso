import type { ConfigSesion, MotivoFin } from "@/hooks/use-sesion";

/** "1 minuto", "30 minutos", "2 horas", "1 h 30 min", "180 días". */
export function textoMinutos(minutos: number): string {
  const m = Math.max(1, Math.round(minutos));
  if (m < 60) return `${m} ${m === 1 ? "minuto" : "minutos"}`;
  if (m % 1440 === 0) return `${m / 1440} ${m === 1440 ? "día" : "días"}`;
  if (m % 60 === 0) return `${m / 60} ${m === 60 ? "hora" : "horas"}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** "Pasó 1 minuto" / "Pasaron 30 minutos" (con "más de" en el medio si hace falta). */
function pasaron(minutos: number, masDe = false): string {
  const tiempo = textoMinutos(minutos);
  const singular = /^1 (minuto|hora|día)$/.test(tiempo);
  return `${singular ? "Pasó" : "Pasaron"} ${masDe ? "más de " : ""}${tiempo}`;
}

/**
 * Lo que /acceso le explica al usuario cuando su sesión anterior terminó
 * (integrador, punto 16 y los demás). `config` son los tiempos vigentes, para
 * decir cuánto era el límite.
 */
export function mensajeMotivo(motivo: MotivoFin, config: ConfigSesion | null): { titulo: string; texto: string } {
  switch (motivo) {
    case "otro_inicio":
      return {
        titulo: "Iniciaste sesión en otro navegador",
        texto: "Tu cuenta solo puede tener una sesión abierta a la vez, así que cerramos esta. Si no fuiste tú, entra y cambia tu contraseña.",
      };
    case "inactividad":
      return {
        titulo: "Tu sesión se cerró por inactividad",
        texto: config
          ? `${pasaron(config.sesionMinutos)} sin que usaras Pulso. Vuelve a entrar para seguir.`
          : "Pasó demasiado tiempo sin que usaras Pulso. Vuelve a entrar para seguir.",
      };
    case "vencida":
      return {
        titulo: "Tu sesión venció",
        texto: config
          ? `${pasaron(config.tokenMinutos, true)} sin que este navegador usara tu sesión, y el acceso venció. Vuelve a entrar.`
          : "Pasó demasiado tiempo sin que este navegador usara tu sesión, y el acceso venció. Vuelve a entrar.",
      };
    case "contrasena":
      return {
        titulo: "Se cambió la contraseña de tu cuenta",
        texto: "Por seguridad, cerramos las sesiones abiertas. Entra con la contraseña nueva; si no fuiste tú, usa \"Olvidé mi contraseña\".",
      };
    case "admin":
      return {
        titulo: "Un administrador cerró tu sesión",
        texto: "Un administrador cambió el acceso a tu cuenta (por ejemplo, tu contraseña). Vuelve a entrar con los datos que te indicó.",
      };
    case "cierre":
      return {
        titulo: "Se cerró la sesión",
        texto: "Cerraste sesión en otra pestaña o ventana de este navegador.",
      };
  }
}
