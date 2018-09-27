const express = require('express')
const fs = require('fs')
const path = require('path')
const shortid = require('shortid')
const { promisify } = require('util')

const Nodes = require('./src/toplevel/nodes')

const { Model } = require('./src/model')
const { compile, startEngine } = require('./src/engine')
const compiler = require('./src/compiler')
const { mkGraph } = require('./src/graph')

function createGraph (env, name) {
  const id = shortid.generate()
  env.graphs[id] = {
    id,
    name,
    nodes: [],
    edges: []
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
      this._onUpdate(req.params.id, req.body)
      res.json({})
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
    const result = await compiler.compile(mkGraph(graph))
    return result.realtimeExe
  }

  async swapEngine (compiled) {
    if (this._engine) {
      this._engine.stop()
      await this._engine.waitForExit()
    }

    if (false) {
      this._engine = startEngine(compiled)
    }
  }
}

async function main () {
  const savedEnv = await loadEnvironment()
  if (savedEnv) {
    Object.assign(environment, savedEnv, {
      nodes: Nodes.list
    })
  } else {
    createInstrument(environment, 'Default')
  }

  const backend = new Backend()
  const api = new Api()
  api.setOnUpdate((id, graph) => {
    Object.assign(environment.graphs[id], graph)
    backend.push(graph)
      .then(null, e => console.error('Crash in backend', e))
    saveEnvironment(environment)
      .then(null, e => console.warn('Failed to save graph', e))
  })
  api.start()

  backend.push(environment.graphs[environment.activeInstrument])
}
main()
  .then(null, e => console.error('Crash in main', e))

async function loadEnvironment () {
  try {
    const content = await promisify(fs.readFile)(path.join(__dirname, 'save.json'))
    return JSON.parse(content)
  } catch (e) {
    console.error(e)
    return null
  }
}

async function saveEnvironment (env) {
  const json = JSON.stringify(env)

  return promisify(fs.writeFile)(path.join(__dirname, 'save.json'), json)
}
