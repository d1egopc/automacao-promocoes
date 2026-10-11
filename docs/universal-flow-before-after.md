# Universal Flow — mapa BEFORE/AFTER local (candidato, sem deploy)

Este mapa descreve a direção autorizada para experimentos na branch `fix/universal-flow-lifecycle`. Não é um registro de aprovação de implementação: o arquivo encontrado em 2026-10-09 continha apenas `#`. Nenhuma etapa abaixo autoriza alteração em produção.

## Classificação Maintenance Manager

Tarefa: demonstrar e testar um ciclo de vida universal da Engine em PostgreSQL local descartável. Área: Processor, Validator, Importer, fairness, frescor, Auto-Clean. Risco: crítico (persistência, concorrência, multiworkspace e retenção). Reversibilidade: mudanças locais na branch; sem deploy. Contratos: `AGENTS.md`, Engine, Solenoide, histórico/fila e storage. Persistência/dados: apenas fixtures sintéticas locais. Performance: hot selection com 100k históricos e 100k pendentes expirados. Superfícies: backend; sem frontend/provider. Capacidade mínima segura: alta. Justificativa: hot path e SQL. Condição para escalar: qualquer mudança de schema/retention/produto com evidência insuficiente. Modo inicial: read-only nos fontes e reprodução no banco descartável. Rollback: descartar alterações locais e cluster sintético, sem tocar main/produção. Arquivos permitidos: documentos/testes e, após gates, módulos Engine estritamente necessários. Áreas congeladas: fanout, destino, crédito, imagem, link/afiliações, relógio, provider, deploy. Decisão humana adicional: necessária antes de qualquer operação irreversível ou deploy.

## BEFORE — comportamento encontrado em 568c4fe

1. `engine_jobs_cliente` operacional mistura pendentes recentes e legados; SQL de Processor/Validator/Importer classifica todos após join de eventos. A limpeza de expirados divide um limite fixo; 100k legados participam do ranking em cada consulta.
2. Os seletores usam buckets SQL de 30 min; o gate factual de frescor no runner distingue Normal 30 min, Turbo 10 min e Manual V2. Logo, o SQL pode ocupar slot com item que o runner expira depois.
3. Cotas fixas por lane deixam slots vazios quando a lane não tem trabalho. O baseline escolhe workspaces por rank estático, sem memória entre rodadas. Fairness de origem só alcança grupos já presentes no baseline.
4. Importer repete a estrutura; retry futuro é filtrado, mas ready antigo e retry vencido competem no mesmo ranking.
5. Auto-Clean SQL escolhe jobs terminais por `criado_em`; terminalização recente de job antigo não inicia nova janela de retenção.
6. A oferta/fila e a memória de dedup são superfícies distintas do job Engine. Nenhum seletor pode substituir a decisão de workspace/destino nem o relógio de envio.

## AFTER — hipóteses sujeitas aos gates locais

1. Expiração operacional é etapa limitada própria, idempotente, com idade comercial Normal/Turbo/Manual V2 fiel à autoridade existente; nunca apaga diretamente um job e não usa Auto-Clean como Processor.
2. Seleção viva trabalha somente sobre conjunto elegível pequeno e usa capacidade disponível por empréstimo entre lanes. Para limites 1/2/4, todo slot com candidato vivo elegível deve ser preenchido; prioridades comerciais continuam explícitas.
3. Fairness persistida por workspace antes do corte global, com progresso limitado mesmo quando workspaces > slots. Só então a fairness de origem existente opera dentro do workspace; clone-only e radar-only não dependem de origem concorrente.
4. Importer separa ready vivo, retry vencido, retry futuro e esgotado; faz progresso limitado em ready/retry vencido, nunca consome retry futuro.
5. Job deixa o hot path em status terminal. Um marcador factual de terminalidade, com transição monotônica e guardas de referência/histórico, inicia a retenção. Auto-Clean apaga fisicamente somente após esse prazo e com proteções; histórico D0–D7 e dedup/fanout permanecem separados.
6. Índices e consultas devem ser medidos em PostgreSQL real descartável sob 500/700 por dia, 100k terminais e 100k expirados; EXPLAIN BEFORE/AFTER e convergência precedem qualquer conclusão de prontidão.

