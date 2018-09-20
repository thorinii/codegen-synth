const mkNodeDefinition = require('./model').mkNodeDefinition

const SineWave = mkNodeDefinition({
  in: ['period'],
  out: ['out'],
  storage: 'int %%id%%_tick;',
  init: '%%id%%_tick = 0;',
  process: '%%id%%_tick++;\ndouble %%out%% = sin(%%id%%_tick / %%period%%) * 0.04f;'
})

const Mul = mkNodeDefinition({
  in: ['in1', 'in2'],
  out: ['out'],
  process: 'double %%out%% = %%in1%% * %%in2%%;'
})

const DelayLine = mkNodeDefinition({
  in: ['in'],
  out: ['out'],
  params: ['delay'],
  storage: 'static int %%id%%_tick;\nstatic double %%id%%_buffer[%%delay%%];',
  init: '%%id%%_tick = 0;',
  process: 'double %%out%% = %%id%%_buffer[%%id%%_tick];',
  processEpilogue: '%%id%%_buffer[%%id%%_tick] = %%in%%;\n%%id%%_tick = (%%id%%_tick + 1) % %%delay%%;',
  isDirect: false
})

module.exports = {
  Mul,
  SineWave,
  DelayLine
}
