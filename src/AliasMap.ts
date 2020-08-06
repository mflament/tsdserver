import { types } from 'util';
import { replaceMatches } from './Utils';

/**
 * An alias associating a value to a string or a regexp.
 */
export interface Alias {
  /**
   * A function, a string or a regexp used to match the module name.
   */
  find: ((path: string) => boolean | string[] | null | undefined) | string | RegExp;
  /**
   * The replacement used for module path. Matched groups can be refenced using $1, $2, ...
   */
  replace: ((...matches: string[]) => string) | string | null;
}

/**
 * AliasOptions<T>
 */
export type AliasMap = { [key: string]: string } | Alias[];

function isAlias(obj: any): obj is Alias {
  if (obj !== null && typeof obj === 'object') {
    const alias = obj as Alias;

    const findType = typeof alias.find;
    const replaceType = alias.replace ? typeof alias.replace : null;
    return (
      (findType === 'string' || findType === 'function' || types.isRegExp(alias.find)) &&
      (replaceType === null || replaceType === 'string' || replaceType === 'function')
    );
  }
  return false;
}

function isAliasArray(obj: any): obj is Alias[] {
  return Array.isArray(obj) && obj.every(o => isAlias(o));
}

export function newAliasResolver(param?: AliasMap): (name: string) => string | null | undefined {
  const aliases: Alias[] = [];
  if (isAliasArray(param)) {
    aliases.push(...param);
  } else if (param != null && typeof param === 'object') {
    for (const key in param) {
      const alias: Alias = {
        find: key,
        replace: param[key]
      };
      if (isAlias(alias)) {
        aliases.push(alias);
      }
    }
  }

  return name => {
    for (const alias of aliases) {
      if (alias.find === name) {
        if (typeof alias.replace === 'function') return alias.replace(name);
        return alias.replace;
      }

      if (types.isRegExp(alias.find)) {
        const matches = name.match(alias.find);
        if (matches) {
          if (alias.replace == null) return null;
          if (typeof alias.replace === 'function') return alias.replace(...matches);
          return replaceMatches(alias.replace, matches);
        }
        return undefined;
      }

      if (typeof alias.find === 'function') {
        let results = alias.find(name);
        if (results) {
          if (results == null) return null;

          if (typeof results === 'string') results = [results];
          else if (results === true) results = [name];

          if (alias.replace === null) return null;
          if (typeof alias.replace === 'function') return alias.replace(...results);
          return replaceMatches(alias.replace, results);
        }
        return undefined;
      }
    }
  };
}
