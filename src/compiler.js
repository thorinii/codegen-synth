const { Map, Set } = require('immutable')

const Graph = require('./graph')
const prettyI = require('pretty-immutable')

const MARK_JS = 'js'
const MARK_REALTIME = 'realtime'

module.exports.compile = graph => {
  const [jsGraph, realtimeGraph] = partition(graph)

  // dead node pass
  console.log(prettyI(jsGraph))
  console.log(prettyI(realtimeGraph))

  return null
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
