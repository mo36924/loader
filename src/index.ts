import { EventEmitter, on } from "events";
import { pathToFileURL } from "url";
import html from "@mo36924/typescript-plugin-html-template";
import ts, { CustomTransformers, ESMap } from "typescript";

type ResolvedModules = ESMap<
  string,
  {
    resolvedFileName: string;
    originalPath?: string;
    extension: string;
    isExternalLibraryImport: boolean;
    packageId?: any;
  }
>;

type PromiseOrValue<T> = Promise<T> | T;
type ResolveResult = PromiseOrValue<{ format?: string | null; shortCircuit?: boolean; url: string }>;
type LoadResult = PromiseOrValue<{
  format: string;
  shortCircuit?: boolean;
  source: string | ArrayBuffer | SharedArrayBuffer | Uint8Array;
}>;

type Resolve = (
  specifier: string,
  context: { conditions: string[]; importAssertions: any; parentURL: string | undefined },
  nextResolve: (
    specifier: string,
    context: { conditions: string[]; importAssertions: any; parentURL: string | undefined },
  ) => ResolveResult,
) => ResolveResult;

type Load = (
  url: string,
  context: { conditions: string[]; format: string; importAssertions: any },
  nextLoad: (url: string, context: { conditions: string[]; format: string; importAssertions: any }) => LoadResult,
) => LoadResult;

const ee = new EventEmitter();
const onWriteFile: AsyncIterableIterator<[string]> = on(ee, "writeFile");
const diagnosticReporter = (ts as any).createDiagnosticReporter(ts.sys, true);

const customTransformers: CustomTransformers = {
  before: [
    (context) => (sourceFile) =>
      ts.visitNode(sourceFile, function visitor(node): ts.Node {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const resolvedModules: ResolvedModules = (sourceFile as any).resolvedModules;
          const resolvedModule = resolvedModules.get(node.moduleSpecifier.text);

          if (resolvedModule && !resolvedModule.isExternalLibraryImport) {
            if (ts.isImportDeclaration(node)) {
              return context.factory.updateImportDeclaration(
                node,
                node.decorators,
                node.modifiers,
                node.importClause,
                context.factory.createStringLiteral(resolvedModule.resolvedFileName),
                node.assertClause,
              );
            } else {
              return context.factory.updateExportDeclaration(
                node,
                node.decorators,
                node.modifiers,
                node.isTypeOnly,
                node.exportClause,
                context.factory.createStringLiteral(resolvedModule.resolvedFileName),
                node.assertClause,
              );
            }
          }
        }

        return ts.visitEachChild(node, visitor, context);
      }),
    html(),
  ],
};

ts.createWatchProgram(
  ts.createWatchCompilerHost(
    "tsconfig.json",
    {
      noEmit: false,
      sourceMap: false,
      inlineSourceMap: true,
      inlineSources: true,
    },
    {
      ...ts.sys,
      writeFile(path: string, data: string) {
        const url = pathToFileURL(path.replace(/\.js$/, ".ts")).href;
        files[url] = data;
        ee.emit("writeFile", url);
      },
    },
    (...args: Parameters<typeof ts.createEmitAndSemanticDiagnosticsBuilderProgram>) => {
      const program = ts.createEmitAndSemanticDiagnosticsBuilderProgram(...args);
      const emit = program.emit;

      program.emit = (targetSourceFile, writeFile, cancellationToken, emitOnlyDtsFiles, _customTransformers) =>
        emit(targetSourceFile, writeFile, cancellationToken, emitOnlyDtsFiles, customTransformers);

      return program;
    },
    diagnosticReporter,
    async (diagnostic, _newLine, _options, errorCount) => {
      if (errorCount === undefined) {
        ts.sys.clearScreen!();
      }

      diagnosticReporter(diagnostic);
      process.exitCode = errorCount;

      if (errorCount === 0) {
      }
    },
  ),
);

const files: { [url: string]: string | Buffer } = Object.create(null);

const resolve: Resolve = (specifier: string, context, nextResolve) =>
  /(\.ts|\?\d+)$/.test(specifier)
    ? { format: "module", shortCircuit: true, url: new URL(specifier, context.parentURL).href }
    : nextResolve(specifier, context);

const load: Load = (url, context, nextLoad) => {
  url = url.replace(/\?\d+$/, "");
  return url in files ? { format: "module", shortCircuit: true, source: files[url] } : nextLoad(url, context);
};

export { onWriteFile, files, resolve, load };
