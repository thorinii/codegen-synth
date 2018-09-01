const { Model } = require('./src/model');
const { Constant, SineWave } = require('./src/nodes');
const { buildAndStartEngine } = require('./src/engine');

async function main () {
  const model = new Model();
  const variable = model.addVariable('period', 18.0);
  const sineWave = model.addNode(SineWave);
  model.connect(variable.out, sineWave.period);
  model.connect(sineWave.out, model.out);

  model.onNote((note, velocity) => {
    console.log(note);
    variable.set(20);
  });

  const engine = await buildAndStartEngine(model);
  await engine.waitForExit();
}

main().then(null, e => console.error('Crashed', e));