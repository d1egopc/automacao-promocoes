# Browser Extension

## Fonte oficial

- Fonte de desenvolvimento: subtree `optimus-capture` da main reconciliada do backend. Verifique sua tree Git e o `manifest.json` antes de empacotar.
- A tag `extension/v0.2.0` e o ZIP draft registram um artefato historico, nao necessariamente a tree mais recente da main ou a extensao instalada em cada navegador.
- Uma extensao unpacked observada no PC nao comprova distribuicao oficial. Nao substitua a subtree atual por copia antiga com o mesmo numero de versao.

Versao, tag, commit/tree, ZIP/hash e estado de distribuicao datados ficam no [EVIDENCE-REGISTER.md](EVIDENCE-REGISTER.md).

## Fluxos

- Captura da aba atual alimenta formulario editavel e Preview local.
- Preview e padrao da oferta; mensagem final usa o template do destino.
- Salvar no Optimus cria Oferta normal.
- `+ Lista` usa `origem="captura_extensao"`, insere diretamente na Lista, nao cria Oferta fantasma e nao entra no Auto Dispatcher.
- Oferta existente no painel usa o contrato legado `origem="ofertas" + ofertaId`.
- Enviar agora permanece uma acao separada.
- Idempotencia/dedupe deve impedir dupla escrita e duplo envio.

## UX e performance

- Mostre resumo, formulario e Preview assim que os dados basicos estiverem disponiveis.
- Conversao/afiliacao pode concluir assincronamente; bloqueie somente a acao que depende dela.
- Edicao do usuario e autoridade e nao pode ser sobrescrita por recaptura.
- Nao adicione request, timer, observer pesado, biblioteca ou imagem extra sem justificativa.
- Preview reativo deve ser DOM/CSS/local e sem request adicional.

## Marketplaces

Adapters oficiais: Mercado Livre, Amazon, Shopee, AliExpress, Magalu e KaBuM. Mudanca compartilhada exige smoke nos seis. Preserve os contratos em [MARKETPLACES.md](MARKETPLACES.md).

## Worker D1EGOPC — infraestrutura compartilhada da plataforma

Contrato confirmado pelo proprietário em 27/10/2026: a workspace D1EGOPC é pessoal e não é Admin Master. O PC/extensão autenticada pode atuar como infraestrutura técnica compartilhada para outros clientes. O usuário proprietário do Worker (`ownerId`), a workspace comercial (`job.cliente_id`) e o Admin Master são identidades distintas; não substituir uma pela outra.

A implementação existente usa o serviço/repositório `modules/local-worker` e o runner `optimus-capture/local-worker`. O servidor promove a Worker dedicado somente os owners explicitamente autorizados em `LOCAL_WORKER_DEDICATED_OWNER_IDS`, com capabilities e lease válidos; ser Admin Master não é requisito para esse papel técnico. Owners não autorizados permanecem community e não podem reivindicar essas tarefas. Não adicionar permissão administrativa para fazer a extensão funcionar.

O claim é global por capability, TTL e tentativas, com `FOR UPDATE SKIP LOCKED`. A imagem pública validada é armazenada no cache técnico por marketplace/produto e pode beneficiar vários jobs/workspaces. Isso não compartilha filas comerciais, credenciais, integrações ou provas de afiliação. Capacidades existentes incluem `magalu_image_v1`, `magalu_identity_v1`, `ml_image_v1` e `ml_identity_v1`, respeitando os respectivos contratos. Nenhuma capacidade adicional é liberada por esta documentação.

`LOCAL_WORKER_MAGALU_TECHNICAL_SLUG` é configuração técnica do caminho de obtenção da imagem Magazine Você; não é o promoterId comercial dos clientes. Um href da loja técnica pode integrar a prova de SKU/imagem. O adapter consome somente a imagem pública validada desse cache e resolve a afiliação com `getIntegracaoCliente(job.cliente_id, "magalu")`, gerando/validando a prova da workspace correta. Não copiar promoterId, tag, token, cookie, link comercial ou credencial pessoal D1EGOPC para a oferta de outro cliente. Link da loja técnica não é prova afiliada para outro cliente.

