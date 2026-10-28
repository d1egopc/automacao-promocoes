# Sensor passivo Garimpei 24h — candidata, publicação não autorizada

Tarefa: evolução da sonda homologada d00fbc7af3ea42a8e9dda6c73a562ea848b7286c; área observabilidade focal.
Risco: nível 3, novo armazenamento diagnóstico limitado, sem autoridade comercial ou financeira.
Reversibilidade: descarte da candidata; publicação futura exige imagem anterior imutável e plano oficial.
Contratos: Ingress, Multi-tenancy, Performance, Telemetria Primeiro e Deployment.
Persistência: apenas journal sanitizado dedicado proposto fora de /data/PostgreSQL; nenhuma alteração produtiva nesta missão.
Performance: callback existente; OFF não extrai texto nem escreve; ativo até 24h, 10000 mensagens e 32 detalhes Magalu. Sem polling, consulta externa ou segundo listener.
Superfícies: módulo da sonda, journal exclusivo, integração administrativa, testes, benchmark e CI/Guardião.
Capacidade mínima segura: revisão de callback, limites, privacidade e persistência diagnóstica.
Justificativa: ausência de cobertura anterior à Engine e logs de retenção insuficiente já comprovados.
Escalar: infraestrutura produtiva, seleção/sessão, contrato comercial ou escrita fora do journal exclusivo.
Modo inicial: leitura; desenvolvimento isolado sobre d00fbc7a, mantendo Shopee independente.
Rollback: antes de produção, descartar; depois, selecionar imagem anterior pelo mecanismo oficial, sem apagar evidências.
Arquivos permitidos: somente os sete arquivos de integração/testes/CI já delimitados e journal, teste e benchmark exclusivos deste sensor.
Congelados: Magalu comercial, Shopee, RIO, Mensageiro/créditos, sessão, grupos, destinos, /data e PostgreSQL produtivo.
Decisão humana necessária: publicação, infraestrutura diagnóstica e ativação, separadas do desenvolvimento.

## Comportamento

Reutiliza a mesma instância da sonda e os hooks existentes no callback Baileys, antes da supressão recovery e filtros comerciais. Alvo fixo: admin_ZOIAO e JID homologado por referência ec288ef5bc72eae2; validador exige grupo selecionado ativo/único e propriedade/socket atual. Nenhuma segunda conexão/listener.

A extração diagnóstica reconhece URLs HTTP(S) cujo hostname é exatamente magazineluiza.onelink.me, inclusive em texto maior e captions em wrappers conhecidos, sem usuário/senha/porta. Não consulta rede ou modifica extração comercial. Inspeção limitada a 128 KiB, 32 nós e profundidade seis por mensagem; truncamento fica explicitamente marcado COBERTURA_INCOMPLETA, sem fingir ausência de amostra.

Outros marketplaces ficam apenas no contador agregado. Detalhes são limitados a 32 mensagens Magalu e 16 estágios cada; limite de 10000 mensagens do grupo evita trabalho ilimitado. IDs de mensagem são HMAC; grupo/sessão/workspace são referências opacas. Divergência da workspace capturada pelo callback é observável, sem autorizar dispatch nem ampliar a seleção comercial.

Um alerta técnico por mensagem Magalu observada é emitido no log administrativo [RADAR-GARIMPEI-ADMIN] e no journal: ao terminar por filtro, receber criação/rejeição Engine ou após 30 segundos sem conclusão. Nesse último caso o motivo é stage_timeout, não falha comercial presumida. Progresso posterior ainda é registrado com eventId, sem segundo alerta. Não existe envio WhatsApp/Telegram, destinatário inventado, integração externa ou cobrança.

O journal usa esquema fechado, 600 linhas, fila máxima de 600 metadados, 2 MiB, gravação assíncrona com sync e permissão 0600, sem I/O síncrono por oferta. Erro/overflow encerra somente observação. Uma mesma mensagem repetida tem apenas um detalhe/alerta durante a execução. Não garante entrega externa de notificação nem exatamente uma vez após crash; arquivo já existente impede reativação/replay automático.

## Consulta sob demanda

GET /admin/radar/ingress-observation retorna snapshot em memória. GET /admin/radar/ingress-observation/sensor24h/archive retorna journal sanitizado; ambos exigem Admin Master pelo middleware oficial. A leitura não inicia, encerra, reinicia nem prolonga o prazo original. Não há polling por IA. Telemetria/sonda-radar existente continua oferecendo o snapshot limitado conforme seu escopo, sem autorizar start via tel_.

Após duas horas, comparar expiresAt com o valor retornado na ativação; deve ser idêntico. Pode encerrar antecipadamente com POST /admin/radar/ingress-observation/stop. Sem decisão de encerramento ou limite, segue até expiresAt original. Zero Magalu produz SEM_AMOSTRA; truncamento produz COBERTURA_INCOMPLETA. Nenhum deles prova defeito do transporte.

