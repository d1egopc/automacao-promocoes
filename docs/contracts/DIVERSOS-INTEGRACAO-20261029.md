# Integração funcional Diversos — candidata isolada

Tarefa: Missão 8, integrar somente correções homologadas de Pesca e Camping, rede/Periféricos e caixas amplificadas/Audio TV.
Área: classificador compartilhado e validação dos consumidores.
Risco: 3, classificação afeta destinos seletivos.
Reversibilidade: branch isolada; publicação futura e rollback por imagem oficial.
Contratos: Platform Topology, Production Deployment, Ingress Radar/Clonador, Marketplaces/V3, Multi-tenancy, Performance, destinos e fidelidade comercial.
Persistência/dados: nenhuma nova persistência, schema, memória, feedback ou consulta por oferta.
Performance: somente decisão determinística limitada em memória; sem rede ou Worker.
Superfícies: dois módulos funcionais, testes/fixtures/replay, Guardião aditivo, CI-only e este documento.
Capacidade mínima segura: revisão transversal do classificador e destinos; sem agentes delegados.
Justificativa: reaproveitar famílias já homologadas, sem duplicar classificação por motor.
Condição para escalar: regressão comercial, novos efeitos de persistência ou divergência de consumidores.
Modo inicial: leitura e desenvolvimento isolado.
Rollback: não há mudança produtiva nesta missão. Futura publicação deve preservar a imagem-base Links e o overlay para reversão oficial.
Arquivos permitidos: marketplaces/inteligencia/classificador-categorias.js, evidencia-funcional.js, testes/fixtures, scripts/guardian-v1.cjs, workflow CI-only e documentação.
Áreas congeladas: index.js, Links, engines/adapters, afiliação, preços, cupons/PIX, títulos comerciais, URLs, sessões, Garimpei, /data, PostgreSQL, fila/TTL/cadência/dedupe/ACK e todos os módulos de laboratório.
Decisão humana necessária: somente publicação futura, não desenvolvimento/testes/commit/push da branch CI isolada autorizados.

## Reconciliação

Base desta candidata: main remota 5dd99da80233ab9a49162e02e215b75982e3da28, conferida por git ls-remote nesta missão; corresponde ao Backend Links publicado anteriormente nesta sessão. Imagem-base para o plano futuro, sujeita a novo preflight: sha256:77d88b2b59d4ced7aea92ed64104c0aa43587250cbfa25754e4b478e40122573. Não consultar nem alterar VPS nesta missão.

Origem homologada: 6343d675f30510c2d5712633cdff82474cbf5c28. Transportados somente o classificador funcional e o extrator limitado. A exportação exclusiva do protótipo foi omitida. Não transportar classificador-estrutural.candidate.js, memória/feedback, métricas novas, IA, Worker ou aquisições externas.

A pasta oficial foi lida com seus contratos e índice de continuidade; sua leitura Git retornou operação fora de worktree/objeto ausente nesta sessão. Não corrigir configuração, ACL ou arquivos dessa pasta. Necessidade técnica da worktree: partir da base publicada comprovada no repositório já registrado em Codex e manter candidatas anteriores preservadas. A worktree nova mantém o mesmo remote oficial e base exata; não substitui a pasta oficial.

## Integração compartilhada existente

classificarCategoriaOferta → avaliarEvidenciaCategoria → famílias funcionais/natureza → fallback legado. classificarCategoriaUniversal usa o mesmo avaliador antes de preservar categoria declarada específica. avaliarOfertaUniversal normaliza o envelope e chama essa mesma classificação. Importer Engine usa avaliarOfertaUniversal e os adapters ML/Shopee/Amazon chamam o classificador compartilhado. A reclassificação final ML/AliExpress permanece com seus gates de título factual e categoria genérica; não ampliá-la para outros marketplaces.

Radar WhatsApp, TeleRadar e Clonador ingressam na Engine existente: não classificar nem filtrar novamente no listener/bridge. Clonador bridge registra o evento bruto para o mesmo importer. RIO recebe a categoria materializada e aplica destinos existentes; não recategorizar a fila histórica ou sobrescrever categorias no dispatcher. Manual V2 e farejadores que já usam a função compartilhada herdam as correções; o classificador local legado KaBuM não é modificado. Provar paridade no serviço comum e consumidores reais aplicáveis, sem afirmar execução produtiva ponta a ponta nesta missão.

