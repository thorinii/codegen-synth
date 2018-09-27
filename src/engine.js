const byline = require('byline')
const { spawn } = require('child_process')

const { compile } = require('./model_compiler')

class Engine {
  constructor (model, process) {
    this._model = model
    this._process = process

    byline.createStream(process.stdout).on('data', line => {
      const message = JSON.parse(line)
      this.handle(message)
    })
    byline.createStream(process.stderr).on('data', line => {
      console.warn('WARN: ' + line)
    })

    model._eventSend = msg => {
      process.stdin.write(msg + '\n')
    }
  }

  handle (msg) {
    // console.log('Engine:', msg);

    let type = msg.msg
    if (type === 'midi') type += '.' + msg.type

    this._model._fire(type, msg)
  }

  stop () {
    this._process.kill()
  }

  async waitForExit () {
    await onExit(this._process)
  }
}

async function buildAndStartEngine (model) {
  const compiled = await compile(model)
  return startEngine(compiled)
}

function startEngine (compiled) {
  const engineProcess = spawn(compiled.binary, [], {
    stdio: ['pipe', 'pipe', 'inherit']
  })
  return new Engine(compiled.model, engineProcess)
}

function onExit (childProcess) {
  return new Promise((resolve, reject) => {
    childProcess.once('exit', (code, signal) => {
      if (code === 0 || code === null) {
        resolve(undefined)
      } else {
        reject(new Error('Exit with error code: ' + code))
      }
    })
    childProcess.once('error', (err) => {
      reject(err)
    })
  })
}

module.exports = {
  buildAndStartEngine,
  startEngine
}
