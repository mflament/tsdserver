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

function isModuleResolver(obj: any): obj is ModuleResolver {
  return typeof obj === 'function';
}

function isRelativeModule(name: string) {
  return name.startsWith('/') || name.startsWith('./') || name.startsWith('../');
}

type StringLiteral = acorn.Node & {
  type: 'Literal';
  value: string;
  range?: [number, number];
};

type ImportDeclaration = acorn.Node & {
  type: 'ImportDeclaration' | 'ImportExpression';
  source: StringLiteral;
};

type ExportDeclaration = acorn.Node & {
  type: 'ExportNamedDeclaration' | 'ExportAllDeclaration';
  source: StringLiteral | null;
};

function isImportDeclaration(node: acorn.Node): node is ImportDeclaration {
  return node.type === 'ImportDeclaration' || node.type === 'ImportExpression';
}

function isExportDeclaration(node: acorn.Node): node is ExportDeclaration {
  return node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration';
}

function getSource(node: acorn.Node): StringLiteral | null {
  if (isImportDeclaration(node)) return node.source;
  if (isExportDeclaration(node)) return node.source;
  return null;
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

  const updateSource = (code: string): string => {
    const parsed = acorn.parse(code, {
      sourceType: sourceType,
      ecmaVersion: ecmaVersion,
      ranges: true
    });

    let newCode = '';
    let offset = 0;

    const visitor = (node: acorn.Node): void => {
      const source = getSource(node);
      if (!source) return;
      if (!source.range) {
        console.error('No; range in AST node');
        return;
      }

      let name = source.value;
      if (!name) return;

      if (!isRelativeModule(name)) {
        let resolved = moduleResolver(name);
        if (resolved === null) {
          if (node.range) {
            newCode += code.substring(offset, node.range[0]);
            offset = node.range[1];
            return;
          } else console.error('No range for node', node);
        } else {
          //if (!resolved.startsWith('./')) resolved = './' + resolved;
          name = resolved;
        }
      }

      if (!name.endsWith('.js')) name += '.js';

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

  return async file => {
    if (file.resolvedFile.endsWith('.js')) {
      const code = await file.readText();
      try {
        return updateSource(code);
      } catch (e) {
        console.error('Error parsing ' + file.resolvedFile, e);
        return code;
      }
    }
    return undefined;
  };
};

export default newTransformer;
