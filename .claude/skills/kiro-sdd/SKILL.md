---
name: kiro-sdd
description: 'Opera no Claude Code o fluxo Spec-Driven Development do Kiro em .kiro/: cria specs (requirements.md ou bugfix.md, design.md, tasks.md), executa tasks em waves com checkpoints, mantém tasks.md e tasks.meta.json no formato do Kiro, sincroniza mudanças e audita o progresso. Use sempre que o usuário mencionar spec, SDD, Kiro, requisitos, EARS, tasks.md, waves, checkpoint ou pendências; pedir uma feature ou correção não trivial neste repositório; ou pedir para continuar, executar ou conferir o status de uma task, mesmo sem citar o Kiro.'
argument-hint: "[new|run|sync|status] [spec]"
---

# Fluxo SDD do Kiro

Trabalhe em `.kiro/` de modo que a mesma spec continue utilizável no Kiro. A spec define o que deve ser feito; o código a implementa. Por isso, uma divergência se resolve mudando primeiro o documento certo, nunca deixando código e spec seguirem caminhos diferentes.

## Ferramenta de estado

Para consultar ou mudar o estado das tasks, use o script. Ele mantém `tasks.md` e `tasks.meta.json` consistentes, preserva as quebras de linha e recusa transições inválidas. Evite editar marcadores à mão:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tasks.mjs" help
node "${CLAUDE_SKILL_DIR}/scripts/tasks.mjs" status <spec>
```

Nos comandos de `mark`, use `--session ${CLAUDE_SESSION_ID}` e o `executionId` gerado por `new-run`.

## Escolha o modo

Argumentos recebidos: `$ARGUMENTS`

| Pedido | Modo |
|---|---|
| Criar feature ou correção | **Nova spec** |
| Executar ou continuar tasks | **Execução** |
| Mudar requisito, design ou escopo | **Sincronização** |
| Saber onde a spec está | Rode `status` e relate o resultado, incluindo avisos e pendências |

Antes de qualquer modo, leia os arquivos de `.kiro/steering/` cuja regra de inclusão se aplique. Uma correção trivial, sem mudança de comportamento, não precisa de spec.

## Nova spec

Leia [references/artifacts.md](references/artifacts.md) antes de escrever qualquer documento.

1. Se a spec nova sobrepõe uma existente, proponha atualizar a existente: o Kiro recomenda uma spec por feature.
2. Rode `init <spec>`. Em feature, acrescente `--workflow design-first` só se houver restrição técnica dominante ou se o usuário pedir. Em bugfix, use `--type bugfix`, sem `--workflow`.
3. Escreva um documento por vez e peça aprovação antes do próximo. Cada aprovação evita que um erro de entendimento se espalhe pelos documentos seguintes.
   - `requirements-first`: requirements → design → tasks.
   - `design-first`: design → requirements → tasks.
   - `bugfix`: bugfix → design → tasks.
4. Pule as aprovações só se o usuário as dispensar, seja pedindo uma spec rápida ou dando os documentos por aprovados.
5. Antes de escrever o design, confira se todo sujeito dos critérios está no glossário: o `check` não detecta isso.
6. Ao terminar as tasks, rode `check`. Corrija todo erro e, numa spec nova, também os avisos de cobertura, antes de oferecer a execução.

## Execução

1. Rode `status`. Se houver `ERRO`, pare e resolva. Trate `AVISO` no histórico como informação sobre o passado, não como bloqueio.
2. Confirme que a branch não é a principal. Se for, crie uma antes de alterar código.
3. Defina o escopo. Para "rodar tudo", use os ids obrigatórios que o `status` lista como não concluídos; as tasks opcionais aparecem à parte e só entram se o usuário pedir. Para uma única task, confira se as dependências dela estão concluídas.
4. Rode `new-run` e guarde o id. Coloque o escopo inteiro na fila com um único `mark queued`. Ao retomar uma execução interrompida, as tasks em `[-]` continuam como estão.
5. Repita até o `status` não indicar lote:
   1. Pegue o `Próximo lote` do `status` e rode `mark in_progress` com esses ids em um único comando. Se aparecer `Lote atual`, esse lote já começou: conclua o que faltar nele.
   2. Implemente. Tasks de um mesmo lote podem correr em paralelo só quando alteram arquivos diferentes. Agrupe no mesmo responsável as que alteram o mesmo arquivo, pois a wave garante a ordem das dependências, mas não evita conflito de escrita.
   3. Verifique com evidência: teste, validação ou leitura do resultado frente ao critério citado em `_Requirements_`.
   4. Rode `mark done` só para o que passou na verificação. Em caso de falha, deixe em `[-]`, não avance para o próximo lote e relate o bloqueio.

Se usar subagentes, entregue a cada um o texto da task, os critérios citados, o trecho do design e o steering relevante. Só o orquestrador chama `mark`, porque gravações concorrentes em `tasks.md` e no meta podem perder atualizações.

### Checkpoints

Um checkpoint é uma barreira: o `status` o coloca como próximo lote assim que tudo o que vem antes dele termina. Rode o comando exatamente como descrito e, se a task pedir, leve as dúvidas ao usuário.

Se a ferramenta exigida não puder rodar (versão errada do Terraform, por exemplo), o checkpoint continua aberto e isso entra no relatório. Não altere restrições de versão nem substitua a verificação para fazê-lo passar.

### Antes de declarar a spec pronta

`[x]` significa que a task passou na verificação planejada. Isso não prova que a feature funciona. Na primeira versão de `api-key-rotation`, todas as tasks chegaram a `[x]` com testes verdes, e ainda assim a rotação não gerava chave nova a partir do estado inicial.

Depois do último checkpoint, revise o código contra os critérios de aceite, percorrendo cenários de ponta a ponta. Inclua estado inicial vazio, reexecução e dados no formato real. Registre o que estiver errado como item de `## Pendências` no `tasks.md` e informe que a spec não está pronta enquanto houver item aberto. O `mark` não atua nessa seção: ao resolver um item, com evidência, edite o marcador à mão.

## Sincronização

O botão **Sync Files** do Kiro não existe aqui, então faça o equivalente manual, na ordem do workflow em `.config.kiro`:

1. Atualize o documento de origem e, com aprovação, os que derivam dele.
2. Crie tasks novas com numeração nova e referência aos critérios, e recoloque-as no Task Dependency Graph.
3. Use `mark reopen` nas tasks concluídas que precisam ser refeitas.
4. Evite renomear tasks já executadas: o título é a chave do histórico. Se for inevitável, avise que o histórico ficará órfão.
5. Rode `check`.

## Limites

- Peça confirmação antes de `terraform apply`, de deploy e de qualquer chamada que crie, altere ou revogue chaves reais. Validar e testar não exige nada disso.
- Faça commits só quando o usuário pedir e siga a skill `conventional-commit`.
- Consulte a documentação nas fontes indicadas em `.kiro/steering/tech.md`. Se um MCP exigido não estiver disponível nesta sessão, avise o usuário em vez de buscar a mesma documentação por web fetch, que o steering proíbe.
- `tasks.meta.json` é um formato interno e sem documentação pública. Para entender ou diagnosticar esse arquivo, leia [references/tasks-meta.md](references/tasks-meta.md). Deixe `pbtResults` como está, pois não há exemplo do formato.

## Relatório final

Informe as tasks concluídas e a evidência de cada lote, o que ficou em `[-]` e por quê, as pendências abertas e o próximo lote.
