import path from 'path';
import fs from 'fs';

import { DefaultModuleResolverOptions, ModuleResolver, Alias } from './tsdserver';
import { fileExists, replaceMatches } from './Utils';
import { AliasResolver, isAlias, isAliasOptions } from './Alias';
import { isObject, isString } from 'util';

export function isModuleAlias(obj: any): obj is Alias<string> {
  return isAlias(obj, (e): e is string => isString(e));
}

export function isDefaultModuleResolverOptions(obj: any): obj is DefaultModuleResolverOptions {
  if (isObject(obj) && obj.alias) {
    const alias = (obj as DefaultModuleResolverOptions).alias;
    return isAliasOptions(alias, (e): e is string => isString(e));
  }
  return false;
}

export function defaultResolver(options?: DefaultModuleResolverOptions): ModuleResolver {
  if (!options || !options.alias || options.alias.length == 0) {
    return name => name;
  }

  const aliaser = new AliasResolver<string>(options.alias, replaceMatches);
  return name => {
    name = aliaser.resolve(name) || name;
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
