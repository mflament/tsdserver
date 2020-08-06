import path from 'path';
import fs from 'fs';

import { fileExists } from './Utils';
import { AliasMap, newAliasResolver } from './AliasMap';

export type ModuleResolver = (name: string) => string | null;

export function defaultResolver(aliasMap?: AliasMap): ModuleResolver {
  const resolver = newAliasResolver(aliasMap);
  return name => {
    if (resolver) {
      const resolvedPath = resolver(name);
      if (resolvedPath === null) return null;
      if (resolvedPath) name = resolvedPath;
    }
    const packageFile = path.join('node_modules', name, 'package.json');
    if (fileExists(packageFile)) {
      const npmPackage = JSON.parse(fs.readFileSync(packageFile, { encoding: 'utf-8' }));
      let file = npmPackage['module'] || npmPackage['main'];
      if (typeof file === 'string') {
        if (fileExists(path.join('node_modules', name, file))) {
          return '/' + path.posix.join(name, file);
        }
      }
    }
    return '/' + name;
  };
}