## Fronteiras explícitas

- Vivo sai do hot path quando o status deixa o conjunto ativo por transição factual; histórico começa no evento durável, não no card da UI.
- Memória dedup por destino começa nas regras comerciais existentes; esta frente não muda janela de 2h nem exceção de benefício superior.
- Auto-Clean só atua após terminalidade e retenção; não deve corrigir seletor lento por exclusão em massa.
- Guard de disco comprovado para reset de esteiras: `calcularPicoEspacoExecute` e `MARGEM_MINIMA_EXECUTE_BYTES` em `modules/engine/reset-esteiras/preflight.routes.js` (bloqueia execute sem margem). Guard de escrita atômica da fila: `margemSuficienteParaExecucaoReal` em `modules/storage-manager/storage.repository.js`. Não foi comprovado um guard global contínuo para crescimento PostgreSQL/VPS; nenhum guard será alterado.

## Critério de entrega

Um AFTER só pode ser marcado como aprovado se os 15 testes mínimos da autorização passarem no PostgreSQL isolado, sem regressão em RIO/Radar/TeleRadar/Clonador, e após revisão independente do defensor. Até lá, `READY_FOR_REVIEW=false`.

## Estado do AFTER local em 2026-10-09

O candidato avançou em quatro frentes: (1) TTL/Manual/Turbo compartilhados entre regra runtime e SQL derivado; (2) limitação de expirados antes dos `WindowAgg` comerciais, ainda com custo de busca e limpeza dentro dos seletores; (3) ordenação por `ultimo_atendimento_em` e registro transacional de claim; (4) Processor/Validator passaram a usar claim por slot inclusive single-origin, evitando reivindicar antecipadamente irmãos que podem vencer. O teste PostgreSQL de cruzamento TTL e reposição passou; a reprodução de 8 workspaces/2 slots e 25/1 mostrou progresso bounded no selector com registro explícito. Ainda não há prova do orquestrador completo/concor­rência.

O próximo gate é o terminalizer independente. O Defender apontou alternativa sem DDL: usar a chave já permitida `diagnostico_final/expirada` como memória universal de frescor, atualmente não atualizada pelos expirados, e persistir marco terminal em metadata mais evento idempotente. O candidato local foi implementado isoladamente, mas ainda exige prova de concorrência, custo contínuo e ligação segura ao orquestrador. Retenção por terminalidade, Auto-Clean e convergência 500/700 continuam pendentes.

Existe agora implementação local isolada em `terminalizer-pre-importer.service.js`, **não ligada ao runner**. Oito workspaces/2 slots, idempotência em replay, caso Turbo vencido e um lote TEMP com 100k expirados passaram; o lote 100k/10 custou ~1 s local após trocar `EXISTS` por head por workspace. Isso não fecha concorrência, drenagem ou custo contínuo e não libera ativação.

### Gate estrutural identificado na continuação

No fixture com 100k terminais e 100k expirados, o plano do terminalizer atual ordenou 99990 linhas para retirar 10; uma alternativa por `criado_em LIMIT 80` usou o índice existente, mas filtrou 100000 terminais antes de devolver 80 pendentes. Portanto o schema atual não forneceu busca bounded em estado/tempo nesse cenário. Um índice composto, parcial ou outra autoridade persistente de cursor exige decisão humana separada; nenhuma migration foi criada ou executada. A retenção por `criado_em` e a exclusão de eventos factuais pelo Auto-Clean continuam inseguras para um job criado há dias e terminalizado agora. O terminalizer permanece desconectado.

O candidato local de fairness foi testado com duas conexões reais no PostgreSQL descartável para limites 1/2/4 e todos os slots de dois workers, em Processor, Validator e Importer; os claims foram distintos. Isso não substitui os gates contínuos 500/700, crash/replay integrado, fanout parcial e controles positivos completos. `READY_FOR_INDEPENDENT_REVIEW=false`.
