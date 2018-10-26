const nanoid = require('./id_generator')
const { Map, List, Set, Record } = require('immutable')
const prettyI = require('pretty-immutable')

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
    const sanitisePointer = p => List.of('' + p[0], p[1])
    return Edge({
      from: Array.isArray(edge.from) ? sanitisePointer(edge.from) : edge.from,
      to: sanitisePointer(edge.to)
    })
  }

  const nodes = Map(graph.nodes.map(n => {
    return ['' + n.id, mkNode(n)]
  }))
  const edges = Set(graph.edges.map(mkEdge))
  return Graph({
    nodes,
    edges
  })
}

function setParam (graph, name, value) {
  return graph.update('params', p => {
    return p.set(name, value)
  })
}

function addIncomingTarget (graph, name, params) {
  return graph.update('params', p => {
    return p.update('in', Map(), incoming => incoming.set(name, params))
  })
}

function addOutgoingTarget (graph, name, params) {
  return graph.update('params', p => {
    return p.update('out', Map(), outgoing => outgoing.set(name, params))
  })
}

function addNode (graph, id, node) {
  return graph.update('nodes', ns => ns.set(id, node))
}

function addEdge (graph, edge) {
  return graph.update('edges', es => es.add(edge))
}

function mkNodeId () {
  return nanoid(10)
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

/**
 * Maps each node in the graph into any number of nodes and edges, using the
 * supplied function, while preserving edges.
 *
 * If the function returns null, the node will be kept as is. If the function
 * returns a graph, the node will be replaced with the graph, and all edges
 * previously going to the node will be rerouted to the inputs and outputs of
 * the graph.
 *
 * Does not map any of the new nodes.
 */
function mapNodes (graph, fn) {
  let modified = graph

  graph.nodes.forEach((node, originalId) => {
    const mapped = fn(originalId, node)
    if (!mapped) return

    modified = modified.update('nodes', ns => ns.delete(originalId))
    mapped.nodes.forEach((node, id) => {
      modified = modified.update('nodes', ns => ns.set(originalId + '$' + id, node))
    })
    mapped.edges.forEach(edge => {
      if (edge.from.get(0) === 'self') {
        const outsideEdges = modified.edges.filter(e => e.to.get(0) === originalId && e.to.get(1) === edge.from.get(1))
        outsideEdges.forEach(outside => {
          modified = modified.update('edges', es => es.add(Edge({
            from: outside.from,
            to: edge.to.set(0, originalId + '$' + edge.to.get(0))
          })))
        })
      } else if (edge.to.get(0) === 'self') {
        const outsideEdges = modified.edges.filter(e => e.from.get(0) === originalId && e.from.get(1) === edge.to.get(1))
        outsideEdges.forEach(outside => {
          modified = modified.update('edges', es => es.add(Edge({
            from: edge.from.set(0, originalId + '$' + edge.from.get(0)),
            to: outside.to
          })))
        })
      } else {
        modified = modified.update('edges', es => es.add(Edge({
          from: edge.from.set(0, originalId + '$' + edge.from.get(0)),
          to: edge.to.set(0, originalId + '$' + edge.to.get(0))
        })))
      }
    })

    modified = modified.update('edges', es => es.filter(e => e.to.get(0) !== originalId))
    modified = modified.update('edges', es => es.filter(e => e.from.get(0) !== originalId))
  })

  return modified
}

function toDot (graph) {
  const str = id => `"${id}"`

  let nodes = graph.nodes.entrySeq().map(([id, node]) => {
    let label = `[${node.type}]\\n${id}`

    if (node.type === 'core/constant') {
      label = node.params.get('value')
    } else if (node.type === 'maths/mul') {
      label = '*'
    } else if (node.type === 'maths/add') {
      label = '+'
    } else if (node.type === 'maths/expr') {
      label = `${node.params.get('expr')}\\n${id}`
    }

    const attributes = [
      `label=${str(label)}`,
      'color="lightgrey"'
    ].filter(a => !!a)

    return `${str(id)} [${attributes.join(',')}];`
  })

  let edges = graph.edges.map(edge => {
    const fromId = edge.from.get(0)
    const toId = edge.to.get(0)
    const attributes = [
      edge.from.get(1) === 'value' ? null : `taillabel=${str(edge.from.get(1))}`,
      edge.to.get(1) === 'value' ? null : `headlabel=${str(edge.to.get(1))}`,
      'color="lightgrey"'
    ].filter(a => !!a)

    return `${str(fromId)} -> ${str(toId)} [${attributes.join(',')}];`
  })

  let digraph =
    'digraph {\n' +
    '  rankdir=LR;\n' +
    nodes.map(s => '  ' + s).join('\n') + '\n' +
    edges.map(s => '  ' + s).join('\n') + '\n' +
    '}'
  return digraph
}

module.exports = {
  mkGraph,

  setParam,
  addIncomingTarget,
  addOutgoingTarget,
  addNode,
  addEdge,

  markNodes,
  markForwards,
  markBackwards,

  partition,
  mapNodes,

  Graph,
  Node,
  Edge,

  hasFrom,

  emptyGraph: Graph(),
  mkNodeId,

  toDot
}
