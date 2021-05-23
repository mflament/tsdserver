import { IncomingMessage, ServerResponse, OutgoingHttpHeaders, RequestListener } from 'http';
import url from 'url';
import { newJSImportTransformer } from './JSImportTransformer';
import { CompilerOptions, Options } from './Options';
import { ResolvedFile } from './ResolvedFile';
import { ResourceTransformer } from './ResourceTransfomer';
import { readFileSync } from 'fs';

export function createRequestListener(options: Options): RequestListener {
  const compilerOptions: CompilerOptions = {
    baseUrl: './',
    target: 'ES2020',
    module: 'ES2020',
    outDir: './dist/',
    paths: {},
    ...JSON.parse(readFileSync(options.tsconfig, { encoding: 'utf-8' })).compilerOptions
  };
  options.directories.push(compilerOptions.outDir);

  const transformers: ResourceTransformer[] = [];
  transformers.push(newJSImportTransformer(compilerOptions));

  async function handle(message: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!message.url) throw new Error('no url in message');
    let requestPath = extractPath(message.url) || options.welcome;
    const resolvedFile = ResolvedFile.resolve(options.directories, requestPath);
    if (resolvedFile) {
      if (options?.debug) console.log('handling request: ' + requestPath);
      if (resolvedFile.isUpToDate(message)) {
        response.writeHead(304, {});
      } else {
        for (const transformer of transformers) {
          let newContent = await transformer(resolvedFile);
          if (newContent !== undefined) resolvedFile.content = newContent;
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
      console.log('Error handling request: ' + message.url, e);
      response.writeHead(500, 'Server error: ' + e.get);
    } finally {
      response.end();
    }
  };
}

function extractPath(requestUrl: string): string | null {
  let requestPath = url.parse(requestUrl).pathname;
  if (requestPath) {
    if (requestPath.startsWith('/')) requestPath = requestPath.substring(1);
    requestPath = decodeURI(requestPath);
  }
  return requestPath;
}
