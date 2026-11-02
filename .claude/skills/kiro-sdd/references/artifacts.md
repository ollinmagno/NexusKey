# Formato dos artefatos

A origem de cada regra está marcada assim:

- **[repo]**: observado em `.kiro/specs/api-key-rotation/`, antes chamada `resend-key-rotation`.
- **[doc]**: descrito na documentação do Kiro.
- **[inferido]**: dedução, sem exemplo no repositório nem documentação.

Escreva os documentos em português. Mantenha em inglês os títulos de seção e as palavras-chave EARS, como na spec existente **[repo]**.

## Estrutura

```text
AGENTS.md                      sempre carregado pelo Kiro
.kiro/
  settings/mcp.json            MCPs do workspace no Kiro
  steering/*.md                contexto permanente do projeto
  specs/<nome-em-kebab-case>/
    .config.kiro               identidade e tipo da spec
    requirements.md            feature
    bugfix.md                  bugfix, no lugar de requirements.md
    design.md
    tasks.md
    tasks.meta.json            histórico local, ignorado pelo Git
```

## `.config.kiro`

JSON de uma linha, criado por `tasks.mjs init` **[repo]**:

```json
{"specId": "<uuid>", "workflowType": "requirements-first", "specType": "feature"}
```

- `workflowType`: `requirements-first` **[repo]** ou `design-first` **[doc, valor inferido]**.
- `specType`: `feature` **[repo]** ou `bugfix` **[doc, valor inferido]**.
- O valor de `workflowType` em specs de bugfix é **[inferido]**.

## `requirements.md`

Seções, nesta ordem **[repo]**:

````markdown
# Requirements Document

## Introduction
O que é a feature, em um parágrafo.

## Glossary
- **Nome_Do_Termo**: definição. Todo sujeito dos critérios vem daqui.

## Requirements

### Requirement 1: Título

**User Story:** Como <papel>, quero <capacidade>, para que <benefício>.

#### Acceptance Criteria

1. WHEN <evento>, THE <Sistema> SHALL <comportamento>.
2. IF <condição indesejada>, THEN THE <Sistema> SHALL <reação>.

---
````

Formas EARS em uso **[repo]**:

| Forma | Uso |
|---|---|
| `THE X SHALL` | Regra sempre válida |
| `WHEN evento, THE X SHALL` | Resposta a um evento |
| `IF condição, THEN THE X SHALL` | Tratamento de falha |
| `WHILE estado, THE X SHALL` | Restrição durante um estado |

Cada critério precisa ser verificável por uma task. A referência `N.M` significa critério `M` do requisito `N`. Depois de escrever, procure inconsistências, ambiguidades e lacunas, trabalho que no Kiro é feito por **Analyze Requirements** **[doc]**.

Lições da spec existente:

- Todo sujeito usado deve estar no glossário. `Terraform_Module` aparece nos critérios, mas não está lá.
- Não exija de uma ferramenta o que ela não faz. O critério 8.4 pede que `terraform validate` detecte wildcard em IAM, e o design recorre a revisão manual.
- Descreva o estado inicial e o formato real dos dados. A falta disso deixou passar o defeito do estado `{}` listado em Pendências.

## `bugfix.md`

Três seções em forma WHEN/THEN **[doc]**:

```markdown
## Current Behavior (Defect)
WHEN <condição> THEN the system <comportamento incorreto>

## Expected Behavior (Correct)
WHEN <condição> THEN the system SHALL <comportamento correto>

## Unchanged Behavior (Regression Prevention)
WHEN <condição> THEN the system SHALL CONTINUE TO <comportamento existente>
```

O `design.md` de um bugfix traz causa raiz, abordagem da correção e propriedades a testar: o código atual exibe o defeito, o código corrigido se comporta bem e o restante não muda. As tasks incluem esses testes **[doc]**.

A numeração para referenciar esses itens não tem exemplo; use `_Requirements_` só em specs de feature e cite a seção do `bugfix.md` nas demais **[inferido]**.

## `design.md`

