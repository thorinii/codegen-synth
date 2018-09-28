const { Map, List, Set, Record } = require('immutable')

const Graph = require('./graph')
const prettyI = require('pretty-immutable')

const { Model } = require('./model')
const ModelCompiler = require('./model_compiler')
const Nodes = require('./toplevel/nodes')

const MARK_JS = 'js'
const MARK_REALTIME = 'realtime'

async function compile (graph) {
  const [jsGraph, realtimeGraph] = partition(graph)

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

function partition (graph) {
  const realtimeNodes = new Set([
    'output',
    'sine_generator',
    'delay',
    'biquad_lowpass',
    'biquad_hipass'
  ])
  const jsNodes = new Set([])

  // mark nodes we know
  graph = Graph.markNodes(graph, n => {
    if (realtimeNodes.has(n.type)) return [MARK_REALTIME]
    else if (jsNodes.has(n.type)) return [MARK_JS]
    else return []
  })

  graph = Graph.markForwards(graph, MARK_REALTIME)
  graph = Graph.markBackwards(graph, MARK_JS)

  // mark nodes that are unassigned as JS
  graph = Graph.markNodes(graph, n => {
    if (!n.marks.has(MARK_REALTIME)) return [MARK_JS]
    else return []
  })

  let varCounter = 0
  return Graph.partition(graph, [MARK_JS, MARK_REALTIME], isRight => {
    if (!isRight) throw new Error('Does not support realtime -> JS connections')

    const varId = '' + (varCounter++)
    return {
      leftNode: Graph.Node({ type: 'var', params: Map({ id: varId }) }),
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
    if (node.type === 'output') {
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
      const definition = type.makeDefinition(nodeConfig)
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
    nodesById = nodesById.set(id, ControllerNode({
      id,
      type: node.type,
      params: node.params
    }))
  })

  graph.edges.forEach(edge => {
    if (Graph.hasFrom(edge)) {
      nodesById = nodesById.update(edge.from.get(0), n => {
        return n.update('outputs', o => o.set(edge.from.get(1), ControllerEdge({
          node: edge.to.get(0),
          target: edge.to.get(1)
        })))
      })
    } else {
      const generatedId = '$' + generatedNodeCounter++
      nodesById = nodesById.set(generatedId, ControllerNode({
        id: generatedId,
        type: 'constant',
        params: Map.of('value', edge.from),
        outputs: Map.of('value', ControllerEdge({
          node: edge.to.get(0),
          target: edge.to.get(1)
        }))
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
