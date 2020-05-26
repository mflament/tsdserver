import { Alias, AliasOptions } from './tsdserver';
import { isArray, isObject, isString, isRegExp } from 'util';

type AliasValueReplacer<T> = (value: T, matches: RegExpMatchArray) => T;

export class AliasResolver<T> {
  private readonly replacer: AliasValueReplacer<T>;
  private readonly aliases: Alias<T>[] = [];
  constructor(param: AliasOptions<T>, replacer: AliasValueReplacer<T>) {
    this.replacer = replacer;
    let aliases: Alias<T>[];
    if (isArray(param)) {
      aliases = param;
    } else {
      aliases = [];
      for (const key in param) {
        aliases.push({
          find: name,
          replacement: param[key]
        });
      }
    }
    this.aliases = aliases;
  }

  resolve(name: string): T | undefined {
    for (const alias of this.aliases) {
      if (alias.find === name) {
        return alias.replacement;
      }

      if (alias.find instanceof RegExp) {
        const matches = name.match(alias.find);
        if (matches) {
          return this.replacer(alias.replacement, matches);
        }
      }
    }
    return undefined;
  }
}

export function isAliasOptions<T>(obj: any, isElement: (e: any) => e is T): obj is AliasOptions<T> {
  if (isArray(obj)) return obj.every(a => isAlias(a, isElement));
  if (isObject(obj)) return Object.keys(obj).every(k => isString(k)) && Object.values(obj).every(v => isElement(v));
  return false;
}

export function isAlias<T>(obj: any, isElement: (e: any) => e is T): obj is Alias<T> {
  if (isObject(obj)) {
    const alias = obj as Alias<T>;
    if (isString(alias.find) || isRegExp(alias.find)) return false;
    return isElement(alias.replacement);
  }
  return false;
}