Seções, nesta ordem **[repo]**:

1. `# Design Document`
2. `## Overview`, com os objetivos de design
3. `## Architecture`, com diagramas Mermaid de componentes e sequência
4. `## Components and Interfaces`, com recursos, módulos e contratos
5. `## Data Models`
6. `## Error Handling`, com tabela de etapa, falha e comportamento
7. `## Testing Strategy`, por camada

Dimensione o conteúdo pela feature: diagramas só ajudam quando há mais de um componente, e em uma mudança pequena uma linha basta em cada seção.

O Kiro deriva dos critérios EARS propriedades do tipo "para qualquer entrada que atenda às pré-condições, tal comportamento vale" e gera testes baseados em propriedades (PBT) **[doc]**. Registre as propriedades aplicáveis na estratégia de testes, ou justifique a ausência, como a spec existente faz.

## `tasks.md`

Seções, nesta ordem **[repo]**:

````markdown
# Implementation Plan: <spec>

## Overview

## Tasks

- [ ] 1. Título do grupo
  - [ ] 1.1 Ação concreta com arquivo e símbolos exatos
    - Detalhe opcional
    - _Requirements: 1.1, 2.3_

- [ ] 2. Checkpoint — Validar <algo>
  - Execute `<comando>` para confirmar <resultado>. Pergunte ao usuário se tiver dúvidas.

## Pendências

- [ ] Problema conhecido que impede considerar a spec pronta.

## Notes

## Task Dependency Graph

```json
{ "waves": [ { "id": 0, "tasks": ["1.1"] }, { "id": 1, "tasks": ["1.2", "1.3"] } ] }
```
````

Regras:

- **Marcadores [repo]:** `[ ]` não iniciada, `[~]` na fila, `[-]` em andamento, `[x]` concluída.
- **Tasks pai:** só agrupam. Ficam fora das waves, sem `_Requirements_`, e são concluídas com as subtasks **[repo]**.
- **Checkpoints:** o título começa com `N. Checkpoint`, ficam fora das waves e não têm subtasks **[repo]**.
- **Waves:** tasks da mesma wave são independentes entre si, e uma wave só começa depois da anterior **[doc]**.
- **Opcionais:** a nota da spec diz que levam `*`, mas não há exemplo no repositório. O script aceita `- [ ]* 1.1` **[inferido]**. "Run all Tasks" só executa tasks obrigatórias **[doc]**.
- **Títulos:** o título completo, com o número, é a chave do histórico **[repo]**.
- **`## Pendências`:** convenção deste repositório, criada no commit `b23c666`. Os itens não entram nas waves e não contam como tasks, mesmo começando com número. Omita a seção enquanto não houver item **[repo]**.

## Steering

Markdown em `.kiro/steering/` com front matter no início do arquivo **[doc]**:

```yaml
---
inclusion: always
---
```

| Modo | Campos adicionais | Quando carrega |
|---|---|---|
| `always` | — | Em toda interação |
| `fileMatch` | `fileMatchPattern` (glob ou lista) | Ao trabalhar em arquivos correspondentes |
| `manual` | — | Quando citado como `#nome-do-arquivo` |
| `auto` | `name`, `description` | Quando o pedido combina com a descrição |

No Claude Code nada disso carrega sozinho: leia os arquivos conforme essas regras. Referências no formato `#[[file:caminho]]` apontam para outro arquivo a ser lido **[doc]**.

Os arquivos-base são `product.md`, `tech.md` e `structure.md` **[doc]**. Atualize-os quando uma decisão permanente mudar, não para registrar detalhes de uma feature.

## Fontes

- [Specs](https://kiro.dev/docs/specs/)
- [Feature specs](https://kiro.dev/docs/specs/feature-specs/)
- [Bugfix specs](https://kiro.dev/docs/specs/bugfix-specs/)
- [Best practices](https://kiro.dev/docs/specs/best-practices/)
- [Correctness](https://kiro.dev/docs/specs/correctness/)
- [Steering](https://kiro.dev/docs/steering/)
