"use server";

import { escritura, lectura, SIN_ENTRADA } from "@/lib/seguridad/accion";
import { perfilSchema } from "@/lib/seguridad/validacion";
import { perfilDe, salud } from "./consultas";
import type { PerfilRow, PerfilFormData } from "./types";

/** Perfil anónimo del usuario de la sesión, o null si nunca lo completó. */
export async function getPerfil(): Promise<PerfilRow | null> {
  return lectura("perfil.ver", null, SIN_ENTRADA, null, ({ db, uid }) => perfilDe(db, uid));
}

/**
 * Crea o actualiza el perfil (una fila por uid). Los cuatro campos se guardan
 * cifrados (integrador, punto 19); los rangos que antes controlaba la base
 * (edad 18–120, altura 100–250, sexo m/f/otro) los controla `perfilSchema`.
 */
export async function guardarPerfil(data: PerfilFormData): Promise<{ error: string | null }> {
  return escritura("perfil.guardar", perfilSchema, data, async ({ db, uid, auditar }, d) => {
    const c = salud.cifrarPerfil(d);
    await db.query(
      `insert into perfil (uid, edad_cifrado, sexo_cifrado, altura_cm_cifrado, fumador_cifrado, actualizado_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (uid) do update
         set edad_cifrado = excluded.edad_cifrado,
             sexo_cifrado = excluded.sexo_cifrado,
             altura_cm_cifrado = excluded.altura_cm_cifrado,
             fumador_cifrado = excluded.fumador_cifrado,
             actualizado_at = now()`,
      [uid, c.edad_cifrado, c.sexo_cifrado, c.altura_cm_cifrado, c.fumador_cifrado]
    );
    await auditar({ accion: "perfil.guardar", recurso: "perfil" });
    return null;
  });
}
