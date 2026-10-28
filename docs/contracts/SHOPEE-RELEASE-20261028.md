# Release Shopee — etapa 1 autorizada

Tarefa: publicação exclusiva da candidata 868a0cf2, seguida de saúde antes de qualquer sensor.
Área: importer/adapter Shopee. Risco 3, reversível por imagem anterior imutável.
Contratos: marketplaces, links/afiliacao multiworkspace, fidelidade comercial, performance e deployment.
Persistência: nenhum replay, migration ou alteração manual de dado; runtime normal conserva autoridades existentes.
Performance: budgets homologados de redirect/API, sem chamada nova no callback ou loop RIO.
Superfícies runtime: somente marketplaces/shopee/importar.js e modules/engine/importer/adapters/shopee.adapter.js.
Capacidade mínima segura: Sol Alto, publicação comercial delimitada com rollback conhecido.
Escalar/parar: primeira falha de gate, divergência da base publicada/imagem, health ou rollback indisponível.
Modo inicial: leitura, testes/CI, publicação manual oficial uma única vez.
Rollback: imagem ativa sha256:ba5cbe934e2bff9ad1bbd4faa1e522739bd1c7a600025dc0f549ab4f0291b729, Compose overlay anterior preservado pelo workflow.
Arquivos permitidos: delta homologado 868a0cf2 e documentação/CI-only deste release.
Áreas congeladas: sensor/infraestrutura nesta etapa; Mensageiro, V4, créditos, destinos, sessões, Radar, TeleRadar e RIO fora do adapter homologado.
Decisão humana: publicação coordenada explicitamente autorizada em 28/10/2026; ativação do sensor expressamente proibida.

Main remota conferida em 12589a07843954fb6ea858f34da4c56861e64f8a e imagem ativa correspondente confirmada. 868a0cf2 descende dessa base; nenhum delta runtime adicional é necessário para reconciliar. O novo commit de release altera somente este registro e a seleção da branch no CI-only. Os dois arquivos runtime conservam byte a byte o candidato homologado.

Os dois casos sem identidade factual permanecem bloqueados; os negativos do replay são gate obrigatório. Nenhum evento sintético será enviado ao ambiente produtivo. Recuperação comercial completa só pode ser afirmada com ingresso natural, RIO e ACK correlacionados; saúde/fixture não substituem essa prova.

Correção de contexto documental: o grupo Garimpei é WhatsApp na sessão admin_ZOIAO. A seção Telegram da documentação histórica SHOPEE-MAGALU-RECOVERY-20261028.md não é evidência desse incidente. A candidata Shopee não altera Magalu nem TeleRadar; o sensor será uma etapa independente após saúde desta publicação.