Frases/Copy: nenhum arquivo de geração de texto é alterado; testes existentes devem preservar entrada comercial e verificar coerência de família. Grupo/workspace/marketplace não determina a categoria. Facas/facões e roupa sem público suficiente continuam conservadores.

## Replay e limites

Base atual comparada diretamente (5dd99da8), não números antigos reutilizados. Corpus focal 53 casos: seis mudanças esperadas, incluindo a recusa conservadora do kit de naturezas conflitantes; zero erros. Saint Plus, ração com finalidade de isca e três títulos históricos de Rapala mudam para Pesca e Camping. Frog e graxa de carretilha já são reconhecidos pela base atual: permanecem controles de não regressão, sem chamar sua classificação antiga de regressão atual. Camisa sem gênero e faca tática ambígua continuam conservadoras.

Corpus real estratificado anterior de 40 títulos, 26 com rótulo curado e 14 sem rótulo: três correções (Saint Plus, Huawei AX2S e Mondial CM-400-L); Diversos 40→37; rótulos coincidentes 10→13, sem falso positivo específico ou regressão nova nesses rótulos. Os dez rótulos corretos iniciais eram abstenções Diversos. Isso não é percentual de acurácia populacional nem rótulo independente cego. Os 37 remanescentes incluem abstenções corretas, identidades insuficientes e nichos fora desta missão; lista completa no artefato real40.json. Nenhum caso passa a ser correto simplesmente por sair de Diversos.

Replay V3 amplo:147 casos, zero mudanças/erros, Diversos23→23. Benchmark local sintético, pares alternados: p50 base148.09µs/candidata147.38µs; p95 base152.06µs/candidata155.05µs. Zero I/O de arquivo, chamadas externas ou consultas novas no classificador durante a medição. Não equivale a latência produtiva.

73 testes focais (inclui combinações de sete marketplaces, três origens, dois tenants e destinos seletivos), mais122 verificações de regressão direcionadas passaram localmente em Node24. O adapter Shopee real recebe importer injetado e identidade/afiliação de fixture verificável, sem rede real. Uma fixture inicial foi rejeitada antes da classificação pelo filtro de URL/identidade existente; foi corrigida para o formato www.shopee.com.br e afiliação válida, sem alterar o adapter ou flexibilizar filtros. Não declarar teste de callback WhatsApp, RIO ACK ou ingressão produtiva real: essas fronteiras não foram exercitadas nesta missão.

O uso de descrição/atributos só vale onde o envelope real os disponibiliza (direto ou raw/metadata); adapters que passam só título continuam limitados a esse título. Não implementar aquisição de atributos/identidade ou expandir payloads de outros motores nesta integração focal.

## Publicação futura — não executada

1. Reconfirmar main=5dd99da80233ab9a49162e02e215b75982e3da28 e imagem realmente ativa=sha256:77d88b2b59d4ced7aea92ed64104c0aa43587250cbfa25754e4b478e40122573. Se divergirem, reconciliar antes de publicar.
2. Reconfirmar CI Linux/Node24, Guardião e SHA final desta branch. Não promover laboratório: allowlist runtime exata é marketplaces/inteligencia/classificador-categorias.js,marketplaces/inteligencia/evidencia-funcional.js.
3. Sob autorização de publicação separada, preservar referência recovery da imagem77d88b2b e overlay vigente; a referência anterior de recuperação Links aponta para3c07f90a e não substitui a base nova. Nenhuma referência Docker foi criada nesta missão.
4. Somente depois de autorização, fast-forward do candidato e workflow oficial Deploy Backend VPS com source_sha final, base_sha5dd99da8, base_image77d88b2b e garimpei_sensor_mount=false. O Guardião deriva os dois runtime paths; deploy utiliza imagem ativa, sem build do checkout sujo da VPS, sem env/mounts/schema/Worker.
5. Validar hashes, HTTP, PostgreSQL/container preservado, oito sessões conforme baseline atual, Radar/TeleRadar, Clonador, RIO e destinos/categorias; não criar oferta artificial. Classificação corrigida não prova entrega/ACK.
6. Regressão objetiva: rollback homologado para imagem77d88b2b e overlay anterior, backend somente. Não usar reset, apagar dados ou reinstalar dependências. Publicação e qualquer rollback exigem o escopo operacional autorizado da missão futura.
