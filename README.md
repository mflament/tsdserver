# tsdserver

TypeScript developement server.

A simple HTTP server (using [micro](https://github.com/zeit/micro)) to serve your TypeScript web site static resources
and update javascritp imports.

## Features:

- Lookup the requested resources in multiple root directories.
- Map a requested resource path to one or more paths.
- Resolve and rewrite javascript imports with the resolved module path
- Suffix any requested module with '.js' extension
- Wrap any file requested as javascript (from request path extension) but that did not resolve to a JS file (done by the
  mapFileName option). This allows you to import text resources from your javascript module, but load the raw resource
  on the server (ie: HTML templates stored in HTML files).

## Requirements

This plugin requires an LTS Node version (v10.0.0+).

## Install

Using npm:

```
npm install tsdserver --save-dev
```

## Usage:

From the command line, in the project directory:

```
npx tsdserver -l tcp://127.0.0.1:8080
```

Will start a server with default configuration listeneing to port 8080 of local interface.

Use `npx tsdserver --help` to get more details on command line options.

You can also create a npm script in you `package.json` to start the dev server:

```
"scripts": {
    "http-server": "tsdserver -l tcp://localhost:8080"
}
```

### Configuration

Configuration can be a JSON file or a CommonJS module. If you need to customize the file name mapping or module
resolution functions, you will need to use a CommonJS module.

### Options:

```
{
  /**
   * Welcome file. Default to 'index.html'
   */
  welcome?: string;
  /**
   * List of directories used to lookup requested resources.
   * "." and "node_modules" will always be added at the end of this list.
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
   * A function to convert a requested file name to a one or more file name to lookup.
   */
  mapFileName?: ((name: string) => string[] | string) |
                { [key: string]: string[] | string }  |
                {
                  find: string | RegExp;
                  replacement: string | string[];
                }[];
  /**
   * A function used to resolve module path while updating JS imports.
   * Can also be the configuration for the default module resolver.
   */
  resolveModule?: ((name: string) => string) |
                  {
                    alias: { [key: string]: string } |
                           {
                             find: string | RegExp;
                             replacement: string;
                           }
                 }[];
}
```

#### mapFileName:

A function used to convert the requested resource path. Can return an array of resources to check in all configured
directories.  
This can also be an alias map configuration.

#### resolveModule

Used to resolve module path from module name.  
Can be a function `(name: string) => string` that convert a module name to a path. This path will then be requested by
follwing request on this import and will use the root directories to find the js file as any other resources.

It can also be a configuration object for the default module resolver. Right now, there is a single option for this
resolver, the 'alias' (inspired from
[rollup-plugin-alias](https://github.com/rollup/plugins/tree/master/packages/alias#readme)).
