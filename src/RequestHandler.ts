import { IncomingMessage, ServerResponse, OutgoingHttpHeaders, RequestListener } from 'http';
import url from 'url';
import fs, { Stats } from 'fs';
import path from 'path';
import mime from 'mime-types';
import JSImportTransformer from './JSImportTransformer';
import { fileStats } from './Utils';
import { Options } from './Options';
import { ResourceTransformer } from './ResourceTransformer';
import JSResourceWrapper from './JSResourceWrapper';

const JS_MIME_TYPE = 'application/javascript';

export type ResolverFallback = (path: string) => string | undefined;

export interface ResolvedFile {
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly resolvedFile: string;
  readonly stats: Stats;
  readonly requestedMimeType?: string;
  readonly resolvedMimeType?: string;

  readText(): Promise<string>;
}

class DefaultResolvedFile implements ResolvedFile {
  content: string | null = null;

  /**
   *
   * @param requestedPath requested path
   * @param resolvedFile resolved resource name
   * @param stats
   */
  constructor(
    readonly requestedPath: string,
    readonly resolvedPath: string,
    readonly resolvedFile: string,
    readonly stats: Stats
  ) {}

  get requestedMimeType(): string | undefined {
    return mime.lookup(path.extname(this.requestedPath)) || undefined;
  }

  get resolvedMimeType(): string | undefined {
    return mime.lookup(path.extname(this.resolvedFile)) || undefined;
  }

  async readText(): Promise<string> {
    if (this.content !== null) {
      return Promise.resolve(this.content);
    }
    return new Promise((resolve, reject) => {
      fs.readFile(this.resolvedFile, { encoding: 'utf-8' }, (err, data) => {
        if (err) reject(err);
        else {
          this.content = data;
          resolve(data);
        }
      });
    });
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

  async write(response: ServerResponse): Promise<void> {
    const headers: OutgoingHttpHeaders = {};
    if (this.requestedMimeType) {
      headers['Content-Type'] = this.requestedMimeType;
    }
    headers['Last-Modified'] = this.stats.mtime.toUTCString();
    headers['ETag'] = this.stats.mtime.getTime();
    headers['Cache-Control'] = 'no-cache, max-age=0';
    response.writeHead(200, headers);

    if (this.content) {
      return this.writeText(this.content, response);
    } else {
      return this.stream(response);
    }
  }

  get isJSRequested(): boolean {
    return this.requestedMimeType === JS_MIME_TYPE;
  }

  get isJSResolved(): boolean {
    return this.resolvedMimeType === JS_MIME_TYPE;
  }

  private async stream(out: ServerResponse): Promise<void> {
    return new Promise(resolve => {
      const stream = fs.createReadStream(this.resolvedFile);
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
}

class FileResolver {
  private readonly directories: string[] = [];
  private readonly fallback: ResolverFallback;

  constructor(options: Options) {
    if (options.wrapJSResources !== false) {
      this.fallback = p => {
        if (p.endsWith('.js')) return p.substring(0, p.length - 3);
        if (options.fallback) return options.fallback(p);
      };
    } else if (options.fallback) {
      if (typeof options.fallback === 'function') {
        this.fallback = options.fallback;
      } else {
        console.error("Invalid 'fallback' option, expected 'function'", options.fallback);
        this.fallback = () => undefined;
      }
    } else {
      this.fallback = () => undefined;
    }

    if (options.directories) {
      if (Array.isArray(options.directories)) {
        this.directories.push(...options.directories);
      } else {
        console.error("Invalid 'directories' option, expected 'array'", options.directories);
      }
    }
    this.directories.push('.');
    this.directories.push('node_modules');
  }

  resolve(requestPath: string): DefaultResolvedFile | undefined {
    let currentPath: string | undefined = requestPath;
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

function extractPath(requestUrl: string): string | null {
  let requestPath = url.parse(requestUrl).pathname;
  if (requestPath) {
    if (requestPath.startsWith('/')) requestPath = requestPath.substring(1);
    requestPath = decodeURI(requestPath);
  }
  return requestPath;
}

function createTransformers(options: Options): ResourceTransformer[] {
  const transformers = [];
  if (options.transformers) {
    if (!Array.isArray(options.transformers)) {
      console.error("Invalid option 'transformers', expected 'array'", options.transformers);
    } else {
      for (const transformer of options.transformers) {
        if (typeof transformer === 'function') {
          transformers.push(transformer);
        } else {
          console.error("Invalid option 'transformer', expected 'function'", transformer);
        }
      }
    }
  }
  return transformers;
}

export function createRequestListener(options?: Options): RequestListener {
  options = options || {};
  const welcome = options.welcome || 'index.html';
  const fileResolver = new FileResolver(options);
  const transformers = createTransformers(options);

  if (options.updateJSImport !== false) {
    transformers.push(JSImportTransformer(options.updateJSImport));
  }

  if (options.wrapJSResources !== false) {
    transformers.push(JSResourceWrapper());
  }

  async function handle(message: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!message.url) throw new Error('no url in message');
    let requestPath = extractPath(message.url) || welcome;
    const resolvedFile = fileResolver.resolve(requestPath);
    if (resolvedFile) {
      if (resolvedFile.isUpToDate(message)) {
        response.writeHead(304, {});
      } else {
        for (const transformer of transformers) {
          let newContent = await transformer(resolvedFile);
          if (newContent !== undefined) {
            resolvedFile.content = newContent;
          }
        }
        await resolvedFile.write(response);
      }
    } else {
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
    } catch (e) {
      console.log('Error handling request', message, e);
      response.writeHead(500, 'Server error: ' + e.get);
    } finally {
      response.end();
    }
  };
}
