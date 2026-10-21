// Utilidades comunes de los escenarios k6 de Pulso (API móvil /api/movil/v1).
//
// - BASE_URL: una o varias bases separadas por coma (escalabilidad horizontal:
//   cada petición elige una al azar, como haría un balanceador round-robin).
// - Tokens: los crea tests/carga/preparar.mjs directamente en la base de carga
//   (ver el README de esta carpeta). Se mandan como `Authorization: Bearer`.
// - Cada petición lleva el tag `name` = "MÉTODO recurso" para tener p50/p95/p99
//   por endpoint.
// - Sin rutas de IA: dependen de un proveedor externo y tienen su propio límite.
import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

export const BASES = (__ENV.BASE_URL || "http://127.0.0.1:3109").split(",").map((b) => b.replace(/\/+$/, ""));

for (const b of BASES) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b)) {
    throw new Error(`BASE_URL no local: ${b}. Estas pruebas nunca se corren contra producción.`);
  }
}

// Los últimos RESERVADOS tokens no se usan en la carga: son para las pruebas que
// destruyen la sesión (límite de supresión de datos, recuperación de sesión).
export const RESERVADOS = 10;
const tokens = new SharedArray("tokens", () => {
  const todos = JSON.parse(open("/carga/.data/tokens.json"));
  return todos.slice(0, todos.length - RESERVADOS);
});
export const reservados = new SharedArray("reservados", () => JSON.parse(open("/carga/.data/tokens.json")).slice(-RESERVADOS));

export const API = "/api/movil/v1";
export const base = () => BASES[Math.floor(Math.random() * BASES.length)];
export const tokenAzar = () => tokens[Math.floor(Math.random() * tokens.length)];
export const tokenDeVU = () => tokens[(__VU - 1) % tokens.length];

function fecha(desplazamientoDias = 0) {
  const d = new Date(Date.now() + desplazamientoDias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const TIPOS = ["frecuencia_cardiaca", "peso", "horas_sueno", "nivel_estres"];
const FIJOS = ["ejercicio", "alimentacion", "sueno", "medicamento", "hidratacion"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function valorMetrica(tipo) {
  switch (tipo) {
    case "frecuencia_cardiaca": return 55 + Math.round(Math.random() * 40);
    case "peso": return Math.round((55 + Math.random() * 45) * 10) / 10;
    case "horas_sueno": return 5 + Math.round(Math.random() * 8) / 2;
    default: return 1 + Math.floor(Math.random() * 10);
  }
}

/**
 * Catálogo de endpoints de la API móvil (sin IA). `peso` es la proporción en
 * la mezcla realista, derivada de lo que pide cada pantalla de la app:
 * el Dashboard pide últimas + informe + historial; Score, informe + perfil;
 * Hábitos, definiciones + día + rutinas; etc.
 */
export const ENDPOINTS = {
  "POST sesion":              { peso: 5,  fn: (t) => ["POST", "/sesion", "{}"] },
  "GET metricas/ultimas":     { peso: 14, fn: () => ["GET", "/metricas/ultimas"] },
  "GET metricas/historial":   { peso: 14, fn: () => ["GET", `/metricas/historial?tipo=${pick(TIPOS)}&dias=30`] },
  "GET informe":              { peso: 8,  fn: () => ["GET", "/informe"] },
  "GET perfil":               { peso: 5,  fn: () => ["GET", "/perfil"] },
  "GET consentimiento":       { peso: 3,  fn: () => ["GET", "/consentimiento"] },
  "GET recetas":              { peso: 5,  fn: () => ["GET", "/recetas"] },
  "GET mercado":              { peso: 4,  fn: () => ["GET", "/mercado"] },
  "GET rutinas":              { peso: 6,  fn: () => ["GET", "/rutinas"] },
  "GET habitos/definiciones": { peso: 6,  fn: () => ["GET", "/habitos/definiciones"] },
  "GET habitos/fecha":        { peso: 7,  fn: () => ["GET", `/habitos/fecha?fecha=${fecha()}`] },
  "GET habitos/semana":       { peso: 5,  fn: () => ["GET", `/habitos/semana?desde=${fecha(-6)}&hasta=${fecha()}`] },
  "POST metricas":            { peso: 6,  fn: () => { const tipo = pick(TIPOS); return ["POST", "/metricas", JSON.stringify({ tipo, valor: valorMetrica(tipo) })]; } },
  "PUT habitos/fijos":        { peso: 5,  fn: () => ["PUT", "/habitos/fijos", JSON.stringify({ fecha: fecha(), tipo: pick(FIJOS), completado: Math.random() < 0.5 })] },
  "PUT perfil":               { peso: 2,  fn: () => ["PUT", "/perfil", JSON.stringify({ edad: 20 + Math.floor(Math.random() * 50), sexo: pick(["m", "f", "otro"]), altura_cm: 150 + Math.floor(Math.random() * 40), fumador: Math.random() < 0.2 })] },
};

export const NOMBRES = Object.keys(ENDPOINTS);
const ACUM = (() => {
  let s = 0;
  return NOMBRES.map((n) => (s += ENDPOINTS[n].peso));
})();
const TOTAL = ACUM[ACUM.length - 1];

/** Un endpoint al azar según la mezcla realista. */
export function elegir() {
  const r = Math.random() * TOTAL;
  return NOMBRES[ACUM.findIndex((a) => r < a)];
}

/**
 * IP de cliente simulada, fija por token (10.77.x.y). En producción cada usuario
 * llega con su propia IP y el proxy (Traefik) la pone en X-Forwarded-For; en el
 * entorno local no hay proxy y todo k6 sale de 127.0.0.1, así que sin esto los
 * límites POR IP (p. ej. 1200 escrituras/h, src/lib/seguridad/tasa.ts) se
 * agotarían en segundos y la prueba mediría el límite, no el servidor. Los
 * límites por SESIÓN siguen intactos. Con IP_REAL=1 se omite el header.
 */
export function ipDe(token) {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
  return `10.77.${(h >>> 8) & 255}.${h & 255}`;
}
const IP_REAL = __ENV.IP_REAL === "1";
export function cabeceras(token) {
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  if (!IP_REAL) h["X-Forwarded-For"] = ipDe(token);
  return h;
}

/** Hace la petición `nombre` con el token dado. Devuelve la respuesta. */
export function llamar(nombre, token, extraTags = {}) {
  const [metodo, ruta, cuerpo] = ENDPOINTS[nombre].fn();
  const res = http.request(metodo, `${base()}${API}${ruta}`, cuerpo ?? null, {
    headers: cabeceras(token),
    tags: { name: nombre, ...extraTags },
    timeout: __ENV.TIMEOUT || "30s",
  });
  check(res, { "2xx": (r) => r.status >= 200 && r.status < 300 }, { name: nombre });
  return res;
}

/** Umbrales por endpoint (crean sub-métricas en el resumen exportado). */
export function umbralesPorEndpoint({ p95Lectura = 500, p95Escritura = 800, p95Informe = 2500, error = 0.01 } = {}) {
  const u = {};
  for (const n of NOMBRES) {
    const p95 = n === "GET informe" ? p95Informe : n.startsWith("GET") ? p95Lectura : p95Escritura;
    u[`http_req_duration{name:${n}}`] = [`p(95)<${p95}`];
    u[`http_req_failed{name:${n}}`] = [`rate<${error}`];
  }
  return u;
}

export const ESTADISTICAS = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"];
