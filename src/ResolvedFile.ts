import fs, { Stats } from 'fs';
import { OutgoingHttpHeaders } from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import mime from 'mime-types';
import path from 'path';
import { fileStats } from './Utils';

const JS_MIME_TYPE = 'application/javascript';

export class ResolvedFile implements ResolvedFile {
  static resolve(directories: string[], requestPath: string): ResolvedFile | undefined {
    let currentPath: string | undefined = requestPath;
    for (const directory of directories) {
      let file = path.resolve(directory, currentPath);
      const stats = fileStats(file);
      if (stats != null) {
        return new ResolvedFile(requestPath, currentPath, file, stats);
      }
    }
    return undefined;
  }

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
      function done() {
        stream.close();
        resolve();
      }
      stream.on('end', done);
      stream.on('error', done);
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
