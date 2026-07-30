import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  /*
   * PUREZA DA CAMADA DE DOMÍNIO
   * ============================
   * src/domain/ contém as regras financeiras: consolidação, gaps, limites de
   * risco, projeção de aposentadoria. Precisa ser testável sem banco, sem rede
   * e sem React.
   *
   * Esta regra impede que a dependência inverta silenciosamente. Sem ela, um
   * "só vou buscar esse dado aqui" transforma uma função pura em algo que só
   * roda com Supabase de pé — e a regra financeira deixa de ser testável.
   */
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "next",
                "next/*",
                "@supabase/*",
                "@/data",
                "@/data/*",
                "@/app",
                "@/app/*",
                "@/components",
                "@/components/*",
                "@/providers",
                "@/providers/*",
              ],
              message:
                "src/domain deve permanecer puro: sem React, Next, Supabase ou acesso a dados. Receba os dados como argumento.",
            },
          ],
        },
      ],
    },
  },

  /*
   * O service_role ignora RLS: só pode ser usado por scripts administrativos
   * fora do runtime da aplicação.
   */
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/data/supabase/admin",
              message:
                "O cliente admin ignora RLS e não pode ser usado no runtime. Use @/data/supabase/server.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
]);

export default eslintConfig;
