# Classificador escalável — evolução isolada V3

Tarefa: ampliar a candidata278468cf, auditar a decisão e entregar base estrutural sem produção.
Área: classificação compartilhada e laboratório de evidências, memória/feedback e métricas.
Risco:3 no código funcional; persistência futura seria4 e não foi implementada.
Reversibilidade: descartar branch validation/guardian-v1-classificador-estrutural-20261028.
Contratos: Marketplaces/V3, Multi-tenancy, Performance, Telemetria, Ingress e Histórico.
Persistência/dados: somente leitura tenant-scoped limitada para auditoria; laboratório em RAM nos testes. Sem schema, /data, armazenamento ou endpoints novos em produção.
Performance: extrator limitado, sem rede/I/O/query por oferta; laboratório não importado por motor.
Superfícies: classificador, extrator funcional, módulo candidate isolado, testes/fixtures/replays, Guardião aditivo, CI-only e este documento.
Capacidade mínima segura: revisão transversal de evidência e isolamento.
Justificativa: manutenção por palavra/título não escala; identidade confirmada e fontes estruturadas devem reduzir trabalho repetido.
Escalar: aquisição externa, semântica paga/instalação, schema, integração comercial ou confiança não comprovada.
Modo inicial: leitura, seguida de implementação isolada.
Rollback: nenhuma alteração produtiva; main/runtime c9f81bae preservados.
Áreas congeladas: Garimpei ativo até29/10/2026 21:08:36 BRT conforme proprietário, sessões, Radar/TeleRadar, RIO, preços/cupons/links, afiliação, destinos, fila/dedupe/ACK, Mensageiro/créditos e dados.
Decisão humana: futura publicação e integração durável/semântica, não desenvolvimento e CI isolados solicitados.

## Auditoria da V3

1. classificarCategoriaOferta chama avaliarEvidenciaCategoria e só depois classificarCategoriaLegada.
2. Evidência oficial usa WeakSet em memória, marketplace e productId iguais, lista de fontes e hierarquia conhecida. JSON reidratado não adquire proveniência. Hoje AliExpress e Magalu factual conectam esses dados; não se presume aquisição equivalente nos outros conectores.
3. Natureza explícita pode corrigir categoria oficial/declarada contraditória; adulto/brinquedo/roupa e conflitos têm precedência protetora.
4. Universal chama a mesma evidência, depois preserva categoria declarada específica válida. Nome válido não equivale a prova oficial; essa distinção precisa permanecer no diagnóstico.
5. O scorer legado concatena termo/título/descrição/categoria/marca/marketplace/loja, pontua prioridade+termos fortes+termos fracos-negativos e escolhe o maior score. Não há calibração probabilística ou limiar geral de ambiguidade. Empates podem manter a ordem do catálogo.
6. Sem regra/scorer, tenta identidades confiáveis e retorna Diversos. Há falso negativo por vocabulário, mas também Diversos corretos, páginas não produto, títulos incompletos e limitações da taxonomia.
7. A normalização preserva raw e metadata; descrição/atributos podem ser consumidos quando realmente presentes, sem chamada nova. Não confundir dado disponível no modelo com campo efetivamente entregue por um conector.

## Novos casos reais e primeira falha

Telemetria primeiro: grant anterior401, novo grant aceito e restrito a user_pss60lus; snapshot29/10 00:39:03 UTC. Endpoints sanitizados limitam janela e não entregam títulos/descrições históricos para rotulagem. Essa lacuna motivou a consulta complementar READ ONLY, sem usar SSH para contornar autorização negada; escopo restrito ao mesmo workspace, datas/limites/timeouts. Nenhum segredo/grant foi salvo.

- Shopee HUAWEI WiFi AX2S/WS7000: histórico101587, evento199641, ofertas170973 e correlatas; título integral mantém roteador/WiFi/dual band. Categoria importada é o rótulo genérico Shopee; não há descrição nos campos inspecionados. Nem avaliador de natureza nem REGRAS reconhecem roteador+rede; fallback Diversos reproduzido na base e na focal278.
- ML caixa amplificada CM-400-L400W RMS: histórico101602, evento199633, oferta170945 e correlatas; título preserva caixa amplificada/RMS. Categoria importada Diversos e descrição ausente. A regra AudioTV conhece caixa de som/amplificador, mas não a flexão caixa amplificada; scorer sem match, Diversos. Não é perda de título ou problema de transporte comprovado.

