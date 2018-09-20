import Vue from 'vue'

import * as Api from './api'
import { GraphUi } from './graph-ui'

const viewState = {
  nodeTypes: [],
  subGraphs: [],
  instruments: [],

  selectedGraph: null,

  createSubGraph: () => {
    console.log('Creating subgraph')
  }
}
new Vue({
  el: '.sidebar',
  data: viewState
})

async function main () {
  const graphUi = new GraphUi(document.querySelector('#rete'))
  graphUi.setOnChange(async graph => {
    await Api.uploadGraph(viewState.selectedGraph, graph)
  })

  const env = await Api.loadEnvironment()
  graphUi.setAvailableNodeTypes(env.nodes)

  for (const node of env.nodes) {
    viewState.nodeTypes.push({
      name: node.name,
      create () {
        graphUi.addNode(node.name)
      }
    })
  }

  for (const id of env.subGraphs) {
    const graph = env.graphs[id]
    viewState.subGraphs.push({
      id,
      name: graph.name,
      switchTo: () => {}
    })
  }

  for (const id of env.instruments) {
    const graph = env.graphs[id]
    viewState.instruments.push({
      id,
      name: graph.name,
      switchTo: () => {}
    })
  }

  // note: these are not equivalent. This just defaults the currently edited
  // graph to the active instrument
  viewState.selectedGraph = env.activeInstrument
  console.log(env)

  graphUi.addNode('Output')
}

main()
  .then(null, e => console.error('Crash in main', e))
