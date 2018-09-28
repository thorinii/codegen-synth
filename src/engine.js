const { List, Map } = require('immutable')
const byline = require('byline')
const { spawn } = require('child_process')
const ch = require('medium')

const go = afn => {
  afn().then(null, e => {
    console.error('Async task crashed:', e)
  })
}

class Controller {
  constructor (model, cmdCh, msgCh) {
    this._cmdCh = cmdCh

    this._realtimeGoing = false
    this._queue = List()
    this._nodes = List()
    this._nodesById = Map()

    model.nodes.forEach(definition => {
      const node = {
        msgTypes: definition.type.msgTypes,
        definition,
        data: definition.type.construct(definition.params)
      }

      this._nodes = this._nodes.push(node)
      this._nodesById = this._nodesById.set(definition.id, node)
    })

    go(async () => {
      while (true) {
        const msg = await ch.take(msgCh)
        if (msg === ch.CLOSED) break

        this._forwardToQueue(msg)
        await this._processQueue()
        this._pushOutputs()
      }
    })
  }

  _enqueueForAble (msg) {
    this._nodes
      .filter(n => n.msgTypes.has(msg.type))
      .forEach(n => this._enqueue({ node: n, ...msg }))
  }

  _enqueue (job) {
    if (job.node && !job.node.msgTypes.has(job.type)) {
      throw new Error(`Node ${job.node.definition.id} cannot handle message "${job.type}"`)
    }

    this._queue = this._queue.push(job)
  }

  _forwardToQueue (msg) {
    switch (msg.msg) {
      case 'start':
        this._realtimeGoing = false
        this._enqueueForAble({ type: 'init' })
        break

      case 'midi':
        if (msg.type === 'note-down' || msg.type === 'note-up') {
          this._enqueueForAble({ ...msg, type: 'midi-note' })
        } else if (msg.type === 'cc') {
          this._enqueueForAble({ ...msg, type: 'midi-cc' })
        } else {
          console.warn('Unknown realtime MIDI message:', msg)
        }
        break

      default:
        console.warn('Unknown realtime message:', msg)
        break
    }
  }

  async _processQueue () {
    // TODO: handle infinite loops

    while (!this._queue.isEmpty()) {
      const job = this._queue.first()
      this._queue = this._queue.shift()

      const data = job.node.data
      const pushOutFn = (port, msg) => {
        job.node.definition.outputs.get(port, List()).forEach(edge => {
          const destinationNode = this._nodesById.get(edge.node)
          this._enqueue({ ...msg, node: destinationNode, target: edge.target })
        })
      }
      await job.node.definition.type.handle(data, job, pushOutFn)
    }
  }

  _pushOutputs () {
    this._nodes
      .filter(n => !!n.definition.type.getBridgeVar)
      .forEach(node => {
        const [varId, value] = node.definition.type.getBridgeVar(node.data)
        ch.put(this._cmdCh, `set ${varId} ${value}`)
      })

    if (!this._realtimeGoing) {
      ch.put(this._cmdCh, 'start')
      this._realtimeGoing = true
    }
  }
}

class RealtimeProcess {
  constructor (process, cmdCh, msgCh) {
    this._process = process
    this._msgCh = msgCh

    byline.createStream(process.stdout).on('data', line => {
      const message = JSON.parse(line)
      this._handle(message)
    })
    byline.createStream(process.stderr).on('data', line => {
      console.warn('WARN: ' + line)
    })

    go(async () => {
      while (true) {
        const msg = await ch.take(cmdCh)
        if (msg === ch.CLOSED) break

        process.stdin.write(msg + '\n')
      }
    })

    onExit(process).then(() => ch.close(this._msgCh), null)
  }

  _handle (msg) {
    ch.put(this._msgCh, msg)
  }

  stop () {
    this._process.kill()
  }

  async waitForExit () {
    await onExit(this._process)
  }
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

function startEngine (compiled) {
  const cmdCh = ch.chan()
  const msgCh = ch.chan()

  const controller = new Controller(compiled.controller, cmdCh, msgCh)

  const realtimeProcess = spawn(compiled.realtime.binary, [], {
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const realtime = new RealtimeProcess(realtimeProcess, cmdCh, msgCh)

  return {
    controller,
    realtime,

    stop: () => realtime.stop(),
    waitForExit: () => realtime.waitForExit()
  }
}

module.exports = {
  startEngine
}
