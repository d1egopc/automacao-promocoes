# Gerente V2 — observabilidade temporária

## Estado desta preparação

O pacote está agora em um checkout Git completo e isolado em `C:\Users\Liva D1EGOPC\Documents\Codex\opt-v2`, na branch local `validation/gerente-v2-observability-20261024`, criada diretamente sobre `10b066f827117bb78af310e982de99b5880119bc`. O commit-base e o `origin/main` local foram confirmados pelo proprietário e lidos no repositório oficial; não houve atualização de refs pela rede nesta etapa. A pasta oficial não foi alterada por esta preparação, e seus documentos locais preexistentes não foram copiados para o candidato. VPS, Compose, ambiente, sessões, V3, PostgreSQL e `/data` também não foram alterados.

O checkout foi materializado a partir de um bundle local de leitura porque a clonagem direta do caminho oficial foi bloqueada ao iniciar o `sh.exe` do Git for Windows. Foi usado um diretório curto com `core.longpaths=true` para completar os 5.244 arquivos rastreados, sem ACLs elevadas ou mudança no repositório oficial. O estado de trabalho oficial continua sem prova confiável via `git status` neste sandbox; por isso não se afirma que a pasta oficial esteja limpa.

O trace legado `gerente-trace.js` não é adequado para esta janela: ele grava JSON sincronamente no caminho da mensagem e não oferece expiração automática de 15 minutos. O diagnóstico de `messages.upsert` existente é independente, ativado por variáveis de ambiente, tem escopo mais amplo que um grupo e registra workspace/sessão em claro. Ele permanece desligado e intocado.

A alternativa V2 está somente nesta cópia local. Ela não existe na produção atual e não deve ser tratada como já ativada ou pronta para coleta produtiva.

## V2 preparado

Arquivos funcionais alterados:

- `index.js`
- `modules/mensageiro/gerente.service.js`
- `modules/mensageiro-v3/operational-gates.js`

Arquivos novos:

- `modules/mensageiro/gerente-observability-v2.js`
- `modules/mensageiro/gerente-observability-v2.routes.js`
- `tests/mensageiro-gerente-observability-v2.test.cjs`
- `scripts/benchmark-gerente-observability-v2.cjs`
- este documento

A V2 é desligada na inicialização e não usa flags de ambiente. Ela reutiliza o callback já existente de `messages.upsert`; não registra listener adicional. Quando desligada, o callback faz apenas a checagem de estado/alvo e não cria buffer por mensagem. Quando ligada, o callback coleta somente a workspace `user_k3phmbkf`, a sessão informada e o grupo informado, depois de validar a sessão/grupo contra o escopo de `groupManager` no V3. O perfil pode estar inativo ou o card desativado: isso é precisamente um resultado que a janela precisa diagnosticar, desde que sessão e grupo estejam no escopo configurado.

A coleta cobre etapas e códigos enumerados: ingresso, socket atual/obsoleto, resolução de sessão/workspace/grupo, seleção do perfil (incluindo `PERFIL_INATIVO` e um único candidato quando inequívoco), escopo/card, regra, isenção, metadata/admin, tentativa/resultado da exclusão e retorno/erro do handler. Não há texto da mensagem, URL, telefone, participante, JID completo, token nem erro dinâmico no esquema de saída.

IDs de evento, workspace, sessão, grupo, perfil e regra são HMAC truncados a 16 caracteres com chave aleatória exclusiva por execução. A chave é zerada ao terminar. Registros ficam somente em memória e são removidos até 60 segundos após o término, para permitir coleta imediata dos resultados.

## Ativação planejada — não executar nesta etapa

A alternativa exige publicar primeiro o código V2 aprovado. O início em runtime, após essa publicação, seria uma chamada autenticada de Admin Master por HTTPS:

```http
POST /admin/mensageiro/gerente-v2/start
Authorization: Bearer <token de Admin Master>
Content-Type: application/json
```