Preservar a ordem operacional existente: cache técnico válido pode ser reutilizado; quando não existe task pendente, o adapter tenta as fontes backend/factual/busca antes de solicitar o Worker de imagem. Uma task pendente evita refazer consultas remotas em cada retry. O runner autenticado processa as tarefas pelo mecanismo automático já existente, sem exigir abrir uma oferta manualmente. Falta de Worker/capability/configuração técnica não autoriza inventar imagem, ignorar prazo, contornar CAPTCHA ou usar afiliação estrangeira. Não criar segunda captura, fila comercial ou autoridade de produto.

### Proveniência comercial e limite atual de observabilidade

A origem comercial deve continuar identificada por `Engine evento → job.cliente_id → integração da workspace`, mesmo quando o recurso técnico é compartilhado. A implementação atual conserva esse vínculo nos jobs; `local_worker_tasks` e seu DTO **não têm** `clienteId`, `eventoId`, `jobId` ou lista persistida de solicitantes. Tasks/caches técnicos podem ser compartilhados por produto/URL, portanto não se deve atribuir a tarefa exclusivamente ao owner da extensão nem a uma workspace inferida.

Essa ausência é uma lacuna de correlação por solicitante, não uma comprovação de perda da identidade comercial no job. Não declarar que a identificação completa está persistida na task. Se for necessário rastrear todas as workspaces beneficiárias de uma mesma task, preparar separadamente a correlação mínima com os jobs existentes, preservando o compartilhamento técnico, a idempotência e os limites de leitura; nenhuma migração ou alteração runtime é autorizada por esta documentação.

No evento real Telegram 197029, o job 1007554 pertence a `user_pss60lus`; a task 27879 é `magalu_identity_v1`, com identidade validada e correlação por URL. Isso é compatível com infraestrutura técnica compartilhada e não com restrição à workspace D1EGOPC. A Telemetria consultada não expõe o owner do Worker executor, a task de imagem ou a afiliação final; não afirmar que aquele Worker específico foi executado no PC D1EGOPC sem essa evidência. Identidade concluída não confirma imagem nem conversão comercial.

Validação executável: `tests/local-worker-platform-architecture.test.cjs` exercita Worker pessoal dedicado sem papel Admin Master, claim global, uso da mesma imagem por dois clientes com afiliados distintos e rejeição da loja técnica como afiliado estrangeiro. Reutilizar também os testes existentes de autenticação, idempotência e suporte Mercado Livre. A versão de código testada não comprova a versão da extensão instalada no PC ou a configuração runtime atual.

## Magalu multiloja dinâmico

A afiliação comercial é obtida exclusivamente da integração da workspace solicitante. Slugs de lojas não formam uma allowlist de nomes no código: uma nova loja configurada deve usar o mesmo conversor existente, sem alteração de código ou deploy por cliente. Os exemplos d1egopc, loja_brnofertas e mariadasdores em testes são fictícios para parametrização, não prova de existência de loja ou comissão.

O Worker técnico compartilhado fornece identidade/imagem, nunca um afiliado universal. Workspace sem integração retorna integracao_ausente, sem herdar a loja técnica. Manter validação de host, produto, vendedor, loja esperada e prova por workspace, inclusive nos aliases antigos e na passagem OneLink → identidade canônica. Formato normalizado, link estrutural, página acessível, loja correta e comissão atribuída são níveis distintos de evidência. A prova efetiva de comissão exige confirmação externa e não pode ser presumida pelos testes.

## Empacotamento

Gere ZIP diretamente da tree comprovada. `manifest.json` fica na raiz. Exclua `.git`, testes, logs, backups, worktrees, tokens/cookies e temporarios. Calcule SHA-256, tamanho e contagem antes de submeter ao gate humano.
