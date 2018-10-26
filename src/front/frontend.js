import Ace from 'ace'
import Vue from 'vue'
// import Edn from 'jsedn'

import * as Api from './api'
// import * as Graph from '../graph'

const viewState = {
  files: [],
  nodeTypes: [],

  selectedFile: null,

  createSubGraph: () => {
    console.log('Creating subgraph')
  }
}
new Vue({
  el: '.sidebar',
  data: viewState
})

const editor = Ace.edit('code-editor', {
  mode: 'ace/mode/clojure',
  selectionStyle: 'text'
})
editor.session.setTabSize(2)
document.getElementById('code-editor').style.fontSize = '16px'
editor.session.setUseSoftTabs(true)
editor.session.on('change', delta => {
  const viewModel = viewState.files.find(f => f.name === viewState.selectedFile)
  if (!viewState.selectedFile || !viewModel) return

  const content = editor.session.getValue()
  viewModel.saving = true

  Api.uploadFile(viewState.selectedFile, content)
    .then(() => {
      viewModel.content = content.replace(/ +$/mg, '\n').replace(/\n*$/, '\n')
      viewModel.saving = false
    })
    .then(null, e => {
      console.error('Failed to upload file')
    })
})

function delay (ms) {
  return new Promise((resolve, reject) => setTimeout(() => resolve(), ms))
}

let graphRenderEl = null
async function refreshGraphRender () {
  if (graphRenderEl === null) {
    graphRenderEl = document.querySelector('#graph-render')
  }

  graphRenderEl.src = '/api/compiler/render/parsed?t=' + new Date().getTime()

  await delay(500)
  return refreshGraphRender()
}

async function main () {
  const editorStorage = await Api.loadEditorStorage()

  for (const file in editorStorage.files) {
    const content = editorStorage.files[file].replace(/ +$/mg, '\n').replace(/\n*$/, '\n')

    viewState.files.push({
      name: file,
      content,
      saving: false,
      switchTo () {
        viewState.selectedFile = Object.keys(editorStorage.files)[0] || null
        editor.setValue(this.content)
      }
    })
  }

  // for (const node of env.nodes) {
  //   viewState.nodeTypes.push({
  //     name: node.name,
  //     create () {
  //       render()
  //     }
  //   })
  // }

  if (viewState.files.length > 0) {
    viewState.files[0].switchTo()
  }

  refreshGraphRender()
}

main()
  .then(null, e => console.error('Crash in main', e))
