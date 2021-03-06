const { Map, List, Set, Record } = require('immutable')
const { mkNodeDefinition: mkRealtimeNode } = require('../model')

const Node = Record({
  name: null,
  inputs: List(),
  outputs: List(),
  params: List(),

  controller: null,
  makeRealtime: null,

  onlyController: false,
  onlyRealtime: false
}, 'Node')

const Controller = Record({
  msgTypes: Set.of('init'),

  construct: () => null,
  handle: null,
  getBridgeVar: null
}, 'Controller')

const mkNode = def => {
  return Node(def)
    .update('onlyController', b => b || (def.controller && !def.makeRealtime))
    .update('onlyRealtime', b => b || (def.makeRealtime && !def.controller))
}

const gi = (node, input) => false ? node.inputs.get(input) : `%%${input}%%`
const gir = (node, input) => false ? node.inputs.get(input).toFixed(1) : `%%${input}%%`

const list = [
  mkNode({
    name: 'io/mono-output',
    inputs: [
      { type: 'real', name: 'value' }
    ],

    onlyRealtime: true
  }),

  mkNode({
    name: 'core/constant',
    params: [
      { type: 'int', name: 'value' }
    ],
    outputs: [
      { type: 'real', name: 'value' }
    ],

    makeRealtime (node) {
      return mkRealtimeNode({
        out: ['value'],
        process: `double %%value%% = ${node.params.get('value')};`
      })
    },

    controller: Controller({
      construct (params) {
        return params.get('value')
      },

      async handle (data, msg, pushOutFn) {
        pushOutFn('value', { type: 'value', value: data })
      }
    })
  }),

  mkNode({
    name: 'var_bridge',
    inputs: [
      { type: 'real', name: 'value' }
    ],

    controller: Controller({
      msgTypes: Set.of('init', 'value'),

      construct (params) {
        return { id: params.get('id'), cell: 0 }
      },

      async handle (data, msg, pushOutFn) {
        if (msg.type === 'init') {
          data.cell = 0
        } else if (msg.type === 'value') {
          data.cell = msg.value
        }
      },

      getBridgeVar (data) {
        return [data.id, data.cell]
      }
    })
  }),

  mkNode({
    name: 'io/midi-cc',
    params: [
      { type: 'int', name: 'cc-index' }
    ],
    outputs: [
      { type: 'real', name: 'value' }
    ],

    controller: Controller({
      msgTypes: Set.of('init', 'midi-cc'),

      construct (params) {
        return params.get('cc-index')
      },

      async handle (data, msg, pushOutFn) {
        // if (msg.controller) console.log('cc', msg.controller)
        if (msg.controller === data) {
          pushOutFn('value', { type: 'value', value: msg.value / 127 })
        }
      }
    })
  }),

  mkNode({
    name: 'wave/sine',
    inputs: [
      { type: 'real', name: 'period' }
    ],
    outputs: [
      { type: 'real', name: 'value' }
    ],

    makeRealtime (node) {
      return mkRealtimeNode({
        in: ['period'],
        out: ['value'],
        storage: 'double %%id%%_tick;',
        init: '%%id%%_tick = 0;',
        process: `%%id%%_tick += (M_PI * ${gir(node, 'period')}) / (4 * 14400); if (%%id%%_tick > M_PI * 2) %%id%%_tick -= M_PI * 2;\ndouble %%value%% = sin(%%id%%_tick) * 0.04f;`
      })
    }
  }),

  mkNode({
    name: 'wave/noise',
    outputs: [
      { type: 'real', name: 'value' }
    ],

    makeRealtime (node) {
      const length = 44100 * 4
      return mkRealtimeNode({
        out: ['value'],
        storage: 'int %%id%%_tick; double *%%id%%_buffer;',
        init: `%%id%%_tick = 0; %%id%%_buffer = (double*) calloc(sizeof(double), ${length}); for (int i = 0; i < ${length}; i++) %%id%%_buffer[i] = ((double) rand()) / RAND_MAX * 2.0 - 1.0;`,
        process: `%%id%%_tick = (%%id%%_tick + 1) % ${length}; double %%value%% = %%id%%_buffer[%%id%%_tick];`
      })
    }
  }),

  mkNode({
    name: 'speed_envelope',
    inputs: [
      { type: 'real', name: 'value' },
      { type: 'real', name: 'speed' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeRealtime (node) {
      return mkRealtimeNode({
        in: ['value', 'speed'],
        out: ['out'],
        storage: 'double %%id%%_value;',
        init: '%%id%%_value = 0;',
        process: `double %%id%%_diff = ${gir(node, 'value')} - %%id%%_value;\n` +
                 `double %%id%%_speed = ${gir(node, 'speed')} / (4 * 14400);\n` +
                 `if (abs(%%id%%_diff) < %%id%%_speed) %%id%%_value = ${gir(node, 'value')};\n` +
                 `else %%id%%_value += copysign(%%id%%_speed, %%id%%_diff);\n` +
                 `double %%out%% = %%id%%_value;`
      })
    }
  }),

  mkNode({
    name: 'maths/mul',
    inputs: [
      { type: 'real', name: 'a' },
      { type: 'real', name: 'b' }
    ],
    outputs: [
      { type: 'real', name: 'value' }
    ],

    makeRealtime (node) {
      return mkRealtimeNode({
        in: ['a', 'b'],
        out: ['value'],
        process: `double %%value%% = ${gir(node, 'a')} * ${gir(node, 'b')};`
      })
    },

    controller: Controller({
      msgTypes: Set.of('init', 'value'),

      construct () {
        return { a: 0, b: 0 }
      },

      async handle (data, msg, pushOutFn) {
        if (msg.type === 'value') {
          if (msg.target === 'a') data.a = msg.value
          if (msg.target === 'b') data.b = msg.value
        }

        pushOutFn('value', {
          type: 'value',
          value: data.a * data.b
        })
      }
    })
  }),

  mkNode({
    name: 'maths/add',
    inputs: [
      { type: 'real', name: 'a' },
      { type: 'real', name: 'b' }
    ],
    outputs: [
      { type: 'real', name: 'value' }
    ],

    makeRealtime (node) {
      return mkRealtimeNode({
        in: ['a', 'b'],
        out: ['value'],
        process: `double %%value%% = ${gir(node, 'a')} + ${gir(node, 'b')};`
      })
    },

    controller: Controller({})
  }),

  mkNode({
    name: 'delay/int',
    inputs: [
      { type: 'real', name: 'in' }
    ],
    params: [
      { type: 'int', name: 'delay' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeRealtime (node) {
      return mkRealtimeNode({
        in: ['in'],
        out: ['out'],
        storage: `static int %%id%%_tick;\nstatic double %%id%%_buffer[${node.params.get('delay')}];`,
        init: `%%id%%_tick = 0; for (int i = 0; i < ${node.params.get('delay')}; i++) %%id%%_buffer[i] = 0;`,
        process: 'double %%out%% = %%id%%_buffer[%%id%%_tick];',
        processEpilogue: `%%id%%_buffer[%%id%%_tick] = %%in%%;\n%%id%%_tick = (%%id%%_tick + 1) % ${node.params.get('delay')};`,
        isDirect: false
      })
    }
  }),

  mkNode({
    name: 'filter/dc',
    inputs: [
      { type: 'real', name: 'in' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeRealtime (node) {
      // TODO: proper blocker from https://www.dsprelated.com/freebooks/filters/DC_Blocker.html
      const alpha = 0.995
      return mkRealtimeNode({
        in: ['in'],
        out: ['out'],
        storage: `static double %%id%%_prev;`,
        init: '%%id%%_prev = 0;',
        process: `double %%out%% = %%in%% + ${alpha} * %%id%%_prev; %%id%%_prev = %%out%% - %%id%%_prev;`
      })
    }
  }),

  mkNode({
    name: 'filter/avg-lowpass',
    inputs: [
      { type: 'real', name: 'in' }
    ],
    outputs: [
      { type: 'real', name: 'out' }
    ],

    makeRealtime (node) {
      const alpha = 0.9997
      return mkRealtimeNode({
        in: ['in'],
        out: ['out'],
        storage: `static double %%id%%_prev;`,
        init: '%%id%%_prev = 0;',
        process: `double %%out%% = ${1 - alpha} * %%in%% + ${alpha} * %%id%%_prev; %%id%%_prev = %%out%%;`
      })
    }
  }),

  mkNode({
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

    makeRealtime (node) {
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

      return mkRealtimeNode({
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

  mkNode({
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

    makeRealtime (node) {
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

      return mkRealtimeNode({
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

let lookupTable = new Map()
list.forEach(type => {
  lookupTable = lookupTable.set(type.name, type)
})

module.exports.lookup = name => lookupTable.get(name)
