import acorn from 'acorn';
import walk from 'acorn-walk';
import { posix as path } from 'path';
import { createImportResolver, ImportResolver } from './ImportResolver';
import { CompilerOptions } from './Options';
import { ResolvedFile } from './ResolvedFile';
import { ResourceTransformer } from './ResourceTransfomer';

export class ImportDeclaration {
  static create(importPath: string, declaringFile: ResolvedFile): ImportDeclaration | undefined {
    const index = importPath.indexOf('/');
    if (index < 0) {
      return new ImportDeclaration(importPath, declaringFile);
    }

    const module = importPath.substring(0, index);
    if (module === '' || module === '.' || module === '..') return undefined;
    const file = importPath.substring(index + 1);
    return new ImportDeclaration(module, declaringFile, file);
  }

  private constructor(
    readonly moduleName: string, // module name
    readonly declaringFile: ResolvedFile,
    readonly filePath?: string // relative file path in module
  ) {}

  get path(): string {
    let res = this.moduleName;
    if (this.filePath) res += '/' + this.filePath;
    return res;
  }
}

export function newJSImportTransformer(compilerOptions: CompilerOptions): ResourceTransformer {
  const parserOptions: acorn.Options = {
    sourceType: getSourceType(compilerOptions),
    ecmaVersion: getEcmaVersion(compilerOptions),
    ranges: true
  };
  const importResolver = createImportResolver(compilerOptions);
  return file => transformJS(file, parserOptions, importResolver);
}

async function transformJS(
  file: ResolvedFile,
  parserOptions: acorn.Options,
  importResolver: ImportResolver
): Promise<string | undefined> {
  if (file.resolvedFile.endsWith('.js')) {
    const code = await file.readText();
    let ast;
    try {
      ast = acorn.parse(code, parserOptions);
      return transformAST(file, code, ast, importResolver);
    } catch (e) {
      console.error('Error transforming ' + file.resolvedFile, e);
      return code;
    }
  }
  return undefined;
}

function transformAST(file: ResolvedFile, code: string, ast: acorn.Node, moduleResolver: ImportResolver): string {
  const output = { code: '', offset: 0 };
  const visitor = (n: acorn.Node) => visitNode(n, file, code, moduleResolver, output);
  walk.simple(ast, {
    ImportDeclaration: visitor,
    ImportExpression: visitor,
    ExportNamedDeclaration: visitor,
    ExportAllDeclaration: visitor
  });
  if (output.offset < code.length) {
    output.code += code.substring(output.offset, code.length);
  }
  return output.code;
}

function visitNode(
  node: acorn.Node,
  file: ResolvedFile,
  code: string,
  resolveImport: ImportResolver,
  output: { code: string; offset: number }
): void {
  if (!node.range) throw new Error('Missing range in node ' + node);
  const source = getSource(node);
  if (!source?.range || !source?.value) return;
  const name = source.value;
  const importDeclaration = ImportDeclaration.create(name, file);
  let importPath;
  if (importDeclaration) {
    importPath = resolveImport(importDeclaration);
  } else {
    importPath = path.join(path.dirname(file.resolvedPath), name);
  }
  output.code += code.substring(output.offset, source.range[0]);
  if (importPath) {
    if (!importPath.startsWith('/')) importPath = '/' + importPath;
    if (!importPath.endsWith('.js')) importPath += '.js';
    output.code += '"' + importPath + '"';
  } else {
    output.code += '"' + name + '"';
  }
  output.offset = source.range[1];
}

function isModuleResolver(obj: any): obj is ImportResolver {
  return typeof obj === 'function';
}

type StringLiteral = acorn.Node & {
  type: 'Literal';
  value: string;
  range?: [number, number];
};

type ImportDeclarationNode = acorn.Node & {
  type: 'ImportDeclaration' | 'ImportExpression';
  source: StringLiteral;
};

type ExportDeclarationNode = acorn.Node & {
  type: 'ExportNamedDeclaration' | 'ExportAllDeclaration';
  source: StringLiteral | null;
};

function isImportDeclaration(node: acorn.Node): node is ImportDeclarationNode {
  return node.type === 'ImportDeclaration' || node.type === 'ImportExpression';
}

function isExportDeclaration(node: acorn.Node): node is ExportDeclarationNode {
  return node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration';
}

function getSource(node: acorn.Node): StringLiteral | null {
  if (isImportDeclaration(node) || isExportDeclaration(node)) return node.source;
  return null;
}

type SourceType = 'script' | 'module';
type EcmaVersion = 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020;

function getSourceType(compilerOptions: CompilerOptions): SourceType {
  switch (compilerOptions.module) {
    case 'ESNext':
    case 'ES2020':
      return 'module';
    default:
      return 'script';
  }
}

function getEcmaVersion(compilerOptions: CompilerOptions): EcmaVersion {
  switch (compilerOptions.target) {
    case 'ES3':
      return 3;
    case 'ES5':
      return 5;
    case 'ES2015':
      return 2015;
    case 'ES2016':
      return 2016;
    case 'ES2017':
      return 2017;
    case 'ES2018':
      return 2018;
    case 'ES2019':
      return 2019;
    case 'ES2020':
    case 'ESNext':
    case 'Latest':
    default:
      return 2020;
  }
}
