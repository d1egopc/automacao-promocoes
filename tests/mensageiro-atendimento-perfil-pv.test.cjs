const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const criarRotasMensageiro = require('../modules/mensageiro/routes');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimus-pv-perfil-'));
process.env.DATA_DIR = dir;
const { writeGlobalJson } = require('../utils/storage');
const storage = require('../modules/mensageiro/storage');
const service = require('../modules/mensageiro/service');

writeGlobalJson('usuarios.json', ['alpha', 'beta', 'gamma', 'delta'].map(id => ({ id, ativo: true })));

function perfil(id, sessaoId) {
  return { id, nome: id, ativo: true, sessaoId, grupos: [], modulos: {} };
}
function atendimento(texto, categoria = 'atendimento') {
  return {
    ativo: categoria === 'atendimento', faqAtivo: categoria === 'faq', fluxosAtivo: categoria === 'fluxos',
    gatilhos: [{ id: 'mesmo-id', categoria, ativo: true, nome: 'teste', modo: 'qualquer',
      palavrasObrigatorias: ['teste'], respostas: [{ tipo: 'texto', conteudo: texto }] }]
  };
}
function sock() {
  const envios = [];
  return { envios, async sendMessage(jid, payload) { envios.push({ jid, payload }); return { key: { id: 'mock' } }; } };
}
let sequenciaEvento = 0;
async function mensagem(clienteId, sessaoId, jid, id = `evento_${++sequenciaEvento}`, socket = sock()) {
  await service.tratarMensagemPrivadaAtendimento({ clienteId, sessaoId, sock: socket, planoLiberado: true,
    mensagem: { key: { remoteJid: jid, id, fromMe: false }, message: { conversation: 'teste' } } });
  return socket.envios;
}

