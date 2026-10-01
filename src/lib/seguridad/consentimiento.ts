import "server-only";
import type { Db } from "@/lib/db/pool";

/**
 * Consentimiento para mandar datos de salud a la IA (plantilla, fila 3; Ley
 * 1581 de 2012, art. 6: los datos de salud son sensibles y su tratamiento
 * necesita autorización explícita).
 *
 * Qué cubre: las métricas, el perfil y el informe del motor que viajan a
 * Anthropic (Claude) en el análisis, el score, los tips y las rutinas. No
 * cubre recetas ni mercado, que solo mandan ingredientes.
 *
 * Si cambia el texto que ve el usuario, hay que subir la versión: el
 * consentimiento dado a otra versión deja de valer.
 */
export const VERSION_CONSENTIMIENTO_IA = "2026-10-01";

export async function tieneConsentimientoIA(db: Db, uid: string): Promise<boolean> {
  const { rows } = await db.query<{ vigente: boolean }>(
    `select exists (
       select 1 from consentimientos
        where uid = $1 and tipo = 'ia_datos_salud'
          and version = $2 and revocado_at is null
     ) as vigente`,
    [uid, VERSION_CONSENTIMIENTO_IA]
  );
  return rows[0]?.vigente ?? false;
}
