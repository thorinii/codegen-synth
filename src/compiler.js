const { Map, List, Set, Record } = require('immutable')
const Edn = require('jsedn')

const Graph = require('./graph')
const prettyI = require('pretty-immutable')

const { Model } = require('./model')
const ModelCompiler = require('./model_compiler')
const Nodes = require('./toplevel/nodes')

const MARK_JS = 'js'
const MARK_REALTIME = 'realtime'

async function compile (files, activeInstrument) {
  const parsedGraphs = parseGraphs(files)

  const instrumentGraph = parsedGraphs.instruments.get(activeInstrument).graph
  // TODO: sanitisation pass that checks all nodes exist
  const inlinedGraph = inlineGraphNodes(instrumentGraph, parsedGraphs)

  const [jsGraph, realtimeGraph] = partition(inlinedGraph)

  // TODO: dead node pass
  // console.log(prettyI(jsGraph))
  // console.log(prettyI(realtimeGraph))

  const realtimeModel = createRealtimeModel(realtimeGraph)
  const realtimeExe = await ModelCompiler.compile(realtimeModel)

  // TODO: convert jsGraph into a fully specified data structure (not a Graph.Graph)
  const controllerModel = createControllerModel(jsGraph)

  return {
    controller: controllerModel,
    realtime: realtimeExe
  }
}

function parseGraphs (files) {
  const parseGraph = (filename, list) => {
    let name = null
    let description = null
    let graph = Graph.Graph()
    graph = Graph.setParam(graph, 'file', filename)

    list.val.forEach((item, idx) => {
      if (idx === 0) return // skip the type

      if (idx === 1) {
        name = item.name
        return
      }
      if (idx === 2 && typeof item === 'string') {
        description = item
        return
      }

      if (!(item instanceof Edn.List)) throw new Error('Unknown thing: ' + JSON.stringify(item))

      const itemType = item.val[0].val
      switch (itemType) {
        case 'in':
          graph = Graph.addIncomingTarget(graph, item.val[1].val, { type: item.val[2].val })
          break

        case 'out':
          graph = Graph.addOutgoingTarget(graph, item.val[1].val, { type: item.val[2].val })
          break

        case 'node': {
          let params = Map()
          if (item.val[3]) {
            const keys = item.val[3].keys
            const values = item.val[3].vals
            keys.forEach((key, idx) => {
              const value = values[idx]
              params = params.set(key.val, value)
            })
          }

          const node = Graph.Node({
            type: item.val[2].val,
            params: params
          })
          graph = Graph.addNode(graph, item.val[1].val, node)
          break
        }

        case '--': {
          if (item.val[1] instanceof Edn.Symbol) {
            const edge = Graph.Edge({
              from: List.of(item.val[1].ns, item.val[1].name),
              to: List.of(item.val[2].ns, item.val[2].name)
            })
            graph = Graph.addEdge(graph, edge)
          } else {
            const nodeId = Graph.mkNodeId()
            const node = Graph.Node({
              type: 'core/constant',
              params: Map({ value: item.val[1] })
            })
            const edge = Graph.Edge({
              from: List.of(nodeId, 'value'),
              to: List.of(item.val[2].ns, item.val[2].name)
            })
            console.log(item.val[1])

            graph = Graph.addNode(graph, nodeId, node)
            graph = Graph.addEdge(graph, edge)
          }
          break
        }

        default:
          throw new Error('Unknown item type: ' + itemType + ' ' + JSON.stringify(item))
      }
    })

    if (name === null) throw new Error('Graph needs a name:', list)
    return {
      name,
      description,
      graph
    }
  }

  const parsedEdn = files.map((content, filename) => {
    try {
      return Edn.parse('(' + content + ')')
    } catch (e) {
      throw new Error('Failed to parse file ' + filename + ': ' + e)
    }
  })

  let instruments = Map()
  let nodes = Map()
  parsedEdn.forEach((edn, filename) => {
    edn.each(item => {
      if (!(item instanceof Edn.List)) return

      const type = item.at(0).val
      if (type === 'instrument') {
        const graph = parseGraph(filename, item)
        instruments = instruments.set(filename + '/' + graph.name, {
          file: filename,
          name: graph.name,
          description: graph.description,
          graph: graph.graph
        })
      } else if (type === 'node') {
        const graph = parseGraph(filename, item)
        nodes = nodes.set(filename + '/' + graph.name, {
          file: filename,
          name: graph.name,
          description: graph.description,
          graph: graph.graph
        })
      } else {
        console.warn('Unknown item type:', type)
      }
    })
  })

  return { instruments, nodes }
}

