# Preparação de infraestrutura exclusiva Garimpei — 28/10/2026

Tarefa: preparar bind diagnóstico, retenção física e guard do deploy; candidata base 711f864885710e03324735abbdef708d2f6f6d19.
Área: infraestrutura/observabilidade; risco nível 3 (metadados limitados e rollback conhecido).
Reversibilidade: código isolado; diretórios vazios permanecem sem efeito no backend; futura montagem é reversível pelo release overlay anterior.
Contratos: Deployment, Performance, Multi-tenancy, Telemetria Primeiro, sensor 24h e Guardião.
Persistência/dados: somente dois diretórios explicitamente autorizados no host, sem dado comercial; limpeza futura só do journal vencido.
Performance: nenhuma mudança na captura; limpeza oneshot a cada 5min, sem IA, rede ou consulta aos motores.
Superfícies: scripts de deploy/guard/cleanup, workflow e testes, modelos de Compose/systemd; módulos runtime imutáveis contra 711f8648.
Capacidade mínima segura: revisão de persistência e invariantes Compose/rollback.
Justificativa: evidência diagnóstica precisa sobreviver à recriação do container.
Escalar: mudanças comerciais, exclusão produtiva, infraestrutura além dos caminhos aprovados ou divergência de baseline.
Modo inicial: READ ONLY; criação dos dois diretórios somente após confirmação humana específica para o pai ausente.
Rollback: preservar backend-release.yml anterior e imagem ativa pelo ID; apenas backend pode ser recriado na aplicação futura aprovada.
Arquivos permitidos: scripts/deploy-backend-vps-manual.sh, scripts/guardian-v1.cjs, scripts/garimpei-{infra-guard,journal-cleanup}.py, workflows deployment/CI-only, testes de infraestrutura/deploy e documentação.
Áreas congeladas: todos os módulos runtime, index.js, Radar/Magalu/Shopee/RIO/Mensageiro/financeiro, sessões, grupos, dados, /data e PostgreSQL.
Decisão humana: instalação dos arquivos de infraestrutura, aplicação da montagem, publicação e ativação permanecem separadas. Preparar/CI não autoriza essas ações.

## Evidência produtiva desta preparação

SSH oficial autenticou srv1947615. Backend user node, UID/GID 1000:1000. Container ea263071b8e83224aac45da775d2518255b99254b8f56314f7c894eadb30e1f9 running, restart 0/OOM false, StartedAt 2026-10-28T17:25:42.129997856Z. PostgreSQL 0e54a0aa1673f9865516ed05c277a3a5f4831687cad2b9a3c111833583083af8 healthy.

Imagem ativa confirmada: sha256:ba5cbe934e2bff9ad1bbd4faa1e522739bd1c7a600025dc0f549ab4f0291b729. Tag Compose local/optimus-backend:12589a07843954fb6ea858f34da4c56861e64f8a-40735448758-1. Esta imagem é o rollback imediato de uma futura publicação sobre esta baseline. Imagem anterior adicional existente: sha256:076aeea89e6ba571ec671a17f1d9e3a2fa3ace64b3f971fc4d3616bfc19b6631, tag recovery 40735448758-1; não confundir com rollback imediato do próximo release. Ambas existem, comprovadas por docker image inspect. A tag recovery imutável da imagem atualmente ativa será criada/verificada pelo workflow oficial no preflight futuro; nenhuma tag foi criada nesta preparação.

Montagem atual única: bind /opt/optimus/data → /data, RW, rprivate. Compose efetivo sanitizado foi lido somente em memória, sem expor env/secrets. SHA-256 do JSON canônico cfca5e7d2dc2bc88064e495c8e10c1320437ea07f89ed30f2ad5c7fc3f0ff2d5.

Os caminhos /opt/optimus/observability e /opt/optimus/observability/garimpei-sensor não existiam. O proprietário autorizou explicitamente criar o pai adicional. Ambos foram criados com mkdir exclusivo, 0700, UID/GID 1000:1000, vazios. /opt e /opt/optimus foram validados como diretórios reais, sem links simbólicos; nenhum caminho existente foi sobrescrito/chmodado. Não houve escrita em /data ou banco, arquivo removido, nova montagem, aplicação do Compose, container/sessão reiniciados ou deploy.

## Delta Compose proposto

Aplicar somente mediante decisão futura, no overlay backend-release.yml gerado pelo deploy oficial; compose.yml base permanece intocado. Além da imagem versionada do release, o único delta autorizado é:

```yaml
services:
  backend:
    volumes:
      - type: bind
        source: /opt/optimus/observability/garimpei-sensor
        target: /var/log/optimus/garimpei-sensor
        bind:
          create_host_path: false
```

O Compose mescla volumes pela chave target, conservando /data. A fixture Linux usa docker compose config real para comprovar a mescla, sem criar containers. A mudança exige workflow_dispatch em main com novo input garimpei_sensor_mount=true; default false. O guard Python aceita apenas essa estrutura exata, sem duplicidade, outro path, read_only, propagação ou criação implícita. Mudanças de env, porta, rede, PostgreSQL ou mount existente falham fechadas.

