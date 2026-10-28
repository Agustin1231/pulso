// Pruebas funcionales de integración de la API REST de la app nativa:
// `/api/movil/v1/*` (src/app/api/movil/v1/[...ruta]/route.ts y sesion/route.ts)
// y `/api/mis-datos`, contra el servidor funcional real con su base Postgres
// descartable. Recorren cada recurso con casos felices, bordes de los
// esquemas zod (validacion.ts) y los códigos que la app mapea a errores
// tipados (400 → DatosInvalidos, 401 → SinSesion, 404 → NoEncontrado, 429 →
// LimiteAlcanzado).
//
//   node --test --test-concurrency=1 tests/funcionales/api-movil.test.mjs
//
// Ver comun.mjs para las variables de entorno. Sin DATABASE_ADMIN_URL se
// saltean solo los casos que preparan datos directo en la base.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import {
  BASE, IP_CORRIDA, METRICA_OK, RANGOS, SALTEAR, SIN_ADMIN,
  admin, escribir, hoy, leer, limpiarIdentidades, limpiarLimitesDe, movil, nuevaIp,
  nuevoToken, rechazo, registrar, sesionMovil, uidDe,
} from "./comun.mjs";

/**
 * Un valor de métrica como lo guarda la app, cifrado (integrador, punto 19),
 * para los casos que cargan historial directo en la base. Necesita la
 * PULSO_CLAVE_DATOS del servidor; el import es dinámico para que el resto de
 * la suite corra igual en un Node sin soporte de .ts.
 */
let salud = null;
async function valorCifrado(valor) {
  if (!salud) {
    const [{ cifrar, descifrar }, { crearCifradoSalud }] = await Promise.all([
      import("../../src/lib/seguridad/cifrado.ts"),
      import("../../src/lib/db/salud-cifrada.ts"),
    ]);
    salud = crearCifradoSalud({ cifrar, descifrar });
  }
  return salud.cifrarMetrica(valor, null).valor_cifrado;
}

before(async () => {
  // Que la IP de esta corrida empiece con el cupo entero aunque se repita.
  await limpiarLimitesDe(IP_CORRIDA);
});
after(limpiarIdentidades);

// ─── M01 · Sesión anónima ─────────────────────────────────────────────────────