```json
{
  "workspaceId": "user_k3phmbkf",
  "sessionId": "user_k3phmbkf_ClaroTeste",
  "groupId": "<JID atual do grupo SERVMAQ, confirmado no V3>",
  "durationMs": 900000,
  "maxEvents": 10,
  "runId": "<UUID v4 novo>"
}
```

O ID do grupo deve ser obtido da configuração V3 vigente e não deve ser inferido do nome/hash sanitizado. A validação compara workspace, sessão e grupo com o escopo configurado. A resposta de `start`, `status` e `events` não contém os valores brutos do alvo.

Consultar o estado em `GET /admin/mensageiro/gerente-v2/status?runId=<UUID>` e os registros em `GET /admin/mensageiro/gerente-v2/events?runId=<UUID>`. Encerrar antes do prazo com `POST /admin/mensageiro/gerente-v2/stop` e `{ "runId": "<UUID>" }`. Mesmo sem chamada de `stop`, um timer encerra a captura em no máximo 900.000 ms; o limite configurável também aceita duração menor. Após expiração, fim manual ou limite de eventos, buscar os resultados imediatamente; eles são eliminados após 60 segundos. Não colocar o Bearer em query string, shell history ou logs.

Não há mudança de ambiente/Compose nem restart para ligar ou desligar a V2; o controle é o endpoint Admin Master. A publicação do código, se aprovada em outra etapa, é necessária. Não há deploy autorizado agora.

## Limites, fail-safe e riscos

- `workspaceId` é fixo em `user_k3phmbkf`; sessão e grupo precisam corresponder exatamente. Grupos e workspaces diferentes não são registrados.
- Limites: duração máxima 15 minutos, até 10 eventos-alvo, 120 registros, orçamento determinístico de 61.440 bytes; uma execução por vez.
- O timer é baseado em deadline monotônico e há nova verificação no início de cada operação de captura/leitura. Como todo timer Node, sua execução física pode atrasar se o event loop estiver bloqueado; nesse caso a checagem monotônica impede continuar aceitando eventos quando o loop retomar. Não é garantia de interrupção enquanto o event loop esteja suspenso.
- Nenhuma escrita síncrona, arquivo, banco ou chamada de rede foi adicionada ao hot path. A validação de alvo recarrega o store V3 uma vez no `start` administrativo. `selectProfile/store.reload()` já existente no fluxo V3 permanece preexistente e não foi introduzido pela telemetria.
- O trace não altera decisão/ordem: callbacks de diagnóstico são opcionais e exceções são capturadas. Não há retry, envio nem efeito comercial.
- Limitação conhecida: o filtro exige que o workspace derivado e capturado pelo listener já seja `user_k3phmbkf`. Se a divergência de workspace ocorrer antes desse filtro, o evento não aparecerá no trace V2. Não ampliar o filtro para observar tráfego de outra workspace; resolver essa hipótese por uma verificação separada da associação socket→workspace, sem conteúdo de mensagens.
- A medição local não prova carga de produção, rede, metadata do WhatsApp ou health do RIO. Antes de qualquer futura janela, confirmar que os access logs/proxy não armazenam corpos de requisição, conferir os flags independentes do diagnóstico legado ainda desligados, validar alvo V3 atual, health e rollback.
- Um limite de 10 eventos não substitui o timeout absoluto. Se atingir esse limite e não houver outra chamada de ingresso, a execução permanece sem aceitar eventos adicionais e o timer finaliza o estado ativo no prazo. Buscar os registros prontamente após alcançar o limite.

## Verificações locais

Executado em Windows, Node `v20.20.2`, sem Docker e sem runtime Node 24 disponível. `npm ci --ignore-scripts` instalou as dependências no checkout isolado. O teste real do Baileys 6.7.22 inicialmente revelou que seu harness que avalia um callback extraído de `index.js` não injetava o novo controlador V2; o harness foi atualizado para injetar o controlador real e validar a coleta antes dos filtros. A correção é somente no teste existente, não no runtime. O teste passou após o ajuste.

Passaram:

