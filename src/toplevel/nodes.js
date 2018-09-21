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

const gi = (node, input) => false ? node.inputs.get(input) : `%%${input.toLowerCase()}%%`
const gir = (node, input) => false ? node.inputs.get(input).toFixed(1) : `%%${input.toLowerCase()}%%`

const list = [
  normalise({
    name: 'Output',
    inputs: [
      { type: 'real', name: 'Output' }
    ]
  }),

  normalise({
    name: 'Constant',
    params: [
      { type: 'int', name: 'Value' }
    ],
    outputs: [
      { type: 'real', name: 'Out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        out: ['out'],
        process: `double %%out%% = ${node.params.get('Value')};`
      })
    }
  }),

  normalise({
    name: 'Sine Wave',
    inputs: [
      { type: 'real', name: 'Period' }
    ],
    outputs: [
      { type: 'real', name: 'Out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['period'],
        out: ['out'],
        storage: 'int %%id%%_tick;',
        init: '%%id%%_tick = 0;',
        process: `%%id%%_tick++;\ndouble %%out%% = sin(%%id%%_tick / ${gir(node, 'Period')}) * 0.04f;`
      })
    }
  }),

  normalise({
    name: 'Mul',
    inputs: [
      { type: 'real', name: 'A' },
      { type: 'real', name: 'B' }
    ],
    outputs: [
      { type: 'real', name: 'Out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['a', 'b'],
        out: ['out'],
        process: `double %%out%% = ${gir(node, 'A')} * ${gir(node, 'B')};`
      })
    }
  }),

  normalise({
    name: 'Add',
    inputs: [
      { type: 'real', name: 'A' },
      { type: 'real', name: 'B' }
    ],
    outputs: [
      { type: 'real', name: 'Out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['a', 'b'],
        out: ['out'],
        process: `double %%out%% = ${gir(node, 'A')} + ${gir(node, 'B')};`
      })
    }
  }),

  normalise({
    name: 'Delay',
    inputs: [
      { type: 'real', name: 'In' }
    ],
    params: [
      { type: 'int', name: 'Delay' }
    ],
    outputs: [
      { type: 'real', name: 'Out' }
    ],

    makeDefinition (node) {
      return mkNodeDefinition({
        in: ['in'],
        out: ['out'],
        storage: `static int %%id%%_tick;\nstatic double %%id%%_buffer[${node.params.get('Delay')}];`,
        init: '%%id%%_tick = 0;',
        process: 'double %%out%% = %%id%%_buffer[%%id%%_tick];',
        processEpilogue: `%%id%%_buffer[%%id%%_tick] = %%in%%;\n%%id%%_tick = (%%id%%_tick + 1) % ${node.params.get('Delay')};`,
        isDirect: false
      })
    }
  }),

  normalise({
    name: 'BiQuad Lowpass',
    inputs: [
      { type: 'real', name: 'In' }
    ],
    params: [
      { type: 'real', name: 'F' },
      { type: 'real', name: 'Q' }
    ],
    outputs: [
      { type: 'real', name: 'Out' }
    ],

    makeDefinition (node) {
      const Fs = 14400 * 4
      const f0 = node.params.get('F') || 0
      const Q = node.params.get('Q') || 0

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
    name: 'BiQuad Hipass',
    inputs: [
      { type: 'real', name: 'In' }
    ],
    params: [
      { type: 'real', name: 'F' },
      { type: 'real', name: 'Q' }
    ],
    outputs: [
      { type: 'real', name: 'Out' }
    ],

    makeDefinition (node) {
      const Fs = 14400 * 4
      const f0 = node.params.get('F') || 0
      const Q = node.params.get('Q') || 0

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
