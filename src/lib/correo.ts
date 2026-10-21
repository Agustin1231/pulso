import "server-only";
import { after } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";
import { mensajeError } from "@/lib/db/pool";

/**
 * Correos de la cuenta (activación y recuperación) por SMTP.
 *
 * Variables: SMTP_HOST, SMTP_PORT (465 = TLS directo, otro = STARTTLS),
 * SMTP_USER, SMTP_PASS y, opcional, SMTP_FROM. Con Gmail, SMTP_PASS es una
 * contraseña de aplicación, no la de la cuenta.
 *
 * Los enlaces se arman con APP_URL y nunca con el Host de la petición: ese
 * header lo elige el cliente, y con él alguien podría pedir una recuperación
 * para otra persona y hacer que el enlace (con el token) apunte a su dominio.
 */

export interface Correo {
  asunto: string;
  texto:  string;
  html:   string;
}

let transporte: Transporter | null = null;

function obtenerTransporte(): Transporter {
  if (transporte) return transporte;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error("Falta SMTP_HOST, SMTP_USER o SMTP_PASS");
  const puerto = Number(SMTP_PORT ?? 465);
  // Sin TLS solo contra un SMTP de prueba en la misma máquina (Mailpit en desarrollo).
  const local = SMTP_HOST === "localhost" || SMTP_HOST === "127.0.0.1";
  transporte = nodemailer.createTransport({
    host:       SMTP_HOST,
    port:       puerto,
    secure:     puerto === 465,
    requireTLS: puerto !== 465 && !local,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporte;
}

/** URL absoluta de una ruta de la app, a partir de APP_URL. */
export function urlDeLaApp(ruta: string): string {
  const base = process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? null : "http://localhost:3000");
  if (!base) throw new Error("Falta APP_URL");
  return new URL(ruta, base).toString();
}

export async function enviarCorreo(para: string, correo: Correo): Promise<void> {
  const from = process.env.SMTP_FROM ?? `Pulso <${process.env.SMTP_USER}>`;
  await obtenerTransporte().sendMail({ from, to: para, subject: correo.asunto, text: correo.texto, html: correo.html });
}

/**
 * Manda el correo después de responder. La respuesta no espera al SMTP, así
 * que tarda lo mismo haya correo o no: el tiempo no dice si un correo está
 * registrado. Si falla, queda en el log (el usuario puede pedir otro).
 */
export function enviarDespues(para: string, correo: Correo, contexto: string): void {
  after(async () => {
    try {
      await enviarCorreo(para, correo);
    } catch (err) {
      console.error(`[correo] ${contexto}:`, mensajeError(err));
    }
  });
}

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function armar(asunto: string, parrafos: string[], enlace: { texto: string; url: string }, cierre: string): Correo {
  const texto = [...parrafos, enlace.url, cierre].join("\n\n");
  const p = (t: string) => `<p style="margin:0 0 16px">${escapar(t)}</p>`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:520px">` +
    parrafos.map(p).join("") +
    `<p style="margin:0 0 16px"><a href="${escapar(enlace.url)}" style="display:inline-block;background:#ff6b6b;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px">${escapar(enlace.texto)}</a></p>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#555">Si el botón no funciona, copia este enlace en el navegador:<br>${escapar(enlace.url)}</p>` +
    `<p style="margin:0;font-size:13px;color:#555">${escapar(cierre)}</p>` +
    `</div>`;
  return { asunto, texto, html };
}

export function correoActivacion(url: string): Correo {
  return armar(
    "Activa tu cuenta de Pulso",
    ["Hola,", "Para activar tu cuenta de Pulso abre este enlace. Sirve una sola vez y vence en 24 horas."],
    { texto: "Activar mi cuenta", url },
    "Si no creaste una cuenta en Pulso, ignora este correo."
  );
}

export function correoRecuperacion(url: string): Correo {
  return armar(
    "Restablece tu contraseña de Pulso",
    ["Hola,", "Pediste crear una contraseña nueva para tu cuenta de Pulso. El enlace sirve una sola vez y vence en 1 hora."],
    { texto: "Crear contraseña nueva", url },
    "Si no lo pediste, ignora este correo. Tu contraseña sigue igual."
  );
}

/** Alguien intentó registrarse con un correo que ya tiene cuenta: se le avisa al dueño, no al que lo intentó. */
export function correoYaRegistrado(url: string): Correo {
  return armar(
    "Ya tienes una cuenta en Pulso",
    [
      "Hola,",
      "Alguien intentó crear una cuenta en Pulso con este correo, pero ya tiene una. Si fuiste tú, inicia sesión. Si no recuerdas la contraseña, en esa misma pantalla puedes pedir una nueva.",
    ],
    { texto: "Iniciar sesión", url },
    "Si no fuiste tú, ignora este correo. Nadie entró a tu cuenta."
  );
}
