import { test } from "node:test";
import assert from "node:assert/strict";
import { media, mediana, sd, cuantil, mad, cuantilNormal, cuantilT, crearPRNG } from "../../src/lib/ml/estadistica";

const cerca = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `${a} no está a ${tol} de ${b}`);

test("media, mediana, sd, cuantil y mad contra valores a mano", () => {
  assert.equal(media([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 3, 2]), 2.5);
  cerca(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 0.001);
  assert.equal(sd([5]), 0);
  assert.equal(cuantil([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(mad([1, 2, 3, 4, 100]), 1);
});

test("cuantilNormal (Acklam) contra tablas", () => {
  cerca(cuantilNormal(0.975), 1.959964, 1e-5);
  cerca(cuantilNormal(0.9), 1.281552, 1e-5);
  cerca(cuantilNormal(0.5), 0, 1e-9);
  cerca(cuantilNormal(0.01), -2.326348, 1e-5);
  cerca(cuantilNormal(0.999), 3.090232, 1e-4);
});

test("cuantilT (Cornish-Fisher) contra tablas de la t", () => {
  cerca(cuantilT(0.975, 3), 3.182, 0.02);
  cerca(cuantilT(0.975, 5), 2.571, 0.01);
  cerca(cuantilT(0.975, 10), 2.228, 0.005);
  cerca(cuantilT(0.975, 30), 2.042, 0.005);
  cerca(cuantilT(0.9, 8), 1.397, 0.005);
  cerca(cuantilT(0.975, 1000), 1.962, 0.005);
});

test("PRNG reproducible y con normal bien calibrada", () => {
  const a = crearPRNG(123);
  const b = crearPRNG(123);
  for (let i = 0; i < 10; i++) assert.equal(a.uniforme(), b.uniforme());
  assert.notEqual(crearPRNG(1).uniforme(), crearPRNG(2).uniforme());

  const r = crearPRNG(9);
  const xs: number[] = [];
  for (let i = 0; i < 5000; i++) xs.push(r.normal());
  cerca(media(xs), 0, 0.05, "media de N(0,1)");
  cerca(sd(xs), 1, 0.05, "sd de N(0,1)");
  for (let i = 0; i < 100; i++) {
    const e = r.entero(1, 4);
    assert.ok(e >= 1 && e <= 4 && Number.isInteger(e));
  }
});
