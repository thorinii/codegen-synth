const byline = require('byline');
const { execFile, spawn } = require('child_process');
const denodeify = require('denodeify');
const fs = require('fs');
const tmp = require('tmp');
const { promisify } = require('util');

class Engine {
  constructor (model, process) {
    this._model = model;
    this._process = process;

    byline.createStream(process.stdout).on('data', line => {
      const message = JSON.parse(line);
      this.handle(message);
    });
    byline.createStream(process.stderr).on('data', line => {
      console.warn('WARN: ' + line);
    });

    model._eventSend = msg => {
      process.stdin.write(msg + '\n');
    }
  }

  handle (msg) {
    // console.log('Engine:', msg);

    let type = msg.msg;
    if (type === 'midi') type += '.' + msg.type;

    this._model._fire(type, msg);
  }

  stop () {
    this._process.kill();
  }

  async waitForExit () {
    await onExit(this._process);
  }
}

async function buildAndStartEngine (model) {
  const compiled = await compile(model);
  return startEngine(compiled);
}

async function compile (model) {
  console.log('Generating code...');
  model.trimUnusedNodes();
  const schedule = scheduleNodes(model);
  const template = await denodeify(fs.readFile)('templates/main.c', 'utf8');
  const source = generateEngineSource(template, model, schedule);

  const tmpSourceFile = await denodeify(tmp.file)({
    discardDescriptor: true,
    prefix: 'codegen-synth-',
    postfix: '.c',
  })
  const tmpBinaryFile = tmpSourceFile.replace(/.c$/, '');

  await denodeify(fs.writeFile)(tmpSourceFile, source, 'utf8')

  try {
    console.log('Compiling code...');
    await promisify(execFile)('gcc', [
      '-std=c11',
      '-Wall', '-Werror',
      '-O3',
      '-o', tmpBinaryFile,
      tmpSourceFile,
      '-lm', '-ljack', '-lpthread',
    ]);

    return {
      model,
      binary: tmpBinaryFile
    };
  } catch (e) {
    if (e.stderr) throw new Error('Failed to compile source: ' + e.stderr.trim());
    else throw e;
  }
}

function startEngine (compiled) {
  const engineProcess = spawn(compiled.binary, [], {
    stdio: ['pipe', 'pipe', 'inherit']
  });
  return new Engine(compiled.model, engineProcess);
}

function generateEngineSource (template, model, schedule) {
  const formatKeyInline = (template, key, value) => {
    const regex = new RegExp(`%%${key}%%`, 'g');
    return template.replace(regex, value);
  };
  const formatKeyBlock = (template, key, value) => {
    const regex = new RegExp(`^.*%%${key.toUpperCase()}%%.*$`, 'gm');
    return template.replace(regex, `/* BEGIN ${key} */\n${value}\n/* END ${key} */`);
  }
  const formatInline = (template, values) => {
    let formatted = template;
    for (const key in values) {
      formatted = formatKeyInline(formatted, key, values[key]);
    }
    return formatted;
  };
  const formatBlocks = (template, values) => {
    let formatted = template;
    for (const key in values) {
      formatted = formatKeyBlock(formatted, key, values[key]);
    }
    return formatted;
  };

  const formatNodeId = node => {
    if (node._id !== undefined) node = node._id;
    return 'n' + node;
  }
  const formatPortVar = id => 'p' + id;
  const formatPortSum = ports => {
    if (ports.length === 0) {
      return '0';
    } else if (ports.length === 1) {
      return formatPortVar(ports[0]);
    } else {
      return '(' + ports.map(formatPortVar).join(' + ') + ')';
    }
  };

  const formatNodeSections = node => {
    const vars = {
      id: formatNodeId(node)
    }
    node._info.params.forEach(key => {
      vars[key] = node._params[key];
    });
    node._inputs.forEach((value, key) => {
      vars[key] = formatPortSum(value);
    });
    node._outputs.forEach((value, key) => {
      vars[key] = formatPortVar(value);
    });
    return {
      storage: node._info.storage && formatInline(node._info.storage, vars),
      init: node._info.init && formatInline(node._info.init, vars),
      process: node._info.process && formatInline(node._info.process, vars),
      processEpilogue: node._info.processEpilogue && formatInline(node._info.processEpilogue, vars),
    }
  };

  const nodesSections = schedule.map(formatNodeSections);
  const joinSections = sections => sections.filter(ss => ss).join('\n')
  const sections = {
    storage: joinSections(nodesSections.map(ss => ss.storage)),
    init: joinSections(nodesSections.map(ss => ss.init)),
    process: joinSections(nodesSections.map(ss => ss.process)),
    processEpilogue: joinSections(nodesSections.map(ss => ss.processEpilogue)),
  }

  const storagePrologue = `int VAR_COUNT = ${model._varCount};\ndouble vars[${model._varCount}];`;
  const processEpilogue = formatKeyInline('return %%out%%;', 'out', formatPortSum(model.out));
  sections.storage = storagePrologue + '\n' + sections.storage;
  sections.process += '\n' + sections.processEpilogue;
  sections.process += '\n' + processEpilogue;

  // console.log(`storage:\n${sections.storage}\n`.replace(/\n/g, '\n  '));
  // console.log(`init:\n${sections.init}\n`.replace(/\n/g, '\n  '));
  // console.log(`process:\n${sections.process}\n`.replace(/\n/g, '\n  '));

  return formatBlocks(template, sections);
}

function scheduleNodes (model) {
  const scheduleTmp = [];
  function nodesFrom (id) {
    const thisNode = model.nodes.find(n => n._id === id);

    const nodes = new Set();
    Array.from(thisNode._outputs.values()).forEach(out => {
      model.nodes.forEach(n => {
        Array.from(n._inputs.values()).forEach(input => {
          if (input.includes(out)) nodes.add(n);
        })
      })
    });
    return Array.from(nodes);
  }
  function recursivePush (id) {
    scheduleTmp.push(id);
    const thisNode = model.nodes.find(n => n._id === id);

    nodesFrom(id).forEach(n => {
      if (n._info.isDirect) {
        recursivePush(n._id);
      }
    });
  }
  model.nodes.forEach(n => recursivePush(n._id));

  const seenNodes = new Set();
  const schedule = [];
  scheduleTmp.reverse();
  scheduleTmp.forEach(s => {
    if (!seenNodes.has(s)) {
      seenNodes.add(s);
      schedule.push(s);
    }
  })
  schedule.reverse();

  return schedule.map(s => model.nodes.find(n => n._id === s));
}

function onExit(childProcess) {
  return new Promise((resolve, reject) => {
    childProcess.once('exit', (code, signal) => {
      if (code === 0 || code === null) {
        resolve(undefined);
      } else {
        reject(new Error('Exit with error code: ' + code));
      }
    });
    childProcess.once('error', (err) => {
      reject(err);
    });
  });
}

module.exports = {
  buildAndStartEngine,
  compile,
  startEngine
};