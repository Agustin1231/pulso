"use client";

import { Check, Circle, X } from "lucide-react";
import { reglasContrasena } from "@/lib/seguridad/contrasena";

/**
 * Regla de contraseñas con check en vivo (integrador, punto 13), para crear
 * la cuenta, restablecer y cambiar la contraseña. Es solo una guía: el
 * servidor y la base aplican la misma regla (src/lib/seguridad/contrasena.ts y
 * `pulso_contrasena_fallas`) y explican lo que falte.
 *
 * Con `email`, incluye "que no contenga tu correo"; sin él (al restablecer, el
 * formulario no sabe de qué cuenta es) esa la revisa solo el servidor.
 */
export function ReglasContrasena({ password, email }: { password: string; email?: string | null }) {
  const reglas = reglasContrasena(password, email);
  const vacia = password.length === 0;

  return (
    <ul aria-label="Requisitos de la contraseña" className="space-y-1 rounded-lg border border-border bg-surface-2/50 p-2.5">
      {reglas.map((r) => {
        // Vacía, las reglas del tipo "sin…" se cumplirían solas: se muestran neutras.
        const estado = vacia ? "pendiente" : r.cumple ? "cumple" : "falta";
        const Icono = estado === "cumple" ? Check : estado === "falta" ? X : Circle;
        return (
          <li
            key={r.id}
            className={`flex items-start gap-1.5 text-[11px] leading-snug ${
              estado === "cumple" ? "text-teal" : estado === "falta" ? "text-coral" : "text-muted-foreground"
            }`}
          >
            <Icono className={`mt-px shrink-0 ${estado === "pendiente" ? "h-2.5 w-2.5 m-0.5" : "h-3.5 w-3.5"}`} aria-hidden />
            <span>
              {r.texto}
              <span className="sr-only">{estado === "cumple" ? " (cumple)" : estado === "falta" ? " (falta)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
