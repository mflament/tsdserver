import { ResourceTransformer } from './ResourceTransformer';

export default (): ResourceTransformer => {
  return async file => {
    if (file.requestedPath.endsWith('.js') && !file.resolvedFile.endsWith('.js')) {
      const code = await file.readText();
      return 'export default `' + code + '`;\n';
    }
    return undefined;
  };
};
