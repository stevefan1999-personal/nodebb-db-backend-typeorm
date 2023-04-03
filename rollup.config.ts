import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import autoExternal from 'rollup-plugin-auto-external'
import obfuscator from 'rollup-plugin-obfuscator'
import { swc, minify } from 'rollup-plugin-swc3'

export default {
  external: ['date-fns/fp'],
  input: './src/index.ts',
  output: [
    {
      file: './output/index.cjs',
      format: 'cjs',
      inlineDynamicImports: true,
      sourcemap: true,
    },
  ],
  plugins: [
    swc(),
    minify({}),
    nodeResolve(),
    commonjs(),
    json(),
    autoExternal(),
    obfuscator({
      globalOptions: {
        identifierNamesGenerator: 'mangled-shuffled',
        selfDefending: true,
        splitStrings: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 1,
        target: 'node',
      },
    }),
  ],
}
