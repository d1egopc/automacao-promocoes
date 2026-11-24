# Optimus VPS Maintenance V1

Implementação candidata para ambiente descartável. O contrato de produção [PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md) e o contrato [PRODUCTION-READONLY-OPERATIONS.md](PRODUCTION-READONLY-OPERATIONS.md) continuam em vigor.

## Descoberta e comandos

O operador provisiona duas identidades SSH e associa aliases locais distintos, por exemplo `optimus-audit` e `optimus-release`. Os aliases não usam o usuário SSH operacional genérico. A distribuição das chaves e do fingerprint de host ocorre fora do Git. Uma sandbox verifica o fingerprint, usa BatchMode e conhece a finalidade do alias antes de chamar o servidor.

```text
ssh -o BatchMode=yes optimus-audit  "jobs <workspace> 60 20"
ssh -o BatchMode=yes optimus-audit  "funil <workspace> 60 120"
ssh -o BatchMode=yes optimus-audit  "logs <workspace> 30 20"
ssh -o BatchMode=yes optimus-audit  "work <workspace> 60 20"
ssh -o BatchMode=yes optimus-audit  "acks <workspace> 60 20"
ssh -o BatchMode=yes optimus-release "preflight <release-id>"
ssh -o BatchMode=yes optimus-release "deploy <release-id>"
ssh -o BatchMode=yes optimus-release "status current"
ssh -o BatchMode=yes optimus-release "status <operation-id>"
ssh -o BatchMode=yes optimus-release "recover <operation-id>"
```

## Instalação de referência

A instalação é responsabilidade do operador após homologação. Use uma conta distinta por chave e papel. O administrador configura `ForceCommand /usr/local/bin/node -- /opt/optimus-maintenance/ops/maintenance/entry.cjs audit` ou `deploy` por conta, `DisableForwarding yes`, `PermitTTY no`, `PermitUserEnvironment no`, chaves individuais gerenciadas pelo administrador, host key verificada e sem autenticação por senha para os perfis. Os perfis ficam fora do grupo Docker e sem outras regras sudo. O único comando sudo, apenas para o perfil de release, tem caminho e argumentos exatos de `entry.cjs` para invocar `broker.cjs`, sem argumentos adicionais. Use `NOSETENV`, `env_reset`, sem variáveis Node, Docker ou Compose herdadas. Código, binários, chaves autorizadas, dependências, configs, diretório Compose, lock e journal ficam sob controle de contas confiáveis, sem escrita pelos dois perfis.

- O arquivo root-owned `/etc/optimus-maintenance/audit/<login>.json` é legível somente pela conta de auditoria designada. Campos `principal`, `workspaces`, `salt` aleatório de 64 caracteres hex e `databaseUrl` de credencial PostgreSQL com apenas SELECT nas colunas usadas. A senha é injetada pelo operador fora do repositório. Cada consulta usa SQL parametrizado, limite de 120 resultados e 24 horas, transação READ ONLY e timeout de 2 segundos. `funil` resume o conjunto de jobs limitado pela consulta. `logs` significa eventos estruturados de processamento vinculados ao job, com códigos selecionados. `work` cobre o vínculo persistido de identidade Magalu e não enumera tarefas compartilhadas. `acks` exige status enviado, confirmação persistida e identificador não vazio do provedor. Uma linha ausente significa evidência não observada.
- O arquivo root-only `/etc/optimus-maintenance/deploy.json` contém `principals`; `policy` com `purpose`, `profile` e `requiredChecks` incluindo `golden`; e `host` com `directory`, `project`, `backend`, `postgres`, `httpPort`, `controlImage`, `controlNetwork` e `fenceDbUrlFile`. Os nomes e a rede são fixos pelo administrador. O secret da fence fica em arquivo root-only, fora do contexto de build, e chega por stdin a um container de comando descartável executado a partir de imagem de controle fixada por ID, sem volumes produtivos. A conta de banco da fence deve ter escopo de leitura, locks e atualização somente das colunas necessárias ao serviço transacional. PostgreSQL exige privilégio UPDATE em ao menos uma coluna para SELECT FOR SHARE. A concessão exata exige revisão e prova no lab. A V1 utiliza a mesma máquina da fence e seu trigger; o canal SSH não cria usuário, token Admin Master ou rota HTTP. A chamada HTTP Admin Master continua independente e não pode encerrar uma geração pertencente à V1.
- O broker lê `/etc/optimus-maintenance/release-approval.pub.pem` e `releases/<id>.json`. O envelope contém `payload` e `signature` em Base64, com assinatura Ed25519 sobre os bytes JSON do payload. O aprovador independente confere a execução oficial do Guardian/CI, Golden, diff de runtime e imagens antes de assinar. O payload inclui `version=1`, `id`, `sourceSha`, `baseSha`, `purpose`, `profile`, `runtimeFiles`, `approvedAt`, `expiresAt`, `base` e `candidate` com `ref`, `digest` OCI e `imageId` do Docker. `gates` liga `sourceSha`, `baseDigest`, `candidateDigest`, `runId`, `runtimeDiffVerified=true` e `results` por check. Apenas resultados assinados `pass` no conjunto exigido habilitam deploy. A credencial que solicita deploy não aprova releases.
- O lock é `backend-release.lock` no diretório do Compose. `/var/lib/optimus-maintenance/current.json` mantém o último ID e a recuperação, com escrita atômica e fsync. O sistema envia registros estruturados para `logger`, tag `optimus-maintenance-v1`. Configure armazenamento persistente, acesso restrito e retenção. O broker registra cada fase; o histórico completo reside no journal do sistema.

