import acorn from 'acorn';
import walk from 'acorn-walk';
import { defaultResolver } from './DefaultModuleResolver';
import { isFunction } from 'util';
import { ModuleResolver, Options } from './tsdserver';

function isModuleResolver(obj: any): obj is ModuleResolver {
  return isFunction(obj);
}

export class JSImportUpdater {
  readonly sourceType: 'script' | 'module';
  readonly ecmaVersion: 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020;
  readonly moduleResolver: ModuleResolver;

  constructor(options?: Options) {
    options = options || {};
    this.sourceType = options.sourceType || 'module';
    this.ecmaVersion = options.ecmaVersion || 2020;
    if (isModuleResolver(options.resolveModule)) {
      this.moduleResolver = options.resolveModule;
    } else {
      this.moduleResolver = defaultResolver(options.resolveModule);
    }
  }

  update(code: string): string {
    const parsed = acorn.parse(code, {
      sourceType: this.sourceType,
      ecmaVersion: this.ecmaVersion,
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
        name = this.moduleResolver(name);
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
  }
}

interface ImportNode extends acorn.Node {
  source: LiteralNode;
}

interface LiteralNode extends acorn.Node {
  value?: string;
}

function isImportNode(node?: acorn.Node): node is ImportNode {
  return node !== undefined && (node as ImportNode).source !== undefined;
}

function isRelativeModule(name: string) {
  return name.startsWith('/') || name.startsWith('./') || name.startsWith('../');
}
