# Observação focal Garimpei

Tarefa: correlação read-only e candidata mínima de observabilidade autorizada em 28/10/2026.
Área: sonda Radar WhatsApp; risco 3; reversibilidade por descarte/reversão da candidata.
Contratos: Ingress, Telemetria Primeiro, Multi-tenancy, Performance e Deployment.
Persistência/dados: nenhuma escrita produtiva; relatório somente em RAM, retenção existente.
Performance: OFF sem relógio/timer adicional; ativo no máximo cinco minutos/dez mensagens, sem segundo listener ou I/O.
Superfícies: alvo da sonda existente, metadados e testes/gate CI-only.
Capacidade mínima segura: revisão de isolamento e callback compartilhado.
Justificativa: configuração persistida correta, mas sem cobertura histórica anterior à Engine.
Escalar: qualquer necessidade de alterar filtro comercial, seleção, sessão ou persistência.
Modo inicial: READ ONLY; implementação em branch isolada da main 12589a07843954fb6ea858f34da4c56861e64f8a.
Rollback: antes de publicação, descartar a candidata. Publicação futura exige preflight e rollback oficial próprios.
Arquivos permitidos: index.js somente observabilidade, ingress-observation-v1.js, testes, Guardião, CI-only e este contrato.
Áreas congeladas: todos os filtros e motores comerciais, Magalu, Shopee, Mensageiro, sessões, dados, RIO, destinos e demais integrações.
Decisão humana necessária: publicação e ativação separadas; nenhuma delas é executada pela candidata.

## Correlação

A configuração produtiva consultada vincula admin/admin_ZOIAO aos JIDs homologados das fontes. A busca diária dos dois OneLinks foi global em engine_eventos_brutos/texto/links_extraidos e engine_links; os jobs seriam correlacionados a admin e user_pss60lus somente depois de encontrar o evento. Nenhum evento correspondente foi encontrado. A janela 13h50–14h30 BRT também não contém eventos pelos JIDs/sessão, nem jobs com os códigos de divergência consultados. Rejeições anteriores à persistência não podem ser descartadas por essa consulta.

Captura central admin não equivale a propriedade exclusiva dos jobs: listarClientesEngineRadar usa as workspaces elegíveis do registry. O callback recebe clienteIdMensageiro resolvido da sessão; configuração persistida não prova o valor capturado na RAM no incidente. A sonda expõe hash desse contexto e contador de divergência.

## Alvo e operação futura

O alvo fixo passa de OP Teste Radar para exclusivamente admin/admin_ZOIAO, referência SHA-256 curta do JID ec288ef5bc72eae2. O nome exibido não é autoridade. Exigir seleção ativa e única no bloco da sessão, identidades técnicas concordantes, propriedade da sessão, socket atual aberto e listener registrado; anexação física permanece desconhecida quando introspecção não existe. Payload não escolhe alvo.

Reutiliza as rotas Admin Master e a instância/callback existentes. tel_ continua read-only. Não executa start ao publicar, reiniciar ou consultar preflight. Antes de qualquer ativação futura, provar a imagem publicada e o preflight real, obter aprovação e observar apenas publicação natural.

Metadados: referência opaca de sessão/grupo/workspace, callback, horário, fromMe/upsertType, geração, decisões/códigos dos gates, execução Radar e eventId numérico quando criado. Texto, participantes, credenciais e URLs integrais não entram no relatório. Falha de workspace é contada sem conservar mensagem de outra workspace.

Sem publicação natural durante a janela: SEM_AMOSTRA. Isso não comprova falha do WhatsApp. Callback positivo sem radar_gate/decisão localiza uma lacuna intermediária; engine_event com ID permite continuar nos rastreios oficiais existentes. A sonda não altera nem garante distribuição/ACK comerciais.

Limites preservados: cinco minutos, dez eventos, até dez URLs apenas como hashes, dezesseis estágios por evento e quinze minutos de retenção em RAM. Relatório desaparece após retenção/restart. A candidata Shopee 868a0cf2d176bb06c014443100b0384269d73016 não integra esta branch.
