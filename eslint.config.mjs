import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import security from "eslint-plugin-security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  // Salida del build y de los tests compilados: no es código fuente.
  { ignores: [".next/**", ".tmp-test/**", "next-env.d.ts"] },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // SAST del backend (docs/integrador, SAST-BE-15 a 17): reglas de
  // eslint-plugin-security en todo el repo.
  security.configs.recommended,

  // `detect-object-injection` marca cualquier `obj[variable]`. Se deja activa
  // en el código de servidor que recibe peticiones (src/app, src/lib/db,
  // src/lib/seguridad, src/lib/sesion.ts, src/lib/media.ts), donde cada caso
  // se revisó y quedó corregido o justificado en línea. Acá se apaga porque
  // las 300+ apariciones son índices numéricos de vectores y matrices (motor
  // de predicción, scripts de entrenamiento, tests) o claves que son uniones
  // de TypeScript sobre mapas constantes (componentes que corren en el
  // navegador): ninguna toma un nombre de propiedad elegido por un cliente.
  {
    files: ["src/lib/ml/**", "src/components/**", "scripts/**", "tests/**"],
    rules: { "security/detect-object-injection": "off" },
  },

  // Scripts de línea de comandos y tests: leen y escriben archivos que elige
  // quien los corre (salidas de entrenamiento, figuras, fixtures). No se
  // despliegan ni reciben entrada de un usuario de la app.
  {
    files: ["scripts/**", "tests/**"],
    rules: {
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
    },
  },
];

export default eslintConfig;