describe("M01 sesión anónima por Bearer", { skip: SALTEAR }, () => {
  test("POST sin Bearer crea una identidad: token de 43 caracteres, sin uid y sin cookies", async () => {
    const { status, cuerpo, res } = await sesionMovil();
    registrar(cuerpo?.token);
    assert.equal(status, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.origen, "nueva");
    assert.match(cuerpo.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(cuerpo.uid, undefined, "el uid no sale del servidor");
    assert.deepEqual(cuerpo.bloqueo, { activo: false, bloqueada: false });
    assert.equal(res.headers.getSetCookie().length, 0, "la sesión móvil no pone cookies");
  });

  test("POST con el Bearer vigente renueva sin crear otra identidad ni cambiar el token", async () => {
    const token = await nuevoToken();
    const { status, cuerpo } = await sesionMovil({ token });
    assert.equal(status, 200);
    assert.equal(cuerpo.origen, "existente");
    assert.equal(cuerpo.token, token);
  });

  test("GET informa el estado sin renovar: activa con Bearer; sin_sesion sin él, inventado o mal formado", async () => {
    const token = await nuevoToken();
    const estado = async (auth) =>
      (await fetch(`${BASE}/api/movil/v1/sesion`, { headers: auth ? { Authorization: auth } : {} })).json();
    assert.deepEqual(await estado(`Bearer ${token}`), { estado: "activa", bloqueo: { activo: false, bloqueada: false }, motivo: null });
    assert.equal((await estado(null)).estado, "sin_sesion");
    assert.equal((await estado(`Bearer ${"A".repeat(43)}`)).estado, "sin_sesion");
    assert.equal((await estado(`Bearer corto`)).estado, "sin_sesion");
    assert.equal((await estado(`Basic ${token}`)).estado, "sin_sesion", "solo el esquema Bearer");
  });

  test("DELETE cierra la sesión del teléfono: el token deja de servir y los datos quedan en el servidor", async () => {
    const token = await nuevoToken();
    await escribir("POST", "metricas", token, { tipo: "peso", valor: 70 });
    const res = await fetch(`${BASE}/api/movil/v1/sesion`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": IP_CORRIDA },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    await rechazo(movil("GET", "metricas/ultimas", token), 401, "sesion_requerida", "token revocado");
    const est = await (await fetch(`${BASE}/api/movil/v1/sesion`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(est.estado, "sin_sesion");
  });

  test("Origin de otro sitio en la sesión: 403 origen_no_permitido", async () => {
    const res = await fetch(`${BASE}/api/movil/v1/sesion`, {
      method: "POST", headers: { Origin: "https://evil.example", "X-Forwarded-For": IP_CORRIDA },
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "origen_no_permitido");
  });

  test("límite de sesiones nuevas: 30 por hora por IP; la 31.ª da 429 con Retry-After y renovar no cuenta", { skip: SIN_ADMIN }, async () => {
    const ip = nuevaIp();
    await limpiarLimitesDe(ip);
    const tokens = [];
    for (let i = 0; i < 30; i++) {
      const { status, cuerpo } = await sesionMovil({ ip });
      assert.equal(status, 200, `la sesión ${i + 1} tenía que crearse`);
      tokens.push(registrar(cuerpo.token));
    }
    const { status, cuerpo, res } = await sesionMovil({ ip });
    assert.equal(status, 429);
    assert.equal(cuerpo.error, "demasiadas_peticiones");
    assert.equal(res.headers.get("retry-after"), "3600");
    // Renovar una sesión existente desde la misma IP no consume el límite.
    const renovada = await sesionMovil({ ip, token: tokens[0] });
    assert.equal(renovada.status, 200);
    assert.equal(renovada.cuerpo.origen, "existente");
  });
});

// ─── M02 · Métricas ───────────────────────────────────────────────────────────

describe("M02 registro de métricas", { skip: SALTEAR }, () => {
  test("registra los cuatro tipos de la app y la unidad la pone el servidor", async () => {
    const token = await nuevoToken();
    for (const [tipo, valor] of Object.entries(METRICA_OK)) {
      await escribir("POST", "metricas", token, { tipo, valor, notas: `nota ${tipo}` });
    }
    const ultimas = await leer("metricas/ultimas", token);
    assert.equal(ultimas.length, 4);
    for (const m of ultimas) {
      assert.equal(m.valor, METRICA_OK[m.tipo]);
      assert.equal(m.unidad, RANGOS[m.tipo].unidad, `unidad de ${m.tipo}`);
      assert.equal(m.notas, `nota ${m.tipo}`);
      assert.match(m.id, /^[0-9a-f-]{36}$/);
      assert.ok(!Number.isNaN(Date.parse(m.created_at)));
    }
    // El más reciente primero (la app elige ese para la gráfica).
    assert.equal(ultimas[0].tipo, "nivel_estres");
  });

  test("bordes inclusive de cada rango: el mínimo y el máximo se aceptan", async () => {
    const token = await nuevoToken();
    for (const [tipo, { min, max }] of Object.entries(RANGOS)) {
      await escribir("POST", "metricas", token, { tipo, valor: min });
      await escribir("POST", "metricas", token, { tipo, valor: max });
    }
    const ultimas = await leer("metricas/ultimas", token);
    for (const m of ultimas) assert.equal(m.valor, RANGOS[m.tipo].max, "el upsert del día dejó el último valor");
  });

  test("fuera de rango por debajo o por encima: 400 datos_invalidos", async () => {
    const token = await nuevoToken();
    const casos = [
      ["frecuencia_cardiaca", 29], ["frecuencia_cardiaca", 221], ["frecuencia_cardiaca", 999],
      ["peso", 19.9], ["peso", 300.1], ["horas_sueno", -0.5], ["horas_sueno", 24.5],
      ["nivel_estres", 0], ["nivel_estres", 11],
    ];
    for (const [tipo, valor] of casos) {
      await rechazo(movil("POST", "metricas", token, { tipo, valor }), 400, "datos_invalidos", `${tipo}=${valor}`);
    }
    assert.deepEqual(await leer("metricas/ultimas", token), [], "nada quedó guardado");
  });

  test("tipo desconocido, valor no numérico o ausente y notas de más de 500 caracteres: 400", async () => {
    const token = await nuevoToken();
    for (const cuerpo of [
      { tipo: "colesterol_ldl", valor: 100 },
      { tipo: "FRECUENCIA_CARDIACA", valor: 70 },
      { tipo: "frecuencia_cardiaca", valor: "70" },
      { tipo: "frecuencia_cardiaca", valor: null },
      { tipo: "frecuencia_cardiaca" },
      { valor: 70 },
      { tipo: "frecuencia_cardiaca", valor: 70, notas: "x".repeat(501) },
    ]) {
      await rechazo(movil("POST", "metricas", token, cuerpo), 400, "datos_invalidos", JSON.stringify(cuerpo).slice(0, 80));
    }
    // 500 caracteres justos sí entran.
    await escribir("POST", "metricas", token, { tipo: "frecuencia_cardiaca", valor: 70, notas: "x".repeat(500) });
  });

  test("las métricas que solo usa el motor (presión, glucosa, colesterol) también se validan por rango", async () => {
    const token = await nuevoToken();
    await escribir("POST", "metricas", token, { tipo: "presion_sistolica", valor: 120 });
    await escribir("POST", "metricas", token, { tipo: "glucosa", valor: 95 });
    await rechazo(movil("POST", "metricas", token, { tipo: "presion_diastolica", valor: 200 }), 400, "datos_invalidos");
  });

  test("upsert del día: dos registros del mismo tipo dejan uno solo con el último valor", async () => {
    const token = await nuevoToken();
    await escribir("POST", "metricas", token, { tipo: "frecuencia_cardiaca", valor: 80 });
    await escribir("POST", "metricas", token, { tipo: "frecuencia_cardiaca", valor: 66, notas: "corregido" });
    const hist = await leer("metricas/historial?tipo=frecuencia_cardiaca&dias=30", token);
    assert.equal(hist.length, 1);
    assert.equal(hist[0].valor, 66);
    assert.equal(hist[0].notas, "corregido");
  });

  test("historial: solo el tipo pedido, en orden ascendente y dentro de la ventana de días", { skip: SIN_ADMIN }, async () => {
    const token = await nuevoToken();
    const uid = await uidDe(token);
    for (const dias of [20, 10, 3]) {
      await admin().query(
        "insert into metricas (uid, tipo, valor_cifrado, unidad, created_at) values ($1, 'peso', $2, 'kg', now() - make_interval(days => $3))",
        [uid, await valorCifrado(80 - dias / 10), dias]
      );
    }
    await escribir("POST", "metricas", token, { tipo: "frecuencia_cardiaca", valor: 70 });
    const todo = await leer("metricas/historial?tipo=peso&dias=30", token);
    assert.equal(todo.length, 3);
    assert.deepEqual(todo.map((m) => m.valor), [78, 79, 79.7], "orden cronológico");
    assert.equal((await leer("metricas/historial?tipo=peso&dias=7", token)).length, 1);
    assert.ok(todo.every((m) => m.tipo === "peso"));
  });

  test("historial con tipo o días inválidos: 200 con lista vacía (las lecturas no exponen errores de validación)", async () => {
    const token = await nuevoToken();
    await escribir("POST", "metricas", token, { tipo: "peso", valor: 70 });
    for (const q of ["tipo=desconocido&dias=30", "tipo=peso&dias=0", "tipo=peso&dias=366", "tipo=peso&dias=abc", "tipo=peso&dias=1.5", "dias=30"]) {
      assert.deepEqual(await leer(`metricas/historial?${q}`, token), [], q);
    }
    // Sin `dias` vale 30, como en la app.
    assert.equal((await leer("metricas/historial?tipo=peso", token)).length, 1);
  });
});

// ─── M03 · Informe del motor ──────────────────────────────────────────────────

describe("M03 informe del motor de predicción", { skip: SALTEAR }, () => {
  test("sin métricas: estructura completa con riesgo 'Sin datos' y sin pronósticos", async () => {
    const token = await nuevoToken();
    const inf = await leer("informe", token);
    assert.match(inf.generadoEn, /^\d{4}-\d{2}-\d{2}/);
    assert.equal(inf.horizonte, 30);
    assert.deepEqual(inf.metricas, {});
    assert.deepEqual(inf.cobertura, { dias: 0, porMetrica: {} });
    assert.equal(inf.riesgo.score, null);
    assert.equal(inf.riesgo.etiqueta, "Sin datos");
    assert.equal(inf.riesgo.insuficiente, true);
    assert.ok(Array.isArray(inf.riesgo.factores) && inf.riesgo.factores.length >= 4);
    assert.ok(inf.riesgo.factores.every((f) => f.estado === "sin-datos"));
    assert.equal(inf.proyeccion.horizonteDias, 30);
    assert.ok(Array.isArray(inf.limitaciones));
  });

  test("con un registro por métrica: cobertura.porMetrica es un objeto de números 0..1 y hay score", async () => {
    const token = await nuevoToken();
    for (const [tipo, valor] of Object.entries(METRICA_OK)) await escribir("POST", "metricas", token, { tipo, valor });
    const inf = await leer("informe", token);
    assert.deepEqual(Object.keys(inf.metricas).sort(), Object.keys(METRICA_OK).sort());
    for (const [tipo, c] of Object.entries(inf.cobertura.porMetrica)) {
      assert.equal(typeof c, "number", `porMetrica.${tipo}`);
      assert.ok(c >= 0 && c <= 1, `porMetrica.${tipo}=${c}`);
    }
    assert.equal(typeof inf.riesgo.score, "number");
    assert.ok(inf.riesgo.score >= 0 && inf.riesgo.score <= 100);
  });

  test("con 21 días de historial: pronóstico a 30 días con intervalos de 2 valores y modelo elegido", { skip: SIN_ADMIN }, async () => {
    const token = await nuevoToken();
    const uid = await uidDe(token);
    for (let d = 21; d >= 1; d--) {
      await admin().query(
        `insert into metricas (uid, tipo, valor_cifrado, unidad, created_at) values
           ($1, 'frecuencia_cardiaca', $2, 'bpm', now() - make_interval(days => $4)),
           ($1, 'horas_sueno', $3, 'h', now() - make_interval(days => $4))`,
        [uid, await valorCifrado(68 + (d % 5)), await valorCifrado(6.5 + (d % 3) * 0.5), d]
      );
    }
    const inf = await leer("informe", token);
    const fc = inf.metricas.frecuencia_cardiaca;
    assert.equal(fc.n, 21);
    assert.equal(fc.pronostico.length, 30);
    for (const p of fc.pronostico) {
      assert.equal(p.ic80.length, 2);
      assert.equal(p.ic95.length, 2);
      assert.ok(p.ic80[0] <= p.media && p.media <= p.ic80[1], "la media está dentro del intervalo");
      assert.match(p.fecha, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.ok(fc.modelo.tabla.some((f) => f.seleccionado), "hay un modelo seleccionado");
    assert.ok(["alta", "media", "baja"].includes(fc.modelo.confianza));
    assert.ok(["sube", "baja", "estable"].includes(fc.tendencia.direccion));
    assert.ok(inf.cobertura.porMetrica.frecuencia_cardiaca > 0 && inf.cobertura.porMetrica.frecuencia_cardiaca <= 1);
  });
});

// ─── M09 · Perfil anónimo ─────────────────────────────────────────────────────

describe("M09 perfil anónimo", { skip: SALTEAR }, () => {
  test("GET sin perfil devuelve null; PUT lo crea y lo actualiza (nulls explícitos)", async () => {
    const token = await nuevoToken();
    assert.equal(await leer("perfil", token), null);
    await escribir("PUT", "perfil", token, { edad: 40, sexo: "f", altura_cm: 165, fumador: false });
    let p = await leer("perfil", token);
    assert.equal(p.edad, 40);
    assert.equal(p.sexo, "f");
    assert.equal(p.altura_cm, 165);
    assert.equal(p.fumador, false);
    assert.ok(p.actualizado_at);
    await escribir("PUT", "perfil", token, { edad: null, sexo: null, altura_cm: null, fumador: null });
    p = await leer("perfil", token);
    assert.deepEqual([p.edad, p.sexo, p.altura_cm, p.fumador], [null, null, null, null]);
  });

  test("bordes: edad 18..120 y altura 100..250 se aceptan; un paso afuera, 400", async () => {
    const token = await nuevoToken();
    const base = { edad: null, sexo: null, altura_cm: null, fumador: null };
    for (const c of [{ edad: 18 }, { edad: 120 }, { altura_cm: 100 }, { altura_cm: 250 }]) {
      await escribir("PUT", "perfil", token, { ...base, ...c });
    }
    for (const c of [{ edad: 17 }, { edad: 121 }, { altura_cm: 99 }, { altura_cm: 251 }, { edad: 30.5 }]) {
      await rechazo(movil("PUT", "perfil", token, { ...base, ...c }), 400, "datos_invalidos", JSON.stringify(c));
    }
  });

  test("sexo fuera de m/f/otro, fumador no booleano o un campo faltante: 400 (los campos son .nullable(), no .optional())", async () => {
    const token = await nuevoToken();
    const ok = { edad: 30, sexo: "m", altura_cm: 170, fumador: true };
    await rechazo(movil("PUT", "perfil", token, { ...ok, sexo: "x" }), 400, "datos_invalidos", "sexo");
    await rechazo(movil("PUT", "perfil", token, { ...ok, fumador: "si" }), 400, "datos_invalidos", "fumador");
    const { fumador, ...sinFumador } = ok;
    await rechazo(movil("PUT", "perfil", token, sinFumador), 400, "datos_invalidos", "campo faltante");
    await rechazo(movil("PUT", "perfil", token, {}), 400, "datos_invalidos", "vacío");
    assert.equal(await leer("perfil", token), null, "nada se guardó");
  });
});

// ─── M11 · Consentimiento ─────────────────────────────────────────────────────

describe("M11 consentimiento para la IA", { skip: SALTEAR }, () => {
  test("ciclo completo: false → otorgar → true → revocar → false; otorgar dos veces es idempotente", async () => {
    const token = await nuevoToken();
    assert.deepEqual(await leer("consentimiento", token), { otorgado: false });
    await escribir("POST", "consentimiento", token, {});
    await escribir("POST", "consentimiento", token, {});
    assert.deepEqual(await leer("consentimiento", token), { otorgado: true });
    await escribir("DELETE", "consentimiento", token);
    assert.deepEqual(await leer("consentimiento", token), { otorgado: false });
    // Revocar sin consentimiento vigente tampoco falla.
    await escribir("DELETE", "consentimiento", token);
  });

  test("POST sin cuerpo responde 400; con `{}` 200 (la app siempre manda `{}`)", async () => {
    const token = await nuevoToken();
    const res = await fetch(`${BASE}/api/movil/v1/consentimiento`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": IP_CORRIDA },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "datos_invalidos");
    await escribir("POST", "consentimiento", token);
  });

  test("queda auditado con el tipo y la versión del texto aceptado", { skip: SIN_ADMIN }, async () => {
    const token = await nuevoToken();
    await escribir("POST", "consentimiento", token, {});
    const { rows } = await admin().query(
      "select version, revocado_at from consentimientos where uid = $1 and tipo = 'ia_datos_salud'", [await uidDe(token)]
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].version, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(rows[0].revocado_at, null);
  });
});

// ─── M05 · Recetas guardadas ──────────────────────────────────────────────────

const recetaValida = (extra = {}) => ({
  titulo: "Ensalada de lentejas",
  contenido: "## Ensalada de lentejas\n\n### Ingredientes\n- Lentejas (200 g)",
  imagen_url: null,
  ingredientes: ["Lentejas", "Tomate"],
  ...extra,
});

describe("M05 recetas guardadas", { skip: SALTEAR }, () => {
  test("crear, listar (más reciente primero) y calificar de 0 a 5", async () => {
    const token = await nuevoToken();
    await escribir("POST", "recetas", token, recetaValida({ titulo: "Primera" }));
    await escribir("POST", "recetas", token, recetaValida({ titulo: "Segunda", imagen_url: "/api/img/recetas/abc_123/foto-1.webp" }));
    const lista = await leer("recetas", token);
    assert.deepEqual(lista.map((r) => r.titulo), ["Segunda", "Primera"]);
    assert.deepEqual(lista[1].ingredientes, ["Lentejas", "Tomate"]);
    assert.equal(lista[1].calificacion, null);
    assert.equal(lista[0].imagen_url, "/api/img/recetas/abc_123/foto-1.webp");
    for (const c of [0, 3, 5]) {
      await escribir("PATCH", `recetas/${lista[0].id}`, token, { calificacion: c });
      assert.equal((await leer("recetas", token))[0].calificacion, c);
    }
  });

  test("calificación fuera de 0..5, decimal, texto o ausente: 400", async () => {
    const token = await nuevoToken();
    await escribir("POST", "recetas", token, recetaValida());
    const [r] = await leer("recetas", token);
    for (const calificacion of [6, -1, 2.5, "5", null, undefined]) {
      await rechazo(movil("PATCH", `recetas/${r.id}`, token, { calificacion }), 400, "datos_invalidos", String(calificacion));
    }
  });

  test("imagen_url solo acepta fotos servidas por la app: externas, data: o con ../ dan 400", async () => {
    const token = await nuevoToken();
    for (const imagen_url of [
      "https://evil.example/foto.png", "data:image/png;base64,AAAA", "/api/img/recetas/../../etc/passwd.png",
      "/api/img/recetas/a/b.gif", "javascript:alert(1)",
    ]) {
      await rechazo(movil("POST", "recetas", token, recetaValida({ imagen_url })), 400, "datos_invalidos", imagen_url);
    }
  });

  test("título vacío o de más de 200, contenido vacío, ingredientes de más (61) o largos (121): 400", async () => {
    const token = await nuevoToken();
    for (const extra of [
      { titulo: "" }, { titulo: "   " }, { titulo: "x".repeat(201) }, { contenido: "" },
      { contenido: "x".repeat(20_001) },
      { ingredientes: Array.from({ length: 61 }, (_, i) => `i${i}`) },
      { ingredientes: ["x".repeat(121)] }, { ingredientes: [""] }, { ingredientes: "tomate" },
    ]) {
      await rechazo(movil("POST", "recetas", token, recetaValida(extra)), 400, "datos_invalidos", JSON.stringify(extra).slice(0, 60));
    }
    // Límites exactos.
    await escribir("POST", "recetas", token, recetaValida({ titulo: "x".repeat(200), ingredientes: Array.from({ length: 60 }, (_, i) => `i${i}`) }));
  });

  test("eliminar: 200 y desaparece; repetir o un id inexistente, 404; un id que no es UUID, 404 de ruta", async () => {
    const token = await nuevoToken();
    await escribir("POST", "recetas", token, recetaValida());
    const [r] = await leer("recetas", token);
    await escribir("DELETE", `recetas/${r.id}`, token);
    assert.deepEqual(await leer("recetas", token), []);
    await rechazo(movil("DELETE", `recetas/${r.id}`, token), 404, "no_encontrado", "repetido");
    await rechazo(movil("DELETE", `recetas/${randomUUID()}`, token), 404, "no_encontrado", "inexistente");
    await rechazo(movil("PATCH", `recetas/${randomUUID()}`, token, { calificacion: 3 }), 404, "no_encontrado", "calificar inexistente");
    await rechazo(movil("DELETE", "recetas/123", token), 404, "no_encontrado", "id no UUID");
    await rechazo(movil("DELETE", "recetas", token), 404, "no_encontrado", "sin id");
  });
});

// ─── M06 · Listas del mercado ─────────────────────────────────────────────────

describe("M06 listas del mercado", { skip: SALTEAR }, () => {
  test("crear semanal y mensual, listar (más reciente primero) y eliminar", async () => {
    const token = await nuevoToken();
    await escribir("POST", "mercado", token, { nombre: "Semana 1", periodo: "semanal", contenido: "### Verduras\n- Espinaca" });
    await escribir("POST", "mercado", token, { nombre: "Octubre", periodo: "mensual", contenido: "### Granos\n- Avena" });
    const listas = await leer("mercado", token);
    assert.deepEqual(listas.map((l) => [l.nombre, l.periodo]), [["Octubre", "mensual"], ["Semana 1", "semanal"]]);
    await escribir("DELETE", `mercado/${listas[0].id}`, token);
    assert.equal((await leer("mercado", token)).length, 1);
    await rechazo(movil("DELETE", `mercado/${listas[0].id}`, token), 404, "no_encontrado", "repetido");
  });

  test("periodo distinto de semanal/mensual, nombre vacío o de 121, contenido de más de 20 000: 400", async () => {
    const token = await nuevoToken();
    const ok = { nombre: "Lista", periodo: "semanal", contenido: "- Avena" };
    for (const extra of [{ periodo: "diario" }, { periodo: "Semanal" }, { nombre: "" }, { nombre: "x".repeat(121) }, { contenido: "x".repeat(20_001) }, { contenido: "" }]) {
      await rechazo(movil("POST", "mercado", token, { ...ok, ...extra }), 400, "datos_invalidos", JSON.stringify(extra).slice(0, 50));
    }
    await escribir("POST", "mercado", token, { ...ok, nombre: "x".repeat(120), contenido: "x".repeat(20_000) });
  });
});

// ─── M07 · Rutinas guardadas ──────────────────────────────────────────────────

const ejercicio = (i = 1, extra = {}) => ({
  bloque: "Parte principal", nombre: `Ejercicio ${i}`, detalle: "3 series × 10 repeticiones", descanso: 30, descripcion: "Técnica.", ...extra,
});
const contenidoRutina = (extra = {}) => ({
  texto: "## Corazón en Marcha\n\n### Parte principal\n1. **Sentadillas** | 3 series × 10 | Descanso: 30 seg",
  nivel: "Activo (ejercicio 2-3 veces por semana)", tiempo: "30", lugar: "Al aire libre", limitacion: "Ninguna limitación",
  ...extra,
});

describe("M07 rutinas guardadas", { skip: SALTEAR }, () => {
  test("guardar con `metricas` omitido, vacío o con valores, y con ejercicios; el contenido vuelve igual", async () => {
    const token = await nuevoToken();
    await escribir("POST", "rutinas", token, { nombre: "Sin métricas", contenido: contenidoRutina() });
    await escribir("POST", "rutinas", token, { nombre: "Métricas vacías", contenido: contenidoRutina({ metricas: {} }) });
    const completa = contenidoRutina({ metricas: { sueno: 6.5, estres: 7 }, ejercicios: [ejercicio(1), ejercicio(2, { descripcion: undefined })] });
    await escribir("POST", "rutinas", token, { nombre: "Completa", contenido: completa });
    const lista = await leer("rutinas", token);
    assert.deepEqual(lista.map((r) => r.nombre), ["Completa", "Métricas vacías", "Sin métricas"]);
    assert.deepEqual(lista[0].contenido.metricas, { sueno: 6.5, estres: 7 });
    assert.equal(lista[0].contenido.ejercicios.length, 2);
    assert.equal(lista[0].contenido.ejercicios[1].descripcion, undefined, "la descripción opcional se omite");
    assert.equal(lista[0].activa, true);
  });

  test("un null explícito en un campo .optional() (metricas.sueno, descripcion) da 400: por eso la app los omite", async () => {
    const token = await nuevoToken();
    await rechazo(movil("POST", "rutinas", token, { nombre: "R", contenido: contenidoRutina({ metricas: { sueno: null, estres: 5 } }) }), 400, "datos_invalidos", "sueno null");
    await rechazo(movil("POST", "rutinas", token, { nombre: "R", contenido: contenidoRutina({ metricas: null }) }), 400, "datos_invalidos", "metricas null");
    await rechazo(movil("POST", "rutinas", token, { nombre: "R", contenido: contenidoRutina({ ejercicios: [ejercicio(1, { descripcion: null })] }) }), 400, "datos_invalidos", "descripcion null");
    await rechazo(movil("POST", "rutinas", token, { nombre: "R", contenido: contenidoRutina({ ejercicios: null }) }), 400, "datos_invalidos", "ejercicios null");
    assert.deepEqual(await leer("rutinas", token), []);
  });

  test("límites de los ejercicios: 60 entran; 61, descanso 3601 o decimal, o nombre de 121 dan 400", async () => {
    const token = await nuevoToken();
    await escribir("POST", "rutinas", token, { nombre: "Sesenta", contenido: contenidoRutina({ ejercicios: Array.from({ length: 60 }, (_, i) => ejercicio(i, { descanso: i === 0 ? 3600 : 0 })) }) });
    for (const ejercicios of [
      Array.from({ length: 61 }, (_, i) => ejercicio(i)),
      [ejercicio(1, { descanso: 3601 })], [ejercicio(1, { descanso: -1 })], [ejercicio(1, { descanso: 1.5 })],
      [ejercicio(1, { nombre: "x".repeat(121) })], [ejercicio(1, { bloque: "x".repeat(61) })],
    ]) {
      await rechazo(movil("POST", "rutinas", token, { nombre: "R", contenido: contenidoRutina({ ejercicios }) }), 400, "datos_invalidos");
    }
    for (const extra of [{ texto: "" }, { texto: "x".repeat(20_001) }, { nivel: "x".repeat(101) }]) {
      await rechazo(movil("POST", "rutinas", token, { nombre: "R", contenido: contenidoRutina(extra) }), 400, "datos_invalidos", Object.keys(extra)[0]);
    }
    await rechazo(movil("POST", "rutinas", token, { nombre: "", contenido: contenidoRutina() }), 400, "datos_invalidos", "nombre vacío");
    await rechazo(movil("POST", "rutinas", token, { nombre: "R" }), 400, "datos_invalidos", "sin contenido");
  });

  test("eliminar es baja lógica: desaparece de la lista, la fila queda inactiva y repetir responde 200 (idempotente)", async () => {
    const token = await nuevoToken();
    await escribir("POST", "rutinas", token, { nombre: "A borrar", contenido: contenidoRutina() });
    const [r] = await leer("rutinas", token);
    await escribir("DELETE", `rutinas/${r.id}`, token);
    assert.deepEqual(await leer("rutinas", token), []);
    if (admin()) {
      const { rows } = await admin().query("select activa from rutinas where id = $1", [r.id]);
      assert.deepEqual(rows, [{ activa: false }]);
    }
    // Observación: la fila sigue existiendo (inactiva) y el UPDATE la vuelve a
    // encontrar, así que repetir el borrado responde 200 (idempotente), a
    // diferencia de recetas y mercado, que borran la fila y responden 404.
    await escribir("DELETE", `rutinas/${r.id}`, token);
    await rechazo(movil("DELETE", `rutinas/${randomUUID()}`, token), 404, "no_encontrado", "inexistente");
  });
});

// ─── M08 · Hábitos ────────────────────────────────────────────────────────────

const habito = (extra = {}) => ({
  nombre: "Caminar", emoji: "🚶", frecuencia: "diario", hora: null, lugar: null, dias_semana: [], dia_mes: null, ...extra,
});

describe("M08 hábitos", { skip: SALTEAR }, () => {
  test("crear diario, semanal y mensual con nulls explícitos; se listan en orden de creación", async () => {
    const token = await nuevoToken();
    await escribir("POST", "habitos/definiciones", token, habito({ hora: "07:30", lugar: "Parque" }));
    await escribir("POST", "habitos/definiciones", token, habito({ nombre: "Yoga", emoji: "🧘", frecuencia: "semanal", dias_semana: ["lunes", "miercoles", "sabado"] }));
    await escribir("POST", "habitos/definiciones", token, habito({ nombre: "Pagar", emoji: "💳", frecuencia: "mensual", dia_mes: 31 }));
    const defs = await leer("habitos/definiciones", token);
    assert.deepEqual(defs.map((d) => d.nombre), ["Caminar", "Yoga", "Pagar"]);
    assert.equal(defs[0].hora, "07:30");
    assert.equal(defs[0].lugar, "Parque");
    assert.deepEqual(defs[1].dias_semana, ["lunes", "miercoles", "sabado"]);
    assert.equal(defs[2].dia_mes, 31);
    assert.ok(defs.every((d) => d.activo === true));
  });

  test("normaliza la entrada: días repetidos se deduplican y un lugar en blanco queda null; hora vacía es 400", async () => {
    const token = await nuevoToken();
    await escribir("POST", "habitos/definiciones", token, habito({ frecuencia: "semanal", dias_semana: ["lunes", "lunes", "viernes"], lugar: "   " }));
    const [d] = await leer("habitos/definiciones", token);
    assert.deepEqual(d.dias_semana, ["lunes", "viernes"]);
    assert.equal(d.lugar, null);
    assert.equal(d.hora, null);
    // La hora sin valor viaja como null (así la manda la app); "" no pasa el regex HH:mm.
    await rechazo(movil("POST", "habitos/definiciones", token, habito({ hora: "" })), 400, "datos_invalidos", "hora vacía");
  });

  test("validaciones: hora 25:00 o 7:5, día con tilde, nombre de 61, frecuencia o día del mes inválidos, campo faltante: 400", async () => {
    const token = await nuevoToken();
    for (const extra of [
      { hora: "25:00" }, { hora: "7:5" }, { hora: "07:60" }, { dias_semana: ["miércoles"] }, { dias_semana: ["lun"] },
      { nombre: "x".repeat(61) }, { nombre: "  " }, { frecuencia: "anual" }, { dia_mes: 32 }, { dia_mes: 0 },
      { emoji: "" }, { emoji: "x".repeat(17) }, { lugar: "x".repeat(61) },
    ]) {
      await rechazo(movil("POST", "habitos/definiciones", token, habito(extra)), 400, "datos_invalidos", JSON.stringify(extra).slice(0, 50));
    }
    const { dia_mes, ...sinDiaMes } = habito();
    await rechazo(movil("POST", "habitos/definiciones", token, sinDiaMes), 400, "datos_invalidos", "dia_mes faltante (.nullable())");
    assert.deepEqual(await leer("habitos/definiciones", token), []);
  });

  test("editar cambia todos los campos; un id inexistente da 404", async () => {
    const token = await nuevoToken();
    await escribir("POST", "habitos/definiciones", token, habito());
    const [d] = await leer("habitos/definiciones", token);
    await escribir("PUT", `habitos/definiciones/${d.id}`, token, habito({ nombre: "Correr", emoji: "🏃", frecuencia: "semanal", hora: "06:00", lugar: "Rambla", dias_semana: ["domingo"] }));
    const [e] = await leer("habitos/definiciones", token);
    assert.equal(e.id, d.id);
    assert.deepEqual([e.nombre, e.emoji, e.frecuencia, e.hora, e.lugar, e.dias_semana], ["Correr", "🏃", "semanal", "06:00", "Rambla", ["domingo"]]);
    await rechazo(movil("PUT", `habitos/definiciones/${randomUUID()}`, token, habito()), 404, "no_encontrado", "inexistente");
    await rechazo(movil("PUT", `habitos/definiciones/${d.id}`, token, habito({ hora: "99:99" })), 400, "datos_invalidos", "editar inválido");
  });

  test("eliminar es baja lógica: desaparece del listado y lo registrado se conserva", { skip: SIN_ADMIN }, async () => {
    const token = await nuevoToken();
    await escribir("POST", "habitos/definiciones", token, habito());
    const [d] = await leer("habitos/definiciones", token);
    await escribir("PUT", "habitos/registro", token, { fecha: hoy(), tipo: "habito_custom", refId: d.id, completado: true });
    await escribir("DELETE", `habitos/definiciones/${d.id}`, token);
    assert.deepEqual(await leer("habitos/definiciones", token), []);
    const { rows } = await admin().query("select activo from habitos_definicion where id = $1", [d.id]);
    assert.deepEqual(rows, [{ activo: false }]);
    assert.equal((await leer(`habitos/fecha?fecha=${hoy()}`, token)).registro.length, 1, "el historial queda");
    await rechazo(movil("DELETE", `habitos/definiciones/${randomUUID()}`, token), 404, "no_encontrado");
    // Observación: como en rutinas, repetir el borrado o editar el hábito ya
    // borrado responde 200 (el UPDATE encuentra la fila inactiva); no reaparece.
    await escribir("DELETE", `habitos/definiciones/${d.id}`, token);
    await escribir("PUT", `habitos/definiciones/${d.id}`, token, habito({ nombre: "Revivido" }));
    assert.deepEqual(await leer("habitos/definiciones", token), []);
  });

  test("hábitos fijos: marcar y desmarcar los cinco tipos; la fecha los refleja", async () => {
    const token = await nuevoToken();
    const tipos = ["hidratacion", "alimentacion", "sueno", "medicamento", "ejercicio"];
    for (const tipo of tipos) await escribir("PUT", "habitos/fijos", token, { fecha: hoy(), tipo, completado: true });
    await escribir("PUT", "habitos/fijos", token, { fecha: hoy(), tipo: "sueno", completado: false });
    const { fijos } = await leer(`habitos/fecha?fecha=${hoy()}`, token);
    assert.equal(fijos.length, 5, "una fila por tipo (upsert)");
    const hechos = fijos.filter((f) => f.completado).map((f) => f.tipo).sort();
    assert.deepEqual(hechos, ["alimentacion", "ejercicio", "hidratacion", "medicamento"]);
    assert.ok(fijos.every((f) => f.fecha.startsWith(hoy()) || !Number.isNaN(Date.parse(f.fecha))));
  });

  test("hábitos fijos: tipo inválido, fecha mal formada o completado no booleano: 400", async () => {
    const token = await nuevoToken();
    for (const c of [
      { fecha: hoy(), tipo: "agua", completado: true }, { fecha: "19/10/2026", tipo: "sueno", completado: true },
      { fecha: hoy(), tipo: "sueno", completado: "si" }, { fecha: hoy(), tipo: "sueno" },
    ]) {
      await rechazo(movil("PUT", "habitos/fijos", token, c), 400, "datos_invalidos", JSON.stringify(c));
    }
  });

  // Verificación de DEF-1 (corregido): fechaSchema exige que la fecha exista.
  test("una fecha con formato válido pero inexistente (2026-02-30, 0000-01-01) se rechaza con 400",
    async () => {
      const token = await nuevoToken();
      for (const fecha of ["2026-02-30", "0000-01-01"]) {
        await rechazo(movil("PUT", "habitos/fijos", token, { fecha, tipo: "sueno", completado: true }), 400, "datos_invalidos", fecha);
        await rechazo(movil("PUT", "habitos/registro", token, { fecha, tipo: "ejercicio", refId: "ej-x", completado: true }), 400, "datos_invalidos", fecha);
      }
    });

  test("registro de ejercicios y hábitos propios: marcar es idempotente y desmarcar lo quita", async () => {
    const token = await nuevoToken();
    await escribir("POST", "habitos/definiciones", token, habito());
    const [d] = await leer("habitos/definiciones", token);
    const marcar = (tipo, refId, completado) => escribir("PUT", "habitos/registro", token, { fecha: hoy(), tipo, refId, completado });
    await marcar("habito_custom", d.id, true);
    await marcar("habito_custom", d.id, true);
    await marcar("ejercicio", "ej-Sentadillas a la silla", true);
    let { registro } = await leer(`habitos/fecha?fecha=${hoy()}`, token);
    assert.deepEqual(registro.map((r) => r.ref_id).sort(), [d.id, "ej-Sentadillas a la silla"].sort());
    await marcar("ejercicio", "ej-Sentadillas a la silla", false);
    await marcar("ejercicio", "ej-Sentadillas a la silla", false);
    ({ registro } = await leer(`habitos/fecha?fecha=${hoy()}`, token));
    assert.deepEqual(registro.map((r) => r.ref_id), [d.id]);
    for (const c of [
      { tipo: "habito", refId: "x", completado: true }, { tipo: "ejercicio", refId: "", completado: true },
      { tipo: "ejercicio", refId: "x".repeat(201), completado: true },
    ]) {
      await rechazo(movil("PUT", "habitos/registro", token, { fecha: hoy(), ...c }), 400, "datos_invalidos", JSON.stringify(c).slice(0, 40));
    }
  });

  test("semana: devuelve fijos y registros del rango; fechas inválidas o faltantes devuelven listas vacías", async () => {
    const token = await nuevoToken();
    await escribir("PUT", "habitos/fijos", token, { fecha: hoy(-2), tipo: "hidratacion", completado: true });
    await escribir("PUT", "habitos/fijos", token, { fecha: hoy(), tipo: "sueno", completado: true });
    await escribir("PUT", "habitos/registro", token, { fecha: hoy(-1), tipo: "ejercicio", refId: "ej-A", completado: true });
    await escribir("PUT", "habitos/fijos", token, { fecha: hoy(-10), tipo: "sueno", completado: true });
    const semana = await leer(`habitos/semana?desde=${hoy(-6)}&hasta=${hoy()}`, token);
    assert.equal(semana.fijos.length, 2, "el de hace 10 días queda fuera");
    assert.equal(semana.registro.length, 1);
    for (const q of [`desde=${hoy(-6)}`, "desde=ayer&hasta=hoy", ""]) {
      assert.deepEqual(await leer(`habitos/semana?${q}`, token), { fijos: [], registro: [] }, q);
    }
    assert.deepEqual(await leer("habitos/fecha?fecha=mañana", token), { fijos: [], registro: [] });
  });
});

// ─── Aislamiento, autenticación y contrato de la ruta ─────────────────────────

describe("M01 aislamiento y autenticación en toda la API", { skip: SALTEAR }, () => {
  let a, b, ids;

  before(async () => {
    a = await nuevoToken();
    b = await nuevoToken();
    await escribir("POST", "metricas", a, { tipo: "frecuencia_cardiaca", valor: 64 });
    await escribir("PUT", "perfil", a, { edad: 50, sexo: "m", altura_cm: 180, fumador: true });
    await escribir("POST", "recetas", a, recetaValida());
    await escribir("POST", "mercado", a, { nombre: "L", periodo: "semanal", contenido: "- Avena" });
    await escribir("POST", "rutinas", a, { nombre: "R", contenido: contenidoRutina() });
    await escribir("POST", "habitos/definiciones", a, habito());
    await escribir("PUT", "habitos/fijos", a, { fecha: hoy(), tipo: "sueno", completado: true });
    await escribir("POST", "consentimiento", a, {});
    ids = {
      receta: (await leer("recetas", a))[0].id,
      lista: (await leer("mercado", a))[0].id,
      rutina: (await leer("rutinas", a))[0].id,
      habito: (await leer("habitos/definiciones", a))[0].id,
    };
  });

  test("B no ve nada de A en ningún listado, ni su perfil, ni su consentimiento, ni su informe", async () => {
    for (const ruta of ["metricas/ultimas", "metricas/historial?tipo=frecuencia_cardiaca&dias=30", "recetas", "mercado", "rutinas", "habitos/definiciones"]) {
      assert.deepEqual(await leer(ruta, b), [], ruta);
    }
    assert.deepEqual(await leer(`habitos/fecha?fecha=${hoy()}`, b), { fijos: [], registro: [] });
    assert.equal(await leer("perfil", b), null);
    assert.deepEqual(await leer("consentimiento", b), { otorgado: false });
    assert.deepEqual((await leer("informe", b)).metricas, {});
  });

  test("B no puede calificar, editar ni borrar los recursos de A (404, sin confirmar que existen)", async () => {
    await rechazo(movil("PATCH", `recetas/${ids.receta}`, b, { calificacion: 1 }), 404, "no_encontrado", "calificar");
    await rechazo(movil("DELETE", `recetas/${ids.receta}`, b), 404, "no_encontrado", "receta");
    await rechazo(movil("DELETE", `mercado/${ids.lista}`, b), 404, "no_encontrado", "lista");
    await rechazo(movil("DELETE", `rutinas/${ids.rutina}`, b), 404, "no_encontrado", "rutina");
    await rechazo(movil("PUT", `habitos/definiciones/${ids.habito}`, b, habito({ nombre: "Hackeado" })), 404, "no_encontrado", "editar hábito");
    await rechazo(movil("DELETE", `habitos/definiciones/${ids.habito}`, b), 404, "no_encontrado", "hábito");
    // Lo de A sigue intacto.
    assert.equal((await leer("recetas", a))[0].calificacion, null);
    assert.equal((await leer("habitos/definiciones", a))[0].nombre, "Caminar");
    assert.equal((await leer("rutinas", a)).length, 1);
  });

  const RECURSOS = [
    ["GET", "metricas/ultimas"], ["GET", "metricas/historial?tipo=peso"], ["POST", "metricas"], ["GET", "informe"],
    ["GET", "perfil"], ["PUT", "perfil"], ["GET", "consentimiento"], ["POST", "consentimiento"], ["DELETE", "consentimiento"],
    ["GET", "recetas"], ["POST", "recetas"], ["PATCH", `recetas/${randomUUID()}`], ["DELETE", `recetas/${randomUUID()}`],
    ["GET", "mercado"], ["POST", "mercado"], ["DELETE", `mercado/${randomUUID()}`],
    ["GET", "rutinas"], ["POST", "rutinas"], ["DELETE", `rutinas/${randomUUID()}`],
    ["GET", "habitos/definiciones"], ["POST", "habitos/definiciones"], ["PUT", `habitos/definiciones/${randomUUID()}`],
    ["DELETE", `habitos/definiciones/${randomUUID()}`], ["GET", `habitos/fecha?fecha=${hoy()}`],
    ["GET", `habitos/semana?desde=${hoy(-6)}&hasta=${hoy()}`], ["PUT", "habitos/fijos"], ["PUT", "habitos/registro"],
  ];

  test(`sin Bearer, los ${RECURSOS.length} recursos responden 401 sesion_requerida`, async () => {
    for (const [m, r] of RECURSOS) await rechazo(movil(m, r, null), 401, "sesion_requerida", `${m} ${r}`);
  });

  test("con un Bearer inventado o con formato inválido, 401 en todos", async () => {
    for (const [m, r] of RECURSOS) await rechazo(movil(m, r, "Z".repeat(43)), 401, "sesion_requerida", `${m} ${r}`);
    await rechazo(movil("GET", "metricas/ultimas", null, undefined, { headers: { Authorization: "Bearer ../../etc" } }), 401, "sesion_requerida");
  });

  test("ruta inexistente o método no soportado: 404 no_encontrado (antes de mirar la sesión)", async () => {
    for (const [m, r] of [
      ["GET", "no-existe"], ["PATCH", "metricas"], ["POST", "informe"], ["DELETE", "perfil"], ["PUT", "recetas"],
      ["GET", "recetas/" + randomUUID()], ["GET", "habitos"], ["POST", "metricas/ultimas/extra"],
    ]) {
      await rechazo(movil(m, r, a), 404, "no_encontrado", `${m} ${r}`);
    }
    // La raíz `/api/movil/v1/` no tiene segmentos: la responde Next con su página 404.
    assert.equal((await movil("GET", "", a)).status, 404);
  });

  test("el cuerpo tiene que ser un objeto JSON: arreglo, texto, número, null o JSON roto dan 400", async () => {
    for (const cuerpo of ["[]", '"texto"', "42", "null", "{roto", ""]) {
      await rechazo(movil("POST", "metricas", a, cuerpo), 400, "datos_invalidos", `cuerpo ${cuerpo}`);
    }
  });

  test("Origin ajeno en un recurso: 403 origen_no_permitido", async () => {
    await rechazo(movil("GET", "metricas/ultimas", a, undefined, { headers: { Origin: "https://evil.example" } }), 403, "origen_no_permitido");
  });

  test("los listados exponen la columna uid de cada fila (observación de minimización)", async () => {
    // La app no la usa; el comentario de PulsoApi dice que "nunca se manda un uid".
    // Queda documentado como observación: `select *` devuelve el uid al cliente.
    const [m] = await leer("metricas/ultimas", a);
    assert.ok("uid" in m, "si esto falla, se dejó de exponer el uid: actualizar el documento");
  });
});

// ─── M11 · Supresión ──────────────────────────────────────────────────────────

describe("M11 supresión de datos (DELETE /api/mis-datos)", { skip: SALTEAR }, () => {
  test("borra todos los datos de la identidad, el token deja de valer y queda auditado", { skip: SIN_ADMIN }, async () => {
    // Límite `supresion`: 3 por hora por IP. Esta prueba usa una IP propia.
    const ip = nuevaIp();
    const token = await nuevoToken(ip);
    const uid = await uidDe(token);
    await escribir("POST", "metricas", token, { tipo: "peso", valor: 70 });
    await escribir("PUT", "perfil", token, { edad: 30, sexo: null, altura_cm: null, fumador: null });
    await escribir("POST", "recetas", token, recetaValida());
    await escribir("POST", "mercado", token, { nombre: "L", periodo: "semanal", contenido: "- Avena" });
    await escribir("POST", "rutinas", token, { nombre: "R", contenido: contenidoRutina() });
    await escribir("POST", "habitos/definiciones", token, habito());
    await escribir("PUT", "habitos/fijos", token, { fecha: hoy(), tipo: "sueno", completado: true });
    await escribir("POST", "consentimiento", token, {});

    const res = await fetch(`${BASE}/api/mis-datos`, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": ip } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    for (const tabla of ["metricas", "perfil", "recetas_guardadas", "listas_mercado", "rutinas", "habitos_definicion", "habitos", "consentimientos", "sesiones", "identidades"]) {
      const { rows } = await admin().query(`select count(*)::int as n from ${tabla} where uid = $1`, [uid]);
      assert.equal(rows[0].n, 0, `quedaron filas en ${tabla}`);
    }
    await rechazo(movil("GET", "metricas/ultimas", token), 401, "sesion_requerida", "después de la supresión");
    const { rows: aud } = await admin().query("select resultado from auditoria where uid = $1 and accion = 'datos.eliminar'", [uid]);
    assert.deepEqual(aud.map((r) => r.resultado), ["ok"]);
  });

  test("sin sesión: 401; y el límite de 3 supresiones por hora por IP corta con 429", { skip: SIN_ADMIN }, async () => {
    const sinSesion = await fetch(`${BASE}/api/mis-datos`, { method: "DELETE", headers: { "X-Forwarded-For": IP_CORRIDA } });
    assert.equal(sinSesion.status, 401);
    const ip = nuevaIp();
    const estados = [];
    for (let i = 0; i < 4; i++) {
      const { cuerpo } = await sesionMovil({ ip });
      registrar(cuerpo.token);
      const r = await fetch(`${BASE}/api/mis-datos`, { method: "DELETE", headers: { Authorization: `Bearer ${cuerpo.token}`, "X-Forwarded-For": ip } });
      estados.push(r.status);
      if (r.status === 429) assert.equal(r.headers.get("retry-after"), "3600");
    }
    assert.deepEqual(estados, [200, 200, 200, 429]);
  });
});


// ─── Controles agregados por la remediación SAST del backend ──────────────────
// Límite de escrituras, cuota de filas por usuario y tope del cuerpo. La app los
// mapea a ErrorApi.LimiteAlcanzado(ia = false), CuotaExcedida y DemasiadoGrande.

describe("Transversal: límites de escritura, cuotas y tamaño del cuerpo", { skip: SALTEAR }, () => {
  test("escrituras: 300 por hora por sesión; la 301.ª da 429 con Retry-After", { skip: SIN_ADMIN }, async () => {
    const ip = nuevaIp();
    const token = await nuevoToken(ip);
    const uid = await uidDe(token);
    await limpiarLimitesDe(uid);
    // Se precarga el contador (300 escrituras reales tardarían y llenarían la base).
    await admin().query(
      `insert into limites_tasa (clave, ventana, conteo)
       values ($1, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 300)
       on conflict (clave, ventana) do update set conteo = 300`,
      [`escritura:${uid}`],
    );
    const r = await rechazo(movil("POST", "metricas", token, { tipo: "peso", valor: 70 }, { ip }), 429, "demasiadas_peticiones", "escritura 301");
    assert.equal(r.res.headers.get("retry-after"), "3600");
    // Leer no cuenta como escritura.
    assert.equal((await movil("GET", "metricas/ultimas", token, undefined, { ip })).status, 200);
    // Otra identidad no comparte el contador de la sesión.
    const otra = await nuevoToken(ip);
    assert.equal((await movil("POST", "metricas", otra, { tipo: "peso", valor: 70 }, { ip })).status, 200);
  });

  test("cuota de filas: con 100 listas del mercado guardadas, la siguiente da 409 cuota_excedida", { skip: SIN_ADMIN }, async () => {
    const token = await nuevoToken();
    const uid = await uidDe(token);
    await admin().query(
      `insert into listas_mercado (uid, nombre, periodo, contenido)
       select $1, 'Lista ' || g, 'semanal', '### Verduras\n- Espinaca' from generate_series(1, 100) g`,
      [uid],
    );
    await rechazo(movil("POST", "mercado", token, { nombre: "Una más", periodo: "semanal", contenido: "- x" }), 409, "cuota_excedida", "lista 101");
    assert.equal((await leer("mercado", token)).length, 100);
    // Al borrar una, vuelve a haber lugar.
    const [primera] = await leer("mercado", token);
    await escribir("DELETE", `mercado/${primera.id}`, token);
    await escribir("POST", "mercado", token, { nombre: "Ahora sí", periodo: "semanal", contenido: "- x" });
  });

  test("cuerpo de más de 256 KB en la API móvil: 413 cuerpo_demasiado_grande (sin tocar la base)", async () => {
    const token = await nuevoToken();
    const grande = { titulo: "R", contenido: "x".repeat(300 * 1024), imagen_url: null, ingredientes: [] };
    // Con node:http y no con fetch: el servidor responde 413 por el
    // Content-Length sin leer el cuerpo y corta la conexión; el fetch de Node
    // 26 (undici) da ECONNRESET en vez de devolver la respuesta que ya llegó.
    const r = await new Promise((resolver, rechazar) => {
      const datos = JSON.stringify(grande);
      const req = http.request(new URL(`${BASE}/api/movil/v1/recetas`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`, "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(datos), "X-Forwarded-For": IP_CORRIDA,
        },
      }, (res) => {
        let texto = "";
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolver({ status: res.statusCode, json: JSON.parse(texto) }));
      });
      req.on("error", rechazar);
      req.end(datos);
    });
    assert.deepEqual([r.status, r.json.error], [413, "cuerpo_demasiado_grande"], "300 KB");
    assert.deepEqual(await leer("recetas", token), []);
    // Justo por debajo del tope el cuerpo se lee y lo valida zod (contenido > 20 000 → 400).
    const casi = { ...grande, contenido: "x".repeat(200 * 1024) };
    await rechazo(movil("POST", "recetas", token, casi), 400, "datos_invalidos", "200 KB");
  });
});
