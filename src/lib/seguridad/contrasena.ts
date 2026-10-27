/**
 * Regla de contraseñas (integrador, punto 13).
 *
 * La misma regla vive en tres lugares y tiene que dar lo mismo en los tres:
 *   * acá, en TypeScript puro: la usa la lista con check en vivo de los
 *     formularios (cliente) y `contrasenaSchema` de zod (servidor);
 *   * `pulso_contrasena_fallas` en db/seguridad.sql: la base la vuelve a
 *     aplicar al crear la cuenta, al cambiar o restablecer la contraseña, así
 *     que saltearse zod no alcanza para guardar una contraseña débil.
 * tests/integrador/cuentas.test.mjs compara los dos lados con los mismos casos.
 *
 * Para que la paridad sea exacta, nada depende del locale ni de las clases
 * Unicode del motor de expresiones regulares (que no son iguales en V8 y en
 * Postgres): las letras son las del alfabeto inglés más las del español
 * (á é í ó ú ü ñ), se recorre por punto de código (`Array.from`, igual que
 * `substr` en la base) y las minúsculas se sacan con una tabla fija.
 *
 * Sin dependencias: este archivo lo importan componentes del navegador y las
 * pruebas con node (`--experimental-strip-types`).
 */

export type IdRegla =
  | "largo" | "maximo" | "mayuscula" | "minuscula" | "numero" | "simbolo"
  | "secuencia" | "repetidos" | "comun" | "correo";

export interface Regla {
  id:     IdRegla;
  texto:  string;
  cumple: boolean;
}

/** Texto de cada regla, en positivo: sirve para la lista y para explicar un rechazo. Igual que en la base. */
export const TEXTO_REGLA: Readonly<Record<IdRegla, string>> = {
  largo:     "Al menos 10 caracteres",
  maximo:    "Como máximo 72 bytes (las tildes y los emojis ocupan más de uno)",
  mayuscula: "Al menos una letra mayúscula",
  minuscula: "Al menos una letra minúscula",
  numero:    "Al menos un número",
  simbolo:   "Al menos un símbolo, como ! ? # * -",
  secuencia: "Sin secuencias de 4 o más, como 1234, abcd o 4321",
  repetidos: "Sin 4 o más caracteres iguales seguidos, como aaaa",
  comun:     "Que no sea una contraseña común, como Password o Qwerty",
  correo:    "Que no contenga tu correo",
};

export const MIN_CARACTERES = 10;
/** bcrypt solo mira los primeros 72 bytes: más largo, dos contraseñas distintas serían la misma. */
export const MAX_BYTES = 72;
const MAX_SECUENCIA = 4;

const MAYUSCULAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑ";
const MINUSCULAS = "abcdefghijklmnopqrstuvwxyzáéíóúüñ";
const DIGITOS = "0123456789";
const ESPACIOS = " \t\n\r";
/** Lo que cuenta para las secuencias: letras sin tilde y dígitos (por código, como `ascii()` en la base). */
const ALFANUMERICOS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Contraseñas comunes, solo sus letras y en minúsculas: "Password1!" o
 * "Qwerty123*" pasan las otras reglas, pero son de lo primero que prueba un
 * atacante. La lista es corta a propósito; la base tiene la misma.
 */
export const CONTRASENAS_COMUNES: readonly string[] = [
  "password", "contrasena", "contraseña", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl",
  "zxcvbnm", "qweasd", "iloveyou", "teamo", "admin", "administrador", "usuario", "pulso",
  "colombia", "bogota", "welcome", "bienvenido", "letmein", "monkey", "dragon", "football",
  "futbol", "superman", "batman", "princesa", "sunshine", "master", "secreto", "clave",
  "miclave", "hola", "holamundo", "abc", "abcabc",
];

/** Minúsculas con una tabla fija (A-Z y las mayúsculas del español), igual que `translate` en la base. */
function minusculas(texto: string): string {
  let r = "";
  for (const c of texto) {
    const i = MAYUSCULAS.indexOf(c);
    r += i >= 0 ? MINUSCULAS.charAt(i) : c;
  }
  return r;
}