O primeiro opt-in exige ancestry do sensor 711f8648, runtime journal presente, UID/GID 1000, diretórios reais/0700, e instalação dos scripts/units de retenção por hash exato, timer enabled/active. Não instala nem inicia systemd automaticamente. Futuro deploy sem opt-in conserva um mount aprovado já presente, mas continua exigindo igualdade integral do Compose além da imagem. Runtime mounts são comparados em lista exata permitindo somente a tupla adicional aprovada; se já instalado ou sem aprovação, continua fingerprint integral. Guardião e runtime allowlist continuam obrigatórios. Helpers Python são operações do runner/host, não copiados para a imagem como runtime.

## Retenção e limpeza física futura

Journal do sensor já limita escrita a 2MiB/600 linhas; fila bounded e esquema fechado. Retenção lógica de 72h desde start, sem renovação por leitura. A limpeza no processo segue a candidata homologada; o novo timer no host cobre crash/restart e recriação.

O arquivo docs/infra/garimpei-sensor-cleanup.service executa scripts/garimpei-journal-cleanup.py instalado em /opt/optimus/infra, como optimus, sem privilégios elevados, com ProtectSystem=strict e ReadWritePaths só do diretório diagnóstico. Timer OnBootSec=5min e OnCalendar=*:0/5, Persistent=true, AccuracySec=30s. Janela física: elegível após 72h da criação, removido no próximo ciclo de até ~5min30s quando host ativo; após host desligado, no primeiro ciclo após retorno. Nenhuma garantia de exclusão durante host desligado.

Script abre cada componente por descritor O_NOFOLLOW/O_DIRECTORY, valida owner/modo, abre somente sensor-v1.jsonl sem seguir links e exige arquivo regular, único hardlink, 0600, UID/GID esperado, tamanho <=2MiB, primeiro registro start válido, timestamp não futuro, prazo vencido e arquivo sem modificação recente. Reconfere device/inode/mtime antes de unlink exclusivo do nome fixo e fsync do diretório. Conteúdo desconhecido, symlink/hardlink, FIFO, permissões impróprias, oversize ou timestamp incoerente falham protegidos. Nunca recursa, segue caminho de payload, limpa backup ou remove diretório. Só testes descartáveis executaram exclusão; nenhum arquivo produtivo foi apagado.

Para instalar futuramente: operador administrativo copia por hash o script Python para /opt/optimus/infra/garimpei-journal-cleanup.py, owner root e modo 0644, units para /etc/systemd/system com root:root/0644; confere User=optimus UID1000 e Python3, systemd-analyze verify das units; somente após autorização, daemon-reload e enable --now do timer exclusivo. O usuário SSH atual não tem sudo não interativo; não contornar permissões nem pedir segredo em chat. Nenhuma unit/script foi instalada nesta preparação.

## Rollback e aplicação coordenada em etapas independentes

1. Revisar e aprovar SHA final desta infraestrutura; seu delta contra 711f8648 não altera runtime. Nenhum merge main foi realizado. A publicação futura precisa disponibilizar o workflow/guards revisados em main somente após aprovação específica; push main continua CI-only, publicação só workflow_dispatch.
2. Instalar retenção host e verificar hashes/timer, sem alterar mount nem container. Isso exige autorização própria de aplicação de infraestrutura e operador administrativo. Diretórios já preparados não ativam nada.
3. **Shopee primeiro, publicação independente:** partir da base publicada 12589a07 e portar somente marketplaces/shopee/importar.js e modules/engine/importer/adapters/shopee.adapter.js de 868a0cf2d176bb06c014443100b0384269d73016, com seus testes/documentos/gates. Novo SHA reconciliado deve preservar ancestry da main de aplicação. Guardião/CI específicos Shopee, input garimpei_sensor_mount=false, baseline/imagem real no momento, health e congelar. Rollback imediato é a imagem ativa anterior, identificada por ID/recovery tag. Não publicar sensor neste release.
4. **Sensor + infraestrutura depois, publicação independente:** criar novo SHA reconciliado sobre o release Shopee comprovado, incorporando apenas a observabilidade de 711f8648 e guards desta infraestrutura. O novo SHA deve preservar os dois arquivos Shopee byte a byte. Revalidar Guardião/CI e diff runtime (index.js, sonda, journal e operational-view), sem modificar comportamento comercial. Preflight renovado usa a imagem Shopee ativa como BASE_IMAGE, não a ba5c antiga. Opt-in de mount true somente nesta etapa aprovada; scripts/units por hash e timer exigidos. Publicar sensor OFF e conferir mount/env/PG/data/health.
5. Backup do backend-release.yml anterior ao release sensor conserva imagem Shopee e ausência do mount. Rollback oficial restaura o overlay anterior e recria apenas backend na imagem Shopee; o diretório/journal permanece no host para análise. Não apagar evidências ou retroceder banco. Em releases posteriores, rollback restaura exatamente mount anterior já presente. Nunca usar compose down ou reset Git.
6. Ativação do sensor somente por decisão posterior, Admin Master, POST /admin/radar/ingress-observation/sensor24h/start com confirm GARIMPEI_24H. Consulta sob demanda não renova janela. Se não houver Magalu natural, SEM_AMOSTRA. A infraestrutura não arma a flag.

Os SHAs 868a0cf2 e 711f8648 são fontes homologadas de deltas independentes, não promessa de que possam ser promovidos em sequência sem reconciliação. Nenhum cherry-pick/merge/rebase das candidatas foi realizado nesta preparação; conflitos de documentação/CI precisam ser resolvidos seletivamente na futura integração. Relatório de entrega registra SHA novo de infraestrutura, testes e CI.
