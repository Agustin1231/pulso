"use server";

import { lectura, SIN_ENTRADA } from "@/lib/seguridad/accion";
import type { Informe } from "@/lib/ml/tipos";
import { calcularInforme } from "./calculo-informe";

/**
 * Informe del motor de predicción para el usuario de la sesión. Antes recibía
 * el uid, así que cualquiera podía pedir el informe de salud de otro.
 * Devuelve null si no hay sesión o algo falla.
 */
export async function getInforme(): Promise<Informe | null> {
  return lectura("informe.ver", null, SIN_ENTRADA, null, ({ db, uid }) => calcularInforme(db, uid));
}
