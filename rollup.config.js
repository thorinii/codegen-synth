import { eslint } from 'rollup-plugin-eslint'

export default {
  input: 'src/front/frontend.js',

  external: [
    'rete',
    'rete-alight-render-plugin',
    'rete-connection-plugin',
    'vue'
  ],

  output: {
    file: 'build/bundle.js',
    format: 'iife',
    sourcemap: true,

    globals: {
      'rete': 'Rete',
      'rete-alight-render-plugin': 'AlightRenderPlugin',
      'rete-connection-plugin': 'ConnectionPlugin',
      'vue': 'Vue'
    }
  },

  plugins: [
    eslint({
      exclude: [
        'src/styles/**'
      ]
    })
  ],

  watch: {
    clearScreen: false
  }
}
