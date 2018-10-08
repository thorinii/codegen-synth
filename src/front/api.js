export function uploadFile (name, content) {
  return httpPost(`/api/editor_storage/${name}`, { content })
}

export function loadEditorStorage () {
  return httpGet('/api/editor_storage')
}

async function httpGet (url) {
  const response = await window.fetch(url)

  if (response.ok) {
    return response.json()
  } else {
    throw new Error('Failed to request: ' + response.statusText)
  }
}

async function httpPost (url, json, options = {}) {
  const response = await window.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': options.type === 'text' ? 'text/plain' : 'application/json'
    },
    body: JSON.stringify(json)
  })

  if (response.ok) {
    return response.json()
  } else {
    throw new Error('Failed to request: ' + response.statusText)
  }
}
