# Validacao local — Fase 1D

Resultado: NAO_PRONTO_PARA_GATE_FASE_1D.

A implementacao local e os testes especificos estao concluidos. O veredito
conservador decorre da validacao ampliada ainda incompleta; nao se declara
verde uma regressao que falhou ou nao executou por dependencia ausente.
Nao houve commit, push, deploy, restart, contato com producao ou migracao.
A preparacao local de confirmado_em foi explicitamente autorizada pelo usuario.

## Mudancas (17 arquivos)

| Arquivo | Mudanca |
|---|---|
| modules/engine/ofc/optional-relation-source.js | Cache read-only, estados explicitos, TTL de disponibilidade e retry de erro, probe compartilhado |
| modules/engine/ofc/live-flow.repository.js | Consulta Reset condicionada a disponibilidade; erros preservam DESCONHECIDO; sem DDL |
| modules/engine/ofc/live-flow.service.js | Null, estado, motivo e horarios do diagnostico Reset preservados |
| modules/telemetria/ciclo-observabilidade.js | Medidor monotonico, leitura/parse/serializacao existente, lag e encerramento de timers |
| modules/engine/ofc/controller.runner.js | Tempos por etapa e publicacao paralela de drenagem; ambos logs antigos mantidos |
| modules/engine/orchestrator.runner.js | Total/etapas Engine e identificacao de ciclo pulado; Auto Gate segue nao aguardado |
| modules/engine/ofc/absorption-gate.service.js | Mede leitura/parse e agrega finalizacoes na passagem existente, sem reler filas |
| modules/engine/ofc/drainage-metrics.repository.js | Consulta read-only das confirmacoes duraveis, detalhe limitado a 100 destinos |
| modules/engine/ofc/drainage-metrics.service.js | Unidades, janela, fonte, qualidade e idade das tres observacoes independentes |
| modules/fila/fila-checkpoints-entrega.repository.js | confirmado_em no mesmo UPDATE/CAS de enviado; debito nao o modifica; leituras preservam campo |
| modules/fila/observabilidade-confirmacao.sql | Proposta de coluna/indice; nao executada nem ligada ao bootstrap |
| modules/auto-gate/auto-gate-metrics.service.js | Transporta observacao paralela sem alterar sinais decisorios |
| modules/auto-gate/auto-gate-shadow.service.js | Mede ciclo/coleta/maquina e serializacao; politica e autoridade intactas |
| modules/auto-gate/auto-gate-telemetry.js | Publica drenagem em paralelo e mede serializacao ja existente |
| tests/ofc-fase-1d-observabilidade.test.js | 21 testes locais, incluindo A-I, falha de persistencia, fonte desconhecida, ciclos e comparacao decisoria |
| modules/engine/ofc/FASE-1D.md | Contratos, qualidade, limites e pre-requisito de migracao |
| modules/engine/ofc/FASE-1D-VALIDACAO.md | Este relatorio de evidencias |

## Testes novos

Comando executado:

```powershell
node tests/ofc-fase-1d-observabilidade.test.js
```

21 aprovados, 0 falhas, 0 ignorados. Inclui todos os cenarios A-I.
Os relogios/horarios novos sao relativos ao momento do teste; nenhuma data
absoluta antiga e usada para fingir entrega recente ou revalidacao de TTL.

A tentativa inicial com `node --test` foi impedida por spawn EPERM do sandbox.
O mesmo arquivo foi executado diretamente com Node, com TAP e todos os casos.
Um erro inicial de fixture (repository incompleto) foi corrigido no teste;
o resultado acima e o da execucao final, nao uma contagem de tentativas.

## Regressoes proximas — resultado final por arquivo

Foram executados os comandos abaixo. 28 arquivos aprovados, 6 sem aprovacao.
Nao agregar o numero de arquivos antigos ao numero de casos dos testes novos.

