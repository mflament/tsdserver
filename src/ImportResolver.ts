import { ResolvedFile } from './ResolvedFile';
import { posix as path } from 'path';
import { readFile, readFileSync } from 'fs';
import { fileExists } from './Utils';
import { MapLike } from 'typescript';
import { ImportDeclaration } from './JSImportTransformer';
import { CompilerOptions } from './Options';

export type ImportResolver = (declaration: ImportDeclaration) => string | undefined;

export function createImportResolver(options: CompilerOptions): ImportResolver {
  return decl => resolvePath(decl, options) || decl.filePath;
}

function resolvePath(decl: ImportDeclaration, compilerOptions: CompilerOptions): string | undefined {
  let resolvedPath;
  let importPath = decl.path;
  for (const key in compilerOptions.paths) {
    const values = compilerOptions.paths[key];
    if (key === importPath) {
      resolvedPath = values.find(v => fileExists(path.join(compilerOptions.outDir, v + '.js')));
      break;
    }
    const prefix = key.endsWith('*') ? key.substring(0, key.length - 1) : undefined;
    if (prefix && importPath.startsWith(prefix)) {
      const np = importPath.substring(prefix.length) + '.js';
      resolvedPath = values.map(v => v.replace('*', np)).find(f => fileExists(path.resolve(compilerOptions.outDir, f)));
      break;
    }
  }

  if (resolvedPath) return resolvedPath;

  const moduleName = decl.moduleName;
  const packageFile = path.join('node_modules', moduleName, 'package.json');
  if (fileExists(packageFile)) {
    const npmPackage = JSON.parse(readFileSync(packageFile, { encoding: 'utf-8' }));
    let file = npmPackage['module'] || npmPackage['main'];
    const projectPath = path.join('node_modules', moduleName, file);
    if (typeof file === 'string' && fileExists(projectPath)) {
      return '/' + projectPath;
    }
  }

  return resolvedPath;
}

// function resolveNode(name: string): string | undefined {
//   return undefined;
// }
