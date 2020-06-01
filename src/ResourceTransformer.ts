import { ResolvedFile } from './RequestHandler';

export type ResourceTransformer = (file: ResolvedFile) => Promise<string | undefined> | (string | undefined);
