# Mensageiro: homologacao isolada de 28/10/2026

Base backend publicada: f9cfc3865ce848c223c84f2e3f916764a25028d2, deploy 40626201741 SUCCESS.
Frontend Production: e85e71b51113917b9dae399b60b89b97b23c9b9f, Vercel dpl_8CWtQg6qi1Sd8bszK71TXix2edRH READY.

## Escopo desta candidata

Unica alteracao de runtime: a consulta de um perfil inexistente numa workspace autenticada ainda sem estado passa de HTTP 500 para 404. A causa foi reproduzida por HTTP contra o router V3 real e o store real: getProfile lanca workspace_nao_encontrada antes de profileOr404 produzir sua resposta. Somente essa excecao esperada e convertida em perfil ausente. Falhas de armazenamento ou outras excecoes continuam falhando, sem fallback, criacao implicita ou troca de workspace.

Os testes antigos de persistencia foram alinhados ao contrato de lock ja publicado: identidade ausente continua bloqueada; concorrencia da fixture reexecuta somente a aquisicao recusada, de forma limitada. Nenhuma mudanca do lock/runtime. A fixture do callback Baileys foi atualizada com a dependencia opcional Radar ja existente; nenhum listener novo foi introduzido.

CI usa fixtures locais, transporte simulado e PostgreSQL 17 descartavel, sem credenciais/volumes produtivos. O frontend nao altera src: somente CI e bloqueio explicito de Preview automatico na branch de validacao.

## Matriz de evidencia

| Recurso | Evidencia isolada | Limite da prova |
| --- | --- | --- |
| Sessao/perfil/grupo/workspace | operational-hotfix, original-ui-compat, universal, routes e release-readiness | nao identifica o Vivo produtivo por nome |
| QR/reconexao | whatsapp-reconnect-seguro; callback Baileys real-buffer em fixture | nenhum QR/reconnect real executado |
| Salvar/reabrir | HTTP V3 + restart do store real; original-ui-compat | painel produtivo nao foi alterado |
| Boas-vindas/despedida, comandos e privado | m322-real-handlers e V4 real-adapters com sock simulado | nenhuma entrega WhatsApp real comprovada |
| Programadas | timezone, recurrence, universal, operational-hotfix, ACK e durability | agendamento real depende de teste autorizado |
| Imagens/templates | real-handlers, ACK e frontend profile-image-save | transporte e imagem de fixture |
| Cooldown/dedupe/limites | bot-comandos, gerente-grupo, V4, canary, operational-gates e claims | sem gerar envios comerciais |
| Isolamento | HTTP entre duas workspaces, fence/store e PostgreSQL financeiro descartavel | grant real recebido so cobre user_pss60lus |
| Independencia da tela ServCel | V3 HTTP, bridge/handlers e scheduler executados sem frontend; V4 so dispatcha no backend | o canario administrativo atual continua deliberadamente restrito a ServCel |

## Bloqueios operacionais de publicacao/ativacao geral V4

- V4 permanece OFF. /mensageiro-v4/state, /groups e operacoes funcionais respondem 503 v4_off sem target autorizado. Isso e um gate de seguranca intencional, nao uma falha corrigida por esta candidata.
- A interface /mensageiro-v4 exige esse /state para abrir o editor. A allowlist runtime do canario Admin Master esta restrita a SERVMAQ/ServCel/perfil/grupo homologados. Ela nao autoriza o Vivo D1EGOPC.
- Targets V4 estaticos sao tuplas de grupo. Nao habilitam atendimento privado V4; Programadas continuam no scheduler V3 unico. Nao declarar homologacao operacional completa do V4 a partir dos testes de adapters.
- /mensageiro continua usando a compatibilidade V3 independente da pagina ServCel. Ja existe em producao; republicar o mesmo codigo nao remove os gates V4.
- O grant HTTPS consultado foi aceito, mas sua resposta tem escopo user_pss60lus e sessionsRef opacos. Dois sockets open nao comprovam que um deles seja o Vivo D1EGOPC. Nao associar workspace/numero por memoria ou pelo nome de outra sessao.
- Prova real de entrada, resposta, ACK, cooldown e agendamento pelo Vivo permanece pendente de identificacao autorizada e alvo de teste confirmado. Sem envios, captura, moderação, reconexao ou flags nesta missao.

## Publicacao futura e rollback

Nao publicar nesta missao. A candidata corrige somente HTTP 404 e fecha a cobertura CI; nao habilita V4. Uma eventual publicacao exige preflight novo, source/base/imagem reais, CI main verde e workflow manual oficial, com imagem anterior preservada. Frontend nao necessita release de UI nesta candidata; src e identico a Production. Vercel main permanece intocada.

Resultado dos testes, SHAs finais e runs devem ser consultados no relatorio externo de homologacao; este documento nao presume CI verde antes de sua conclusao.
