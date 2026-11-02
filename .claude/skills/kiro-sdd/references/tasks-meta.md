# Engenharia reversa do `tasks.meta.json`

A documentação pública do Kiro não descreve este arquivo. Tudo aqui foi deduzido de uma única execução da spec hoje chamada `api-key-rotation` (antes `resend-key-rotation`), comparada com o histórico do Git. O Kiro pode mudar o formato sem aviso.

## Papel do arquivo

É um log de auditoria local, só com acréscimos, ignorado pelo Git (`.gitignore:21`). O estado atual está em `tasks.md`. O meta não é fonte de verdade: um clone novo não o tem, e `tasks.md` pode mudar sem que ele acompanhe.

## Formato

```json
{
  "pbtResults": {},
  "executionHistory": {
    "<título completo da task, com o número>": [
      {
        "executionId": "<uuid>",
        "chatSessionId": "sess_<uuid>",
        "timestamp": 1793497717684
      }
    ]
  }
}
```

- A chave é o texto da linha depois do marcador. As 46 chaves coincidem exatamente com os títulos em `tasks.md`.
- `timestamp` está em milissegundos desde a época Unix.
- `executionId` identifica a execução e `chatSessionId`, a sessão. Aqui há um único valor de cada.
- `pbtResults` está vazio porque o design descartou PBT, então não se conhece o formato de um resultado.

## Máquina de estados

Cada transição de uma task folha acrescenta uma entrada:

| Entradas | Estado | Marcador | Evidência |
|---|---|---|---|
| 0 | Não iniciada | `[ ]` | — |
| 1 | Na fila | `[~]` | Task 13 no commit `6bfda3e` |
| 2 | Em andamento | `[-]` | Tasks 12.1 e 12.2 no commit `6bfda3e` |
| 3 | Concluída | `[x]` | Demais folhas e checkpoints 6 e 11 |

A relação entre entradas e estados é uma inferência forte, mas não uma especificação. A task pai recebe uma única entrada, entre 77 e 596 ms depois da última entrada da última subtask, então a conclusão do pai é automática.

## Linha do tempo da execução

Horários em UTC, em 2026-11-01:

1. **01:48:37 a 01:48:42:** todas as folhas e checkpoints entram na fila em cerca de 4 s. Corresponde a "Run all Tasks".
2. **01:48:46 a 03:05:23:** waves 0 a 9. Cada wave só começa depois que a anterior termina, o que confirma a ordem do Task Dependency Graph.
3. **Dentro de cada wave:** os inícios e os fins costumam vir em rajada, a cerca de 3 s por task. As tarefas rodam em paralelo, mas as mudanças de estado são gravadas uma de cada vez. As exceções são 8.7, que terminou 5 minutos depois de 8.5, e 10.1, que começou 5 minutos antes das demais da wave 9.
4. **03:05:37 a 03:14:15:** checkpoints 6 e 11 rodam juntos, depois da wave 9, apesar da numeração.
5. **03:14:18 a 03:14:25:** tasks da wave 10 passam para em andamento. O histórico para aqui, e o checkpoint 13 nunca sai da fila.

O checkpoint 6 valida só o Terraform, mas rodou depois de toda a implementação e dos testes da Lambda. Por isso, `tasks.mjs` o trata como barreira e o executa assim que as tasks anteriores terminam. Essa diferença em relação ao Kiro é intencional.

## Divergências observadas

| Task | `tasks.md` | Meta | Leitura |
|---|---|---|---|
| 12.3 | `[ ]` em `6bfda3e` | 2 entradas | Marcador e histórico divergem. Hipótese: atualização perdida na execução paralela. |
| 10 (pai) | `[ ]` em `6bfda3e` | 1 entrada | Mesma divergência e mesma hipótese. |
| 12.1, 12.2, 12.3 | `[x]` em `b23c666` | 2 entradas | Concluídas à mão, fora do Kiro. |
| 13 | `[x]` em `b23c666` | 1 entrada | Concluída à mão, fora do Kiro. |
| 12 (pai) | `[x]` em `b23c666` | Sem entrada | Concluída à mão, fora do Kiro. |

O commit `b23c666` explica a conclusão manual: registra a validação executada depois do fim da execução no Kiro. Assim, `status` emite esses avisos de propósito. Eles descrevem o passado e não bloqueiam nada. Não os "corrija" fabricando entradas no histórico.

## Regras para gravar

`tasks.mjs mark` segue o comportamento observado:

- Exige `[ ]` → `[~]` → `[-]` → `[x]`, para manter válida a relação entre entradas e estados.
- Trata como nenhuma alteração a repetição do estado atual e o `queued` de uma task em `[-]`, o que permite retomar uma execução interrompida.
- Conclui o pai automaticamente, com uma entrada, quando as subtasks obrigatórias terminam.
- `reopen` volta `[x]` para `[ ]` e reabre os pais, sem apagar nem acrescentar histórico. A task reaberta soma 3 entradas ao concluir de novo.
- Grava `chatSessionId` com o id da sessão do Claude Code. Ele não tem o prefixo `sess_`, o que também permite distinguir execuções feitas fora do Kiro.
