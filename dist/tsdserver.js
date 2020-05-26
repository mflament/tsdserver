'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var arg = _interopDefault(require('arg'));
var path = _interopDefault(require('path'));
var serve = _interopDefault(require('micro'));
var url = _interopDefault(require('url'));
var fs = _interopDefault(require('fs'));
var mime = _interopDefault(require('mime-types'));
var acorn = _interopDefault(require('acorn'));
var walk = _interopDefault(require('acorn-walk'));
var util = require('util');

var version = "1.0.0";

function fileExists(path) {
    const stats = fileStats(path);
    return stats !== null && stats.isFile();
}
function fileStats(path) {
    try {
        return fs.statSync(path, { bigint: false });
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
        return null;
    }
}
function isStringArray(obj) {
    if (util.isArray(obj)) {
        return obj.every(e => util.isString(e));
    }
    return false;
}
function replaceMatches(s, matches) {
    let res = s;
    for (let index = 0; index < matches.length; index++) {
        res = s.replace('$' + index, matches[index]);
    }
    return res;
}

class AliasResolver {
    constructor(param, replacer) {
        this.aliases = [];
        this.replacer = replacer;
        let aliases;
        if (util.isArray(param)) {
            aliases = param;
        }
        else {
            aliases = [];
            for (const key in param) {
                aliases.push({
                    find: key,
                    replacement: param[key]
                });
            }
        }
        this.aliases = aliases;
    }
    resolve(name) {
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
function isAliasOptions(obj, isElement) {
    if (util.isArray(obj))
        return obj.every(a => isAlias(a, isElement));
    if (util.isObject(obj))
        return Object.keys(obj).every(k => util.isString(k)) && Object.values(obj).every(v => isElement(v));
    return false;
}
function isAlias(obj, isElement) {
    if (util.isObject(obj)) {
        const alias = obj;
        if (util.isString(alias.find) || util.isRegExp(alias.find))
            return false;
        return isElement(alias.replacement);
    }
    return false;
}

function isDefaultModuleResolverOptions(obj) {
    if (util.isObject(obj) && obj.alias) {
        const alias = obj.alias;
        return isAliasOptions(alias, (e) => util.isString(e));
    }
    return false;
}
function defaultResolver(options) {
    if (!options || !options.alias || options.alias.length == 0) {
        return name => name;
    }
    const aliaser = new AliasResolver(options.alias, replaceMatches);
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

function isModuleResolver(obj) {
    return util.isFunction(obj);
}
class JSImportUpdater {
    constructor(options) {
        options = options || {};
        this.sourceType = options.sourceType || 'module';
        this.ecmaVersion = options.ecmaVersion || 2020;
        if (isModuleResolver(options.resolveModule)) {
            this.moduleResolver = options.resolveModule;
        }
        else {
            this.moduleResolver = defaultResolver(options.resolveModule);
        }
    }
    update(code) {
        const parsed = acorn.parse(code, {
            sourceType: this.sourceType,
            ecmaVersion: this.ecmaVersion,
            ranges: true
        });
        let newCode = '';
        let offset = 0;
        const visitor = (node) => {
            if (!isImportNode(node))
                throw new Error('Not an import node');
            if (!node.source.range)
                throw new Error('No range');
            let name = node.source.value;
            if (!name)
                return;
            if (!isRelativeModule(name)) {
                name = this.moduleResolver(name);
            }
            if (!name.endsWith('.js'))
                name += '.js';
            if (name !== node.source.value) {
                newCode += code.substring(offset, node.source.range[0]);
                newCode += '"' + name + '"';
                offset = node.source.range[1];
            }
        };
        walk.simple(parsed, {
            ImportDeclaration: visitor,
            ImportExpression: visitor
        });
        if (offset < code.length) {
            newCode += code.substring(offset, code.length);
        }
        return newCode;
    }
}
function isImportNode(node) {
    return node !== undefined && node.source !== undefined;
}
function isRelativeModule(name) {
    return name.startsWith('/') || name.startsWith('./') || name.startsWith('../');
}

class ResolvedFile {
    constructor(requestPath, file, stats) {
        this.requestPath = requestPath;
        this.file = file;
        this.stats = stats;
        this.mimeType = mime.lookup(path.extname(this.requestPath)) || undefined;
    }
    isUpToDate(message) {
        const fileDate = this.stats.mtime;
        let header = message.headers['if-match'];
        if (header !== undefined) {
            const time = parseInt(header);
            if (!isNaN(time)) {
                return fileDate.getTime() === time;
            }
        }
        header = message.headers['if-modified-since'];
        if (header) {
            const time = Date.parse(header);
            if (!isNaN(time)) {
                const fileTime = Math.floor(fileDate.getTime() / 1000);
                const requestTime = Math.floor(time / 1000);
                return fileTime === requestTime;
            }
        }
        return false;
    }
    async write(response, jsUpdater) {
        const headers = {};
        if (this.mimeType)
            headers['Content-Type'] = this.mimeType;
        headers['Last-Modified'] = this.stats.mtime.toUTCString();
        headers['ETag'] = this.stats.mtime.getTime();
        headers['Cache-Control'] = 'no-cache, max-age=0';
        response.writeHead(200, headers);
        if (this.requestedJS) {
            let code = await this.readText(this.file);
            if (!this.resolvedJS) {
                code = this.wrapResource(code);
            }
            else {
                code = jsUpdater.update(code);
            }
            return this.writeText(code, response);
        }
        else {
            return this.stream(this.file, response);
        }
    }
    get requestedJS() {
        return this.requestPath.endsWith('.js');
    }
    get resolvedJS() {
        return this.file.endsWith('.js');
    }
    wrapResource(code) {
        return 'export default `' + code + '`;\r\n';
    }
    async stream(path, out) {
        return new Promise(resolve => {
            const stream = fs.createReadStream(path);
            stream.on('end', resolve);
            stream.on('error', resolve);
            stream.pipe(out, { end: false });
        });
    }
    async writeText(data, out) {
        return new Promise((resolve, reject) => {
            out.on('error', reject);
            out.write(data, 'utf-8', e => {
                if (e)
                    reject(e);
                else
                    resolve();
            });
        });
    }
    async readText(path) {
        return new Promise((resolve, reject) => {
            fs.readFile(path, { encoding: 'utf-8' }, (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(data);
            });
        });
    }
}
function isFileResolver(obj) {
    return util.isFunction(obj);
}
function isFileAliasOptions(obj) {
    return isAliasOptions(obj, (e) => util.isString(e) || isStringArray(e));
}
class FileResolver {
    constructor(options) {
        this.options = options;
        const option = this.options.mapFileName;
        if (!option)
            this.resolver = () => undefined;
        else if (isFileResolver(option)) {
            this.resolver = option;
        }
        else if (isFileAliasOptions(option)) {
            const aliaser = new AliasResolver(option, (value, matches) => {
                if (util.isString(value))
                    return replaceMatches(value, matches);
                return value.map(v => replaceMatches(v, matches));
            });
            this.resolver = n => aliaser.resolve(n);
        }
        else {
            console.error('Invalid mapFileName options');
            this.resolver = () => undefined;
        }
    }
    resolve(requestPath) {
        const resolved = this.resolver(requestPath);
        let fileNames;
        if (!resolved)
            fileNames = [requestPath];
        else if (util.isString(resolved))
            fileNames = [resolved];
        else
            fileNames = resolved;
        const directories = new Set();
        if (this.options.directories) {
            this.options.directories.map(d => path.resolve(d)).forEach(d => directories.add(d));
        }
        directories.add(path.resolve('.'));
        directories.add(path.resolve('node_modules'));
        for (const name of fileNames) {
            for (const directory of directories) {
                let file = path.resolve(directory, name);
                const stats = fileStats(file);
                if (stats != null) {
                    return new ResolvedFile(requestPath, file, stats);
                }
            }
        }
    }
}
function extractPath(requestUrl) {
    let requestPath = url.parse(requestUrl).pathname;
    if (requestPath) {
        if (requestPath.startsWith('/'))
            requestPath = requestPath.substring(1);
        requestPath = decodeURI(requestPath);
    }
    return requestPath;
}
function createTSDRequestListener(options) {
    const fileResolver = new FileResolver(options);
    const jsUpdater = new JSImportUpdater(options);
    return async (message, response) => {
        if (message.method !== 'GET') {
            response.writeHead(405, { Allow: 'GET' });
            response.end();
            return;
        }
        if (!message.url) {
            response.writeHead(500, 'no url');
            response.end();
            return;
        }
        let requestPath = extractPath(message.url) || options.welcome || 'index.html';
        const file = fileResolver.resolve(requestPath);
        if (file) {
            if (file.isUpToDate(message)) {
                response.writeHead(304, {});
            }
            else {
                try {
                    await file.write(response, jsUpdater);
                }
                catch (e) {
                    console.error('Error sending response for ' + requestPath, file, e);
                }
            }
        }
        else {
            console.info('Resource not found "' + requestPath + '"');
            response.writeHead(404, `${requestPath} not found`);
        }
        response.end();
    };
}

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
function parseEndpoint(value, name) {
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
function isAddressInfo(o) {
    return typeof o === 'object' && o.port !== undefined;
}
function isServerOptions(obj) {
    if (!util.isObject(obj)) {
        console.error('options is not an object', obj);
        return false;
    }
    const options = obj;
    if (options.directories) {
        if (!util.isArray(options.directories)) {
            console.error('options.directories is not an array', options.directories);
            return false;
        }
        if (!options.directories.every(d => util.isString(d))) {
            console.error('options.directories contains invalid type, expeccted only string', options.directories);
            return false;
        }
    }
    if (options.ecmaVersion && !util.isNumber(options.ecmaVersion)) {
        // TODO : improve check by restricting to ecmaVersion values
        console.error('options.ecmaVersion has an invalid value', options.ecmaVersion);
        return false;
    }
    if (options.sourceType && options.sourceType !== 'module' && options.sourceType !== 'script') {
        console.error('options.sourceType has an invalid value', options.sourceType);
        return false;
    }
    if (options.mapFileName &&
        !isAliasOptions(options.mapFileName, (e) => util.isString(e) || isStringArray(e)) &&
        !util.isFunction(options.mapFileName)) {
        console.error('options.mapFileName has an invalid type: ' + typeof options.mapFileName, options.mapFileName);
        return false;
    }
    if (options.resolveModule !== undefined &&
        !isDefaultModuleResolverOptions(options.resolveModule) &&
        !util.isFunction(options.resolveModule)) {
        console.error('options.resolveModule is invalid', options.resolveModule);
        return false;
    }
    return true;
}
async function loadOptions(files) {
    for (let file of files) {
        if (!path.isAbsolute(file))
            file = path.resolve(file);
        if (fileExists(file)) {
            let obj;
            try {
                obj = await require(file);
            }
            catch (e) {
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
async function parseCommandLine() {
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
    let endpoints;
    if (!args['--listen'] || args['--listen'].length === 0) {
        // default endpoint
        endpoints = [(s, cb) => s.listen(3000, cb)];
    }
    else {
        endpoints = args['--listen'];
    }
    const optionsFiles = [];
    if (args._[0])
        optionsFiles.push(args._[0]);
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
function registerShutdown(fn) {
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
function startEndpoint(module, endpoint) {
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
        }
        else if (isAddressInfo(details)) {
            console.log(`micro: Accepting connections on port ${details.port}`);
        }
        else {
            console.log('micro: Accepting connections');
        }
    });
}
async function start() {
    try {
        const commandLine = await parseCommandLine();
        const listener = createTSDRequestListener(commandLine.options);
        for (const endpoint of commandLine.endpoints) {
            startEndpoint(listener, endpoint);
        }
        registerShutdown(() => console.log('micro: Gracefully shutting down. Please wait...'));
    }
    catch (e) {
        console.error(e);
    }
}
var Server = { start: start };

module.exports = Server;
//# sourceMappingURL=tsdserver.js.map
