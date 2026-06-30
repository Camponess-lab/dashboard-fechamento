# Análise Técnica — Sistema de Fechamento Gerencial (Google Apps Script)

> Revisão de engenharia do backend (`Code.gs`) e do front-end (`index.html`) do
> sistema de Fechamento Gerencial (Sortation Center / Mercado Livre).
> Objetivo: avaliar o estado atual e elevar o nível profissional do código —
> corrigindo defeitos seguros agora e mapeando as melhorias maiores que exigem
> teste no ambiente publicado.

Data da revisão: 2026-06-30 · Escopo: `apps-script/Code.gs` (1.609 linhas) e `apps-script/index.html` (5.024 linhas).

---

## 1. Visão geral da arquitetura

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Apresentação | HTML + CSS + JS puro (HtmlService) | Painel operacional, login, prévia/PDF |
| Backend | Google Apps Script (`Code.gs`) | Autenticação, CRUD de fechamentos, auditoria |
| Persistência | Google Sheets (`FECHAMENTOS`, `AUDITORIA`) | Registro definitivo (1 linha por fechamento; JSON completo na coluna 19) |
| Rascunho | `localStorage` do navegador | Edição offline / recuperação entre recargas |
| Resiliência | Script "watchdog" (IIFE separada) | Re-renderiza o painel caso o carregamento principal falhe |

Comunicação front→back via `google.script.run`; sessão por **token** guardado no
`CacheService` (TTL de 6 h) e espelhado no `sessionStorage`.

---

## 2. Pontos fortes (já em nível profissional)

O sistema **não** é um protótipo — há decisões maduras que merecem registro:

- **Autenticação server-side robusta:** senhas em SHA-256 **com salt**
  (`passwordHash_`), nunca em texto aberto; o token de sessão não é derivável do
  cliente (`usuarioFromAuth_` exige token gerado pelo login).
- **Defesa contra força bruta:** throttle de 7 tentativas e bloqueio de 15 min
  (`registerFailedLogin_`, `getLoginBlockedMessage_`).
- **Política de senha forte** no servidor: mínimo 8, letras+números, proíbe login
  na senha, senhas comuns, repetição e histórico das 3 últimas
  (`validatePasswordStrength_`).
- **Primeiro acesso obrigatório** com troca de senha provisória.
- **Trilha de auditoria** (`auditLog_`) para login, CRUD e administração.
- **Concorrência:** `withScriptLock_` em todas as gravações críticas.
- **Anti-injeção de fórmula no Sheets** (`safeCell_`) — detalhe que muitos
  esquecem.
- **XSS:** todo dado dinâmico passa por `escHtml` antes de ir ao `innerHTML`.
- **Clickjacking:** `X-Frame-Options` desligado por padrão (`ALLOW_IFRAME_EMBEDDING`).
- **UX/Acessibilidade:** `aria-*`, `role`, aviso de Caps Lock, `prefers-reduced-motion`,
  layout responsivo e pipeline de PDF A4 com auto-ajuste de escala.

---

## 3. Correções aplicadas nesta entrega

Foram aplicadas apenas mudanças **seguras** (sem alterar lógica de negócio nem o
contrato `google.script.run`), porque o sistema depende do runtime do Apps
Script e não pode ser testado fora dele.

