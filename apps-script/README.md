# Fechamento Gerencial — versão Google Apps Script

Variante em **Google Apps Script + Google Sheets** do Sistema de Fechamento
Gerencial (a outra variante deste repositório é o app **Streamlit** em
`../app.py`). Esta pasta versiona o código para histórico e revisão; o app em si
roda como **Web App** publicado pelo Apps Script.

## Arquivos

| Arquivo | Papel no projeto Apps Script |
|---|---|
| `Code.gs` | Backend: login/sessão, CRUD de fechamentos, auditoria, Sheets |
| `index.html` | Front-end servido por `HtmlService` (`doGet` → template `index`) |
| `ANALISE.md` | Revisão técnica, achados e recomendações priorizadas |

## Como publicar / atualizar

1. No projeto do Apps Script, mantenha um arquivo `Code.gs` e um HTML chamado
   `index` (o `doGet` faz `createTemplateFromFile('index')`).
2. Copie o conteúdo de `Code.gs` e `index.html` para os arquivos correspondentes.
3. **Implantar → Gerenciar implantações → Editar → Nova versão.**
4. Primeira instalação: rode `setupManual()` uma vez para criar as abas
   `FECHAMENTOS` e `AUDITORIA`.

## Primeiro administrador (bootstrap)

A base de usuários **não** fica no código-fonte (sem nomes nem hashes versionados).
Os logins ficam no `PropertiesService` e o primeiro administrador é criado uma vez:

1. No editor do Apps Script, abra `Code.gs` e localize `setupPrimeiroAdmin()`.
2. Preencha `NOME`, `LOGIN` e `SENHA_PROVISORIA` (mín. 8 caracteres, com letras e
   números) e **execute a função uma vez**. Depois, **apague os valores**.
3. Faça login com esse administrador; o sistema exige a troca da senha no 1º acesso.
4. Os demais usuários são criados pela tela **Administração de usuários**.
   O botão **Resetar senha** gera/define uma senha provisória (mostrada ao admin)
   e exige troca no próximo acesso.

> A instância **já em produção** não precisa de bootstrap: os usuários continuam
> no `PropertiesService` e o login segue funcionando. Como os hashes antigos
> permanecem no histórico do Git, considere **rotacionar** as senhas provisórias
> ainda não trocadas pelo botão **Resetar senha**.

## Observações

- Os nomes de funções públicas chamadas via `google.script.run` **não** podem ser
  renomeados sem ajustar o front-end (ver cabeçalho do `Code.gs`).
- Antes de promover mudanças, rode o **checklist de QA** em `ANALISE.md`.
