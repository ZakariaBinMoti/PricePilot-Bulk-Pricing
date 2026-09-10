import { type ApiType, pluckConfig, preset } from "@shopify/api-codegen-preset";

export default {
  schema: "https://shopify.dev/admin-graphql-direct-proxy",
  documents: ["app/**/*.{ts,tsx}"],
  projects: {
    default: {
      schema: "https://shopify.dev/admin-graphql-direct-proxy",
      documents: ["app/**/*.{ts,tsx}"],
      extensions: {
        codegen: {
          ...pluckConfig({ modules: [{ apiType: "Admin" as ApiType }] }),
          generates: preset({
            apiType: "Admin" as ApiType,
          }),
        },
      },
    },
  },
};
