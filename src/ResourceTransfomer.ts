import { ResolvedFile } from './ResolvedFile';

export type ResourceTransformer = (file: ResolvedFile) => Promise<string | undefined>;
