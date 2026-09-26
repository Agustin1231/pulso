#!/usr/bin/env node
/**
 * Construye la muestra analítica de NHANES 2021-2023 a partir de los siete
 * archivos .xpt del CDC y la escribe como CSV versionado en el repo.
 *
 *   npm run nhanes:descargar   # baja los .xpt a data/nhanes-2021-2023/xpt/
 *   npm run nhanes:muestra     # .xpt → data/nhanes-2021-2023/muestra-analitica.csv
 *
 * Imprime el flujo de exclusiones y el SHA-256 de cada archivo fuente, para que
 * cualquiera pueda comprobar que parte de los mismos datos.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { leerXPT } from "../src/lib/ml/supervisado/xpt";
import type { TablaXPT } from "../src/lib/ml/supervisado/xpt";
import { ARCHIVOS, construirMuestra, aCSV } from "../src/lib/ml/supervisado/nhanes";
import type { CodigoArchivo } from "../src/lib/ml/supervisado/nhanes";

const DIR = path.join(process.cwd(), "data", "nhanes-2021-2023");
const tablas = {} as Record<CodigoArchivo, TablaXPT>;
const hashes: { archivo: string; sha256: string; bytes: number; filas: number }[] = [];

for (const { codigo } of ARCHIVOS) {
  const bytes = readFileSync(path.join(DIR, "xpt", `${codigo}.xpt`));
  tablas[codigo] = leerXPT(new Uint8Array(bytes));
  hashes.push({
    archivo: `${codigo}.xpt`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    filas: tablas[codigo].filas.length,
  });
}

const { filas, flujo } = construirMuestra(tablas);
writeFileSync(path.join(DIR, "muestra-analitica.csv"), aCSV(filas));
writeFileSync(path.join(DIR, "flujo.json"), JSON.stringify({ flujo, archivos: hashes }, null, 2) + "\n");

console.log("Archivos fuente (NHANES agosto 2021 – agosto 2023):");
for (const h of hashes) console.log(`  ${h.archivo.padEnd(11)} ${String(h.filas).padStart(6)} filas  sha256 ${h.sha256}`);
console.log("\nFlujo de la muestra:");
for (const p of flujo) console.log(`  ${p.criterio.padEnd(40)} ${String(p.n).padStart(6)}`);
const positivos = filas.filter((f) => f.evento === 1).length;
console.log(`\nMuestra analítica: ${filas.length} adultos · ${positivos} con antecedente cardiovascular (${(100 * positivos / filas.length).toFixed(1)} %)`);
console.log(`Escrita en ${path.relative(process.cwd(), path.join(DIR, "muestra-analitica.csv"))}`);
