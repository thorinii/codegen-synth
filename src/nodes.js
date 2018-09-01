const mkNodeDefinition = require('./model').mkNodeDefinition;

const Constant = mkNodeDefinition({
  out: ['out'],
  params: ['value'],
  process: 'float %%out%% = %%value%%;',
})

const SineWave = mkNodeDefinition({
  in: ['period'],
  out: ['out'],
  storage: 'int %%id%%_tick;',
  init: '%%id%%_tick = 0;',
  process: '%%id%%_tick++;\nfloat %%out%% = sin(%%id%%_tick / %%period%%) * 0.02f;',
});

module.exports = {
  Constant, SineWave
};