function recortar(texto: string): string {
  let a = 0;
  let b = texto.length;
  while (a < b && ESPACIOS.includes(texto.charAt(a))) a++;
  while (b > a && ESPACIOS.includes(texto.charAt(b - 1))) b--;
  return texto.slice(a, b);
}

function tieneSecuencia(cps: string[]): boolean {
  for (let i = 0; i + MAX_SECUENCIA <= cps.length; i++) {
    const tramo = cps.slice(i, i + MAX_SECUENCIA);
    if (!tramo.every((c) => ALFANUMERICOS.includes(c))) continue;
    const paso = tramo[1].charCodeAt(0) - tramo[0].charCodeAt(0);
    if (paso !== 1 && paso !== -1) continue;
    if (tramo.every((c, j) => j === 0 || c.charCodeAt(0) - tramo[j - 1].charCodeAt(0) === paso)) return true;
  }
  return false;
}

function tieneRepetidos(cps: string[]): boolean {
  for (let i = 0; i + MAX_SECUENCIA <= cps.length; i++) {
    const [primero, ...resto] = cps.slice(i, i + MAX_SECUENCIA);
    if (resto.every((c) => c === primero)) return true;
  }
  return false;
}

/** Parte local del correo normalizada, si es lo bastante larga para que la regla tenga sentido. */
function parteLocal(email: string | null | undefined): string | null {
  if (!email) return null;
  const local = minusculas(recortar(email)).split("@")[0] ?? "";
  // Con 3 letras o menos ("ana@…") la regla rechazaría medio diccionario.
  return Array.from(local).length >= 4 ? local : null;
}

/**
 * Todas las reglas con si se cumplen. Sin `email`, la del correo no aparece
 * (por ejemplo al restablecer: el formulario no sabe de qué cuenta es; la
 * revisa el servidor).
 */
export function reglasContrasena(password: string, email?: string | null): Regla[] {
  const cps = Array.from(password);
  const bajas = Array.from(minusculas(password));
  const letras = bajas.filter((c) => MINUSCULAS.includes(c)).join("");
  const local = parteLocal(email);

  const t = TEXTO_REGLA;
  const reglas: Regla[] = [
    { id: "largo",     texto: t.largo,     cumple: cps.length >= MIN_CARACTERES },
    { id: "maximo",    texto: t.maximo,    cumple: new TextEncoder().encode(password).length <= MAX_BYTES },
    { id: "mayuscula", texto: t.mayuscula, cumple: cps.some((c) => MAYUSCULAS.includes(c)) },
    { id: "minuscula", texto: t.minuscula, cumple: cps.some((c) => MINUSCULAS.includes(c)) },
    { id: "numero",    texto: t.numero,    cumple: cps.some((c) => DIGITOS.includes(c)) },
    { id: "simbolo",   texto: t.simbolo,
      cumple: cps.some((c) => !MAYUSCULAS.includes(c) && !MINUSCULAS.includes(c) && !DIGITOS.includes(c) && !ESPACIOS.includes(c)) },
    { id: "secuencia", texto: t.secuencia, cumple: !tieneSecuencia(bajas) },
    { id: "repetidos", texto: t.repetidos, cumple: !tieneRepetidos(bajas) },
    { id: "comun",     texto: t.comun,     cumple: !CONTRASENAS_COMUNES.includes(letras) },
  ];
  if (email !== undefined && email !== null) {
    reglas.push({ id: "correo", texto: t.correo, cumple: local === null || !bajas.join("").includes(local) });
  }
  return reglas;
}

/** Solo las reglas que no se cumplen (vacío = la contraseña sirve). */
export function fallasContrasena(password: string, email?: string | null): Regla[] {
  return reglasContrasena(password, email).filter((r) => !r.cumple);
}
