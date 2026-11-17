# Radar Claro — prova local do ingresso

## Escopo

Este plano usa a observabilidade já existente, sem alterar o callback comercial:

- `modules/whatsapp/ingress-boundary-observation.js`: gerações, socket público, listener, `messages.upsert`, tipo `notify/append`, filtros de escopo, etapas de callback/listener/Radar e estado de bootstrap.
- `modules/whatsapp/ingress-observation-journal.js`: retenção curta e fila limitada para registros sanitizados.
- `modules/whatsapp/socket-listener-lifecycle.service.js`: geração atual, registro único, substituição e diagnóstico de entrada.
- `modules/whatsapp/baileys-session-observability.service.js`: classificação separada de falhas Signal diretas/grupo e logs com hashes.
- `modules/radar/whatsapp-capture-gate.js`: razões de rejeição pré-ingresso sem tocar no processamento comercial.

O arquivo `tests/radar-claro-ingress-proof.test.cjs` é somente uma regressão local com fixtures sintéticas. Nenhum conteúdo de mensagem, telefone, JID bruto, mídia, cookie ou credencial é usado como evidência.

## O que a prova cobre

1. `notify` de grupo monitorado atravessa wrapper → callback → listener → Radar e produz contadores/journal sanitizados.
2. `no_matching_sessions` em mensagem direta é classificado separadamente de falha em grupo; a telemetria não remove listener nem substitui a exceção original.
3. Timeout/bootstrap e falha de tarefa offline são distinguíveis de ausência de listener.
4. A geração antiga deixa de ser observada quando um socket novo assume; a janela/escopo não é renovada artificialmente.
5. O gate pré-ingresso diferencia `notify` de histórico, grupo não monitorado e mensagem anterior à ativação.
6. Sessões/workspaces distintos recebem referências e contadores distintos mesmo com o mesmo grupo sintético.
7. A resolução de grupos falha fechada quando a sessão não pertence ao workspace.

Estas são provas sintéticas de contratos de observabilidade e filtros. Elas não provam que um grupo real enviou uma mensagem nem que uma oferta ou ACK foi produzido em produção.

## Plano da prova natural T0/T1/T2

Com autorização do operador do grupo, enviar uma mensagem comercial legítima para **um** grupo já monitorado pelo Radar Claro. Antes do envio, capturar via SSH apenas o snapshot sanitizado:

- sessão técnica e geração do socket;
- estado de bootstrap e listener;
- grupos carregados (referências pseudonimizadas);
- contadores e último `upsert`/evento persistido;
- saúde TeleRadar e Clonador como controles.

Em T1 (30 s) e T2 (120 s), consultar somente o journal/telemetria já existente e correlacionar:

`socket/frame → messages.upsert (notify/append) → callback → filtro → evento bruto → job (se elegível) → oferta/fila/ACK (se houver produto válido)`.

Registrar apenas IDs técnicos já sanitizados, hashes de grupo e contagens. Se não houver `upsert`, classificar como ausência de ingresso/transporte não comprovado; se houver `upsert` e não houver evento bruto, classificar a primeira perda no filtro/callback; se houver evento bruto sem job, seguir o motivo de retenção. Não reconectar, gerar QR, reiniciar ou reprocessar durante a prova.

Critérios de parada: `badSession`, exigência de QR, troca de geração inesperada, erro de listener, alteração de outra sessão, crescimento anormal de contadores, ou qualquer impacto em TeleRadar/Clonador. O experimento é abortado e permanece read-only.

## CI-only proposto

Node 24 executa:

```text
node tests/radar-claro-ingress-proof.test.cjs
node tests/whatsapp-ingress-boundary.test.cjs
node tests/whatsapp-ingress-continuous.test.cjs
node tests/whatsapp-ingress-frame-types.test.cjs
node tests/whatsapp-ingress-observation-journal.test.cjs
node tests/baileys-session-observability.test.js
node tests/baileys-bootstrap-observation.test.cjs
node tests/whatsapp-socket-listener-lifecycle.test.js
node tests/radar-whatsapp-capture-gate.test.js
```

O conjunto é CI-only e não requer segredo nem endpoint produtivo. Um job PostgreSQL 17 só é necessário se a execução incluir persistência real de evento bruto; nesse caso deve usar banco descartável e os testes de ingress/fence já existentes, sem alterar assertions ou conectar na produção. A ausência do job PG17 não deve ser reportada como prova de ACK natural.

## Snapshot read-only da VPS

Na consulta de 17/11/2026, a imagem ativa foi confirmada como `sha256:0f9cec3d56db428ff767090ee0a2f3690de0ff7a45bc8ea028759723379ca9aa`, com backend `running`, `restartCount=0`, `OOMKilled=false`, PostgreSQL 17 saudável e apenas os mounts já conhecidos (`/data` e o journal do sensor Garimpei). Não há mount persistente visível para o journal WhatsApp; o journal de ingress permanece dependente da instância/rota autenticada.

O código efetivamente ativo ainda fixa o alvo legado da sonda em `admin_ZOIAO` e em um `groupRef` fixo. A sessão operacional relatada é `admin_Radar Zap Claro`; portanto `validarAlvoObservacaoIngressRadar()` não pode provar o Claro enquanto essa tupla não coincidir. Isso é uma limitação da sonda, não evidência de falha do capturador. A rota read-only `/telemetria/sonda-radar` e as rotas `/admin/whatsapp/ingress-boundary*` exigem autenticação; a consulta HTTP local sem credencial respondeu `401`.

Nos logs sanitizados recentes há `socketGeracao=22` e repetidos `baileys_signal_error`/`baileys_decrypt_failure` de tipo `no_matching_sessions`, todos classificados como `decryptKind=direct`, além de retry receipts. Não foram observados registros `messages.upsert` do Claro nas últimas 24h consultadas; a ausência de upsert continua sendo lacuna de ingresso, não prova de que nenhum pacote chegou ao transporte. Nenhuma reconexão, restart ou alteração foi executada.

## Impacto e invariantes

O teste novo não importa nem altera `Mensageiro`, TeleRadar, Clonador, Universal, filas, Executor, sessões ou banco. A observabilidade existente é best-effort: exceções de telemetria são absorvidas e o despacho comercial continua sendo o nativo. HMACs, caps de cardinalidade, retenção curta e limites de journal mantêm overhead e exposição baixos.

Estado desta preparação: **local, sem commit, push, merge, deploy ou alteração produtiva**.
