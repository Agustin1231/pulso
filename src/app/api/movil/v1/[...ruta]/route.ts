import { getConsentimientoIA, otorgarConsentimientoIA, revocarConsentimientoIA } from "@/lib/db/consentimiento";
import {
  crearHabitoDefinicion,
  editarHabitoDefinicion,
  eliminarHabitoDefinicion,
  getHabitosDefinicion,
  getHabitosFecha,
  getHabitosSemana,
  toggleHabitoFijo,
  toggleHabitoRegistro,
} from "@/lib/db/habitos";
import { getInforme } from "@/lib/db/informe";
import { eliminarListaMercado, getListasMercado, guardarListaMercado } from "@/lib/db/mercado";
import { getHistorialMetrica, getUltimasMetricas, guardarMetrica } from "@/lib/db/metricas";
import { mensajeError } from "@/lib/db/pool";
import { getPerfil, guardarPerfil } from "@/lib/db/perfil";
import { calificarReceta, eliminarReceta, getRecetasGuardadas, guardarReceta } from "@/lib/db/recetas";
import { eliminarRutina, getRutinasGuardadas, guardarRutina } from "@/lib/db/rutinas";
import { estadoSesion, uidDeSesion } from "@/lib/sesion";
import {
  ERROR_BLOQUEADA,
  ERROR_CUOTA,
  ERROR_DATOS,
  ERROR_LIMITE,
  ERROR_NO_ENCONTRADO,
  ERROR_SESION,
} from "@/lib/seguridad/accion";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipCliente, origenValido } from "@/lib/seguridad/red";
import { CuerpoDemasiadoGrande, json, leerJson } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

/**
 * API REST de la app nativa: `/api/movil/v1/...`.
 *
 * La web lee y escribe con server actions, que solo se pueden invocar desde el
 * propio bundle de Next (el id de cada acción cambia en cada build). Esta ruta
 * expone esas MISMAS acciones como REST, sin reimplementar nada: la validación
 * zod, la sesión, el RLS y la auditoría siguen siendo los de `lib/db` y
 * `lib/seguridad/accion`. Lo único que agrega es el mapeo a códigos HTTP.
 *
 * Las rutas de IA (`/api/recetas`, `/api/rutinas`, ...) y las imágenes
 * (`/api/img/...`) la app las usa tal cual: ya son route handlers y aceptan
 * el Bearer desde `lib/sesion`.
 */

type Params = { params: Promise<{ ruta: string[] }> };
type Cuerpo = Record<string, unknown>;
type Manejador = (c: { cuerpo: Cuerpo; query: URLSearchParams; id?: string }) => Promise<Response>;

/**
 * Tope del cuerpo de esta API: el más grande válido (una rutina con 60
 * ejercicios) no llega a 100 KB. Más chico que el 1 MB general (AM-21).
 */
const MAX_CUERPO_MOVIL = 256 * 1024;

/** `{ error }` de una escritura → respuesta HTTP. */
function escrita({ error }: { error: string | null }): Response {
  if (!error) return json({ ok: true });
  const [status, codigo] =
    error === ERROR_DATOS         ? [400, "datos_invalidos"] :
    error === ERROR_SESION        ? [401, "sesion_requerida"] :
    error === ERROR_NO_ENCONTRADO ? [404, "no_encontrado"] :
    error === ERROR_CUOTA         ? [409, "cuota_excedida"] :
    error === ERROR_BLOQUEADA     ? [423, "sesion_bloqueada"] :
    error === ERROR_LIMITE        ? [429, "demasiadas_peticiones"] :
                                    [500, "error_interno"];
  return json({ error: codigo, mensaje: error }, status, status === 429 ? { "Retry-After": "3600" } : undefined);
}

const n = (v: unknown) => v as never; // la acción valida con zod; acá no se confía en el tipo

