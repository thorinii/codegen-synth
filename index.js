const express = require('express')
const path = require('path')
const shortid = require('shortid')

const Nodes = require('./src/toplevel/nodes')

const { Model } = require('./src/model')
const { compile, startEngine } = require('./src/engine')

function createGraph (env, name) {
  const id = shortid.generate()
  env.graphs[id] = {
    id,
    name,
    nodes: []
  }
  return id
}

function createInstrument (env, name) {
  const id = createGraph(env, name)
  // TODO: add default nodes
  env.instruments.push(id)
  if (env.activeInstrument === null) {
    env.activeInstrument = id
  }
  return id
}

const environment = {
  nodes: Nodes.list,
  subGraphs: [],
  instruments: [],
  graphs: {},
  activeInstrument: null
}

createInstrument(environment, 'Default')

class Api {
  constructor () {
    this._onUpdate = () => {}

    const app = express()
    this.app = app

    app.set('view engine', 'pug')
    app.set('views', path.join(__dirname, 'src'))

    app.use(express.urlencoded({ extended: true }))
    app.use(express.json())

    app.get('/', (req, res) => res.render('page'))

    app.get('/api/environment', (req, res) => {
      res.json(environment)
    })

    app.post('/api/graph/:id', (req, res) => {
      if (!Array.isArray(req.body)) {
        res.status(500).json({ message: 'Invalid payload: not a graph' })
      } else {
        this._onUpdate(req.params.id, req.body)
        res.json({})
      }
    })

    app.use(express.static(path.join(__dirname, 'build')))
  }

  start () {
    const port = 3000
    this.app.listen(port, () => console.log(`Running on port ${port}!`))
  }

  setOnUpdate (fn) {
    this._onUpdate = fn
  }
}

class Backend {
  constructor () {
    this._engine = null
  }

  async push (graph) {
    console.log('Updating graph')

    let compiled
    try {
      compiled = await this.compile(graph)
    } catch (e) {
      console.warn('Failed to compile', e)
      return
    }

    await this.swapEngine(compiled)
  }

  async compile (graph) {
    const model = lowerGraph(graph)
    return compile(model)
  }

  async swapEngine (compiled) {
    if (this._engine) {
      this._engine.stop()
      await this._engine.waitForExit()
    }

    this._engine = startEngine(compiled)
  }
}

const backend = new Backend()
const api = new Api()
api.setOnUpdate((id, graph) => {
  environment.graphs[id].nodes = graph
  backend.push(graph)
    .then(null, e => console.error('Crash in backend', e))
})
api.start()

function lowerGraph (graph) {
  const model = new Model()
  const nodes = new Map()

  let outputNode

  graph.forEach(node => {
    if (node.type === 'Output') {
      outputNode = node
      return
    }

    nodes.set(node.id, createModelNode(model, node))
  })

  if (!outputNode) throw new Error('Graph does not have an output')
  graph.forEach(n => connectBackward(model, n))

  return model

  function createModelNode (model, node) {
    const type = Nodes.lookup(node.type)
    const nodeConfig = {
      inputs: new Map(node.inputs.map(i => [i.name, i.value])),
      params: new Map(node.params.map(p => [p.name, p.value]))
    }
    const definition = type.makeDefinition(nodeConfig)
    return model.addNode(definition, {})
  }

  function connectBackward (model, highNode) {
    highNode.inputs.forEach(input => {
      if (input.from === null) return

      let toPort
      if (highNode.type === 'Output') {
        toPort = model.out
      } else {
        const lowNode = nodes.get(highNode.id)
        toPort = lowNode[input.name.toLowerCase()]
      }

      const fromNode = nodes.get(input.from[0])
      if (!fromNode) throw new Error('Invalid input node: ' + JSON.stringify(input))
      const fromPort = fromNode[input.from[1]]
      if (!(fromPort >= 0)) throw new Error('Invalid input node port: ' + JSON.stringify(input))

      model.connect(fromPort, toPort)
    })
  }
}
