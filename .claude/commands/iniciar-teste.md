---
description: Cria branch, commita o trabalho atual e promove pra homolog (deploy de staging).
---

Esta rotina pega tudo o que está mudado localmente, abre uma branch nova, commita, manda pra homolog e o GitHub Actions cuida do deploy de staging. Use quando o Luiz quer **testar em homologação** o que está em desenvolvimento.

## Passos

### 1. Verifique o que mudou
```
git status
git diff --stat
```

- Se **não houver alterações** (staged ou modified), pare aqui e avise o Luiz que não há nada pra testar. Não rode os passos seguintes.
- Se houver arquivos untracked, **liste-os** e pergunte se devem entrar (`.claude/`, build artifacts geralmente NÃO entram). Use `git add <arquivo>` por nome em vez de `git add .` quando houver risco.
- Se houver `.env`, credenciais ou anything que pareça segredo, **NÃO commite** — alerte o Luiz.

### 2. Gere nome de branch e mensagem de commit
A partir dos arquivos modificados e do conteúdo do diff:

- **Branch name**: `feature/<descricao-curta-em-kebab>` quando for funcionalidade nova ou enhancement; `hotfix/<descricao-curta-em-kebab>` quando o diff parece corrigir bug. Limite a 40 caracteres na descrição. Exemplos:
  - `feature/cronograma-fisico-financeiro`
  - `hotfix/calculo-valor-captado`
  - `feature/importar-beneficiarios-xlsx`

- **Mensagem de commit**: padrão Conventional Commits (`fix(area):`, `feat(area):`, etc.), 1ª linha curta (até ~70 chars), corpo opcional com 2-4 linhas explicando o porquê. Sempre fechar com:
  ```

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

  Mostre ao Luiz o nome de branch e a mensagem **antes** de prosseguir, em uma frase só. Se ele não corrigir, siga.

### 3. Crie a branch a partir do estado atual
```
git checkout -b <nome-da-branch>
```

### 4. Stage + commit
- Prefira `git add <arquivo>` por nome quando lista pequena. Use `git add -A` ou `.` apenas se a checagem do passo 1 confirmou que tudo é commitável.
- Commit via HEREDOC (não inline) pra preservar formatação:
  ```
  git commit -m "$(cat <<'EOF'
  <mensagem gerada>

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
- **Nunca** use `--no-verify` ou `--no-gpg-sign`. Se um hook bloquear, investigue e corrija o problema; **não** force.

### 5. Push da branch
```
git push -u origin <nome-da-branch>
```

### 6. Promova pra homolog
```
git checkout homolog
git pull origin homolog
git merge <nome-da-branch>
```

- Se o merge der **conflito**, **pare imediatamente**: avise o Luiz, mostre os arquivos em conflito, peça orientação. Não tente resolver sem confirmação.
- Se o merge passou limpo (fast-forward ou merge commit automático):
  ```
  git push origin homolog
  ```

### 7. Volte pra branch de trabalho
```
git checkout <nome-da-branch>
```

### 8. Reporte ao Luiz
Diga (curto, 3-4 linhas):
- Nome da branch criada
- Mensagem do commit (1ª linha)
- Que homolog foi atualizada e o deploy de staging vai rodar automaticamente pelo GitHub Actions
- Link do Actions: https://github.com/luizdelphino-collab/LIE/actions
- Lembre que **`main` (produção) NÃO foi tocada** — só vai pra main depois do "ok no staging"

## Salvaguardas

- Nada de `git push --force`, `reset --hard`, ou `--no-verify`.
- Não toque em `main` nesta rotina — é só branch→homolog.
- Se o `git status` mostrar arquivos suspeitos (segredos, binários grandes, builds), **pare e pergunte**.
- Se qualquer comando git falhar (auth, conflito, hook), **pare e mostre o erro** — não tente paliativos.
- Se a branch `homolog` ainda não existir no remoto (projeto novo), **pare** e avise o Luiz: ele precisa criar a branch e configurar o secret `ENV_STAGING` e o projeto `lie-stage` no Firebase antes do staging funcionar.
