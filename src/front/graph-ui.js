import Rete from 'rete'
import AlightRenderPlugin from 'rete-alight-render-plugin'
import ConnectionPlugin from 'rete-connection-plugin'

const mapObj = (obj, fn) => Object.keys(obj).map(k => fn(k, obj[k]))

const SocketTypes = {
  'real': new Rete.Socket('Real'),
  'midi': new Rete.Socket('MIDI')
}

export class GraphUi {
  constructor (el) {
    this.types = []
    this._onChange = () => {}

    const editor = new Rete.NodeEditor('demo@0.1.0', el)
    this.editor = editor

    editor.use(ConnectionPlugin)
    editor.use(AlightRenderPlugin)

    editor.on('process nodecreated noderemoved connectioncreated connectionremoved nodetranslated', () => {
      const rawGraph = editor.toJSON()

      const nodes = []
      const edges = []

      mapObj(rawGraph.nodes, (_, node) => {
        const nodeType = this.types.find(n => n.name === node.name)

        nodes.push({
          id: node.id,
          type: node.name,
          position: node.position,

          params: nodeType.params.map(param => {
            const value = node.data[param.name]
            return { name: param.name, value }
          })
        })

        nodeType.inputs.forEach(input => {
          const socket = node.inputs[input.name]
          if (socket.connections.length === 0) {
            edges.push({
              from: node.data[input.name],
              to: [node.id, input.name]
            })
          } else {
            edges.push({
              from: [socket.connections[0].node, socket.connections[0].output],
              to: [node.id, input.name]
            })
          }
        })
      })

      const graph = {
        nodes, edges
      }

      this._onChange(graph)
    })
  }

  setOnChange (fn) {
    this._onChange = debounce(fn, 500)
  }

  setAvailableNodeTypes (types) {
    this.types = types
    types.forEach(n => {
      const component = new GenericComponent(n)
      n.component = component
      this.editor.register(component)
    })
  }

  async showGraph (graph) {
    const nodesById = new Map()
    const inputs = new Map()
    const outputs = new Map()
    const nodes = await Promise.all(graph.nodes.map(async n => {
      const type = this.types.find(t => t.name === n.type)
      const node = await type.component.createNode()

      nodesById.set(n.id, node)
      n.params.forEach(p => {
        node.data[p.name] = p.value
      })

      if (n.position) {
        node.position = n.position
      }

      Array.from(node.inputs.values()).forEach(i => inputs.set(n.id + '-' + i.name, i))
      Array.from(node.outputs.values()).forEach(o => outputs.set(n.id + '-' + o.name, o))

      graph.edges.forEach(e => {
        if (e.to[0] !== n.id) return
        if (Array.isArray(e.from)) return

        node.data[e.to[1]] = e.from
      })

      return node
    }))

    this.editor.clear()
    nodes.forEach(n => this.editor.addNode(n))

    graph.edges.forEach(e => {
      if (!Array.isArray(e.from)) return

      const from = outputs.get(e.from[0] + '-' + e.from[1])
      const to = inputs.get(e.to[0] + '-' + e.to[1])
      this.editor.connect(from, to)
    })
  }

  async addNode (node) {
    const type = this.types.find(t => t.name === node)
    this.editor.addNode(await type.component.createNode())
  }
}

class GenericComponent extends Rete.Component {
  constructor (definition) {
    super(definition.name)
    this._definition = definition
  }

  builder (node) {
    this._definition.inputs.forEach(input => {
      let c = new Rete.Input(input.name, input.name, SocketTypes[input.type])
      c.addControl(new NumControl(input.name, input.name, this.editor))
      node.addInput(c)
    })
    this._definition.params.forEach(param => {
      node.addControl(new NumControl(param.name, param.name, this.editor))
    })
    this._definition.outputs.forEach(output => {
      let c = new Rete.Output(output.name, output.name, SocketTypes[output.type])
      node.addOutput(c)
    })
  }

  worker () {}
}

class NumControl extends Rete.Control {
  constructor (id, name, emitter) {
    super()
    this.id = id
    this.key = id
    this.emitter = emitter
    this.template = `<div class="input-title">${name}</div><input style="width: 80px" type="number" title="${name}" :value="value" @input="change($event)" />`

    this.scope = {
      value: 0,
      change: this.change.bind(this)
    }
  }

  change (e) {
    this.scope.value = +e.target.value
    this.update()
  }

  update () {
    this.putData(this.id, this.scope.value)
    this.emitter.trigger('process')
    this._alight.scan()
  }

  mounted () {
    this.scope.value = this.getData(this.id) || 0
    this.update()
  }

  setValue (val) {
    this.scope.value = val
    this._alight.scan()
  }
}

function debounce (fn, delay) {
  let timer = null
  return (...args) => {
    if (timer !== null) clearTimeout(timer)

    timer = setTimeout(() => {
      timer = null
      const ret = fn(...args)
      if (ret.then) ret.then(null, e => console.error('Crash in listener', e))
    }, delay)
  }
}