- teste focal V2: escopo OFF, HMAC/sanitização, `PERFIL_INATIVO`, callbacks que falham sem alterar dispatch, Admin Master Bearer, ausência de CSRF por cookie, timeout/limites de evento e buffer;
- `mensageiro-gerente-trace.test.cjs`;
- `mensageiro-v3-operational-hotfix.test.cjs` — 8/8;
- `mensageiro-v3-m32-integration.test.cjs` — 10/10;
- `mensageiro-v3-m322-real-handlers.test.cjs` — 4/4;
- `mensageiro-bot-comandos.test.cjs`;
- `mensageiro-programacoes.test.cjs`;
- `teleradar.test.js` e `teleradar-handoff.test.js`.

Também passaram após direcionar `TEMP`/`TMP` do processo de teste para um diretório descartável permitido pelo sandbox: comandos, grupo/Gerente, Programadas, timezone, compatibilidade UI, listener real Baileys, lifecycle, snapshot de memória, fila Universal, cobertura Radar, handoff TeleRadar, foundation do Clonador e wiring da fila viva. Esse ajuste de diretório foi apenas do processo local de teste.

Limitações e falhas de ambiente observadas:

- `mensageiro-gerente-grupo.test.cjs`: o teste tenta abrir/conectar loopback e o sandbox retorna `EACCES 127.0.0.1:<porta>`.
- `mensageiro-v3-lock-identity.test.cjs`: os cenários de concorrência/lock falham neste Windows restrito com `EPERM`/`EBUSY` e loopback `EACCES`; não se atribui isso ao patch de observabilidade.
- `clonador-grupos-engine-bridge.test.js`: esta cópia isolada não inclui `optimus-capture/local-worker/mercadolivre-identity`; é dependência ausente da cópia, não falha funcional confirmada.
- O teste real de Baileys passou após `npm ci` e após alinhar o contexto VM com a nova dependência injetada por `index.js`.
- Sem redirecionar `TEMP`/`TMP`, alguns testes que fazem rename atômico sob `os.tmpdir()` falhavam com `EPERM` no diretório temporário virtual do sandbox. Com `TEMP`/`TMP` apontando para `opt-v2/tmp/test-tmp`, esses mesmos testes passaram sem mudar assertions.
- O comando legado `npm run test:radar-cupom` ainda aponta para `tests/radar-cupom-mensagem.test.js`, ausente tanto na árvore-base quanto no candidato. A falha é `MODULE_NOT_FOUND` antes de qualquer assertion; portanto, o resultado da assertion histórica “URL de cupom esperada, null recebido” permanece não determinado. O teste de cobertura Radar usado pelo CI (`tests/radar-cobertura-v1.test.js`) passou localmente.

O workflow isolado deve executar Node 24 em Linux; nenhum CI remoto foi executado ainda. A revisão não autoriza tratar ambiente Windows/Node 20 como substituto desse gate.

Benchmark sintético atualizado: 40 rodadas × 188 mensagens (7.520 chamadas), sem rede, disco ou WhatsApp, Node `v20.20.2`. Baseline sem trace: lote média 0,0352 ms, p95 0,0621 ms, p99 0,1004 ms. V2 desligada: média 0,0352 ms, p95 0,0938 ms, p99 0,1233 ms. V2 ativa: lote média 0,8969 ms, p95 1,5998 ms, p99 1,7187 ms; por mensagem média 0,0046 ms, p95 0,0508 ms, p99 0,0899 ms; buffer limitado a 120 registros. Event loop: média 1,1618 ms, p95 1,6906 ms, máximo 2,6726 ms. Heap pós-GC variou 159.856 bytes numa única amostra, ruidosa e não tratada como estimativa confiável de memória. I/O observado: zero. O p95 OFF variou entre medições sintéticas; a média permaneceu igual nesta rodada, portanto não há prova de neutralidade de desempenho em produção.

## Decisão

A V2 alternativa é adequada para uma janela curta **após revisão dos deltas na pasta oficial, validação Node 24/Linux e publicação autorizada**. Não está pronta para ativação em produção enquanto permanecer apenas nesta cópia. A janela não foi executada; nenhuma variável, regra, listener, sessão, container ou dado produtivo foi alterado.
