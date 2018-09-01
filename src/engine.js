const byline = require('byline');
const childProcess = require('child_process');
const execFile = childProcess.execFile;
const spawn = childProcess.spawn;
const denodeify = require('denodeify');
const fs = require('fs');
const tmp = require('tmp');
const promisify = require('util').promisify;

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

  async waitForExit () {
    await onExit(this._process);
  }
}

async function buildAndStartEngine (model) {
  const template = await denodeify(fs.readFile)('templates/main.c', 'utf8');
  const source = generateEngineSource(template, model);

  const tmpSourceFile = await denodeify(tmp.file)({
    discardDescriptor: true,
    prefix: 'codegen-synth-',
    postfix: '.c',
  })
  const tmpBinaryFile = await denodeify(tmp.file)({
    discardDescriptor: true,
    prefix: 'codegen-synth-',
    postfix: '',
  })

  await denodeify(fs.writeFile)(tmpSourceFile, source, 'utf8')

  try {
    await promisify(execFile)('gcc', [
      '-std=c11',
      '-Wall', '-Werror',
      '-O3',
      '-o', tmpBinaryFile,
      tmpSourceFile,
      '-lm', '-ljack', '-lpthread',
    ]);

    const engineProcess = spawn(tmpBinaryFile, [], {
      stdio: ['pipe', 'pipe', 'inherit']
    });
    return new Engine(model, engineProcess);
  } catch (e) {
    if (e.stderr) throw new Error('Failed to compile source: ' + e.stderr.trim());
    else throw e;
  }
}

function generateEngineSource (template, model) {
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

  const formatNodeId = id => 'n' + id;
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
      id: formatNodeId(node._id)
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
      process: node._info.process && formatInline(node._info.process, vars)
    }
  };

  const nodesSections = model.nodes.map(formatNodeSections);
  const joinSections = sections => sections.filter(ss => ss).join('\n')
  const sections = {
    storage: joinSections(nodesSections.map(ss => ss.storage)),
    init: joinSections(nodesSections.map(ss => ss.init)),
    process: joinSections(nodesSections.map(ss => ss.process)),
  }

  const storagePrologue = `int VAR_COUNT = ${model._varCount};\nfloat vars[${model._varCount}];`;
  const processEpilogue = formatKeyInline('return %%out%%;', 'out', formatPortSum(model.out));
  sections.storage = storagePrologue + '\n' + sections.storage;
  sections.process += '\n' + processEpilogue;

  console.log(`storage:\n${sections.storage}\n`.replace(/\n/g, '\n  '));
  console.log(`init:\n${sections.init}\n`.replace(/\n/g, '\n  '));
  console.log(`process:\n${sections.process}\n`.replace(/\n/g, '\n  '));

  return formatBlocks(template, sections);
}

function onExit(childProcess) {
  return new Promise((resolve, reject) => {
    childProcess.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error('Exit with error code: '+code));
      }
    });
    childProcess.once('error', (err) => {
      reject(err);
    });
  });
}

module.exports = {
  buildAndStartEngine
};