A correção reconhece famílias funcionais, sem marca/modelo/marketplace/workspace/título completo. Rede exige tipo de equipamento+função/protocolo; áudio exige tipo acústico/amplificado+função. Madeira/marcenaria é Ferramentas; organizadoras, acessórios, manuais, roupa e descrições de outro produto não herdam a família. Conflitos abstêm. Fontes diagnosticadas como campos_funcionais_disponiveis, sem fingir categoria oficial.

O extrator limita título, descrição e atributos nome/valor permitidos; ignora grupo, credenciais, preços, cupom e URLs. A V3 mantém suas precedências e taxonomia. Não é prometida compreensão semântica universal: esta camada ainda é determinística por família, não um catálogo interminável de modelos.

## Hierarquia preparada em laboratório OFF

Módulo classificador-estrutural.candidate.js sem importação por motor, serviço Universal ou rota:

1. Identidade canônica comprovada+classificação humana confirmada, mesmo workspace/marketplace/ID/variante, versão e prazo válidos, fingerprint dos fatos igual.
2. Categoria oficial validada pelo mesmo mecanismo V3, nunca DTO declarando oficial=true.
3. Natureza/finalidade explícita existente e extrator funcional.
4. Classificação contextual/legada existente, marcada heuristic/legacy_unvalidated_context, sem promovê-la a oficial.
5. Ambiguidade/ausência: Diversos+requiresReview. Grupo nunca decide sozinho; nesta versão não participa de decisões.

Guardas de segurança/conflito precedem a aceitação: identidade confirmada, oficial e natureza incompatíveis produzem abstinência. Não instalar hierarquia rígida que sobrescreva conflito factual. A hierarquia completa é proposta testável em laboratório; NÃO está conectada ao fluxo comercial. O patch funcional publicado futuramente continuaria a V3 com famílias de rede/áudio.

## Memória e feedback sem contaminação

Protótipo em RAM, sem endpoint: autorização de feedback injetada por fronteira administrativa confiável e negada por padrão; prova de identidade não serializável; nada aprende da própria saída. Confirmação/revogação exige CAS de revisão, categoria existente, referência administrativa e motivo limitado. Auditoria versionada/limitada, sem texto, preço, link, cookie ou produto bruto. ID igual em tenants diferentes não compartilha correção.

Cache privado por workspace+marketplace+ID canônico+variante. Mudança dos fatos invalida reutilização; preço/cupom/afiliação não compõem fingerprint. TTL não é renovado por leitura. Limites: até128workspaces,64identidades/tenant,128registros de auditoria/tenant; negar overflow não autoriza despejar outro tenant. Essa é uma capacidade de laboratório explícita, não dimensionamento definitivo de produção. Recomeçar processo perde o protótipo; não alegar aprendizado durável ou multiprocesso homologado.

Projeto futuro durável: repository próprio com chave composta tenant/marketplace/ID/variante, versão de taxonomia/método/fatos, revisão CAS, revisor opaco, evidência, prazo e revogação; append de auditoria na mesma transação. Admin da workspace só confirma no tenant resolvido da autenticação; AdminMaster não promove dados privados a catálogo público automaticamente. Leitura no hot path deve usar snapshot/cache por worker, sem query por item; atualização por lote/notificação, quota e orçamento global. Exige homologação SQL/multiprocesso e decisão específica antes de criar schema/serviço. Nenhum desses mecanismos foi instalado.

Catálogo técnico público futuro pode compartilhar somente fato público validado por identidade, fonte, versão e ausência de dado privado. Correção de cliente continua privada; exportação para treinamento/catálogo público é ação separada, revisada e sanitizada. Embedding parecido ou título parecido jamais torna IDs iguais.

## Semântica: alternativas e custo

