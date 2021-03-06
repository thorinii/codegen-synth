function mkNodeDefinition (options) {
  return Object.freeze({
    in: [],
    out: [],
    params: [],
    storage: null,
    init: null,
    process: null,
    processEpilogue: null,
    isDirect: true,
    ...options
  })
}

const Constant = mkNodeDefinition({
  out: ['out'],
  params: ['value'],
  process: 'double %%out%% = %%value%%;'
})

const Variable = mkNodeDefinition({
  out: ['out'],
  params: ['value', 'varId'],
  init: 'vars[%%varId%%] = %%value%%;',
  process: 'double %%out%% = vars[%%varId%%];'
})

class Model {
  constructor () {
    this.out = []
    this.nodes = []
    this._idCounter = 0
    this._outPortCounter = 0
    this._eventListeners = []
    this._eventSend = null
    this._varCount = 0
  }

  addNode (info, params) {
    if (info === Variable) throw new TypeError('A Variable must be instantiated with the addVariable method')
    const node = this._createNode(info, params)
    this.nodes.push(node)
    return node
  }

  addConstant (value) {
    return this.addNode(Constant, { value })
  }

  addVariable (id, initialValue) {
    this._varCount = Math.max(this._varCount, id + 1)
    const node = this._createNode(Variable, { value: initialValue, varId: id })
    node.set = value => {
      this._send(`set ${id} ${value}`)
    }
    this.nodes.push(node)
    return node
  }

  connect (from, to) {
    if (from._outputs && from._outputs.has('value')) from = from._outputs.has('value')
    if (to._inputs && to._inputs.has('value')) to = to._inputs.has('value')
    to.push(from)
  }

  onNote (callback) {
    this._eventListeners.push(['midi.note-down', msg => callback(msg.note, msg.velocity)])
  }

  trimUnusedNodes () {
    const usedOutputs = new Set()
    this.out.forEach(o => usedOutputs.add(o))

    this.nodes.forEach(n => {
      Array.from(n._inputs.values()).forEach(i => i.forEach(o => usedOutputs.add(o)))
    })

    this.nodes = this.nodes.filter(n => {
      return Array.from(n._outputs.values()).some(o => usedOutputs.has(o))
    })
  }

  _createNode (info, params) {
    const id = this._idCounter++
    const node = {
      _id: id,
      _info: info,
      _params: params,
      _inputs: new Map(),
      _outputs: new Map()
    }
    info.in.forEach(name => {
      const port = []
      node[name] = port
      node._inputs.set(name, port)
    })
    info.out.forEach(name => {
      const id = this._outPortCounter++
      node[name] = id
      node._outputs.set(name, id)
    })
    return node
  }

  _fire (type, msg) {
    this._eventListeners.forEach(l => {
      if (l[0] !== type) return
      try {
        l[1](msg)
      } catch (e) {
        console.error(e)
      }
    })
  }

  _send (msg) {
    if (this._eventSend === null) console.error('EventSend is not initialised')
    else this._eventSend(msg)
  }

  _initEventSend (fn) {
    this._eventSend = fn
  }
}

module.exports = {
  Model,
  mkNodeDefinition
}
