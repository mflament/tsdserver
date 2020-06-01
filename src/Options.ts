import { ResourceTransformer } from './ResourceTransformer';
import { JSImportTransformerOptions } from './JSImportTransformer';

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

  fallback?: (path: string) => string | undefined;

  transformers?: ResourceTransformer[];

  updateJSImport?: boolean | JSImportTransformerOptions;

  wrapJSResources?: boolean;
}