| Alternativa | Vantagem | Limite/custo/decisão |
| --- | --- | --- |
| TF-IDF/ngramas+classificador linear local | Modelo compacto, CPU e treinamento batch com exemplos confirmados | É estatístico lexical, não compreensão geral; precisa dados rotulados, separação por identidade e validação de confiança |
| Embeddings multilíngues locais+protótipos/reranking | Generaliza para paráfrases e famílias novas sem adicionar título/regra por produto | CPU/RAM/modelo/licença e quantização devem ser medidos no hardware isolado; similaridade não é probabilidade |
| Modelo externo/LLM opcional por lote | Auxilia revisão ambígua e explicação | Custo, latência e privacidade variáveis; exige aprovação e orçamento. Não é dependência por oferta |

Recomendação técnica: primeiro corpus confirmado e baseline linear; comparar embeddings locais em shadow offline, com recusa por score/margem calibrados em holdout por identidade e marca. Uma implantação futura deve usar fila de diagnóstico limitada, batch fora do event loop, timeout/circuit breaker e cache versionado. Falha/capacidade não bloqueiam RIO: manter V3/Diversos. Texto é dado, não instrução; modelo só sugere uma categoria da whitelist, sem permissão de ferramentas, preço/link/destino ou geração de ofertas. Guardas de conflito/idade/finalidade sempre prevalecem.

Não há números inventados de latência/custo/acurácia de modelo. Orçamentos iniciais propostos, não medidos: semântica fora do despacho e amostra/batch limitado; teto só será fixado após benchmark. Nenhuma IA paga foi instalada; nenhum modelo baixado, pacote adicionado ou chamada externa por oferta foi executada. Pesquisa documental usa fontes primárias:

- https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction
- https://sbert.net/examples/sentence_transformer/applications/semantic-search/README.html
- https://arxiv.org/abs/2402.05672
- https://github.com/microsoft/unilm/blob/master/e5/README.md
- https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html

## Métricas e validação

Protótipo registra contagens totais/Diversos/ambíguos e distribuição por categoria, estágio, motivo e origem de cardinalidade fechada, sem rótulos de título/URL/ID/grupo. Percentual em Diversos usa somente o denominador processado; é taxa de abstinência, não acurácia. Integração futura deve emitir snapshots agregados pela telemetria oficial em batch, sem varredura ou nova query no hot path. Não foi ativada coleta produtiva.

Amostra real estratificada:40 títulos únicos selecionados entre Diversos persistidos em28/10BRT até o momento da consulta, por marketplace/origem, ordem md5 de historyId e teto18por estrato. Inclui Amazon, ML, Shopee e Magalu; cinco estratos marketplace/origem. Isso representa diversidade de nichos da workspace autorizada, não população de centenas de tenants. Corpus público antigo147 e fixtures anteriores complementam os controles; não foi reexecutada a coorte bruta antiga2000 indisponível.

Rotulagem:26curados pela natureza explícita/taxonomia existente e14null aguardando identidade/contexto. Não se assumiu que sair de Diversos é acertar. Rótulos foram revisados nesta auditoria, não são anotação cega independente. Na amostra: produção40Diversos/16indevidos rotulados; focal278:39/15; candidata:37/13. Acertos nos26rótulos:10→11→13. Nenhum falso positivo específico ou regressão observado nos rotulados; não é estimativa de erro global. Três mudanças:vara anterior+roteador+áudio; os outros13indevidos seguem para evolução semântica/evidência, não recebem regras de título improvisadas.

Snapshot agregado separado:404itens históricos com categoria não nula,43Diversos na consulta; não é dia fechado, não implica43produtos únicos nem acurácia. Não extrapolar a taxa para outros tenants ou todo o dia. Replay mantém contagens, coorte/hash, remanescentes, falsos positivos, casos sem rótulo e métricas por método. Testes usam marcas/modelos alternativos, madeira/organização, conflitos, atributos/descrição, CAS, expiração/revogação,100tenants com IDs iguais, quotas, privacidade e ausência de rede/disco.

CI/Guardião usam a base produtiva exata c9f81bae e conservam as quatro dívidas conhecidas (Radar dedupe, fidelidade Shopee, links AliExpress e templateResgate) sob comparação existente; não reduzir proteção ou chamar BASELINE_DEBT de PASS. Resultados finais e SHA serão entregues externamente após commit/CI, sem deploy ou restart.