## Retenção e reinício

Journal proposto: /var/log/optimus/garimpei-sensor/sensor-v1.jsonl. Somente um arquivo por missão; O_EXCL impede sobrescrita/reutilização. Retenção de 72h desde a criação; leitura após a retenção não entrega registros e não renova o prazo. Com processo vivo, timer único fecha/remove o arquivo. Reinício sempre começa com flag OFF e sem retomada. Journal permite examinar o prefixo íntegro depois do restart, mas não comprova cobertura durante indisponibilidade; cauda incompleta é marcada.

Para sobreviver à recriação de container, diretório diagnóstico persistente separado é necessário. Proposta: bind exclusivo de /opt/optimus/observability/garimpei-sensor para /var/log/optimus/garimpei-sensor, owner UID/GID do backend e diretório 0700. Isso não foi criado. O guard de Compose proíbe mudar mounts durante deploy; portanto provisionamento precisa de autorização de infraestrutura separada e baseline nova, sem relaxar o guard. Após crash/remoção do container, limpeza física requer timer único ou política tmpfiles aprovada para esse único diretório; retenção lógica de 72h continua no leitor. Não apresentar limpeza física pós-crash como já homologada em produção.

## Publicação futura: preflight e rollback

1. Confirmar main remota, diff contra source da imagem ativa, ancestry e estado das candidatas; não assumir que d00fbc7a foi publicado. O pacote completo contra base publicada 12589a07 inclui o primeiro alvo Garimpei e a evolução 24h. Validar hashes dos runtime paths existentes na imagem ativa e ausência do journal novo.
2. Registrar imagem ativa/rollback completo e recovery tag, Compose efetivo, env hashes, mounts, saúde, PostgreSQL/sessões e /data conforme contrato oficial. Provar que a imagem anterior ainda é selecionável. Nenhum comando de deploy foi executado nesta missão.
3. Aprovar/provisionar o diretório diagnóstico persistente fora de /data em missão própria, se necessário. Sem isso, NO-GO para prometer evidência além da vida do container. Não alterar mount/env dentro do deploy nem afrouxar igualdade de Compose.
4. Publicar exclusivamente o pacote de observabilidade pelo workflow manual oficial, com source/base/image/runtime_files exatos obtidos do Guardião. Os runtime paths são index.js, modules/radar/ingress-observation-v1.js, modules/radar/ingress-sensor-journal.js e modules/telemetria/operational-view.js (somente limites declarados da sonda ativa). Nunca copiar a branch Shopee.
5. Flag booleana garimpeiSensorEnabled inicia false, não depende de env e não requer restart para armar. Publicação/boot/GET nunca chamam startSensor. Fazer health/preflight somente leitura e provar OFF. Em falha, restaurar imagem anterior por overlay oficial, preservando journal e dados. Não usar git reset, compose down ou reinício de sessão.

## Ativação futura: decisão separada, exata

1. Com publicação e infraestrutura aprovadas/confirmadas, obter sessão Admin Master pelo mecanismo oficial. Não extrair JWT nem compartilhar credenciais.
2. GET /telemetria/sonda-radar para preflight: tupla/registro válidos, socket atual. attachment desconhecido continua desconhecido. Confirmar journal disponível e nenhuma missão anterior existente; arquivo prévio exige revisão humana, nunca remoção automática para rearmar.
3. POST /admin/radar/ingress-observation/sensor24h/start com JSON {"confirm":"GARIMPEI_24H"}. Não aceita alvo/duração pelo corpo. Somente a ação explícita administrativa arma a flag em RAM. A resposta deve confirmar ok/active e expiresAt igual a startedAt+86400000. Guardar referência opaca e horário; nenhuma mensagem sintética.
4. A captura segue eventos naturais, sem agente de IA. Consultas GET podem ocorrer a qualquer momento, inclusive após 2h. Se houver evidência suficiente, POST /admin/radar/ingress-observation/stop, confirmar estado e ler archive. Caso contrário, não rearmar: aguardar o prazo original.
5. Em expiração, limite ou encerramento, flag volta false e a observação para. Consultar archive até 72h da criação. Interpretar amostra e primeira etapa comprovada; publicar correção comercial somente em nova decisão.

## Limites de prova

Flag OFF e limites são comprovados por fixtures, não por execução produtiva. Um upsert ausente não prova falha do socket. Sensor só observa o callback existente e mensagens entregue a ele; não prova pacote no transporte. Desligamento/restart natural interrompe a janela e não causa retomada, replay ou prolongamento. Nenhum deploy, mount, envio, start ou alteração de dado produtivo foi realizado.
