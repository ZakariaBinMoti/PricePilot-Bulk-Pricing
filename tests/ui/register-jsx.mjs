import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Compile application JSX for DOM interaction tests without a dev server.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const url = new URL(specifier, context.parentURL);
      if (!/\.[^/]+$/.test(url.pathname)) {
        for (const extension of [".ts", ".tsx"]) {
          const candidate = new URL(url.href + extension);
          if (existsSync(fileURLToPath(candidate)))
            return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".module.css"))
      return {
        format: "module",
        source: "export default {};",
        shortCircuit: true,
      };
    if (url.endsWith(".tsx")) {
      const result = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      });
      return {
        format: "module",
        source: result.outputText,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
