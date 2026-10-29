# OP Teste Radar — observação de fronteira OFF (missão14.4)

Tarefa: preparar uma única observação para distinguir ingresso/retorno antecipado.
Área: fronteira compartilhada WhatsApp, somente instrumentação.
Risco: alto (hot path, reconexão, privacidade e multiworkspace).
Reversibilidade: stop/expiração restaura métodos; publicação futura reverte imagem homologada.
Contratos: INGRESS-RADAR-CLONADOR, MESSENGER, TELEMETRIA-OPERACIONAL, MULTITENANCY, PERFORMANCE, PRODUCTION-DEPLOYMENT.
Persistência: somente RAM limitada; sem escrita produtiva, banco ou journal.
Performance: OFF retorna antes de ler socket/payload, sem timers novos enquanto OFF.
Superfícies: index.js (hooks e três rotas Admin Master), módulo de observação, testes, CI e benchmark.
Capacidade: raciocínio alto por concorrência e hot path.
Justificativa: missão14.3 não encontrou cobertura individual anterior à persistência.
Escalar: qualquer proposta de filtro, buffer recovery, dependência ou roteamento comercial.
Modo inicial: leitura; desenvolvimento isolado autorizado.
Rollback: imagem produtiva anterior, sem alteração de env/mounts/dados; stop restaura somente métodos que ainda pertencem à sonda.
Arquivos permitidos: delta listado nesta candidata; Guardião inalterado.
Áreas congeladas: filtros, Baileys/recovery, sessões, Worker, Magalu comercial, Links, Diversos, Radar comercial, RIO, filas/destinos/ACK, Garimpei, PostgreSQL e /data.
Decisão humana: publicação, restart implícito do backend, ativação e envio de teste separados.

## Reconciliação

Reutiliza2543c4f8625999562b11c458913679a79ee5e9ae (cadeia7f7a7077/fa550c3d), sem cherry-pick de módulos comerciais antigos. Basef02b5a590c6f01f8ceb430013990a1c86ddcd522 contém Links5dd99da8 e Diversos. Apenas o delta de hooks/index e módulo/teste foi trazido; o Guardião antigo não foi copiado. A preparação não inclui a candidata da extensão48116638 nem altera a extensão instalada.

Leitura produtiva29/10: imagemsha256:b7ff5e7bb45792422a7080f2d36f30834950e0fb0e60237649ac35364812f5ea,running,restartCount0. Hash indexa2273694f6c30c4958d067768f0eee008c73a7ad4e3e0ecd2f3437b29bcfa06a coincide com a base. Não afirmar que Gitmain, disco oficial e runtime são a mesma árvore sem essa evidência por arquivo.

Grupo120363408782037034@g.us selecionado emadmin, identidades técnicas concordantes, sessão de bloco/grupoadmin_Zoiao Claro. O alvo antigoadmin_ZOIAO/Garimpei não foi reutilizado. Validador independente exige seleção única, sessionInput e resolução exatos, propriedadeadmin, socket atual/open e registro do listener no emitter atual. Falha fechada com qualquer divergência. Estado atual do socket/listener não foi acessível pelo canal autenticado disponível; nenhuma inspeção indireta de heap ou extração de credencial foi usada. GET futuro da candidata retorna validação atual, geração e physicalListener, sem iniciar observação.

O proprietário confirmou Vivo como remetente e ZOIAO Claro como monitor. Isso ajuda o contexto, mas não substitui key.fromMe observado no socket.

## Escopo e evidências

OFF por padrão, sem flag/env automática. Um único run por instância, cinco minutos máximos, até10 IDs sanitizados do grupo, mil emits de upsert da sessão, quatro bindings/gerações,64 registros de transição,12 estágios por mensagem. Batches limitados a64 metadados; truncamento/unkeyed explícitos. Sessão errada não é envolvida; outros grupos não geram registros individuais. Não leem conteúdo, participantes, telefone, URLs, cookies, tokens ou campos comerciais. JID/id só são comparados em RAM; relatório contém referências HMAC efêmeras e fromMe booleano.

Envolve métodos públicos existentes ev.emit/on/off/removeAllListeners/buffer/flush e ws.emit. Nenhuma assinatura extra, conexão, listener comercial, flush, reconexão ou polling. Mantém this, argumentos, retorno e erro nativos. trackSocket acompanha novas gerações da mesma sessão sem renovar prazo. Não há mudança nos módulos Baileys ou recuperação.

Socket: ws message/frame/CB:message/open/close são SOMENTE contadores agregados da sessão. Não atribuir um pacote criptografado ao grupo/produto. Upsert: referências por key.id/remoteJid/fromMe em emit_attempt/emit_completed. Buffer: isBuffering e transições, sem inspecionar ou liberar filas internas. Wrapper: contador por emitter/geração; a API onInvoke atual não fornece mensagens. Callback/listener: etapas individuais no callback existente antes das guardas. Radar: entrada, resultado com motivo fechado, incluindo guarda fromMe. Não inclui Engine/eventId: após ingresso persistido usar o rastreio oficial de evento/job/oferta e ACK já existente.

