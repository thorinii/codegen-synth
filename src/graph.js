const shortId = require('shortid')
const { Map, List, Set, Record } = require('immutable')

const Graph = Record({
  nodes: Map(),
  edges: Set(),
  params: Map()
}, 'Graph')

const Node = Record({
  type: null,
  params: Map(),
  marks: Set()
}, 'Node')

const Edge = Record({
  from: null,
  to: null
}, 'Edge')

function mkGraph (graph) {
  const mkNode = node => {
    return Node({
      type: node.type,
      params: Map(node.params.map(p => [p.name, p.value]))
    })
  }
  const mkEdge = edge => {
    return Edge({
      from: Array.isArray(edge.from) ? List(edge.from) : edge.from,
      to: List(edge.to)
    })
  }

  const nodes = Map(graph.nodes.map(n => {
    return [n.id, mkNode(n)]
  }))
  const edges = Set(graph.edges.map(mkEdge))
  return Graph({
    nodes,
    edges
  })
}

function mkNodeId () {
  return shortId.generate()
}

function hasFrom (edge) {
  return List.isList(edge.from)
}

function nodesFromNode (graph, nodeId) {
  return graph.edges.toSeq()
    .filter(e => hasFrom(e) ? e.from.get(0) === nodeId : false)
    .map(e => e.to.get(0))
    .toSet()
}

function nodesToNode (graph, nodeId) {
  return graph.edges.toSeq()
    .filter(e => e.to.get(0) === nodeId)
    .filter(e => hasFrom(e))
    .map(e => e.from.get(0))
    .toSet()
}

/**
 * Marks nodes using marks returned from the mapping function. `fn` should
 * return an array.
 */
function markNodes (graph, fn) {
  return graph.update('nodes', nodes => {
    return nodes.map(n => {
      const marks = fn(n)
      return n.update('marks', m => m.union(marks))
    })
  })
}

function markForwards (graph, mark) {
  return _markInDirection(graph, mark, nodesFromNode)
}

function markBackwards (graph, mark) {
  return _markInDirection(graph, mark, nodesToNode)
}

function _markInDirection (graph, mark, nodeFinderFn) {
  const go = (id, node) => {
    node = node.update('marks', m => m.add(mark))
    graph = graph.update('nodes', nodes => nodes.set(id, node))

    nodeFinderFn(graph, id)
      .forEach(id => {
        const next = graph.nodes.get(id)
        if (!next.marks.has(mark)) go(id, next)
      })
  }

  graph.nodes.entrySeq()
    .filter(([_, node]) => node.marks.has(mark))
    .forEach(([id, node]) => go(id, node))
  return graph
}

/**
 * Splits a graph into two graphs, divided by the two given marks. If not every
 * node is marked with those two, or if there are doubly marked nodes, it will
 * throw an Error.
 *
 * `bridgeFn` is used to replace edges that cross between the two sides. It
 * should return:
 * {
 *   leftNode: [...], // new node needed for the left side
 *   leftEdgeTarget: ..., // the target for the new left edge
 *   rightNode: [...], // new node needed for the right side
 *   rightEdgeTarget: ..., // the target for the new right edge
 * }
 */
function partition (graph, [leftMark, rightMark], bridgeFn) {
  let leftGraph = Graph()
  let rightGraph = Graph()

  graph.nodes.entrySeq().forEach(([id, node]) => {
    const isLeft = node.marks.has(leftMark)
    const isRight = node.marks.has(rightMark)
    if (isLeft && isRight) {
      throw new Error(`Node ${id} is both left and right`)
    } else if (isLeft) {
      leftGraph = leftGraph.update('nodes', ns => ns.set(id, node))
    } else {
      rightGraph = rightGraph.update('nodes', ns => ns.set(id, node))
    }
  })

  const upG = (isLeft, fn) => {
    if (isLeft) {
      leftGraph = fn(leftGraph)
    } else {
      rightGraph = fn(rightGraph)
    }
  }

  graph.edges.forEach(edge => {
    const toNode = edge.to.get(0)
    const toIsLeft = leftGraph.nodes.has(toNode)

    if (hasFrom(edge)) {
      const fromNode = edge.from.get(0)

      const fromIsLeft = leftGraph.nodes.has(fromNode)

      if (fromIsLeft === toIsLeft) {
        upG(toIsLeft, g => g.update('edges', es => es.add(edge)))
      } else {
        const bridge = bridgeFn(fromIsLeft)
        const leftId = mkNodeId()
        const rightId = mkNodeId()

        leftGraph = leftGraph.update('nodes', ns => ns.set(leftId, bridge.leftNode))
        leftGraph = leftGraph.update('edges', es => es.add(Edge({
          from: edge.from,
          to: List.of(leftId, bridge.leftEdgeTarget)
        })))

        rightGraph = rightGraph.update('nodes', ns => ns.set(rightId, bridge.rightNode))
        rightGraph = rightGraph.update('edges', es => es.add(Edge({
          from: List.of(rightId, bridge.rightEdgeTarget),
          to: edge.to
        })))
      }
    } else {
      upG(toIsLeft, g => g.update('edges', es => es.add(edge)))
    }
  })

  return [leftGraph, rightGraph]
}

module.exports = {
  mkGraph,

  markNodes,
  markForwards,
  markBackwards,
  partition,

  Graph,
  Node,
  Edge
}
