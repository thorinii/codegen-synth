const express = require('express')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const { Map, List, Set, Record } = require('immutable')

const Nodes = require('./src/toplevel/nodes')

const { startEngine } = require('./src/engine')
const compiler = require('./src/compiler')
const { mkGraph } = require('./src/graph')

let editorStorage = Record({
  files: Map(),
  activeInstrument: null
}, 'EditorStorage')()

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

    app.get('/api/editor_storage', (req, res) => {
      res.json(editorStorage)
    })

    app.post('/api/editor_storage/:file', (req, res) => {
      this._onUpdate(req.params.file, req.body.content)
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

  async push (editorStorage) {
    let compiled
    try {
      compiled = await this.compile(editorStorage.files, editorStorage.activeInstrument)
    } catch (e) {
      console.warn('Failed to compile', e)
      return
    }

    console.log('Restarting engine')
    await this.swapEngine(compiled)
  }

  async compile (files, activeInstrument) {
    const result = await compiler.compile(files, activeInstrument)
    return result
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
  const savedData = await loadEditorStorage()
  if (savedData) {
    editorStorage = editorStorage.merge(savedData)
  } else {
    editorStorage = editorStorage.update('files', fs => fs.set('default', ''))
  }

  const backend = new Backend()
  const api = new Api()
  api.setOnUpdate((file, content) => {
    editorStorage = editorStorage.update('files', fs => fs.set(file, content))

    backend.push(editorStorage)
      .then(null, e => console.error('Crash in backend', e))

    saveEditorStorage(editorStorage)
      .then(null, e => console.warn('Failed to save graph', e))
  })
  api.start()

  backend.push(editorStorage)
    .then(null, e => console.error('Crash in backend', e))
}
main()
  .then(null, e => console.error('Crash in main', e))

async function loadEditorStorage () {
  try {
    const content = await promisify(fs.readFile)(path.join(__dirname, 'save.json'))
    return JSON.parse(content)
  } catch (e) {
    if (e.code === 'ENOENT') return null

    console.error(e)
    return null
  }
}

async function saveEditorStorage (es) {
  const json = JSON.stringify(es)

  return promisify(fs.writeFile)(path.join(__dirname, 'save.json'), json)
}