Física do listener: com ev.listeners disponível verifica referência nativa. Baileys6.7.22 não expõe essa API; registro lógico preexistente permaneceUNKNOWN. Registro/remoção observados durante a janela ou invocação real do wrapper são provas adicionais, rotuladas pela origem; nenhuma emissão artificial ou reinstalação de listener para provar presença. É possível observar remoção posterior sem reparar. Não chamar registry sozinho de prova física.

Interpretação: emit observado+buffer ativo sem wrapper = retenção observada, sem causa interna inventada; emit+remoção física observada = listener ausente; wrapper/callback separados; retorno antecipado tem motivo; ausência de emit permanece lacuna anterior à API pública, mesmo havendo tráfego agregado no socket. Esta é a menor observação pública segura, não prova absoluta de entrega de um pacote Baileys ao produto.

## Consulta, expiração e preservação

GET /admin/whatsapp/ingress-boundary: status e validação atual, sem renovação. POST /start com JSON {"confirm":"OP_TEST_RADAR_BOUNDARY_5M"}, exclusivamente autenticação Admin Master existente. POST /stop encerra só esta observação. Não aceita escolha arbitrária de sessão/JID/workspace pelo corpo. tel_ não concede controle. Sem alterações do sensor Garimpei.

Ao expirar/limite/stop restaura os métodos envoltos, preserva listeners existentes e não libera buffer. RAM permanece até15min após término, descartada na consulta seguinte. Salvar o GET sanitizado localmente antes disso; não promete sobrevivência a restart. Consulta durante a janela não prolonga início/fim. Sem reinício de janela para repetir amostra; qualquer nova observação exige nova decisão operacional.

## Procedimento futuro, NÃO executado

1. Publicação separadamente autorizada pelo workflow oficial: source/base/image/runtime_files exatos; comparar base, CI, saúde, mounts/dados e referência Docker de rollback. Runtime exclusivo index.js e modules/whatsapp/ingress-boundary-observation.js. Não promover se a base tiver mudado. Publicar OFF.
2. Publicação do backend substitui container e pode reconectar sockets/restabelecer sessões automaticamente. Isso é risco de publicação, não parte da ativação. Proibido fazer hot patch, executar require no processo vivo ou usar workflow de deploy para diagnóstico. Validar saúde após deploy e aguardar nova autorização de ativação.
3. GET validado: admin, grupo/sessão exatos, socket atualopen, geração, listener; physicalUNKNOWN explicitamente permitido como lacuna a observar, nunca mascarado. Confirmar emissor atual e baseline sem alterar buffer/listener. Confirmar acesso administrativo de leitura para salvar relatório.
4. Antes de mensagem, homologar roteamento exclusivo de teste. A seleção de fonte não assegura destino exclusivo. Leitura atual encontrou10 destinos emuser_pss60lus e candidato chamadoOp Geral Tetes(refdde4fdf84a5997ea), ativo; isso NÃO prova escolha única. Não modificar destinos nesta missão. Se fan-out comercial continua possível, NÃO enviar teste até plano de isolamento autorizado. A observação não bloqueia nem redireciona a distribuição.
5. Só após autorizações de ativação e mensagem: POSTstart uma vez; confirmaractive/startedAt/expiresAt; Diego publica uma mensagem pelo Vivo no grupo selecionado. O conteúdo e preço/cupom precisam estar comprovados no momento; não pedir mensagens nesta preparação.
6. Consultar sem renovar, correlacionar referência da mensagem/callback/fromMe/resultado; se houver evento Engine usar rastreio oficial até oferta/fila/destino/ACK. Parar no primeiro bloqueio sem reprocessar/reconectar/flush. Sem amostra resultaSEM_AMOSTRA. GET final preservado localmente e stop oficial opcional autorizado, ou expiração natural automática.
7. Rollback: stop administrativo restaura instrumentação; se falha de publicação comprovada, workflow de rollback homologado para imagem anterior sob autorização, sem alterar dados/env/mounts. Reinício apaga RAM; salvar relatório primeiro quando possível. Não desligar/religar sessão.

## Validação e limites

19 testes focais (incluindo Baileys real),47 testes com regressões Radar/Garimpei; reconexão1→2, emitter trocado, buffer retido/flush natural em fixture, remoção física, erro nativo, retorno antecipado/fromMe, controles de outros grupos/workspaces, alvo inválido, caps, expiração, privacidade e OFF. Fluxo Engine é mock; nenhum evento natural ou ACK comprovado por testes.

Microbenchmark local Node24:1milhão chamadas OFF ~9.84ms;500 emits ativos ~5.18ms; valores de ensaio, sem extrapolar capacidade produtiva. Artefato CI mede novamente.

Teste legado baileys-initial-buffer-recovery: comparação base/candidata obrigatória e separada. Na máquina Windows com dependências locais compartilhadas foram sete falhas iguais na base e candidata, sem falha nova. Não considerar esse testePASS; comparar ambiente Linux limpo e preservar relatório. Guardião existente permanece íntegro, sem permitir nova falha como dívida.

Decisão: candidata diagnóstica pronta para gates; teste produtivo não liberado enquanto isolamento do destino e aplicação/ativação não forem autorizados. Sem deploy, merge, restart, reconexão, ativação ou mensagens nesta missão.
