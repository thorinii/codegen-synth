const { Map, List, Set } = require('immutable')

const Graph = require('./graph')
const prettyI = require('pretty-immutable')

const { Model } = require('./model')
const ModelCompiler = require('./model_compiler')
const Nodes = require('./toplevel/nodes')

const MARK_JS = 'js'
const MARK_REALTIME = 'realtime'

async function compile (graph) {
  const [jsGraph, realtimeGraph] = partition(graph)

  // dead node pass
  console.log(prettyI(jsGraph))
  console.log(prettyI(realtimeGraph))

  const realtimeModel = createRealtimeModel(realtimeGraph)
  const realtimeExe = await ModelCompiler.compile(realtimeModel)

  return {
    realtimeExe
  }
}

function partition (graph) {
  const realtimeNodes = new Set([
    'Output',
    'Sine Wave',
    'Delay',
    'BiQuad Lowpass',
    'BiQuad Hipass'
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
    const varId = varCounter++
    return {
      leftNode: Graph.Node({ type: 'Var', params: Map({ id: varId }) }),
      leftEdgeTarget: 'value',
      rightNode: Graph.Node({ type: 'Var', params: Map({ id: varId }) }),
      rightEdgeTarget: 'value'
    }
  })
}

function createRealtimeModel (graph) {
  const model = new Model()

  let outputNode = null
  let nodes = new Map()
  graph.nodes.entrySeq().forEach(([id, node]) => {
    if (node.type === 'Output') {
      outputNode = id
      return
    }

    nodes = nodes.set(id, createModelNode(model, node))
  })

  if (outputNode === null) throw new Error('Graph does not have an output')
  graph.edges.forEach(e => connect(model, e))

  return model

  function createModelNode (model, node) {
    const type = Nodes.lookup(node.type)
    const nodeConfig = {
      params: node.params
    }
    const definition = type.makeDefinition(nodeConfig)
    return model.addNode(definition, {})
  }

  function connect (model, edge) {
    let toPort
    if (edge.to.get(0) === outputNode) {
      toPort = model.out
    } else {
      const toNode = nodes.get(edge.to.get(0))
      toPort = toNode[edge.to.get(1).toLowerCase()]
    }

    if (List.isList(edge.from)) {
      const fromNode = nodes.get(edge.from.get(0))
      const fromPort = fromNode[edge.from.get(1).toLowerCase()]
      model.connect(fromPort, toPort)
    } else {
      model.connect(model.addConstant(edge.from), toPort)
    }
  }
}

module.exports = {
  compile
}