// Clave: "MÉTODO recurso[/:id]". Los recursos con id llevan `:id` al final.
const MANEJADORES: Record<string, Manejador> = {
  // Métricas
  "GET metricas/ultimas":   async () => json(await getUltimasMetricas()),
  "GET metricas/historial": async ({ query }) =>
    json(await getHistorialMetrica(n(query.get("tipo")), Number(query.get("dias") ?? 30))),
  "POST metricas":          async ({ cuerpo }) =>
    escrita(await guardarMetrica(n(cuerpo.tipo), n(cuerpo.valor), n(cuerpo.notas ?? undefined))),

  // Motor de predicción
  "GET informe": async () => json(await getInforme()),

  // Perfil
  "GET perfil": async () => json(await getPerfil()),
  "PUT perfil": async ({ cuerpo }) => escrita(await guardarPerfil(n(cuerpo))),

  // Consentimiento para mandar datos de salud a la IA
  "GET consentimiento":    async () => json({ otorgado: await getConsentimientoIA() }),
  "POST consentimiento":   async () => escrita(await otorgarConsentimientoIA()),
  "DELETE consentimiento": async () => escrita(await revocarConsentimientoIA()),

  // Recetas
  "GET recetas":        async () => json(await getRecetasGuardadas()),
  "POST recetas":       async ({ cuerpo }) =>
    escrita(await guardarReceta(n(cuerpo.titulo), n(cuerpo.contenido), n(cuerpo.imagen_url ?? null), n(cuerpo.ingredientes ?? []))),
  "PATCH recetas/:id":  async ({ cuerpo, id }) => escrita(await calificarReceta(n(id), n(cuerpo.calificacion))),
  "DELETE recetas/:id": async ({ id }) => escrita(await eliminarReceta(n(id))),

  // Mercado
  "GET mercado":        async () => json(await getListasMercado()),
  "POST mercado":       async ({ cuerpo }) =>
    escrita(await guardarListaMercado(n(cuerpo.nombre), n(cuerpo.periodo), n(cuerpo.contenido))),
  "DELETE mercado/:id": async ({ id }) => escrita(await eliminarListaMercado(n(id))),

  // Rutinas
  "GET rutinas":        async () => json(await getRutinasGuardadas()),
  "POST rutinas":       async ({ cuerpo }) => escrita(await guardarRutina(n(cuerpo.nombre), n(cuerpo.contenido))),
  "DELETE rutinas/:id": async ({ id }) => escrita(await eliminarRutina(n(id))),

  // Hábitos
  "GET habitos/definiciones":        async () => json(await getHabitosDefinicion()),
  "POST habitos/definiciones":       async ({ cuerpo }) => escrita(await crearHabitoDefinicion(n(cuerpo))),
  "PUT habitos/definiciones/:id":    async ({ cuerpo, id }) => escrita(await editarHabitoDefinicion(n(id), n(cuerpo))),
  "DELETE habitos/definiciones/:id": async ({ id }) => escrita(await eliminarHabitoDefinicion(n(id))),
  "GET habitos/fecha":  async ({ query }) => json(await getHabitosFecha(n(query.get("fecha")))),
  "GET habitos/semana": async ({ query }) => json(await getHabitosSemana(n(query.get("desde")), n(query.get("hasta")))),
  "PUT habitos/fijos":    async ({ cuerpo }) =>
    escrita(await toggleHabitoFijo(n(cuerpo.fecha), n(cuerpo.tipo), n(cuerpo.completado))),
  "PUT habitos/registro": async ({ cuerpo }) =>
    escrita(await toggleHabitoRegistro(n(cuerpo.fecha), n(cuerpo.tipo), n(cuerpo.refId), n(cuerpo.completado))),
};

// La clave se arma con los segmentos de la URL, que elige el cliente. Un Map
// solo devuelve sus propias entradas: indexar un objeto literal también
// alcanzaría lo heredado (`constructor`, `__proto__`, …) (SAST-BE-13).
const RUTAS = new Map<string, Manejador>(Object.entries(MANEJADORES));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolver(metodo: string, ruta: string[]): { fn: Manejador; id?: string } | null {
  const exacta = RUTAS.get(`${metodo} ${ruta.join("/")}`);
  if (exacta) return { fn: exacta };
  const id = ruta.at(-1);
  if (!id || !UUID_RE.test(id)) return null;
  const conId = RUTAS.get(`${metodo} ${[...ruta.slice(0, -1), ":id"].join("/")}`);
  return conId ? { fn: conId, id } : null;
}

async function manejar(metodo: string, req: Request, { params }: Params): Promise<Response> {
  const ip = await ipCliente();
  const { ruta = [] } = await params;
  const accion = `movil.${metodo.toLowerCase()}.${ruta.filter((s) => !UUID_RE.test(s)).join(".")}`;

  const destino = resolver(metodo, ruta);
  if (!destino) return json({ error: "no_encontrado" }, 404);

  if (!(await origenValido())) {
    await auditar({ accion, resultado: "denegado", ip, detalle: { motivo: "origen_no_permitido" } });
    return json({ error: "origen_no_permitido" }, 403);
  }

  try {
    // Las acciones devuelven vacío sin sesión (así lo espera la web); la app
    // necesita distinguir "no hay datos" de "no hay sesión".
    if (!(await uidDeSesion())) {
      const { estado } = await estadoSesion();
      const [status, motivo] = estado === "bloqueada" ? [423, "sesion_bloqueada"] : [401, "sesion_requerida"];
      await auditar({ accion, resultado: "denegado", ip, detalle: { motivo } });
      return json({ error: motivo }, status);
    }

    // El cuerpo se lee con tope de tamaño (SAST-BE-10): `req.json()` junta lo que llegue.
    const hayCuerpo = metodo !== "GET" && metodo !== "DELETE";
    let crudo: unknown = {};
    if (hayCuerpo) {
      try {
        crudo = await leerJson(req, MAX_CUERPO_MOVIL);
      } catch (err) {
        if (!(err instanceof CuerpoDemasiadoGrande)) throw err;
        await auditar({ accion, resultado: "denegado", ip, detalle: { motivo: "cuerpo_demasiado_grande" } });
        return json({ error: "cuerpo_demasiado_grande" }, 413);
      }
      if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) {
        return json({ error: "datos_invalidos" }, 400);
      }
    }

    return await destino.fn({ cuerpo: crudo as Cuerpo, query: new URL(req.url).searchParams, id: destino.id });
  } catch (err) {
    console.error(`[api] ${accion}:`, mensajeError(err));
    await auditar({ accion, resultado: "error", ip });
    return json({ error: "error_interno" }, 500);
  }
}

export const GET    = (req: Request, ctx: Params) => manejar("GET", req, ctx);
export const POST   = (req: Request, ctx: Params) => manejar("POST", req, ctx);
export const PUT    = (req: Request, ctx: Params) => manejar("PUT", req, ctx);
export const PATCH  = (req: Request, ctx: Params) => manejar("PATCH", req, ctx);
export const DELETE = (req: Request, ctx: Params) => manejar("DELETE", req, ctx);
