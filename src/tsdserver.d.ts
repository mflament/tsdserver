export type FileNameResolver = (name: string) => string[] | string;

export type ModuleResolver = (name: string) => string;

export type AliasKey = string | RegExp;

/**
 * An alias associating a value to a string or a regexp.
 */
export interface Alias<T> {
  /**
   * A string or a regexp used to match the module name.
   */
  find: AliasKey;
  /**
   * The replacement used for module path. Matched groups can be refenced using $1, $2, ...
   */
  replacement: T;
}

/**
 * AliasOptions<T>
 */
export type AliasOptions<T> = { [key: string]: T } | Alias<T>[];

/**
 * Default module resolver options.
 */
export interface DefaultModuleResolverOptions {
  /**
   * Used to map import path to module name.
   */
  alias: AliasOptions<string>;
}
/**
 * The tsdserver options.
 */
export interface Options {
  /**
   * Welcome file. Default to 'index.html'
   */
  welcome?: string;
  /**
   * List of directories used to lookup requested resources.
   * "." and "node_modules" will always be added to this list.
   */
  directories?: string[];
  /**
   * Source type of js. Used by of acorn parser
   */
  sourceType?: 'script' | 'module';
  /**
   * ecmaVersion of js. Used by of acorn parser
   */
  ecmaVersion?: 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020;
  /**
   * Used to convert a requested file path to a one or more paths to lookup.
   */
  mapFileName?: FileNameResolver | AliasOptions<string | string[]>;
  /**
   * Used to resolve module path from imported module name.
   */
  resolveModule?: ModuleResolver | DefaultModuleResolverOptions;
}