| # | Arquivo | O quê | Por quê |
|---|---|---|---|
| 1 | `index.html` · `submitInitialPasswordChange` | Validação do cliente alinhada ao servidor: mínimo **8** caracteres + exigir **letras e números** (antes: só `< 6`) | Evita o usuário ser aceito no cliente e **rejeitado** pelo servidor (`validatePasswordStrength_`), num vai-e-volta confuso no primeiro acesso |
| 2 | `index.html` · `renderHistory` | Botão **Excluir** do histórico só aparece para `admin` | `deleteFechamento` exige admin (`requireAdmin_`); o operador via um botão que **sempre** falhava com "Acesso negado" |
| 3 | `index.html` (CSS header) | Comentário do tema corrigido (acento **amarelo MELI**/azul, fontes do sistema) | Documentação dizia "acento laranja" e fontes Sora/Inter/JetBrains que **não** são usadas |
| 4 | `index.html` (mensagens de prévia/exportação PDF/PNG) | Acentuação correta em textos exibidos ao usuário ("Não foi possível", "prévia", "página", "técnico", "automático", "impressão"…) | Mensagens sem acento passam impressão de descuido ao usuário final |
| 5 | `Code.gs` (50 mensagens) | Passada completa de acentuação em mensagens de erro/validação e textos de auditoria (sessão, login, senha, planilha…) | Eram exibidas ao usuário via `withFailureHandler` e gravadas na aba `AUDITORIA` sem acento |
| 6 | `index.html` (login) | Remoção de **código morto** (`getLocalLoginUsers`, `saveLocalLoginUsers`, `checkLocalLogin`, `saveUserLocal`, `deleteUserLocal`, `DEFAULT_LOGIN_USERS`) e simplificação de `editUserFromAdmin` | Stubs neutralizados que só poluíam o arquivo; `editUserFromAdmin` passa a usar apenas `usersAdminCache` |
| 7 | `index.html` (watchdog) | `DEFAULT_INTERNAL`/`KPI_ROWS`/`STATUS_OPTIONS` passam a **reutilizar** `DEFAULT_DATA`/`kpiConfig`/`statusOptions` do script principal, com as cópias locais como *fallback* | Acaba com a divergência silenciosa entre as duas cópias; pior caso (principal não inicializa) = comportamento atual |
| 8 | `Code.gs` + `index.html` (P0-4.1) | **Remoção de PII/hashes do fonte**: `DEFAULT_LOGIN_USERS_SERVER` esvaziado; novo `seedInitialAdmin()`/`setupPrimeiroAdmin()` (salt aleatório); "Resetar senha" do admin religado para `resetUserPassword` (provisória forte gerada/mostrada); máquinas de senha-padrão mortas removidas | Tira nomes reais + hashes (com salts previsíveis) do código-fonte sem expor credenciais; produção segue funcionando (usuários já no `PropertiesService`) |

> Nenhuma alteração foi feita em identificadores, chaves de comparação
> (ex.: `id="previa-pdf"`, status `Controlado/Saturado/...`) nem em hashes/salts.
> Validação: `Code.gs` e os dois blocos `<script>` do `index.html` continuam com
> sintaxe íntegra (parse via Node).

---

## 4. Achados e recomendações priorizadas

### P0 — Segurança / dados sensíveis

**4.1 PII + material de credencial no código-fonte.** ✅ *Resolvido em §3.8.*
`DEFAULT_LOGIN_USERS_SERVER` foi esvaziado (sem nomes nem hashes). O primeiro
admin agora é criado por `setupPrimeiroAdmin()`/`seedInitialAdmin()` com
`setUserPassword_` (salt aleatório), e o "Resetar senha" usa `resetUserPassword`
com senha provisória forte. A produção segue funcionando (usuários já no
`PropertiesService`).
- *Resíduo:* os hashes antigos **permanecem no histórico do Git**. Para zerar o
  risco, rotacione pelo botão **Resetar senha** as provisórias ainda não trocadas
  (e, se desejado, reescreva o histórico do repositório — fora do escopo aqui).

**4.2 Rascunho operacional em terminal compartilhado.**
`logoutApp` limpa as chaves de sessão, mas **não** o rascunho (`STORAGE_KEY`) no
`localStorage`. Em PCs compartilhados, o próximo usuário enxerga o fechamento do
anterior.
- *Recomendação:* opção "limpar rascunho ao sair" (ou namespacing por usuário).

### P1 — Manutenibilidade / robustez

**4.3 Duplicação script principal × watchdog — maior dívida técnica.** *(dados resolvidos; render pendente)*
Os **dados** (`DEFAULT_DATA`, `kpiConfig`, `statusOptions`) agora têm fonte única:
o watchdog os reutiliza do script principal (correção §3.7), eliminando a
divergência silenciosa mais provável. **As funções de render continuam
duplicadas** (~200 linhas) — propositalmente, pois são a rede de resiliência do
watchdog. Unificá-las (seção 5) exige teste no Web App publicado e foi deixado
para uma etapa com validação ao vivo.

**4.4 Código morto de login local.** ✅ *Resolvido em §3.6.*
Stubs removidos e `editUserFromAdmin` simplificado para usar `usersAdminCache`.

**4.5 CSS com duas camadas de cascata.**
Há um bloco "OVERRIDES — padrão MELI" que **redefine** regras já declaradas acima
(cores, raios, fontes). Funciona, mas dobra o custo de entender/alterar estilos.
- *Recomendação:* consolidar nas variáveis `:root` e remover os overrides.

