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

var version = "2.0.0";

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
function replaceMatches(s, matches) {
    let res = s;
    for (let index = 0; index < matches.length; index++) {
        res = s.replace('$' + index, matches[index]);
    }
    return res;
}

function isAlias(obj) {
    if (obj !== null && typeof obj === 'object') {
        const alias = obj;
        const findType = typeof alias.find;
        const replaceType = alias.replace ? typeof alias.replace : null;
        return ((findType === 'string' || findType === 'function' || util.types.isRegExp(alias.find)) &&
            (replaceType === null || replaceType === 'string' || replaceType === 'function'));
    }
    return false;
}
function isAliasArray(obj) {
    return Array.isArray(obj) && obj.every(o => isAlias(o));
}
function newAliasResolver(param) {
    const aliases = [];
    if (isAliasArray(param)) {
        aliases.push(...param);
    }
    else if (param != null && typeof param === 'object') {
        for (const key in param) {
            const alias = {
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
                if (typeof alias.replace === 'function')
                    return alias.replace(name);
                return alias.replace;
            }
            if (util.types.isRegExp(alias.find)) {
                const matches = name.match(alias.find);
                if (matches) {
                    if (alias.replace == null)
                        return null;
                    if (typeof alias.replace === 'function')
                        return alias.replace(...matches);
                    return replaceMatches(alias.replace, matches);
                }
                return undefined;
            }
            if (typeof alias.find === 'function') {
                let results = alias.find(name);
                if (results) {
                    if (results == null)
                        return null;
                    if (typeof results === 'string')
                        results = [results];
                    else if (results === true)
                        results = [name];
                    if (alias.replace === null)
                        return null;
                    if (typeof alias.replace === 'function')
                        return alias.replace(...results);
                    return replaceMatches(alias.replace, results);
                }
                return undefined;
            }
        }
    };
}

