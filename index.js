const { Model } = require('./src/model');
const { Constant, SineWave, Mul, DelayLine } = require('./src/nodes');
const { buildAndStartEngine } = require('./src/engine');

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

main().then(null, e => console.error('Crashed', e));