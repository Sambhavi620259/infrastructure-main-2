import { FlatCompat } from "@eslint/eslintrc";
import { globalIgnores } from "eslint/config";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  globalIgnores([
    ".next/**",
    ".next-*/**",
    ".kilo/**",
    "out/**",
    "dist/**",
    "build/**",
    "node_modules/**",
    "backend/**",
    "next-env.d.ts",
  ]),
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
