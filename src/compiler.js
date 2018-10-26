const { Map, List, Set, Record } = require('immutable')
const Edn = require('jsedn')
const Acorn = require('acorn')

const Graph = require('./graph')
const prettyI = require('pretty-immutable')

const { Model } = require('./model')
const ModelCompiler = require('./model_compiler')
const Nodes = require('./toplevel/nodes')

const MARK_JS = 'js'
const MARK_REALTIME = 'realtime'

async function compile (files, activeInstrument) {
  console.log()
  console.log('COMPILING')

  const parsedGraphs = parseGraphs(files)

  const instrumentGraph = parsedGraphs.instruments.get(activeInstrument).graph
  renderGraphAsDot('parsed', instrumentGraph)

  // TODO: sanitisation pass that checks all nodes exist
  const inlinedGraph = inlineGraphNodes(instrumentGraph, parsedGraphs)
  renderGraphAsDot('inlined', inlinedGraph)

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
              params = params.set(key.val, Edn.toJS(value))
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
  let graph = rootGraph
  // TODO: inline graphs

  // inline maths expressions
  graph = Graph.mapNodes(graph, (id, node) => {
    if (node.type !== 'maths/expr') return null

    const exprString = node.params.get('expr')
    const parse = Acorn.parse(exprString)
    if (parse.body.length !== 1 || parse.body[0].type !== 'ExpressionStatement') {
      throw new TypeError('Bad maths expression: ' + exprString)
    }
    const parsedExpression = parse.body[0].expression

    const inputs = node.params.get('inputs')

    let subGraph = Graph.Graph()
    subGraph = Graph.addOutgoingTarget(subGraph, 'out', { type: 'real' })
    inputs.forEach(i => {
      subGraph = Graph.addIncomingTarget(subGraph, i, { type: 'real' })
    })

    let idCounter = 0
    const mkId = type => type + '-' + (idCounter++)
    const createNodeTree = expr => {
      switch (expr.type) {
        case 'Identifier': {
          const name = expr.name
          if (!inputs.includes(name)) throw new TypeError(`Bad maths expression (variable not defined ${name}): ${exprString}`)
          return List.of('self', name)
        }

        case 'Literal': {
          const id = mkId('lit')
          const node = Graph.Node({
            type: 'core/constant',
            params: Map({ value: expr.value })
          })
          subGraph = Graph.addNode(subGraph, id, node)
          return List.of(id, 'value')
        }

        case 'UnaryExpression': {
          const op = expr.operator
          const subTarget = createNodeTree(expr.argument)

          if (op !== '-') throw new TypeError(`Bad maths expression (bad unary operator ${op}): ${exprString}`)

          // negation constant
          const constantId = mkId('neg')
          const constantNode = Graph.Node({
            type: 'core/constant',
            params: Map({ value: -1 })
          })
          subGraph = Graph.addNode(subGraph, constantId, constantNode)

          // multiply node
          const mulId = mkId('negmul')
          const mulNode = Graph.Node({ type: 'maths/mul' })
          subGraph = Graph.addNode(subGraph, mulId, mulNode)

          subGraph = Graph.addEdge(subGraph, Graph.Edge({
            from: subTarget,
            to: List.of(mulId, 'a')
          }))
          subGraph = Graph.addEdge(subGraph, Graph.Edge({
            from: List.of(constantId, 'value'),
            to: List.of(mulId, 'b')
          }))

          return List.of(mulId, 'value')
        }

        case 'BinaryExpression': {
          const op = expr.operator
          const leftTarget = createNodeTree(expr.left)
          const rightTarget = createNodeTree(expr.right)

          const nodeTypes = Map([
            ['*', 'maths/mul'],
            ['+', 'maths/add']])
          if (!nodeTypes.has(op)) throw new TypeError(`Bad maths expression (bad binary operator ${op}): ${exprString}`)

          const id = mkId('bin')
          const node = Graph.Node({ type: nodeTypes.get(op) })
          subGraph = Graph.addNode(subGraph, id, node)

          subGraph = Graph.addEdge(subGraph, Graph.Edge({
            from: leftTarget,
            to: List.of(id, 'a')
          }))
          subGraph = Graph.addEdge(subGraph, Graph.Edge({
            from: rightTarget,
            to: List.of(id, 'b')
          }))

          return List.of(id, 'value')
        }

        default:
          throw new TypeError(`Bad maths expression (unknown operator ${expr.type}): ${exprString}`)
      }
    }

    const topNodeTarget = createNodeTree(parsedExpression)
    subGraph = Graph.addEdge(subGraph, Graph.Edge({ from: topNodeTarget, to: List.of('self', 'out') }))

    return subGraph
  })

  return graph
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
      try {
        model.connect(fromPort, toPort)
      } catch (e) {
        console.error('Error with ports', edge.from.toJSON(), edge.to.toJSON())
        throw e
      }
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

const path = require('path')
const { execFile } = require('child_process')
const fs = require('fs')
const { promisify } = require('util')
function renderGraphAsDot (stage, graph) {
  const renderPath = '/tmp/codegen-synth'
  const dotPath = path.join(renderPath, stage + '.dot')
  const svgPath = path.join(renderPath, stage + '.svg')

  const dot = Graph.toDot(graph)
  promisify(fs.writeFile)(dotPath, dot)
    .then(() => promisify(execFile)('dot', [
      '-Tsvg',
      '-o', svgPath,
      dotPath
    ]))
    .then(() => {}, e => console.warn('Failed to render', e))
}

module.exports = {
  compile
}
