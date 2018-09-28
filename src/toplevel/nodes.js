const { mkNodeDefinition } = require('../model')

const normalise = definition => {
  return Object.assign({
    name: null,
    inputs: [],
    params: [],
    outputs: [],
    makeDefinition (node) {
      throw new TypeError('Node Type ' + this.name + ' does not flatten to a definition')
    }
  }, definition)
}

const gi = (node, input) => false ? node.inputs.get(input) : `%%${input}%%`
const gir = (node, input) => false ? node.inputs.get(input).toFixed(1) : `%%${input}%%`

const list = [
  normalise({
    name: 'output',
    inputs: [
      { type: 'real', name: 'output' }
    ]
  }),

  normalise({
    name: 'constant',
    params: [
      { type: 'int', name: 'value' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        out: ['out'],
        process: `double %%out%% = ${node.params.get('value')};`
      })
    }
  }),

  normalise({
    name: 'sine_generator',
    inputs: [
      { type: 'real', name: 'period' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['period'],
        out: ['out'],
        storage: 'int %%id%%_tick;',
        init: '%%id%%_tick = 0;',
        process: `%%id%%_tick++;\ndouble %%out%% = sin(%%id%%_tick / ${gir(node, 'period')}) * 0.04f;`
      })
    }
  }),

  normalise({
    name: 'mul',
    inputs: [
      { type: 'real', name: 'a' },
      { type: 'real', name: 'b' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['a', 'b'],
        out: ['out'],
        process: `double %%out%% = ${gir(node, 'a')} * ${gir(node, 'b')};`
      })
    }
  }),

  normalise({
    name: 'add',
    inputs: [
      { type: 'real', name: 'a' },
      { type: 'real', name: 'b' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['a', 'b'],
        out: ['out'],
        process: `double %%out%% = ${gir(node, 'a')} + ${gir(node, 'b')};`
      })
    }
  }),

  normalise({
    name: 'delay',
    inputs: [
      { type: 'real', name: 'in' }
    ],
    params: [
      { type: 'int', name: 'delay' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['in'],
        out: ['out'],
        storage: `static int %%id%%_tick;\nstatic double %%id%%_buffer[${node.params.get('delay')}];`,
        init: '%%id%%_tick = 0;',
        process: 'double %%out%% = %%id%%_buffer[%%id%%_tick];',
        processEpilogue: `%%id%%_buffer[%%id%%_tick] = %%in%%;\n%%id%%_tick = (%%id%%_tick + 1) % ${node.params.get('delay')};`,
        isDirect: false
      })
    }
  }),

  normalise({
    name: 'biquad_lowpass',
    inputs: [
      { type: 'real', name: 'in' }
    ],
    params: [
      { type: 'real', name: 'f' },
      { type: 'real', name: 'q' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeDefinition (node) {
      const Fs = 14400 * 4
      const f0 = node.params.get('f') || 0
      const Q = node.params.get('q') || 0

      const w0 = 2 * Math.PI * f0 / Fs
      const alpha = Math.sin(w0) / (2 * Q)

      const b0 = (1 - Math.cos(w0)) / 2
      const b1 = 1 - Math.cos(w0)
      const b2 = (1 - Math.cos(w0)) / 2
      const a0 = 1 + alpha
      const a1 = -2 * Math.cos(w0)
      const a2 = 1 - alpha

      return mkNodeDefinition({
        in: ['in'],
        out: ['out'],
        storage: `static double %%id%%_x[2];\n` +
                 `static double %%id%%_y[2];`,
        process: `double %%out%% = (${b0}/${a0}) * %%in%%` +
                               ` + (${b1}/${a0}) * %%id%%_x[1]` +
                               ` + (${b2}/${a0}) * %%id%%_x[0]` +
                               ` - (${a1}/${a0}) * %%id%%_y[1]` +
                               ` - (${a2}/${a0}) * %%id%%_y[0];`,
        processEpilogue: `%%id%%_x[0] = %%id%%_x[1];\n;` +
                         `%%id%%_x[1] = %%in%%;\n;` +
                         `%%id%%_y[0] = %%id%%_y[1];\n;` +
                         `%%id%%_y[1] = %%out%%;\n;`
      })
    }
  }),

  normalise({
    name: 'biquad_hipass',
    inputs: [
      { type: 'real', name: 'in' }
    ],
    params: [
      { type: 'real', name: 'f' },
      { type: 'real', name: 'q' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeDefinition (node) {
      const Fs = 14400 * 4
      const f0 = node.params.get('f') || 0
      const Q = node.params.get('q') || 0

      const w0 = 2 * Math.PI * f0 / Fs
      const alpha = Math.sin(w0) / (2 * Q)

      const b0 = (1 + Math.cos(w0)) / 2
      const b1 = -(1 + Math.cos(w0))
      const b2 = (1 + Math.cos(w0)) / 2
      const a0 = 1 + alpha
      const a1 = -2 * Math.cos(w0)
      const a2 = 1 - alpha

      return mkNodeDefinition({
        in: ['in'],
        out: ['out'],
        storage: `static double %%id%%_x[2];\n` +
                 `static double %%id%%_y[2];`,
        process: `double %%out%% = (${b0}/${a0}) * %%in%%` +
                               ` + (${b1}/${a0}) * %%id%%_x[1]` +
                               ` + (${b2}/${a0}) * %%id%%_x[0]` +
                               ` - (${a1}/${a0}) * %%id%%_y[1]` +
                               ` - (${a2}/${a0}) * %%id%%_y[0];`,
        processEpilogue: `%%id%%_x[0] = %%id%%_x[1];\n;` +
                         `%%id%%_x[1] = %%in%%;\n;` +
                         `%%id%%_y[0] = %%id%%_y[1];\n;` +
                         `%%id%%_y[1] = %%out%%;\n;`
      })
    }
  })
]

module.exports.list = list

const lookupTable = new Map()
list.forEach(type => {
  lookupTable.set(type.name, type)
})

module.exports.lookup = name => lookupTable.get(name)
