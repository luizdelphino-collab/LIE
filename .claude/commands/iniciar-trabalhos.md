---
description: Atualiza o repositório local pra main antes de iniciar alterações.
---

Execute esta rotina pra começar o trabalho do dia com a base sincronizada com produção:

1. Antes de qualquer coisa, rode `git status` (via Bash). Se houver mudanças **não commitadas** (modified ou staged), **interrompa** o fluxo, mostre o que está pendente e pergunte ao Luiz como prosseguir (commit, stash, descartar). Arquivos `??` untracked (como `.claude/`, builds locais) podem ser ignorados — só bloqueie se houver `M` ou conteúdo staged.
2. Mude para a branch `main`:
   ```
   git checkout main
   ```
3. Baixe as atualizações mais recentes do remoto:
   ```
   git pull origin main
   ```
4. Informe ao Luiz que o projeto LIE está atualizado e pronto para alterações. Mostre o hash do `HEAD` atual e a contagem de commits que entraram, se houve fast-forward (resumo curto, 2-3 linhas).

**Importante**: este comando NÃO autoriza commits, pushes ou alterações destrutivas — é só checkout + pull. Continue aguardando instruções do Luiz após informar.
