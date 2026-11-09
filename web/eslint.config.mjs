import next from "eslint-config-next";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "next-env.d.ts",
      "src/generated/**",
      "prisma/migrations/**",
      "test-results/**",
      "dist/**",
    ],
  },
  ...next,
  {
    // Semua dropdown form memakai <Combobox> (bisa diketik-cari), bukan
    // <select> native – pola yang sama dengan MARLIN. Pengecualian: primitif.
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/field.tsx", "src/components/ui/combobox.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: "Dropdown form wajib <Combobox> (bisa diketik-cari), bukan <select> native.",
        },
      ],
    },
  },
];

export default eslintConfig;
