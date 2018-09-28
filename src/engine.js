const { List } = require('immutable')
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
    this._queue = List()

    console.log(model.nodes.toArray())
    // TODO: instantiate graph
    this._nodes = List()
    this._midiNoteNodes = List()
    this._midiCcNodes = List()

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

  _forwardToQueue (msg) {
    switch (msg.msg) {
      case 'start':
        console.log('START')
        this._nodes.forEach(n => {
          this._enqueue({ job: 'init', node: n })
        })
        break

      case 'midi':
        if (msg.type === 'note-down' || msg.type === 'note-up') {
          this._midiNoteNodes.forEach(n => {
            this._enqueue({ job: 'midi-receive', node: n, msg })
          })
        } else if (msg.type === 'cc') {
          this._midiCcNodes.forEach(n => {
            this._enqueue({ job: 'midi-receive', node: n, msg })
          })
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
    console.log(this._queue)
    // TODO: job queue (plain JSON jobs, eg Input MIDI, pass value/msg)
    // TODO: each job is async and can return multiple new jobs
  }

  _pushOutputs () {}
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