function defaultResolver(aliasMap) {
    const resolver = newAliasResolver(aliasMap);
    return name => {
        if (resolver) {
            const resolvedPath = resolver(name);
            if (resolvedPath === null)
                return null;
            if (resolvedPath)
                name = resolvedPath;
        }
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
    return typeof obj === 'function';
}
function isRelativeModule(name) {
    return name.startsWith('/') || name.startsWith('./') || name.startsWith('../');
}
function isImportDeclaration(node) {
    return node.type === 'ImportDeclaration' || node.type === 'ImportExpression';
}
function isExportDeclaration(node) {
    return node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration';
}
function getSource(node) {
    if (isImportDeclaration(node))
        return node.source;
    if (isExportDeclaration(node))
        return node.source;
    return null;
}
const newTransformer = (options) => {
    if (options === undefined || typeof options === 'boolean')
        options = {};
    const sourceType = options.sourceType || 'module';
    const ecmaVersion = options.ecmaVersion || 2020;
    let moduleResolver;
    if (isModuleResolver(options.moduleResolver)) {
        moduleResolver = options.moduleResolver;
    }
    else {
        moduleResolver = defaultResolver(options.moduleResolver);
    }
    const updateSource = (code) => {
        const parsed = acorn.parse(code, {
            sourceType: sourceType,
            ecmaVersion: ecmaVersion,
            ranges: true
        });
        let newCode = '';
        let offset = 0;
        const visitor = (node) => {
            const source = getSource(node);
            if (!source)
                return;
            if (!source.range) {
                console.error('No; range in AST node');
                return;
            }
            let name = source.value;
            if (!name)
                return;
            if (!isRelativeModule(name)) {
                let resolved = moduleResolver(name);
                if (resolved === null) {
                    if (node.range) {
                        newCode += code.substring(offset, node.range[0]);
                        offset = node.range[1];
                        return;
                    }
                    else
                        console.error('No range for node', node);
                }
                else {
                    //if (!resolved.startsWith('./')) resolved = './' + resolved;
                    name = resolved;
                }
            }
            if (!name.endsWith('.js'))
                name += '.js';
            if (name !== source.value) {
                newCode += code.substring(offset, source.range[0]);
                newCode += '"' + name + '"';
                offset = source.range[1];
            }
        };
        walk.simple(parsed, {
            ImportDeclaration: visitor,
            ImportExpression: visitor,
            ExportNamedDeclaration: visitor,
            ExportAllDeclaration: visitor
        });
        if (offset < code.length) {
            newCode += code.substring(offset, code.length);
        }
        return newCode;
    };
    return async (file) => {
        if (file.resolvedFile.endsWith('.js')) {
            const code = await file.readText();
            try {
                return updateSource(code);
            }
            catch (e) {
                console.error('Error parsing ' + file.resolvedFile, e);
                return code;
            }
        }
        return undefined;
    };
};

var JSResourceWrapper = () => {
    return async (file) => {
        if (file.requestedPath.endsWith('.js') && !file.resolvedFile.endsWith('.js')) {
            const code = await file.readText();
            return 'export default `' + code + '`;\n';
        }
        return undefined;
    };
};

const JS_MIME_TYPE = 'application/javascript';
class DefaultResolvedFile {
    /**
     *
     * @param requestedPath requested path
     * @param resolvedFile resolved resource name
     * @param stats
     */
    constructor(requestedPath, resolvedPath, resolvedFile, stats) {
        this.requestedPath = requestedPath;
        this.resolvedPath = resolvedPath;
        this.resolvedFile = resolvedFile;
        this.stats = stats;
        this.content = null;
    }
    get requestedMimeType() {
        return mime.lookup(path.extname(this.requestedPath)) || undefined;
    }
    get resolvedMimeType() {
        return mime.lookup(path.extname(this.resolvedFile)) || undefined;
    }
    async readText() {
        if (this.content !== null) {
            return Promise.resolve(this.content);
        }
        return new Promise((resolve, reject) => {
            fs.readFile(this.resolvedFile, { encoding: 'utf-8' }, (err, data) => {
                if (err)
                    reject(err);
                else {
                    this.content = data;
                    resolve(data);
                }
            });
        });
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
    async write(response) {
        const headers = {};
        if (this.requestedMimeType) {
            headers['Content-Type'] = this.requestedMimeType;
        }
        headers['Last-Modified'] = this.stats.mtime.toUTCString();
        headers['ETag'] = this.stats.mtime.getTime();
        headers['Cache-Control'] = 'no-cache, max-age=0';
        response.writeHead(200, headers);
        if (this.content) {
            return this.writeText(this.content, response);
        }
        else {
            return this.stream(response);
        }
    }
    get isJSRequested() {
        return this.requestedMimeType === JS_MIME_TYPE;
    }
    get isJSResolved() {
        return this.resolvedMimeType === JS_MIME_TYPE;
    }
    async stream(out) {
        return new Promise(resolve => {
            const stream = fs.createReadStream(this.resolvedFile);
            function done() {
                stream.close();
                resolve();
            }
            stream.on('end', done);
            stream.on('error', done);
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
}
class FileResolver {
    constructor(options) {
        this.directories = [];
        if (options.wrapJSResources !== false) {
            this.fallback = p => {
                if (p.endsWith('.js'))
                    return p.substring(0, p.length - 3);
                if (options.fallback)
                    return options.fallback(p);
            };
        }
        else if (options.fallback) {
            if (typeof options.fallback === 'function') {
                this.fallback = options.fallback;
            }
            else {
                console.error("Invalid 'fallback' option, expected 'function'", options.fallback);
                this.fallback = () => undefined;
            }
        }
        else {
            this.fallback = () => undefined;
        }
        if (options.directories) {
            if (Array.isArray(options.directories)) {
                this.directories.push(...options.directories);
            }
            else {
                console.error("Invalid 'directories' option, expected 'array'", options.directories);
            }
        }
        this.directories.push('.');
        this.directories.push('node_modules');
    }
    resolve(requestPath) {
        let currentPath = requestPath;
        while (currentPath) {
            for (const directory of this.directories) {
                let file = path.resolve(directory, currentPath);
                const stats = fileStats(file);
                if (stats != null) {
                    return new DefaultResolvedFile(requestPath, currentPath, file, stats);
                }
            }
            currentPath = this.fallback(currentPath);
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
function createTransformers(options) {
    const transformers = [];
    if (options.transformers) {
        if (!Array.isArray(options.transformers)) {
            console.error("Invalid option 'transformers', expected 'array'", options.transformers);
        }
        else {
            for (const transformer of options.transformers) {
                if (typeof transformer === 'function') {
                    transformers.push(transformer);
                }
                else {
                    console.error("Invalid option 'transformer', expected 'function'", transformer);
                }
            }
        }
    }
    return transformers;
}
function createRequestListener(options) {
    options = options || {};
    const welcome = options.welcome || 'index.html';
    const fileResolver = new FileResolver(options);
    const transformers = createTransformers(options);
    if (options.updateJSImport !== false) {
        transformers.push(newTransformer(options.updateJSImport));
    }
    if (options.wrapJSResources !== false) {
        transformers.push(JSResourceWrapper());
    }
    async function handle(message, response) {
        var _a;
        if (!message.url)
            throw new Error('no url in message');
        let requestPath = extractPath(message.url) || welcome;
        const resolvedFile = fileResolver.resolve(requestPath);
        if (resolvedFile) {
            if ((_a = options) === null || _a === void 0 ? void 0 : _a.debug)
                console.log('handling request: ' + requestPath);
            if (resolvedFile.isUpToDate(message)) {
                response.writeHead(304, {});
            }
            else {
                for (const transformer of transformers) {
                    let newContent = await transformer(resolvedFile);
                    if (newContent !== undefined) {
                        resolvedFile.content = newContent;
                    }
                }
                await resolvedFile.write(response);
            }
        }
        else {
            console.info('Resource not found "' + requestPath + '"');
            response.writeHead(404, `${requestPath} not found`);
        }
    }
    return async (message, response) => {
        if (message.method !== 'GET') {
            response.writeHead(405, { Allow: 'GET' });
            response.end();
            return;
        }
        try {
            await handle(message, response);
        }
        catch (e) {
            console.log('Error handling request: ' + message.url, e);
            response.writeHead(500, 'Server error: ' + e.get);
        }
        finally {
            response.end();
        }
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
            if (obj !== null && typeof obj === 'object') {
                console.info('Using options file ' + file);
                return obj;
            }
        }
    }
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
        const listener = createRequestListener(commandLine.options);
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
