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
  const res = resolveCompilerPaths(decl, compilerOptions)
  if (res)
    return res;
  return resolveNodeDependency(decl);
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

function resolveNodeDependency(decl: ImportDeclaration): string | undefined {
  const pj = loadPackage('package.json');

  let modulePath = 'node_modules/' + decl.moduleName;
  const dep = pj.dependencies ? pj.dependencies[decl.moduleName] : undefined;
  if (dep && dep.startsWith('file:/')) {
    modulePath = dep.substring('file:/'.length);
  }

  if (decl.filePath) {
    const file = path.join(modulePath, decl.filePath + '.js');
    if (fileExists(file))
      return '/' + file;
  }

  const packageFile = path.join(modulePath, 'package.json');
  if (fileExists(packageFile)) {
    const npmPackage = loadPackage(packageFile);
    let file = npmPackage.module || npmPackage.main;
    if (typeof file === 'string') {
      const projectPath = path.join(modulePath, file);
      if (fileExists(projectPath))
        return '/' + projectPath;
    }
  }
  return undefined;
}

function loadPackage(packageFile: string): PackageJson {
  return JSON.parse(readFileSync(packageFile, {encoding: 'utf-8'})) as PackageJson;
}

interface PackageJson {
  module?: string;
  main?: string;
  dependencies?: { [name: string]: string };
}
