import Rete from 'rete'
import AlightRenderPlugin from 'rete-alight-render-plugin'
import ConnectionPlugin from 'rete-connection-plugin'

const sluggify = name => name.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
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

          params: nodeType.params.map(param => {
            const value = node.data[sluggify(param.name)]
            return { name: param.name, value }
          })
        })

        nodeType.inputs.forEach(input => {
          const socket = node.inputs[sluggify(input.name)]
          if (socket.connections.length === 0) {
            edges.push({
              from: node.data[sluggify(input.name)],
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
      let c = new Rete.Input(sluggify(input.name), input.name, SocketTypes[input.type])
      c.addControl(new NumControl(sluggify(input.name), input.name, this.editor))
      node.addInput(c)
    })
    this._definition.params.forEach(param => {
      node.addControl(new NumControl(sluggify(param.name), param.name, this.editor))
    })
    this._definition.outputs.forEach(output => {
      let c = new Rete.Output(sluggify(output.name), output.name, SocketTypes[output.type])
      node.addOutput(c)
    })
  }

  worker () {}
}

class NumControl extends Rete.Control {
  constructor (id, name, emitter) {
    super()
    this.id = id
    this.emitter = emitter
    this.template = `<div class="input-title">${name}</div><input style="width: 40px" type="number" title="${name}" :value="value" @input="change($event)" />`

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
