/**
 * The tsdserver options.
 */
export interface Options {
  /**
   * Welcome file. Default to 'index.html'
   */
  welcome: string;

  /**
   * List of directories used to lookup requested resources.
   * Defaut to './'
   */
  directories: string[];

  /**
   * tsconfig location. Default to './tsconfig.json'
   */
  tsconfig: string;

  debug: boolean;
}

export interface CompilerOptions {
  target: 'ES3' | 'ES5' | 'ES2015' | 'ES2016' | 'ES2017' | 'ES2018' | 'ES2019' | 'ES2020' | 'ESNext' | 'Latest';
  module: 'ES2020' | 'ESNext' | string;
  baseUrl: string;
  paths: { [id: string]: string[] };
  outDir: string;
}