## Drenagem, troca e falha

O preflight verifica a configuração do backend rodando e a diferença de Compose, que se restringe ao digest selecionado. Verifica também a resolução local e o protocolo de manutenção nos dois digests. A admissão é drenada pela fence até zero claims e zero envios iniciados. A autoridade de finalizar é a operação que possui a geração, identificada na linha da fence sob lock da transação. Com `DRAINED` comprovado, o broker fixa a candidata, recria apenas o serviço backend com `--no-deps --no-build` e aguarda saúde. Saúde exige digest, Compose, uma instância, HTTP 200, o mesmo PostgreSQL saudável, mounts, env, ausência de OOM e de restart. Só então a operação libera e confirma `OPEN`.

Em desconexão ou timeout, consulte `status current`. Enquanto o lock estiver ocupado, a primeira execução ainda é dona da operação. Em estado pendente, use `recover <operation-id>`. Se a drenagem ainda não foi gravada, a recuperação encerra a tentativa. Se a fence segue fechada, recupera o digest anterior saudável e libera a mesma geração. Se houve liberação antes de a resposta chegar, comprova o digest selecionado e registra o resultado sem nova transição. Divergência, container inesperado ou saúde inconclusiva mantém o gate fechado. Não manipular leases, ACK, fila, dedup ou registros ambíguos.

## Homologação

`ops/maintenance/lab/compose.yml` usa Node 24 e PostgreSQL 17, não publica portas e guarda PostgreSQL em tmpfs. Use somente um daemon descartável, com nome de projeto exclusivo e sem credenciais da VPS:

```sh
docker compose -p optimus-maintenance-lab -f ops/maintenance/lab/compose.yml up --abort-on-container-exit --exit-code-from tests
docker compose -p optimus-maintenance-lab -f ops/maintenance/lab/compose.yml down
```

O lab roda os testes unitários da V1, a prova PG17 existente da Claim Fence e os testes PG17 de auditoria e validade atômica de proprietário/epoch/geração. A aprovação para ativação exige, além disso, rodar em host descartável os testes da combinação OpenSSH + sudo restrito + broker real + Docker Compose, com imagens de teste aprovadas. Exercitar chaves trocadas, shell/forwarding negados, concorrência com o publicador legado, queda de SSH antes e depois de drain/troca/release, candidata sem saúde, rollback com o backend parado, recuperação com ACK factual, logs persistentes e recusa de release sem Golden. Os testes unitários de desconexão e falha simulam essas fronteiras e não substituem essa aceitação.

## Primeira ativação e rollback da infraestrutura

1. Aprovar e testar separadamente o SHA da instalação, requisitos dos papéis de banco e o pacote root-owned. Homologar os dois perfis em ambiente descartável. Congelar o digest do controlador e validar que o processo legado consegue recuperar a primeira instalação.
2. Em autorização posterior, preparar contas, aliases, regras, verificador e journal com o caminho V1 desabilitado. A primeira troca pode usar o procedimento administrativo homologado. Durante essa estreia, conservar o acesso legado para liberar uma volta à imagem pré-V1. Ativar a V1 apenas quando a imagem de base e o rollback V1 forem compatíveis com o protocolo.
3. Para recuar a infraestrutura, revogar a chave de publicação e verificar o lock e a operação atual. Se houver operação ativa, terminar ou recuperar pelo broker que a iniciou antes de remover seu controlador. Com fence OPEN, desativar os perfis, restaurar regras/serviços versionados anteriores e preservar journal, configs de rollback e chaves verificadas de recuperação. Retomar o fluxo anterior apenas após validar saúde. Revogar os acessos de banco e SSH instalados pela V1 em autorização separada.

**Riscos residuais.** O cliente de auditoria confia no administrador que instala os escopos e a credencial; a segregação é aplicada no servidor, sem prometer RLS nativa. Assinatura comprova a aprovação do artefato pelo aprovador independente; exige proteção e revogação da chave fora do Git. A V1 depende de operação exclusiva com o lock compartilhado, controle do socket Docker pelo host e da retenção do journal. Falha simultânea do PostgreSQL ou do controlador exige recuperação explícita. Nenhum arquivo de configuração deste contrato concede acesso por si só.