**4.6 Estilo de código inconsistente.**
Mistura de `var`/`let`/`const` e `==`/`===`; duas funções de escape
(`escHtml` e `esc`). Padronizar (`const`/`let`, `===`, um único helper).

### P2 — Polimento / consistência

**4.7 Normalização de idioma/encoding.** ✅ *Resolvido em §3.4 e §3.5.*
Mensagens ao usuário e textos de auditoria do `Code.gs` (50 strings) e as
mensagens de prévia/exportação do `index.html` foram acentuados. Resta apenas
revisar eventuais textos pontuais futuros — sempre **sem** tocar em
identificadores ou chaves de comparação.

**4.8 Limiares mágicos espalhados.**
`98` (DOT/OOT) e `4` (ABS) aparecem repetidos em `updateCalculations`,
`kpiPrintClass` e `buildPrintReport`. Centralizar em um objeto de configuração
(ex.: `THRESHOLDS = { dot: 98, absMax: 4 }`).

**4.9 Handlers inline (`onclick=`).**
Aceitável no Apps Script, mas migrar para `addEventListener` deixaria o código
mais limpo e compatível com CSP mais restrita.

---

## 5. Proposta para a duplicação (item 4.3)

Hoje o watchdog é autossuficiente de propósito (re-renderiza mesmo se o script
principal falhar parcialmente no iframe `userCodeAppPanel`). Para manter essa
resiliência **sem** duplicar dados:

1. Expor a fonte única no escopo global do script principal:
   `window.FG = { DEFAULT_DATA, kpiConfig, statusOptions, render: {...} }`.
2. No watchdog, **referenciar** `window.FG` e só cair nas cópias locais como
   *fallback* quando `window.FG` não existir (sinal de que o principal não subiu).
3. Assim a duplicação vira *defensiva* (só usada em falha), e o caminho normal
   tem um único ponto de manutenção.

> Por exigir validação no Web App publicado (timing do iframe), essa mudança
> **não** foi aplicada nesta entrega.

---

## 6. Checklist de QA recomendado (pós-deploy)

Como não há testes automatizados (esperado em GAS), sugiro um roteiro manual:

- [ ] Login válido / inválido / bloqueio após 7 erros.
- [ ] Primeiro acesso: senha com 7 chars deve ser **recusada** no cliente (correção §3.1).
- [ ] Operador **não** vê "Excluir" no histórico; admin vê e exclui (correção §3.2).
- [ ] Salvar fechamento → aparece no Sheets e no histórico; auditoria registrada.
- [ ] Prévia/Baixar PDF/PNG com conteúdo curto e muito longo (auto-escala).
- [ ] Logout volta ao login sem recarregar; recarregar mantém sessão (token 6 h).
- [ ] Admin: editar/salvar/excluir e resetar senha de usuário (após limpeza do código morto, §3.6).
- [ ] Painel monta KPIs/linhas/áreas após login (watchdog usando a fonte única, §3.7).
- [ ] **Bootstrap:** numa instância limpa, `setupPrimeiroAdmin()` cria o admin e o login funciona (§3.8).
- [ ] **Resetar senha:** gera/aceita provisória forte, mostra ao admin e exige troca no próximo acesso (§3.8).
- [ ] **Produção:** após o deploy, os usuários existentes continuam logando normalmente (§3.8).

---

## 7. Próximos passos sugeridos

**Já aplicado nesta revisão:** correções §3.1–§3.8 — bug da política de senha,
botão Excluir, acentuação completa, remoção de código morto, fonte única dos dados
do watchdog e **remoção de PII/hashes do fonte com bootstrap seguro (P0-4.1)**.

> ⚠️ **Antes de produção:** publique numa implantação de teste e valide o login,
> o `setupPrimeiroAdmin()` e o "Resetar senha" (checklist em §6). A instância atual
> não precisa de bootstrap (usuários já no `PropertiesService`).

**Pendente, por exigir decisão/teste ao vivo:**

1. **P0 — rascunho em terminal compartilhado (§4.2).** Decisão do time: limpar o
   rascunho no logout (evita vazar dados entre turnos, mas perde rascunho não
   salvo) **ou** namespacing por usuário.
2. **P1 — unificar as funções de render principal × watchdog (§5).**
3. **P2 — CSS (§4.5), estilo de código (§4.6) e limiares mágicos (§4.8).**

Os pendentes são de baixo/médio risco, mas pedem teste no Web App publicado antes
de promover para produção.
