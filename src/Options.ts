import { AliasMap } from './AliasMap';
import { ModuleResolver } from './DefaultModuleResolver';
import { ResourceTransformer } from './ResourceTransformer';

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
   * An optional function called if a resource can not be resolved.
   */
  fallback?: (path: string) => string | undefined;

  /**
   * Resource transformers configuration
   */
  transformers?: ResourceTransformer[];

  /**
   * JavaScript imports transformer configuration
   */
  updateJSImport?: boolean | JSImportTransformerOptions;

  /**
   * Load and inject imported resources in JS (JSON/HTML)
   */
  wrapJSResources?: boolean;

  debug?: boolean;
}

export type SourceType = 'script' | 'module';
export type EcmaVersion = 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020;

export interface JSImportTransformerOptions {
  readonly sourceType?: SourceType;
  readonly ecmaVersion?: EcmaVersion;
  /**
   * Used to resolve a client module path from a JS import
   */
  readonly moduleResolver?: ModuleResolver | AliasMap;
}
