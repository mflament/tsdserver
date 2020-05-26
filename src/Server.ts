import arg from 'arg';

import path from 'path';

import serve, { RequestHandler } from 'micro';
import { version } from '../package.json';

import { Server } from 'http';
import { AddressInfo } from 'net';
import { createTSDRequestListener } from './RequestHandler';
import { isObject, isArray, isNumber, isFunction, isString } from 'util';

import { fileExists, isStringArray } from './Utils';

import { Options } from './tsdserver';
import { isAlias, isAliasOptions } from './Alias';
import { isDefaultModuleResolverOptions } from './DefaultModuleResolver';

const HELP_MESSAGE = `
tsdserver - Asynchronous HTTP resources for typescript web testing.
USAGE

    $ tsdserver --help
    $ tsdserver --version
    $ tsdserver [-l listen_uri [-l ...]] [js or json config]

    By default tsdserver will listen on 0.0.0.0:3000 and will look for
    a "tsdserver.config.js" or "tsdserver.json" file in project directory.

    Specifying a single --listen argument will overwrite the default, not supplement it.

OPTIONS

    --help                              shows this help message

    -v, --version                       displays the current version of tsdserver

    -l, --listen listen_uri             specify a URI endpoint on which to listen (see below) -
                                        more than one may be specified to listen in multiple places

ENDPOINTS

    Listen endpoints (specified by the --listen or -l options above) instruct tsdserver
    to listen on one or more interfaces/ports, UNIX domain sockets, or Windows named pipes.

    For TCP (traditional host/port) endpoints:

        $ tsdserver -l tcp://hostname:1234

    For UNIX domain socket endpoints:

        $ tsdserver -l unix:/path/to/socket.sock

    For Windows named pipe endpoints:

        $ tsdserver -l pipe:\\\\.\\pipe\\PipeName
`;

type EndPoint = (server: Server, listener: () => void) => void;

function parseEndpoint(value: string, name: string): EndPoint {
  const url = new URL(value);
  switch (url.protocol) {
    case 'pipe:': {
      // some special handling
      const cutStr = value.replace(/^pipe:/, '');
      if (cutStr.slice(0, 4) !== '\\\\.\\') {
        throw new Error(`Invalid Windows named pipe endpoint: ${value}`);
      }
      //return [cutStr];
      return (s, listener) => s.listen(cutStr, listener);
    }
    case 'unix:':
      if (!url.pathname) {
        throw new Error(`Invalid UNIX domain socket endpoint: ${value}`);
      }
      return (s, listener) => s.listen(url.pathname, listener);
    case 'tcp:':
      url.port = url.port || '3000';
      return (s, listener) => s.listen(parseInt(url.port), url.hostname, listener);
    default:
      throw new Error(`Unknown --listen endpoint scheme (protocol): ${url.protocol}`);
  }
}

function isAddressInfo(o: any): o is AddressInfo {
  return typeof o === 'object' && (o as AddressInfo).port !== undefined;
}

function isServerOptions(obj: any): obj is Options {
  if (!isObject(obj)) {
    console.error('options is not an object', obj);
    return false;
  }

  const options = obj as Options;
  if (options.directories) {
    if (!isArray(options.directories)) {
      console.error('options.directories is not an array', options.directories);
      return false;
    }

    if (!options.directories.every(d => isString(d))) {
      console.error('options.directories contains invalid type, expeccted only string', options.directories);
      return false;
    }
  }

  if (options.ecmaVersion && !isNumber(options.ecmaVersion)) {
    // TODO : improve check by restricting to ecmaVersion values
    console.error('options.ecmaVersion has an invalid value', options.ecmaVersion);
    return false;
  }

  if (options.sourceType && options.sourceType !== 'module' && options.sourceType !== 'script') {
    console.error('options.sourceType has an invalid value', options.sourceType);
    return false;
  }

  if (
    options.mapFileName &&
    !isAliasOptions(options.mapFileName, (e): e is string | string[] => isString(e) || isStringArray(e)) &&
    !isFunction(options.mapFileName)
  ) {
    console.error('options.mapFileName has an invalid type: ' + typeof options.mapFileName, options.mapFileName);
    return false;
  }

  if (
    options.resolveModule !== undefined &&
    !isDefaultModuleResolverOptions(options.resolveModule) &&
    !isFunction(options.resolveModule)
  ) {
    console.error('options.resolveModule is invalid', options.resolveModule);
    return false;
  }
  return true;
}

async function loadOptions(files: string[]): Promise<Options | null> {
  for (let file of files) {
    if (!path.isAbsolute(file)) file = path.resolve(file);
    if (fileExists(file)) {
      let obj;
      try {
        obj = await require(file);
      } catch (e) {
        console.error('Error loading options file ' + file, e);
      }
      if (isServerOptions(obj)) {
        console.info('Using options file ' + file);
        return obj;
      }
    }
  }
  return null;
}

async function parseCommandLine(): Promise<{ endpoints: EndPoint[]; options: Options }> {
  // Check if the user defined any options
  const args = arg({
    '--listen': [parseEndpoint],
    '-l': '--listen',

    '--help': Boolean,

    '--version': Boolean,
    '-v': '--version'
  });

  // When `-h` or `--help` are used, print out
  // the usage information
  if (args['--help']) {
    console.error(HELP_MESSAGE);
    process.exit(2);
  }

  // Print out the package's version when
  // `--version` or `-v` are used
  if (args['--version']) {
    console.log(version);
    process.exit();
  }

  let endpoints: EndPoint[];
  if (!args['--listen'] || args['--listen'].length === 0) {
    // default endpoint
    endpoints = [(s, cb) => s.listen(3000, cb)];
  } else {
    endpoints = args['--listen'];
  }

  const optionsFiles = [];
  if (args._[0]) optionsFiles.push(args._[0]);
  optionsFiles.push('tsdserver.config.js', 'tsdserver.json');
  let options = await loadOptions(optionsFiles);

  if (!options) {
    options = {
      ecmaVersion: 2015,
      sourceType: 'module'
    };
  }

  return {
    endpoints: endpoints,
    options: options
  };
}

function registerShutdown(fn: () => void): void {
  let run = false;

  const wrapper = () => {
    if (!run) {
      run = true;
      fn();
    }
  };

  process.on('SIGINT', wrapper);
  process.on('SIGTERM', wrapper);
  process.on('exit', wrapper);
}

function startEndpoint(module: RequestHandler, endpoint: EndPoint): void {
  const server = serve(module);
  server.on('error', err => {
    console.error('tsdserver:', err.stack);
    process.exit(1);
  });

  endpoint(server, () => {
    registerShutdown(() => server.close());
    const details = server.address();
    // `tsdserver` is designed to run only in production, so
    // this message is perfectly for prod
    if (typeof details === 'string') {
      console.log(`micro: Accepting connections on ${details}`);
    } else if (isAddressInfo(details)) {
      console.log(`micro: Accepting connections on port ${details.port}`);
    } else {
      console.log('micro: Accepting connections');
    }
  });
}

async function start(): Promise<void> {
  try {
    const commandLine = await parseCommandLine();
    const listener = createTSDRequestListener(commandLine.options);
    for (const endpoint of commandLine.endpoints) {
      startEndpoint(listener, endpoint);
    }
    registerShutdown(() => console.log('micro: Gracefully shutting down. Please wait...'));
  } catch (e) {
    console.error(e);
  }
}

export default { start: start };
