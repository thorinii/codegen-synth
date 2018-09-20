export function uploadGraph (graph) {
  return httpPost('/api/graph', graph)
}

export function loadNodeTypes () {
  return httpGet('/api/nodes')
}

async function httpGet (url) {
  const response = await window.fetch(url)

  if (response.ok) {
    return response.json()
  } else {
    throw new Error('Failed to request: ' + response.statusText)
  }
}

async function httpPost (url, json) {
  const response = await window.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(json)
  })

  if (response.ok) {
    return response.json()
  } else {
    throw new Error('Failed to request: ' + response.statusText)
  }
}
