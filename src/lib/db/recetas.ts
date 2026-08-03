"use server";

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pool, mensajeError } from "./pool";
import {
  RECETAS_SUBDIR,
  extPorMime,
  rutaDentroDeMedia,
  uidSeguro,
} from "@/lib/media";
import type { RecetaRow } from "./types";

/**
 * Guarda una imagen (data URL base64) en el volumen de medios y devuelve la URL
 * pública servida por /api/img, o null si falla.
 *
 * Antes esto subía a Supabase Storage desde el **browser**. Ahora es una server
 * action: el archivo se escribe en disco, así que no puede correr en el cliente.
 */
export async function uploadRecetaImagen(
  uid:           string,
  base64DataUrl: string
): Promise<string | null> {
  try {
    const [prefix, data] = base64DataUrl.split(",");
    if (!prefix || !data) return null;

    const uidOk = uidSeguro(uid);
    if (!uidOk) {
      console.warn("[db/recetas] uid con formato inválido, no se guarda la imagen");
      return null;
    }

    const mimeType = prefix.split(":")[1]?.split(";")[0] ?? "image/png";
    const ext = extPorMime(mimeType) ?? ".png";
    const nombre = `${Date.now()}${ext}`;

    const destino = rutaDentroDeMedia([RECETAS_SUBDIR, uidOk, nombre]);
    if (!destino) return null;

    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, Buffer.from(data, "base64"));

    return `/api/img/${RECETAS_SUBDIR}/${uidOk}/${nombre}`;
  } catch (err) {
    console.error("[db/recetas] uploadRecetaImagen:", mensajeError(err));
    return null;
  }
}

export async function guardarReceta(
  uid:          string,
  titulo:       string,
  contenido:    string,
  imagen_url:   string | null,
  ingredientes: string[]
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `insert into recetas_guardadas (uid, titulo, contenido, imagen_url, ingredientes)
       values ($1, $2, $3, $4, $5)`,
      [uid, titulo, contenido, imagen_url ?? null, ingredientes]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

export async function getRecetasGuardadas(uid: string): Promise<RecetaRow[]> {
  try {
    const { rows } = await pool.query<RecetaRow>(
      `select * from recetas_guardadas where uid = $1 order by created_at desc`,
      [uid]
    );
    return rows;
  } catch (err) {
    console.error("[db/recetas] getRecetasGuardadas:", mensajeError(err));
    return [];
  }
}

export async function eliminarReceta(id: string): Promise<{ error: string | null }> {
  try {
    await pool.query(`delete from recetas_guardadas where id = $1`, [id]);
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

export async function calificarReceta(
  id:           string,
  calificacion: number
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `update recetas_guardadas set calificacion = $2 where id = $1`,
      [id, calificacion]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}
