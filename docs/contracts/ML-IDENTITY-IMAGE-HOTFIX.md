# Imagem oficial ML Identity — hotfix focal

Tarefa: reconciliar a prova de imagem ml_identity_v1 com o resolvedor existente. Área: validação de imagem/Worker técnico. Risco: alto na fronteira de confiança, moderado operacionalmente; reversível por candidata isolada. Base publicada b8f5746e4d562deaa5c4081738de89e0bf5fc508, imagem registrada sha256:0c5a304fea3b5873eb7eb61be181be25a73a281b5d62dd34c5b694b0d8b1aa96. Main reconfirmada via GitHub antes da implementação. Sem deploy autorizado nesta missão.

Persistência: usa os campos JSON de prova já existentes, sem schema ou migração; nenhum dado produtivo alterado. Performance: somente validações locais limitadas; nenhuma nova consulta HTTP, DB, arquivo, listener, fila ou timer. Superfícies runtime: contrato ML Identity, serviço Worker existente, projeção sanitizada de sua prova e helper universal de imagem. Áreas congeladas: captura Radar/TeleRadar, distribuição, Executor/RIO, templates/OFC, preços, cupons, categorias, destinos, crédito, afiliação, frontend e extensão. Escalar somente se houver regressão ou necessidade de mudar esses contratos. Rollback pré-release: manter/reverter a candidata isolada; futura publicação requer preflight e autorização próprios.

## Evidência histórica

Auditoria autorizada somente leitura de user_pss60lus em 27/10/2026 confirmou quatro ofertas/14 alvos/zero ACK, correlacionados por historyId → universal_item_id/source_key → queue → evento/job/oferta:

- Rede Covo: history97069, oferta168013, evento197833, MLB68604345, três falhas.
- Chico Bento: history97108, oferta168048, evento197850, MLB55696570, quatro falhas.
- Marine: history97184, oferta168104, evento197882, MLB53231644, três falhas.
- Le Beau: history97279, oferta168157, evento197919, MLB19457568, quatro falhas.

Workers de identidade e imagem concluíram antes das ofertas; resultado de identidade com expectedMlb=observedMlb, sameProductObject e jsonld.image/mlstatic. Oferta persistida tinha imagem oficial; snapshot de fila perdeu a imagem após reprovação de publicabilidade. O helper reconhecia ml_image_v1, não localWorkerIdentityProof. Os controles history97022 e history97114 usaram ml_image_v1 e tiveram seis ACKs. Não reexecutar esses eventos produtivos.

As fixtures guardam IDs e fatos sanitizados; URLs, timestamps frescos e assinaturas dos testes são simulados. PASS isolado não é novo envio real nem prova de recuperação retrospectiva.

## Fronteira de confiança

Não foi adicionado um simples reconhecimento de string. Depois da validação autenticada da task/produto e do HTTP de imagem oficial já existente, o **backend** emite recibo HMAC com separação de domínio `optimus.ml_identity.image.v1`, usando JWT_SECRET já existente, sem copiar ou expor seu valor. Não é token de autenticação nem nova permissão. O recibo vincula MLB, URL da imagem, coleta e expiração; não contém afiliação, credencial, sessão ou conteúdo comercial.

O cache técnico confiável, lido pelo serviço backend já existente, pode emitir recibo para entradas antigas somente após revalidar o contrato e a evidência HTTP que o backend originalmente persistiu. Não há nova requisição HTTP nessa leitura. Metadados públicos, DTOs de cliente ou resultado bruto da extensão não emitem recibos. Sem chave ou validação HTTP, a prova de identidade pode continuar disponível para os usos existentes, mas não libera a imagem pelo novo caminho.

Validade máxima de 24h desde a coleta, alinhada ao cache de identidade atual, limitada também pela expiração original do cache. O resultado bruto do Worker continua sujeito à validação de dez minutos no ingresso. Releitura não renova a coleta nem estende o prazo. Cache expirado é recusado. Rotação/ausência da chave falha fechado. Snapshots antigos sem recibo não são liberados retroativamente.

O helper confere assinatura, validade, versão/capability, origem jsonld.image, sameProductObject, expected/observed MLB, IDs e URLs canônicas disponíveis e a imagem exata assinada. Não basta host mlstatic. Divergência, URL externa, prova ausente/falsa/expirada, marca de fonte e proveniência de Radar/Telegram/WhatsApp permanecem bloqueadas. Rótulo legado não resgata uma prova de identidade inválida. Suporte ml_image_v1 e og:image permanece no caminho existente.

A projeção sanitizada de enriquecimento preserva apenas o recibo já verificado pelo contrato. O resolvedor não altera dados comerciais e não chama o Worker. A avaliação sem candidato usa a prova da imagem-base; não fabrica um segundo candidato vazio e sem URL.

## Homologação

tests/ml-identity-image-publicability.test.cjs valida os quatro formatos históricos no caminho Worker → enriquecimento → montarItemFilaEngine real → imagemFontePublicavel real. Negativos incluem divergência de MLB/URL/marketplace, assinatura falsa, prova expirada, proveniência sem recibo, imagem não oficial, foto de grupo/marca, versão incompatível e Worker não autorizado. HTTP403 não assina; cache sem validação HTTP não assina; ausência de chave não derruba o serviço.

Teste antigo ml-work-enrichment-active exigia que JSON diagnóstico sem recibo fosse publicável. Essa assertion foi explicitamente substituída pelo bloqueio obrigatório; o novo E2E comprova o caminho positivo assinado. Não foi removido nenhum teste de identidade ou de fidelidade comercial.

O teste imagem-candidatos-universal falha também na base exata b8f5746e na expectation de preservar radar.jpg; isso permanece dívida anterior e não é relaxado para liberar mídia de Radar. Guardião compara baseline/candidata e mantém obrigatório o novo teste focal. CI oficial existente é Linux/Node24 e CI-only na branch isolada.

Benchmark é local/sintético: validações da nova prova medem custo CPU limitado, sem I/O, SQL ou rede; não se afirma custo CPU zero nem melhoria de performance produtiva. Nenhum novo trabalho periódico no RIO.

Não houve merge, deploy, replay, envio de mensagem, alteração de destinos ou nova captura. A publicação e a comprovação de uma oferta nova serão avaliadas separadamente.
