# Links — reconciliação final, sem publicação

Tarefa: reconciliar a candidata histórica de Links com a base publicada.
Área: administração e resolvedor de redirects. Risco: nível 3 (rede, identidade e isolamento).
Reversibilidade: branches isoladas; nenhuma publicação autorizada nesta missão.
Contratos: LINKS-MEDIA, MARKETPLACES, MULTITENANCY, PERFORMANCE, COUPONS,
INGRESS-RADAR-CLONADOR, PRODUCTION-DEPLOYMENT.
Persistência/dados: testes temporários; nenhum registry, arquivo ou banco produtivo alterado.
Performance: 4,5 s por resolução, orçamento compartilhado entre camadas; autorização
revalida dois exemplos sequencialmente, podendo consumir dois orçamentos.
Superfícies: rotas Links já montadas, helpers factuais reutilizados, tela Links e CI-only.
Capacidade mínima segura: alta, por SSRF/identidade/multiworkspace.
Justificativa: frontend publicado chama inspect/authorize ausentes no backend publicado.
Condição para escalar: mudança comercial, credencial ou aplicação produtiva necessária.
Modo inicial: leitura de Telemetria, Git remoto, deployment e imagem; depois candidata local.
Rollback: imagem/deployment atuais preservados, com registry version 1 compatível.
Arquivos permitidos: delta histórico de Links, helper factual Amazon aditivo, documentação,
testes e gates adicionais. Nenhuma alteração em index.js ou nos demais motores.
Áreas congeladas: sensor Garimpei, WhatsApp, Shopee comercial, Radar/TeleRadar comercial,
Mensageiro, Classificador, RIO, ACK, destinos, env, mounts, /data e PostgreSQL.
Decisão humana necessária: publicação futura e uso produtivo dos controles administrativos.

## Inventário comprovado em 28/10

Backend main remota/base: c9f81baeeaf966fc581b8310d70c0f54ed90fa46.
Imagem: sha256:3c07f90ab82b26248802d089199e0e64a7f62defe89df8dc0e516c0822a455b1.
Frontend main/deployment Production: e576c1878b37682a50d8aa9263669ee7958a1ef5,
deployment GitHub 7392648250, status success.

Os módulos dynamic-resolver-admin.routes.js e engine-capture-diagnostic.routes.js
estão na imagem e são montados em /admin/links/resolvers e /admin/links/engine-eventos
sob exigirAdminMasterEstrito. Existem listagem, cadastro legado, discover, drafts,
teste, engine-preview, debug, ativação legada e exclusão. O diagnóstico de evento
filtra o cliente na própria query e não prova afiliação ou identidade só com redirect_ok.

Faltam no backend publicado: POST /inspect, /investigations e /drafts/:id/authorize.
O frontend publicado já referencia /inspect e authorize: incompatibilidade de versões,
não motivo para reescrever a tela ou seus módulos existentes. Não foram executados
POSTs administrativos produtivos para testar cadastro, autorização ou preview.

Registry produtivo lido: seuhardware.com ativo legado, desc.vc e ofertou.me ativos
homologados. Estar ativo não comprova destino final ou identidade em todos os links.

## Reconciliação seletiva

Backend histórico: c261b44909709b02bb7aa03021d1cb1c263a8c1b, formado pelos commits
d225b640f7aa1312a88d64ee0dd19152f090fb4b,
b5c5083563026e01d7a4451d3dce297e62f96c82 e c261b449.
Frontend histórico: 528104eb80fa75e6f243e3230d1e17d1327300e3, com 33846fb e 528104e.
Reaplicado somente o delta desses commits nas bases atuais; workflows atuais preservados.
Não copiar o snapshot inteiro das candidatas antigas: ele omite missões posteriores.

Inspeção usa o resolvedor universal com opt-in administrativo explícito. Reutiliza
HTTP seguro, parsers, contratos factuais e cache oficial já existente. Não cria Worker,
converte afiliação, executa JavaScript remoto, captura oferta ou altera fila.
Comercial sem opt-in preserva seu fluxo anterior; não habilita camadas extras automaticamente.

Cadastro de família nova exige dois exemplos distintos, atuais, mesmo host/prefixo/mode,
mesmo método e marketplace, com produto identificado. Rascunhos/investigações ficam
inativos; PATCH não promove rascunho. Investigações são sanitizadas e restritas ao
operador autenticado; allowlist operacional não inclui investigações pendentes.
Parâmetro de URL, shortlink intermediário, host conhecido e HTTP 200 não são prova de produto.
Família aprendida continua entregando candidato ao fluxo comercial existente; homologar
um redirect não é autorização afiliada nem garantia de publicação/ACK.

## Evidência real adicional — DescontosTop

Exemplo público fornecido pelo proprietário usa desc.vc. Em consulta local limitada,
sem API produtiva, a candidata seguiu desc.vc → descontostop.com → www.awin1.com →
www.kabum.com.br. HTTP 200 final com jsonld_product_url_factual e identidade sanitizada
48268ff55dc95620. Mercado/canal: AWIN, produto KaBuM. Afiliação: não comprovada.
A execução local da versão publicada expirou em 4,5 s; uma comparação de rede isolada
não estabelece ganho de desempenho nem falha permanente do serviço produtivo.

O manifesto histórico de 40 exemplos é evidência sanitizada anterior, ligada a hashes
exatos dos resolvedores. Seus números não são replay novo da main atual nem garantia
de disponibilidade atual dos domínios. OneLinks Magalu permaneceram com 403 nessa
amostra; não existe autorização para contornar CAPTCHA ou proteção de rede.

## Gates e publicação futura

Guardiões/gates só recebem cobertura adicional; nenhuma allowlist de deploy é afrouxada.
CI backend Linux/Node24 usa o fluxo CI-only existente. Frontend usa workflow CI-only
novo e git.deploymentEnabled=false exclusivamente na branch de validação Links, para
não gerar Preview automático. As configurações das demais branches e runtime nodejs22.x
do frontend são preservadas. Não há token de deploy ou action de Vercel no workflow.

Na preparação local, 39 suítes em Node24 produziram 35 PASS e 4 BASELINE_DEBT,
confirmadas pela mesma asserção/local na base: engine-v2-marketplaces-fidelidade,
link-conversao-ocorrencia-marketplaces, template-universal-visual-contract e kabum-hotfix.
Isso não é homologação integral limpa nem autorização para corrigir áreas congeladas.
Resultados finais, SHAs novos e CI devem acompanhar o relatório externo da missão.

Publicação futura: aguardar encerramento da observação Garimpei e decisão explícita;
revalidar main/imagem/mounts/rollback e os débitos; promover backend primeiro pelo
deploy manual oficial com os sete arquivos runtime exatos do plano Guardião; comprovar
rotas administrativas sem gerar oferta; depois obter autorização de Preview frontend,
validar interface e promover o mesmo SHA aprovado. Não fazer deploy do frontend antes
de o backend oferecer os endpoints que a tela exige.

Rollback backend seleciona a imagem atual preservada sem trocar volumes/env/sessões.
O registry mantém schema version 1; investigações são persistidas inativas em formato
compatível com o leitor anterior. Nenhum cadastro legado é migrado/ativado no deploy.
Rollback frontend retorna ao deployment e576c187. Prova de comissão exige a integração
da workspace e evidência comercial própria; nem inspeção, nem identidade, nem ACK isolado
substituem a comprovação afiliada.
