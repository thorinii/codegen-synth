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

const gi = (node, input) => node.inputs.get(input) ? node.inputs.get(input) : `%%${input.toLowerCase()}%%`
const gir = (node, input) => node.inputs.get(input) ? node.inputs.get(input).toFixed(1) : `%%${input.toLowerCase()}%%`

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
  })
]

module.exports.list = list

const lookupTable = new Map()
list.forEach(type => {
  lookupTable.set(type.name, type)
})

module.exports.lookup = name => lookupTable.get(name)
