const express = require('express');
const path = require('path');

const Nodes = require('./src/toplevel/nodes');

const { Model } = require('./src/model');
const { Constant, SineWave, Mul, DelayLine } = require('./src/nodes');
const { compile, startEngine, buildAndStartEngine } = require('./src/engine');

class Api {
  constructor () {
    this._onUpdate = () => {};

    const app = express();
    this.app = app;

    app.set('view engine', 'pug');
    app.set('views', path.join(__dirname, 'src'));

    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.get('/', (req, res) => res.render('page'));

    app.get('/api/nodes', (req, res) => {
      res.json(Nodes.list);
    });

    app.post('/api/graph', (req, res) => {
      if (!Array.isArray(req.body)) {
        res.status(500).json({ message: 'Invalid payload: not a graph' });
      } else {
        this._onUpdate(req.body);
        res.json({});
      }
    });

    app.use(express.static(path.join(__dirname, 'src')));
  }

  start () {
    const port = 3000;
    this.app.listen(port, () => console.log(`Running on port ${port}!`));
  }

  setOnUpdate (fn) {
    this._onUpdate = fn;
  }
}

class Backend {
  constructor () {
    this._engine = null;
  }

  async push (graph) {
    console.log('Updating graph');

    let compiled;
    try {
      compiled = await this.compile(graph);
    } catch (e) {
      console.warn('Failed to compile', e);
      return;
    }

    await this.swapEngine(compiled);
  }

  async compile (graph) {
    const model = lowerGraph(graph);
    return await compile(model);
  }

  async swapEngine (compiled) {
    if (this._engine) {
      this._engine.stop();
      await this._engine.waitForExit();
    }

    this._engine = startEngine(compiled);
  }
}

const backend = new Backend();
const api = new Api();
api.setOnUpdate(graph => {
  backend.push(graph)
    .then(null, e => console.error('Crash in backend', e));
});
api.start();


function lowerGraph (graph) {
  const model = new Model();
  const nodes = new Map();

  let outputNode;

  graph.forEach(node => {
    if (node.type === 'Output') {
      outputNode = node;
      return;
    }

    nodes.set(node.id, createModelNode(model, node));
  });

  if (!outputNode) throw new Error('Graph does not have an output');
  graph.forEach(n => connectBackward(model, n));

  return model;

  function createModelNode (model, node) {
    const type = Nodes.lookup(node.type);
    const nodeConfig = {
      inputs: new Map(node.inputs.map(i => [i.name, i.value])),
      params: new Map(node.params.map(p => [p.name, p.value]))
    };
    const definition = type.makeDefinition(nodeConfig);
    return model.addNode(definition, {});
  }

  function connectBackward (model, highNode) {
    highNode.inputs.forEach(input => {
      if (input.from === null) return;

      let toPort;
      if (highNode.type === 'Output') {
        toPort = model.out;
      } else {
        const lowNode = nodes.get(highNode.id);
        toPort = lowNode[input.name.toLowerCase()];
      }

      const fromNode = nodes.get(input.from[0]);
      if (!fromNode) throw new Error('Invalid input node: ' + JSON.stringify(input));
      const fromPort = fromNode[input.from[1]];
      if (!(fromPort >= 0)) throw new Error('Invalid input node port: ' + JSON.stringify(input));

      model.connect(fromPort, toPort);
    });
  }
}

async function main () {
  const model = new Model();
  const oversampling = 4;

  const noteVariables = {};
  for (let x = 24; x <= 24 + 60; x++) {
    const notePeriod = (14400 * oversampling) / (Math.pow(2, (x - 69) / 12) * 440) * 4;
    const delayPeriod = Math.max(1, notePeriod / 6) | 0;

    const noteVariable = model.addVariable('note' + x, 0);
    noteVariables[x] = noteVariable;

    let supply = notePeriod;
    const d = () => {
      supply -= delayPeriod;
      return delayPeriod;
    }

    const aLeft = model.addNode(DelayLine, { delay: d() });
    const aRight = model.addNode(DelayLine, { delay:d() });
    const bLeft = model.addNode(DelayLine, { delay: d() });
    const bRight = model.addNode(DelayLine, { delay: d() });
    const cLeft = model.addNode(DelayLine, { delay: d() });
    console.log(notePeriod, delayPeriod, supply);
    const cRight = model.addNode(DelayLine, { delay: supply | 0 });

    model.connect(cLeft, bLeft);
    model.connect(bLeft, aLeft);
    model.connect(aRight, bRight);
    model.connect(bRight, cRight);

    const aMul = model.addNode(Mul);
    model.connect(model.addConstant(-0.99), aMul.in1);
    model.connect(aLeft, aMul.in2);
    model.connect(aMul, aRight);

    const cMul = model.addNode(Mul);
    model.connect(model.addConstant(-0.99), cMul.in1);
    model.connect(cRight, cMul.in2);
    model.connect(cMul, cLeft);

    model.connect(noteVariable, bLeft);
    model.connect(noteVariable, cRight);

    model.connect(bLeft, model.out);
    model.connect(aRight, model.out);
  }

  // const sineWave = model.addNode(SineWave);
  // model.connect(variable.out, sineWave.period);
  // model.connect(sineWave.out, model.out);

  // const animator = (lengthInSeconds, fn) => {
  //   const ticksInLength = lengthInSeconds / 0.0001;
  //   let alpha = 0;
  //   let counter = 0;
  //   const tick = () => {
  //     fn(alpha);
  //     counter++;
  //     alpha = counter / ticksInLength;
  //     if (counter >= ticksInLength) return;
  //     animation = setTimeout(tick, 0.0001);
  //   }
  //   tick();
  // };

  // animator(1, alpha => console.log(alpha));

  // const samplingRate = 14400;
  // const m21 = 27.5;
  model.onNote((note, velocity) => {
    // const noteHz = Math.pow(2, (note - 69) / 12) * 440;
    // variable.set(samplingRate / noteHz);
    const variable = noteVariables[note];
    if (!variable) return;

    console.log(note, velocity);

    let value = 0.16 * (velocity / 128);
    const halvingFn = () => {
      variable.set(value);
      value = value * 0.9;

      if (value > 0.0001) {
        setTimeout(halvingFn, 0.001);
      }
    };
    halvingFn();
  });

  const engine = await buildAndStartEngine(model);
  await engine.waitForExit();
}

// main().then(null, e => console.error('Crashed', e));