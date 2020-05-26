import typescript_plugin from 'rollup-plugin-typescript2';
import typescript from 'typescript';
import json from 'rollup-plugin-json';

export default [
  {
    input: ['./src/Server.ts'],
    external: ['arg', 'micro', 'url', 'fs', 'path', 'mime-types', 'acorn', 'acorn-walk', 'util'],
    output: [
      {
        file: 'dist/tsdserver.js',
        format: 'commonjs',
        sourcemap: true
      }
    ],
    plugins: [typescript_plugin({ typescript: typescript, clean: true }), json()]
  }
];
