# Release sensor Garimpei OFF sobre Shopee publicada

Tarefa: etapa 2 da publicação coordenada autorizada pelo proprietário, sem ativar sensor.
Área: observabilidade/infraestrutura exclusiva; risco 3; reversível por imagem Shopee e overlay anterior.
Contratos: sensor24h, infraestrutura ee8f5636, deployment, multiworkspace e performance.
Persistência: somente bind diagnóstico fora de /data; schema/PostgreSQL intocados, nenhuma limpeza comercial.
Performance: budgets/timers existentes homologados; flag inicia false e não inicia captura no boot/deploy/GET.
Superfícies: quatro runtime paths homologados e workflow/guards de infraestrutura já aprovados.
Capacidade mínima segura: revisão de isolamento, mounts e rollback.
Escalar/parar: primeira falha de gate, hashes, infraestrutura, saúde ou rollback; nenhuma correção comercial lateral.
Modo inicial: confirmação read-only da instalação administrativa; testes/CI; deploy manual uma vez, se aprovado.
Rollback: imagem Shopee sha256:aaf3a2d7c73047a62cc259da9e9258c8e8ec51005dc448e5669a6fcc2cab10d1 e backend-release.yml anterior, ambos preservados e verificados no preflight.
Arquivos permitidos: delta aprovado ee8f5636 sobre main58ac3d19, resolução somente CI e este registro.
Áreas congeladas: arquivos runtime Shopee, Mensageiro, RIO, Radar comercial, TeleRadar, destinos/créditos, sessões, /data e PostgreSQL.
Decisão humana: publicação autorizada; instalação administrativa confirmada pelo proprietário; ativação expressamente proibida.

Preflight da retenção: três hashes instalados coincidem exatamente com ee8f56360e8e943ada9ba360566ef12b2bf107d7; timer enabled/active, service Result=success/ExecMainStatus=0, User/Group optimus; diretório 0700/1000:1000. Nenhum segredo fornecido ou permissão contornada.

Reconciliação preserva ancestry de 58ac3d19840bb25c8f72bb29e5ac60128a148bd4 e de 711f864885710e03324735abbdef708d2f6f6d19. Os dois runtime Shopee permanecem byte a byte 868a0cf2. Index/sonda/journal/operational-view, helpers e units conservam integralmente ee8f5636. Conflito somente em workflow CI-only, resolvido pela união dos gates e etapa focal da branch reconciliada.

O único opt-in de mount é o bind exato /opt/optimus/observability/garimpei-sensor → /var/log/optimus/garimpei-sensor, create_host_path=false. Deploy não altera env, /data ou outro mount. Retenção lógica72h e timer host a cada5min foram homologados anteriormente e são revalidados por CI Linux nesta etapa. Ausência de amostra natural não é falha.

Após publicar, comprovar health, quatro hashes, dois hashes Shopee, mount/env/PG/core, recovery e flag false. Nenhum POST de start da sonda será executado. Consulta após2h sem renovar24h permanece validada em fixtures; nenhuma janela será aberta para provar isso produtivamente.
