# AGENTS.md

O NexusKey é um módulo Terraform que provisiona na AWS uma rotação automatizada de chaves de API de terceiros (Secrets Manager com rotação nativa e Lambda). O desenvolvimento segue Spec-Driven Development (SDD) com os artefatos do Kiro em `.kiro/`.

## Contexto obrigatório

Leia antes de alterar código:

| Arquivo | Conteúdo |
|---|---|
| [.kiro/steering/product.md](.kiro/steering/product.md) | Propósito do produto |
| [.kiro/steering/tech.md](.kiro/steering/tech.md) | Stack, decisões, proibições e fontes de documentação |
| [.kiro/steering/structure.md](.kiro/steering/structure.md) | Mapa do repositório |

O Kiro injeta esses arquivos sozinho. Outros agentes precisam lê-los. As regras do steering valem para qualquer ferramenta.

## Quando usar SDD

Use uma spec para feature, mudança de comportamento ou correção não trivial. Mudanças triviais sem efeito em comportamento, como ajustes de texto, não precisam de spec.

No Claude Code, use a skill `/kiro-sdd`, que automatiza o que está descrito abaixo. No Kiro, use a interface de Specs.

## Fluxo

Cada spec fica em `.kiro/specs/<nome-em-kebab-case>/`. Uma feature tem uma spec.

```text
requirements-first: requirements.md → design.md → tasks.md → execução → revisão
design-first:       design.md → requirements.md → tasks.md → execução → revisão
bugfix:             bugfix.md → design.md → tasks.md → execução → revisão
```

1. **Especificar:** escreva um documento por vez e obtenha aprovação humana antes do próximo, salvo se a pessoa a dispensar. Requisitos usam EARS (`WHEN … THE <sistema> SHALL …`).
2. **Planejar:** cada task folha aponta os critérios que atende (`_Requirements: 1.2, 3.1_`). O Task Dependency Graph agrupa as tasks em waves.
3. **Executar:** uma wave só começa depois que a anterior termina. Checkpoints são barreiras de validação.
4. **Revisar:** compare o resultado com os critérios de aceite, de ponta a ponta. Registre os problemas em `## Pendências`.

## Estados das tasks

| Marcador | Estado |
|---|---|
| `[ ]` | Não iniciada |
| `[~]` | Na fila |
| `[-]` | Em andamento |
| `[x]` | Concluída e verificada |

- Marque `[x]` somente com evidência, como teste, validação ou conferência com o critério.
- Tasks pai se concluem com as subtasks.
- `tasks.meta.json` é um histórico local do Kiro, ignorado pelo Git. O estado atual está em `tasks.md`.
- Não invente entradas nesse histórico. O formato está documentado em [.claude/skills/kiro-sdd/references/tasks-meta.md](.claude/skills/kiro-sdd/references/tasks-meta.md).

## Mudanças em uma spec

A spec vem antes do código. Se o design ou um requisito estiver errado, pare e atualize primeiro o documento de origem, depois os derivados e, por fim, `tasks.md`. Evite renomear tasks já executadas, porque o título é a chave do histórico.

## Definição de pronto

Uma spec está pronta quando todas as condições abaixo são verdadeiras:

- As tasks obrigatórias estão em `[x]`.
- Os checkpoints foram executados de fato.
- A revisão contra os critérios cobriu estado inicial, reexecução e dados no formato real.
- `## Pendências` não tem item aberto.

Testes verdes e `terraform validate` não bastam: eles não provam que a rotação funciona em uso real.

## Verificação

Rode os checkpoints da spec e os comandos da área alterada, a partir da raiz do repositório:

```bash
node --test terraform/lambda/rotation/rotation.test.mjs
terraform -chdir=terraform validate
terraform -chdir=terraform/examples/basic validate
```

A versão do Terraform precisa ser a de `.terraform-version`. Se a instalada for outra, o `validate` falha: troque a versão instalada, sem alterar `required_version`. Sem a versão correta, a verificação fica pendente.

## Limites

- Obtenha confirmação humana antes de `terraform apply`, de deploy e de qualquer chamada que crie, altere ou revogue chaves reais.
- Nenhum valor de chave pode aparecer em código, logs, outputs, Terraform state ou `*.tfvars` versionado.