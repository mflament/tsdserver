import acorn from 'acorn';
import walk from 'acorn-walk';
import { defaultResolver, ModuleResolver } from './DefaultModuleResolver';
import { AliasMap } from './AliasMap';
import { ResourceTransformer } from './ResourceTransformer';
import { ResolvedFile } from './RequestHandler';

export type SourceType = 'script' | 'module';
export type EcmaVersion = 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020;

export interface JSImportTransformerOptions {
  readonly sourceType?: SourceType;
  readonly ecmaVersion?: EcmaVersion;
  readonly moduleResolver?: ModuleResolver | AliasMap;
}

interface ImportNode extends acorn.Node {
  source: LiteralNode;
}

interface LiteralNode extends acorn.Node {
  value?: string;
}

function isModuleResolver(obj: any): obj is ModuleResolver {
  return typeof obj === 'function';
}

function isImportNode(node?: acorn.Node): node is ImportNode {
  return node !== undefined && (node as ImportNode).source !== undefined;
}

function isRelativeModule(name: string) {
  return name.startsWith('/') || name.startsWith('./') || name.startsWith('../');
}

const newTransformer = (options?: JSImportTransformerOptions | boolean): ResourceTransformer => {
  if (options === undefined || typeof options === 'boolean') options = {};
  const sourceType = options.sourceType || 'module';
  const ecmaVersion = options.ecmaVersion || 2020;

  let moduleResolver: ModuleResolver;
  if (isModuleResolver(options.moduleResolver)) {
    moduleResolver = options.moduleResolver;
  } else {
    moduleResolver = defaultResolver(options.moduleResolver);
  }

  const updateImports = (code: string): string => {
    const parsed = acorn.parse(code, {
      sourceType: sourceType,
      ecmaVersion: ecmaVersion,
      ranges: true
    });

    let newCode = '';
    let offset = 0;

    const visitor = (node: acorn.Node): void => {
      if (!isImportNode(node)) throw new Error('Not an import node');
      if (!node.source.range) throw new Error('No range');

      let name = node.source.value;
      if (!name) return;

      if (!isRelativeModule(name)) {
        name = moduleResolver(name);
      }

      if (!name.endsWith('.js')) name += '.js';

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
  };

  return async file => {
    if (file.resolvedFile.endsWith('.js')) {
      const code = await file.readText();
      return updateImports(code);
    }
    return undefined;
  };
};

export default newTransformer;
