import {posix as path} from 'path';
import {fileExists} from './Utils';
import {ImportDeclaration} from './JSImportTransformer';
import {CompilerOptions} from './Options';
import {readFileSync} from "fs";

export type ImportResolver = (declaration: ImportDeclaration) => string | undefined;

export function createImportResolver(options: CompilerOptions): ImportResolver {
  return decl => resolvePath(decl, options) || decl.filePath;
}

function resolvePath(decl: ImportDeclaration, compilerOptions: CompilerOptions): string | undefined {
  let resolvedPath = resolveCompilerPaths(decl, compilerOptions);
  if (!resolvedPath) resolvedPath = resolveNodeFile(decl);
  if (!resolvedPath) resolvedPath = resolveNodePackage(decl);
  return resolvedPath;
}

function resolveCompilerPaths(decl: ImportDeclaration, compilerOptions: CompilerOptions): string | undefined {
  let importPath = decl.path;
  for (const key in compilerOptions.paths) {
    const values = compilerOptions.paths[key];
    if (key === importPath) {
      return values.find(v => fileExists(path.join(compilerOptions.outDir, v + '.js')));
    }

    const prefix = key.endsWith('*') ? key.substring(0, key.length - 1) : undefined;
    if (prefix && importPath.startsWith(prefix)) {
      const np = importPath.substring(prefix.length) + '.js';
      return values.map(v => v.replace('*', np)).find(f => fileExists(path.resolve(compilerOptions.outDir, f)));
    }
  }
  return undefined;
}

function resolveNodeFile(decl: ImportDeclaration): string | undefined {
  const sourceFile = path.join('node_modules', decl.path + '.js');
  if (fileExists(sourceFile))
    return '/' + sourceFile;
  return undefined;
}

function resolveNodePackage(decl: ImportDeclaration): string | undefined {
  const moduleName = decl.moduleName;
  const packageFile = path.join('node_modules', moduleName, 'package.json');
  if (fileExists(packageFile)) {
    const npmPackage = JSON.parse(readFileSync(packageFile, {encoding: 'utf-8'}));
    let file = npmPackage['module'] || npmPackage['main'];
    if (typeof file === 'string') {
      const projectPath = path.join('node_modules', moduleName, file);
      if (fileExists(projectPath))
        return '/' + projectPath;
    }
  }
  return undefined;
}
