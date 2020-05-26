import { IncomingMessage, ServerResponse, OutgoingHttpHeaders, RequestListener } from 'http';
import url from 'url';
import fs, { Stats } from 'fs';
import path from 'path';
import mime from 'mime-types';
import { JSImportUpdater } from './ImportUpdater';
import { fileStats, isStringArray, replaceMatches } from './Utils';
import { Options, FileNameResolver, AliasOptions } from './tsdserver';
import { isArray, isString, isFunction } from 'util';
import { AliasResolver, isAliasOptions } from './Alias';

export class ResolvedFile {
  readonly requestPath: string; // requested path
  readonly file: string; // resolved resource name
  readonly stats: Stats;
  readonly mimeType?: string;
  constructor(requestPath: string, file: string, stats: Stats) {
    this.requestPath = requestPath;
    this.file = file;
    this.stats = stats;
    this.mimeType = mime.lookup(path.extname(this.requestPath)) || undefined;
  }

  isUpToDate(message: IncomingMessage): boolean {
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

  async write(response: ServerResponse, jsUpdater: JSImportUpdater): Promise<void> {
    const headers: OutgoingHttpHeaders = {};
    if (this.mimeType) headers['Content-Type'] = this.mimeType;
    headers['Last-Modified'] = this.stats.mtime.toUTCString();
    headers['ETag'] = this.stats.mtime.getTime();
    headers['Cache-Control'] = 'no-cache, max-age=0';
    response.writeHead(200, headers);
    if (this.requestedJS) {
      let code = await this.readText(this.file);
      if (!this.resolvedJS) {
        code = this.wrapResource(code);
      } else {
        code = jsUpdater.update(code);
      }
      return this.writeText(code, response);
    } else {
      return this.stream(this.file, response);
    }
  }

  private get requestedJS(): boolean {
    return this.requestPath.endsWith('.js');
  }

  private get resolvedJS(): boolean {
    return this.file.endsWith('.js');
  }

  private wrapResource(code: string): string {
    return 'export default `' + code + '`;\r\n';
  }

  private async stream(path: string, out: ServerResponse): Promise<void> {
    return new Promise(resolve => {
      const stream = fs.createReadStream(path);
      stream.on('end', resolve);
      stream.on('error', resolve);
      stream.pipe(out, { end: false });
    });
  }

  private async writeText(data: string, out: ServerResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      out.on('error', reject);
      out.write(data, 'utf-8', e => {
        if (e) reject(e);
        else resolve();
      });
    });
  }

  private async readText(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(path, { encoding: 'utf-8' }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }
}

function isFileResolver(obj: any): obj is FileResolver {
  return isFunction(obj);
}

function isFileAliasOptions(obj: any): obj is AliasOptions<string | string[]> {
  return isAliasOptions(obj, (e): e is AliasOptions<string | string[]> => isString(e) || isStringArray(e));
}

class FileResolver {
  private readonly options: Options;
  private readonly resolver: (name: string) => string[] | string | undefined;

  constructor(options: Options) {
    this.options = options;
    const option = this.options.mapFileName;
    if (!option) this.resolver = () => undefined;
    else if (isFileResolver(option)) {
      this.resolver = option as FileNameResolver;
    } else if (isFileAliasOptions(option)) {
      const aliaser = new AliasResolver<string | string[]>(option, (value, matches) => {
        if (isString(value)) return replaceMatches(value, matches);
        return value.map(v => replaceMatches(v, matches));
      });
      this.resolver = n => aliaser.resolve(n);
    } else {
      console.error('Invalid mapFileName options');
      this.resolver = () => undefined;
    }
  }

  resolve(requestPath: string): ResolvedFile | undefined {
    const resolved = this.resolver(requestPath);
    let fileNames;

    if (!resolved) fileNames = [requestPath];
    else if (isString(resolved)) fileNames = [resolved];
    else fileNames = resolved;

    const directories = new Set<string>();
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

function extractPath(requestUrl: string): string | null {
  let requestPath = url.parse(requestUrl).pathname;
  if (requestPath) {
    if (requestPath.startsWith('/')) requestPath = requestPath.substring(1);
    requestPath = decodeURI(requestPath);
  }
  return requestPath;
}

export function createTSDRequestListener(options: Options): RequestListener {
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
      } else {
        try {
          await file.write(response, jsUpdater);
        } catch (e) {
          console.error('Error sending response for ' + requestPath, file, e);
        }
      }
    } else {
      console.info('Resource not found "' + requestPath + '"');
      response.writeHead(404, `${requestPath} not found`);
    }
    response.end();
  };
}
