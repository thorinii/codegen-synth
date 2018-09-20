import Vue from 'vue'

import * as Api from './api'
import { GraphUi } from './graph-ui'

// const Nodes = []

const toolbarButtons = []
new Vue({
  el: '.toolbar',
  data: {
    buttons: toolbarButtons
  }
})

async function main () {
  const graphUi = new GraphUi(document.querySelector('#rete'))
  graphUi.setOnChange(async graph => {
    await Api.uploadGraph(graph)
  })

  const nodeTypes = await Api.loadNodeTypes()
  // TODO: load graph on startup

  for (const node of nodeTypes) {
    toolbarButtons.push({
      title: `Create ${node.name}`,
      click () {
        graphUi.addNode(node.name)
      }
    })
  }

  graphUi.setAvailableNodeTypes(nodeTypes)
  graphUi.addNode('Output')
}

main()
  .then(null, e => console.error('Crash in main', e))
