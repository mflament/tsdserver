# tsdserver

TypeScript developement server.

A simple HTTP server (using [micro](https://github.com/zeit/micro)) to serve your TypeScript web site static resources
and update javascript imports.

## Features:

- Lookup the requested resources in multiple root directories.
- Map a requested resource path to one or more paths.
- Resolve and rewrite javascript imports with the resolved module path
- Suffix any requested module with '.js' extension
- Wrap any file requested as javascript (from request path extension) but that did not resolve to a JS file (done by the
  mapFileName option). This allows you to import text resources from your javascript module, but load the raw resource
  on the server (ie: HTML templates stored in HTML files).

## Requirements

This plugin requires a LTS Node version (v10.0.0+).

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

Will start a server with default configuration listening on port 8080 of local interface.

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

All the options are described in 'Option.ts'
