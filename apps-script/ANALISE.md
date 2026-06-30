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

> Nenhuma alteração foi feita em identificadores, chaves de comparação
> (ex.: `id="previa-pdf"`, status `Controlado/Saturado/...`) nem em hashes/salts.

---

## 4. Achados e recomendações priorizadas

### P0 — Segurança / dados sensíveis

**4.1 PII + material de credencial no código-fonte.**
`DEFAULT_LOGIN_USERS_SERVER` (`Code.gs`) traz **nomes reais** de colaboradores e
hashes de senhas provisórias versionados no repositório.
- *Risco:* exposição de dados pessoais e possibilidade de **brute-force offline**
  das senhas provisórias (o atacante tem hash **e** salt).
- *Agravante:* os salts são previsíveis (`fch_<login>_nova_20260629_v1`).
- *Recomendação:* mover a lista-semente para **Script Properties** (ou criá-la
  via função de setup única) e usar `newPasswordSalt_()` (salt aleatório) também
  para os usuários iniciais. O código-fonte não deveria conter nem nomes nem
  hashes.

**4.2 Rascunho operacional em terminal compartilhado.**
`logoutApp` limpa as chaves de sessão, mas **não** o rascunho (`STORAGE_KEY`) no
`localStorage`. Em PCs compartilhados, o próximo usuário enxerga o fechamento do
anterior.
- *Recomendação:* opção "limpar rascunho ao sair" (ou namespacing por usuário).

### P1 — Manutenibilidade / robustez

**4.3 Duplicação script principal × watchdog — maior dívida técnica.**
`DEFAULT_DATA`/`DEFAULT_INTERNAL`, `kpiConfig`/`KPI_ROWS`,
`statusOptions`/`STATUS_OPTIONS` e **todas** as funções de render existem em
**duas cópias** (script principal e watchdog). São ~300 linhas que precisam ser
mantidas em sincronia manualmente — qualquer alteração em uma cópia e não na
outra causa divergência silenciosa. Ver proposta na seção 5.

**4.4 Código morto de login local.**
`getLocalLoginUsers`, `saveLocalLoginUsers`, `checkLocalLogin`, `saveUserLocal`,
`deleteUserLocal` e `DEFAULT_LOGIN_USERS = []` foram neutralizados por segurança,
mas continuam no arquivo (e `editUserFromAdmin` ainda chama `getLocalLoginUsers`).
- *Recomendação:* remover os stubs e simplificar `editUserFromAdmin` para usar só
  `usersAdminCache`.

**4.5 CSS com duas camadas de cascata.**
Há um bloco "OVERRIDES — padrão MELI" que **redefine** regras já declaradas acima
(cores, raios, fontes). Funciona, mas dobra o custo de entender/alterar estilos.
- *Recomendação:* consolidar nas variáveis `:root` e remover os overrides.

**4.6 Estilo de código inconsistente.**
Mistura de `var`/`let`/`const` e `==`/`===`; duas funções de escape
(`escHtml` e `esc`). Padronizar (`const`/`let`, `===`, um único helper).

### P2 — Polimento / consistência

**4.7 Normalização de idioma/encoding (parcialmente feito em §3.4).**
Ainda há mensagens **ao usuário** sem acento, principalmente em `throw new Error`
no `Code.gs` ("Sessao expirada", "Voce nao pode…", "obrigatorio", "invalido",
"provisoria"). Recomenda-se uma passada completa — **sem** tocar em identificadores
ou chaves de comparação.

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

---

## 7. Próximos passos sugeridos

1. **P0:** tirar PII/hashes do fonte (§4.1) e limpar rascunho em terminal
   compartilhado (§4.2).
2. **P1:** unificar estado/render principal × watchdog (§5) e remover código morto
   (§4.4).
3. **P2:** passada completa de acentuação (§4.7) e centralização de limiares (§4.8).

Itens P1/P2 são de baixo risco, mas pedem teste no Web App publicado antes de
promover para produção.
