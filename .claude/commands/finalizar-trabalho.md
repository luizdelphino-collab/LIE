---
description: Promove a branch atual de trabalho pra main (deploy de produção).
---

Esta rotina pega a branch em que o Luiz está e faz o merge dela na `main`, disparando o deploy de produção via GitHub Actions. Use **somente depois** que o teste em homologação passou — main é prod.

## Pré-checagem (importante)

Antes de qualquer git, confirme com o Luiz que:
- O staging (homolog) já foi testado e está OK.
- A branch atual de trabalho já foi para homolog (via `/iniciar-teste`) e validada.

Se o Luiz ainda não confirmou, **pare e pergunte**: "O staging em homolog já foi validado? Posso promover pra produção?". **Não prossiga sem o ok**.

## Passos

### 1. Identifique a branch atual e guarde o nome
```
git branch --show-current
```

Guarde o resultado em `BRANCH_TRABALHO`. Se vier vazio (HEAD destacado) ou se for `main`/`homolog` em si, **pare**: explique ao Luiz que ele precisa estar na feature/hotfix branch antes de finalizar.

Verifique também `git status`:
- Se houver alterações não commitadas, **pare** e avise — ele precisa rodar `/iniciar-teste` primeiro pra commitar e validar em homolog.
- Se tudo está limpo, prossiga.

### 2. Mude pra main e atualize
```
git checkout main
git pull origin main
```

Se o pull falhar (auth, conflito, divergência), **pare** e mostre o erro.

### 3. Merge da branch de trabalho
```
git merge <BRANCH_TRABALHO>
```

- Se der **conflito**, **pare imediatamente**: avise o Luiz, mostre os arquivos em conflito, peça orientação. Não tente resolver sem confirmação.
- Se for fast-forward ou merge automático, prossiga.

### 4. Push pra produção
```
git push origin main
```

- **Nunca** use `--force` ou `--no-verify`.
- Se algum hook bloquear, investigue e fixe a causa real; não force.

### 5. Reporte ao Luiz
Diga (curto, 3-4 linhas):
- Branch `<BRANCH_TRABALHO>` foi mesclada em `main`.
- 1ª linha do commit/merge (ou hash novo).
- O deploy de produção vai rodar automaticamente pelo GitHub Actions.
- Link: https://github.com/luizdelphino-collab/LIE/actions
- Lembre que pode fazer **Ctrl+Shift+R** depois que a Action concluir pra ver em projetos.lie.com.br.

Mencione que o Luiz agora está na branch `main` (não voltou pra `<BRANCH_TRABALHO>`). Pergunte se quer voltar pra ela ou ficar em main.

## Salvaguardas

- ❌ Sem `git push --force`, `reset --hard`, `--no-verify`, `--no-gpg-sign`.
- ❌ Não rode esta rotina se a branch atual for `main` ou `homolog`.
- ❌ Não rode se houver alterações não commitadas.
- ⛔ Se o staging não foi validado, **PARE e PERGUNTE** antes de qualquer git.
- ⛔ Conflito no merge → parar e pedir orientação.
- ⛔ Falha em pull/push → mostrar o erro, não tentar paliativos.
