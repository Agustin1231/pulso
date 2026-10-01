"use server";

import { escritura, lectura, SIN_ENTRADA } from "@/lib/seguridad/accion";
import { perfilSchema } from "@/lib/seguridad/validacion";
import { perfilDe } from "./consultas";
import type { PerfilRow, PerfilFormData } from "./types";

/** Perfil anónimo del usuario de la sesión, o null si nunca lo completó. */
export async function getPerfil(): Promise<PerfilRow | null> {
  return lectura("perfil.ver", null, SIN_ENTRADA, null, ({ db, uid }) => perfilDe(db, uid));
}

/** Crea o actualiza el perfil (una fila por uid). */
export async function guardarPerfil(data: PerfilFormData): Promise<{ error: string | null }> {
  return escritura("perfil.guardar", perfilSchema, data, async ({ db, uid, auditar }, d) => {
    await db.query(
      `insert into perfil (uid, edad, sexo, altura_cm, fumador, actualizado_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (uid) do update
         set edad = excluded.edad,
             sexo = excluded.sexo,
             altura_cm = excluded.altura_cm,
             fumador = excluded.fumador,
             actualizado_at = now()`,
      [uid, d.edad, d.sexo, d.altura_cm, d.fumador]
    );
    await auditar({ accion: "perfil.guardar", recurso: "perfil" });
    return null;
  });
}