function inlineGraphNodes (rootGraph, environment) {
  console.log('compiling', rootGraph, environment)
  return rootGraph
}

function partition (graph) {
  // mark nodes we know
  graph = Graph.markNodes(graph, n => {
    const type = Nodes.lookup(n.type)
    if (!type) throw new Error('Unknown node type: ' + n.type)

    if (type.onlyRealtime) return [MARK_REALTIME]
    else if (type.onlyController) return [MARK_JS]
    else return []
  })

  // propagate requirements: only realtime nodes can come after a realtime
  graph = Graph.markForwards(graph, MARK_REALTIME)
  // only JS nodes can come before a JS
  graph = Graph.markBackwards(graph, MARK_JS)

  // mark nodes that are unassigned as JS
  graph = Graph.markNodes(graph, n => {
    if (!n.marks.has(MARK_REALTIME)) return [MARK_JS]
    else return []
  })

  let varCounter = 0
  return Graph.partition(graph, [MARK_JS, MARK_REALTIME], isRight => {
    if (!isRight) throw new Error('Does not support realtime -> JS connections')

    const varId = varCounter++
    return {
      leftNode: Graph.Node({ type: 'var_bridge', params: Map({ id: varId }) }),
      leftEdgeTarget: 'value',
      rightNode: Graph.Node({ type: 'var', params: Map({ id: varId }) }),
      rightEdgeTarget: 'out'
    }
  })
}

function createRealtimeModel (graph) {
  const model = new Model()

  let outputNode = null
  let nodes = new Map()
  graph.nodes.entrySeq().forEach(([id, node]) => {
    if (node.type === 'io/mono-output') {
      outputNode = id
      return
    }

    nodes = nodes.set(id, createModelNode(model, node))
  })

  if (outputNode === null) throw new Error('Graph does not have an output')
  graph.edges.forEach(e => connect(model, e))

  return model

  function createModelNode (model, node) {
    if (node.type === 'var') {
      return model.addVariable(node.params.get('id'), 0)
    } else {
      const type = Nodes.lookup(node.type)
      const nodeConfig = {
        params: node.params
      }
      const definition = type.makeRealtime(nodeConfig)
      return model.addNode(definition, {})
    }
  }

  function connect (model, edge) {
    let toPort
    if (edge.to.get(0) === outputNode) {
      toPort = model.out
    } else {
      const toNode = nodes.get(edge.to.get(0))
      toPort = toNode[edge.to.get(1)]
    }

    if (List.isList(edge.from)) {
      const fromNode = nodes.get(edge.from.get(0))
      const fromPort = fromNode[edge.from.get(1)]
      model.connect(fromPort, toPort)
    } else {
      model.connect(model.addConstant(edge.from), toPort)
    }
  }
}

function createControllerModel (graph) {
  const ControllerNode = Record({
    id: null,
    type: null,
    params: Map(),
    outputs: Map()
  }, 'Node')
  const ControllerEdge = Record({
    node: null,
    target: null
  }, 'Edge')

  let nodesById = Map()
  let generatedNodeCounter = 0

  graph.nodes.entrySeq().forEach(([id, node]) => {
    const type = Nodes.lookup(node.type).controller

    nodesById = nodesById.set(id, ControllerNode({
      id,
      type: type,
      params: node.params
    }))
  })

  graph.edges.forEach(edge => {
    if (Graph.hasFrom(edge)) {
      nodesById = nodesById.update(edge.from.get(0), n => {
        return n.update('outputs', o => o.update(edge.from.get(1), List(), o => o.push(ControllerEdge({
          node: edge.to.get(0),
          target: edge.to.get(1)
        }))))
      })
    } else {
      const generatedId = '$' + generatedNodeCounter++
      nodesById = nodesById.set(generatedId, ControllerNode({
        id: generatedId,
        type: Nodes.lookup('constant').controller,
        params: Map.of('value', edge.from),
        outputs: Map.of('out', List.of(ControllerEdge({
          node: edge.to.get(0),
          target: edge.to.get(1)
        })))
      }))
    }
  })

  return {
    nodes: nodesById.toList()
  }
}

module.exports = {
  compile
}