| Comando | Resultado final |
|---|---|
| `node tests/auto-gate-shadow.test.js` | APROVADO |
| `node tests/ofc-absorption-gate-shadow.test.js` | APROVADO |
| `node tests/ofc-live-flow-shadow.test.js` | APROVADO |
| `node tests/ofc-commercial-flow-shadow.test.js` | APROVADO |
| `node tests/ofc-buffer-vivo-workspace-shadow.test.js` | APROVADO |
| `node tests/ofc-shadow-planner.test.js` | NAO APROVADO |
| `node tests/ofc-active-queue-shadow.test.js` | APROVADO |
| `node tests/ofc-operacional-v2-shadow.test.js` | APROVADO |
| `node tests/fila-checkpoints-entrega.repository.test.js` | APROVADO |
| `node tests/fila-checkpoint-entrega-funcional.test.js` | APROVADO |
| `node tests/fila-checkpoint-entrega-integracao.test.js` | APROVADO |
| `node tests/fila-checkpoint-recovery.test.js` | APROVADO |
| `node tests/cadencia-v2-autoridade.test.js` | APROVADO |
| `node tests/fila-fanout-destinos-estado.test.js` | APROVADO |
| `node tests/engine-fanout-universal-v2.test.js` | APROVADO — NODE_PATH bundled |
| `node tests/fila-unica-distributor-executor.test.js` | NAO APROVADO |
| `node tests/anti-repeticao-executor.test.js` | APROVADO |
| `node tests/imagem-link-contrato-universal.test.js` | APROVADO — NODE_PATH bundled |
| `node tests/imagem-canonica-fanout.test.js` | APROVADO — NODE_PATH bundled |
| `node tests/radar-whatsapp-media-materializer.test.js` | APROVADO |
| `node tests/optimus-capture-manual-template-contract.test.js` | APROVADO — NODE_PATH bundled |
| `node tests/optimus-capture-extension.test.js` | APROVADO |
| `node tests/p0-2-destinos-clonador-executor.test.js` | APROVADO — NODE_PATH bundled |
| `node tests/discord-executor-automatico.test.js` | APROVADO |
| `node tests/titulo-oferta-contrato-destinos.test.js` | APROVADO |
| `node tests/contrato-comercial-final-universal.test.js` | APROVADO |
| `node tests/contrato-comercial-produto-resgate.test.js` | APROVADO — NODE_PATH bundled |
| `node tests/ofc-renderer-oficial-isolamento.test.js` | NAO APROVADO |
| `node tests/teleradar-semantica-comercial.test.js` | APROVADO |
| `node tests/teleradar-operational-control.test.js` | NAO APROVADO |
| `node tests/social-templates-oficiais.test.js` | NAO APROVADO |
| `node tests/ofertas-v2-achados-listas.test.js` | APROVADO — NODE_PATH bundled |
| `node tests/identidade-visual-ofertas-renderer.test.js` | NAO APROVADO — NODE_PATH bundled |
| `node tests/manual-v2-contract.test.js` | APROVADO |

As regressoes que inicialmente dependiam de sharp foram reexecutadas com
a dependencia real ja disponibilizada pelo runtime, sem instalar pacotes ou
alterar package.json/lockfile:

```powershell
$env:NODE_PATH = 'C:\Users\Liva D1EGOPC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node tests/<arquivo>.test.js
```

Arquivos reexecutados nesse ambiente: engine-fanout-universal-v2,
imagem-link-contrato-universal, imagem-canonica-fanout,
optimus-capture-manual-template-contract, p0-2-destinos-clonador-executor,
contrato-comercial-produto-resgate, ofertas-v2-achados-listas e
identidade-visual-ofertas-renderer.

## Bloqueios de validacao

- ofc-shadow-planner: assertion de Fase 0 espera literal de busca do Worker
  que nao existe no processor atual.
- fila-unica-distributor-executor: assertion espera assinatura de profiler
  que nao existe no index atual.
- ofc-renderer-oficial-isolamento: espera reutilizacao de mensagem legada;
  o fallback atual retorna texto de renderizacao oficial indisponivel.
- teleradar-operational-control: teleproto ausente.
- social-templates-oficiais e identidade-visual-ofertas-renderer: express ausente.

Nao houve correcao de contratos/assertions antigos para forcar aprovacao.
Foram comparados `git hash-object` e `git rev-parse HEAD:<arquivo>`:
processor.service.js, index.js, mensagens-ofertas.js e os tres testes de
assertion sao identicos ao HEAD. A pasta template-universal tambem nao tem diff.
Isso prova que os trechos acusados nao foram alterados pela Fase 1D; nao e
substituto para revisar a divergencia entre esses testes e os contratos atuais.

O teste PostgreSQL integrado nao foi executado: FILA_CHECKPOINT_TEST_DATABASE_URL
esta ausente e nenhuma alteracao de banco foi autorizada. Os testes novos
exercitam o repository/servico reais com modelo local de SQL, nao PostgreSQL.
A validacao integrada da extensao persistente permanece pendente.

## Custo incremental em teste local

200 rodadas, 1.000 itens/rodada, fixture de 59891 bytes,
conteudo em memoria e sem serializacao adicional de snapshot.

- Baseline leitura/parse: 62.0605 ms nas 200 rodadas.
- Com medidor: 86.2341 ms nas 200 rodadas.
- Diferenca media: 0.120868 ms por rodada.

Microbenchmark sujeito a ruido/JIT/GC. Nao inclui stat real, latencia SQL,
custo do indice ou volume de producao. Nao extrapolar para o snapshot de 540 MB.

## Verificacoes finais

```powershell
# Executado para todos os 14 arquivos JS novos/alterados:
node --check <arquivo.js>
git diff --check
git status --short --branch
git diff --numstat
```

14 checks sintaticos sem erro. git diff --check sem erros.
Arvore inicial limpa; final: nove arquivos rastreados modificados e oito novos,
todos listados acima, nenhum arquivo staged.

index.js, schema.sql principal, state-machine, cadencia, importadores,
distribuidor, links, imagens, render, midia e contratos de oferta nao foram
alterados. O repository de checkpoint tem apenas a extensao observacional
autorizada, sem novas transicoes, envio, debito ou regras de fanout.

## Proximo passo seguro

Fechar dependencias/divergencias da validacao ampliada e submeter o diff ao Gate.
A migracao de coluna/indice e a validacao PostgreSQL exigem autorizacao separada.
Nao fazer deploy do repository novo antes da extensao de schema aprovada.
Continuar exclusivamente Shadow, sem Solenoide ou Demand Scheduler.