async function verificarRotas() {
  const app = express();
  app.use(express.json());
  app.use('/mensageiro', criarRotasMensageiro({
    getClienteId: req => req.headers['x-workspace'],
    usuarioTemRecurso: req => req.headers['x-autorizado'] === 'sim',
    getMensageiroCliente: storage.getMensageiroCliente,
    getAtendimentoConfigPerfilCliente: storage.getAtendimentoConfigPerfilCliente,
    setAtendimentoConfigPerfilCliente: storage.setAtendimentoConfigPerfilCliente,
    listarVinculosContatoPerfilCliente: storage.listarVinculosContatoPerfilCliente,
    salvarVinculoContatoPerfilCliente: storage.salvarVinculoContatoPerfilCliente,
    removerVinculoContatoPerfilCliente: storage.removerVinculoContatoPerfilCliente
  }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const req = (path, workspace = 'alpha', autorizado = 'sim', options = {}) => fetch(`${url}${path}`, {
    headers: { 'x-workspace': workspace, 'x-autorizado': autorizado, 'content-type': 'application/json' }, ...options
  });
  try {
    assert.equal((await req('/mensageiro/perfis/pescaria/atendimento', 'alpha', 'nao')).status, 403);
    assert.equal((await req('/mensageiro/perfis/pescaria/atendimento', 'beta')).status, 404);
    assert.equal((await req('/mensageiro/perfis/pescaria/atendimento')).status, 200);
    assert.equal((await req('/mensageiro/perfis/pescaria/atendimento', 'alpha', 'sim', {
      method: 'POST', body: JSON.stringify({ sessaoId: 'outra-sessao', ativo: true })
    })).status, 400);
    assert.equal((await req('/mensageiro/perfis/pescaria/contatos', 'beta')).status, 404);
    assert.equal((await req('/mensageiro/perfis/pescaria/contatos', 'alpha', 'sim', {
      method: 'POST', body: JSON.stringify({ contatoId: '5511888880000@s.whatsapp.net' })
    })).status, 200);
    assert.equal((await req('/mensageiro/perfis/pescaria/contatos')).status, 200);
    assert.equal((await req('/mensageiro/perfis/pescaria/contatos/5511888880000%40s.whatsapp.net', 'alpha', 'sim', {
      method: 'DELETE'
    })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  storage.setMensageiroCliente('alpha', { ativo: true, sessaoId: 'sessao-a',
    perfis: [perfil('pescaria', 'sessao-a'), perfil('roupas', 'sessao-a'), perfil('outra', 'sessao-b')] });
  storage.setMensageiroCliente('beta', { ativo: true, sessaoId: 'sessao-a', perfis: [perfil('beta', 'sessao-a')] });
  await verificarRotas();
  const vazio = storage.getAtendimentoConfigPerfilCliente('alpha', 'pescaria');
  assert.equal(vazio.configurado, false);
  assert.equal(vazio.gatilhos.length, 0);
  storage.setAtendimentoConfigPerfilCliente('alpha', 'pescaria', atendimento('PESCARIA'));
  storage.setAtendimentoConfigPerfilCliente('alpha', 'roupas', atendimento('ROUPAS', 'faq'));
  storage.setAtendimentoConfigPerfilCliente('alpha', 'outra', atendimento('OUTRA', 'fluxos'));
  storage.setAtendimentoConfigPerfilCliente('beta', 'beta', atendimento('BETA'));
  storage.setAtendimentoConfigCliente('alpha', atendimento('GLOBAL'));
  storage.setAtendimentoConfigPerfilCliente('alpha', 'roupas', {
    ...storage.getAtendimentoConfigPerfilCliente('alpha', 'roupas'),
    gatilhos: [{ id: 'mesmo-id', categoria: 'faq', ativo: true, nome: 'teste', modo: 'qualquer',
      palavrasObrigatorias: ['teste'], respostas: [
        { tipo: 'texto', conteudo: 'ROUPAS' },
        { tipo: 'imagemUrl', conteudo: 'https://exemplo.invalid/imagem-roupas.png' }
      ] }]
  });
  assert.equal(storage.getAtendimentoConfigPerfilCliente('alpha', 'roupas').gatilhos[0].respostas[1].tipo, 'imagemUrl',
    'imagem pertence ao perfil e sobrevive a recarga');
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990001@s.whatsapp.net')).length, 0,
    'dois perfis elegiveis sem vinculo nao respondem');
  const proprio = sock();
  await service.tratarMensagemPrivadaAtendimento({ clienteId: 'alpha', sessaoId: 'sessao-a', sock: proprio,
    planoLiberado: true, mensagem: { key: { remoteJid: '5511999990001@s.whatsapp.net', fromMe: true },
      message: { conversation: 'teste' } } });
  assert.equal(proprio.envios.length, 0, 'fromMe nao envia');
  storage.salvarVinculoContatoPerfilCliente('alpha', 'pescaria', '5511999990001@s.whatsapp.net');
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990001@s.whatsapp.net'))[0].payload.text, 'PESCARIA');
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990001@s.whatsapp.net')).length, 0,
    'cooldown do mesmo perfil');
  storage.salvarVinculoContatoPerfilCliente('alpha', 'roupas', '5511999990001@s.whatsapp.net');
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990001@s.whatsapp.net'))[0].payload.text, 'ROUPAS',
    'cooldown independente por perfil');
  assert.equal((await mensagem('alpha', 'sessao-b', '5511999990002@s.whatsapp.net'))[0].payload.text, 'OUTRA');
  assert.equal((await mensagem('beta', 'sessao-a', '5511999990003@s.whatsapp.net'))[0].payload.text, 'BETA');
  assert.equal(storage.getAtendimentoConfigPerfilCliente('alpha', 'pescaria').gatilhos[0].respostas[0].conteudo, 'PESCARIA');
  assert.equal(storage.getAtendimentoConfigPerfilCliente('alpha', 'roupas').gatilhos[0].respostas[1].conteudo,
    'https://exemplo.invalid/imagem-roupas.png');
  assert.throws(() => storage.getAtendimentoConfigPerfilCliente('beta', 'pescaria'), /Perfil nao pertence/);
  assert.equal(storage.listarVinculosContatoPerfilCliente('beta', 'sessao-a').length, 0);
  assert.equal(storage.removerVinculoContatoPerfilCliente('alpha', 'pescaria', '5511999990001@s.whatsapp.net'), false,
    'perfil antigo nao remove vinculo do novo perfil');
  assert.equal(storage.removerVinculoContatoPerfilCliente('alpha', 'roupas', '5511999990001@s.whatsapp.net'), true);
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990004@s.whatsapp.net')).length, 0);

  storage.setAtendimentoConfigPerfilCliente('alpha', 'roupas', { ativo: false, faqAtivo: false, fluxosAtivo: false,
    respostasRapidasAtivo: false, gatilhos: [] });
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990005@s.whatsapp.net'))[0].payload.text, 'PESCARIA',
    'uma unica configuracao PV elegivel mantem roteamento sem vinculo');
  storage.setAtendimentoConfigPerfilCliente('alpha', 'pescaria', { ativo: false, faqAtivo: false, fluxosAtivo: false,
    respostasRapidasAtivo: true, gatilhos: [], respostasRapidas: [{ id: 'atalho', ativo: true, nome: 'atalho',
      gatilhos: ['teste'], resposta: { tipo: 'texto', conteudo: 'RAPIDA' } }] });
  storage.setMensageiroCliente('alpha', { ativo: false });
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990006@s.whatsapp.net'))[0].payload.text, 'RAPIDA');
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990006@s.whatsapp.net')).length, 0,
    'resposta rapida nao duplica');
  storage.setAtendimentoConfigPerfilCliente('alpha', 'pescaria', { ativo: false, faqAtivo: false, fluxosAtivo: false,
    respostasRapidasAtivo: false, gatilhos: [], respostasRapidas: [] });
  assert.equal((await mensagem('alpha', 'sessao-a', '5511999990007@s.whatsapp.net')).length, 0,
    'perfil explicitamente desativado nao reativa legado global ativo');

  storage.setMensageiroCliente('alpha', { ativo: true, perfis: [perfil('legado', 'sessao-legado')] });
  storage.setAtendimentoConfigCliente('alpha', atendimento('LEGADO'));
  assert.equal((await mensagem('alpha', 'sessao-legado', '5511999990008@s.whatsapp.net'))[0].payload.text, 'LEGADO',
    'configuracao global antiga permanece funcional quando nao ha perfil PV configurado');

  storage.setMensageiroCliente('gamma', { ativo: true, sessaoId: 'sessao-g',
    perfis: [perfil('a', 'sessao-g'), perfil('b', 'sessao-g')] });
  storage.setAtendimentoConfigPerfilCliente('gamma', 'a', atendimento('A'));
  storage.setAtendimentoConfigPerfilCliente('gamma', 'b', atendimento('B'));
  const entradaGamma = async (contato, id = undefined) =>
    mensagem('gamma', 'sessao-g', contato, id);

  storage.salvarVinculoContatoPerfilCliente('gamma', 'a', '5511999991001@s.whatsapp.net');
  assert.equal((await entradaGamma('5511999991001@s.whatsapp.net'))[0].payload.text, 'A',
    'vinculo ativo prevalece com dois perfis elegiveis');
  storage.salvarVinculoContatoPerfilCliente('gamma', 'a', '5511999991002@s.whatsapp.net');
  storage.setAtendimentoConfigPerfilCliente('gamma', 'a', { ativo: false, gatilhos: [] });
  assert.equal((await entradaGamma('5511999991002@s.whatsapp.net')).length, 0,
    'vinculo ao perfil desativado nao desvia para o unico perfil B elegivel');
  assert.equal((await entradaGamma('5511999991003@s.whatsapp.net'))[0].payload.text, 'B',
    'contato comprovadamente sem vinculo usa o unico perfil elegivel');
  storage.setAtendimentoConfigPerfilCliente('gamma', 'a', atendimento('A'));
  assert.equal((await entradaGamma('5511999991004@s.whatsapp.net')).length, 0,
    'dois perfis elegiveis sem vinculo permanecem ambiguos');

  storage.salvarVinculoContatoPerfilCliente('gamma', 'a', '5511999991005@s.whatsapp.net');
  storage.setMensageiroCliente('gamma', { perfis: [perfil('b', 'sessao-g')] });
  assert.equal((await entradaGamma('5511999991005@s.whatsapp.net')).length, 0,
    'vinculo orfao por perfil removido falha fechado');
  storage.setMensageiroCliente('gamma', { perfis: [perfil('a', 'outra-sessao'), perfil('b', 'sessao-g')] });
  assert.equal((await entradaGamma('5511999991005@s.whatsapp.net')).length, 0,
    'vinculo a perfil de outra sessao falha fechado');
  storage.setMensageiroCliente('gamma', { perfis: [perfil('a', 'sessao-g'), perfil('b', 'sessao-g')] });
  storage.salvarVinculoContatoPerfilCliente('gamma', 'a', '5511999991006@s.whatsapp.net');
  assert.equal((await entradaGamma('5511999991006@s.whatsapp.net', 'vinculo-1'))[0].payload.text, 'A');
  storage.salvarVinculoContatoPerfilCliente('gamma', 'b', '5511999991006@s.whatsapp.net');
  assert.equal((await entradaGamma('5511999991006@s.whatsapp.net', 'vinculo-1')).length, 0,
    'replay do mesmo evento nao responde de novo apos troca manual de perfil');
  assert.equal((await entradaGamma('5511999991006@s.whatsapp.net', 'vinculo-2'))[0].payload.text, 'B',
    'alteracao manual explicita passa a usar B');

  storage.setMensageiroCliente('delta', { ativo: true, sessaoId: 'sessao-g',
    perfis: [perfil('rapido', 'sessao-g')] });
  storage.setAtendimentoConfigPerfilCliente('delta', 'rapido', {
    respostasRapidasAtivo: true, delaySegundos: 0, cooldownMinutos: 1,
    respostasRapidas: [{ id: 'r', ativo: true, gatilhos: ['teste'],
      resposta: { tipo: 'texto', conteudo: 'DELTA' } }]
  });
  let ativos = 0;
  let pico = 0;
  const socketConcorrente = { envios: [], async sendMessage(jid, payload) {
    ativos += 1;
    pico = Math.max(pico, ativos);
    this.envios.push({ jid, payload });
    await new Promise(resolve => setTimeout(resolve, 20));
    ativos -= 1;
    return { key: { id: 'mock' } };
  } };
  const chamada = (clienteId, contato, id, socket = socketConcorrente) =>
    service.tratarMensagemPrivadaAtendimento({ clienteId, sessaoId: 'sessao-g', sock: socket,
      planoLiberado: true, mensagem: { key: { remoteJid: contato, id, fromMe: false },
        message: { conversation: 'teste' } } });
  const contatoFalhaV1 = '5511999992000@s.whatsapp.net';
  storage.salvarVinculoContatoPerfilCliente('gamma', 'b', contatoFalhaV1);
  let tentativasV1 = 0;
  const socketFalhaV1 = { envios: [], async sendMessage(jid, payload) {
    tentativasV1 += 1;
    if (tentativasV1 === 1) throw new Error('falha_simulada_v1');
    this.envios.push({ jid, payload });
    return { key: { id: 'mock' } };
  } };
  await chamada('gamma', contatoFalhaV1, 'v1-falhou', socketFalhaV1);
  await chamada('gamma', contatoFalhaV1, 'v1-retry', socketFalhaV1);
  assert.equal(tentativasV1, 2, 'falha V1 sem envio confirmado nao segura cooldown');
  assert.equal(socketFalhaV1.envios.length, 1, 'retry V1 entrega uma unica vez');

  const mesmoContato = '5511999992001@s.whatsapp.net';
  await Promise.all([chamada('delta', mesmoContato, 'e1'), chamada('delta', mesmoContato, 'e2')]);
  assert.equal(socketConcorrente.envios.length, 1,
    'eventos concorrentes do mesmo atendimento geram somente uma resposta');
  await chamada('delta', mesmoContato, 'e1');
  assert.equal(socketConcorrente.envios.length, 1, 'evento duplicado respeita o cooldown');
  await Promise.all([
    chamada('delta', '5511999992002@s.whatsapp.net', 'e3'),
    chamada('delta', '5511999992003@s.whatsapp.net', 'e4')
  ]);
  assert.equal(socketConcorrente.envios.length, 3, 'contatos diferentes respondem independentemente');
  assert.equal(pico, 2, 'contatos independentes nao compartilham bloqueio global');

  storage.setAtendimentoConfigPerfilCliente('gamma', 'b', {
    respostasRapidasAtivo: true, delaySegundos: 0, gatilhos: [],
    respostasRapidas: [{ id: 'r', ativo: true, gatilhos: ['teste'],
      resposta: { tipo: 'texto', conteudo: 'GAMMA' } }]
  });
  storage.setAtendimentoConfigPerfilCliente('gamma', 'a', { ativo: false, gatilhos: [] });
  const socketWorkspaces = { envios: [], async sendMessage(jid, payload) {
    this.envios.push({ jid, payload });
    return { key: { id: 'mock' } };
  } };
  await Promise.all([
    chamada('gamma', '5511999992004@s.whatsapp.net', 'e5', socketWorkspaces),
    chamada('delta', '5511999992004@s.whatsapp.net', 'e6', socketWorkspaces)
  ]);
  assert.deepEqual(socketWorkspaces.envios.map(item => item.payload.text).sort(), ['DELTA', 'GAMMA'],
    'mesmo contato em workspaces diferentes nao compartilha cooldown');

  let tentativas = 0;
  const socketFalha = { envios: [], async sendMessage(jid, payload) {
    tentativas += 1;
    if (tentativas === 1) throw new Error('falha_simulada');
    this.envios.push({ jid, payload });
    return { key: { id: 'mock' } };
  } };
  await chamada('delta', '5511999992005@s.whatsapp.net', 'e7', socketFalha);
  await chamada('delta', '5511999992005@s.whatsapp.net', 'e8', socketFalha);
  assert.equal(tentativas, 2, 'falha simulada libera o bloqueio');
  assert.equal(socketFalha.envios.length, 1, 'retry apos falha efetiva realiza um unico envio');

  const originalDateNow = Date.now;
  let agora = originalDateNow();
  try {
    Date.now = () => agora;
    const socketRelogio = sock();
    await chamada('delta', '5511999992006@s.whatsapp.net', 'e9', socketRelogio);
    await chamada('delta', '5511999992006@s.whatsapp.net', 'e10', socketRelogio);
    assert.equal(socketRelogio.envios.length, 1, 'cooldown vigente bloqueia');
    agora += 60 * 1000 + 1;
    await chamada('delta', '5511999992006@s.whatsapp.net', 'e9', socketRelogio);
    assert.equal(socketRelogio.envios.length, 1, 'evento repetido nao reenvia apos expirar o cooldown');
    await chamada('delta', '5511999992006@s.whatsapp.net', 'e11', socketRelogio);
    assert.equal(socketRelogio.envios.length, 2, 'expiracao do cooldown permite novo envio');
  } finally {
    Date.now = originalDateNow;
  }
  const semConsulta = sock();
  fs.writeFileSync(path.join(dir, 'clientes', 'gamma', 'mensageiro-config.json'), '{invalido');
  await chamada('gamma', '5511999992007@s.whatsapp.net', 'consulta-falhou', semConsulta);
  assert.equal(semConsulta.envios.length, 0,
    'falha na consulta dos vinculos nao equivale a contato sem vinculo');
  console.log('mensageiro atendimento por perfil: PASS');
})().finally(() => fs.rmSync(dir, { recursive: true, force: true }));
