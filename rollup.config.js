import { eslint } from 'rollup-plugin-eslint'
import commonjs from 'rollup-plugin-commonjs'
import nodeResolve from 'rollup-plugin-node-resolve'

export default {
  input: 'src/front/frontend.js',

  external: [
    'ace',
    'jsedn',
    'vue'
  ],

  output: {
    file: 'build/bundle.js',
    format: 'iife',
    sourcemap: true,

    globals: {
      'ace': 'ace',
      'jsedn': 'jsedn',
      'vue': 'Vue'
    }
  },

  plugins: [
    eslint({
      exclude: [
        'src/styles/**'
      ]
    }),

    nodeResolve(),
    commonjs({
    })
  ],

  watch: {
    clearScreen: false
  }
}
