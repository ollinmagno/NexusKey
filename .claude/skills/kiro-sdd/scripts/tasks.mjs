#!/usr/bin/env node
// Lê e atualiza o estado de uma spec do Kiro (tasks.md + tasks.meta.json), sem dependências.
// Uso: node tasks.mjs help
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const USAGE = `Uso (a partir de qualquer pasta do repositório):
  tasks.mjs init <spec> [--type feature|bugfix] [--workflow requirements-first|design-first]
  tasks.mjs status <spec>    progresso, diagnóstico e próximo lote
  tasks.mjs check <spec>     só o diagnóstico; sai com código 1 se houver erro
  tasks.mjs new-run          imprime um executionId novo
  tasks.mjs mark <spec> <queued|in_progress|done> <ids...> --session <id> --execution <uuid>
  tasks.mjs mark <spec> reopen <ids...>`;

const MARK = { queued: '~', in_progress: '-', done: 'x', reopen: ' ' };
const ALLOWED_FROM = { queued: [' '], in_progress: ['~'], done: ['-'], reopen: ['x'] };
const LABEL = { ' ': 'não iniciada', '~': 'na fila', '-': 'em andamento', x: 'concluída' };

const fail = (message) => {
  console.error(`Erro: ${message}`);
  process.exit(1);
};

function findRoot() {
  // Para na raiz do Git para não adotar um ~/.kiro de usuário como se fosse o do projeto.
  let dir = process.cwd();
  while (!existsSync(join(dir, '.kiro')) && !existsSync(join(dir, '.git'))) {
    const parent = dirname(dir);
    if (parent === dir) fail('nenhum repositório Git ou pasta .kiro acima do diretório atual');
    dir = parent;
  }
  return dir;
}

function parseTasks(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const tasks = [];
  const pendencies = [];
  let fenced = false;
  let inPendencies = false;
  // Só `## Tasks` contém tasks; um arquivo sem esse título é lido por inteiro.
  let inTasks = !lines.some((line) => /^##\s+Tasks\s*$/i.test(line));
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('```')) fenced = !fenced;
    if (fenced) return;
    const heading = line.match(/^##\s+(.*\S)/);
    if (heading) {
      inPendencies = /^Pend[êe]ncias$/i.test(heading[1]);
      inTasks = /^Tasks$/i.test(heading[1]);
    }
    if (inPendencies) {
      const pendency = line.match(/^\s*- \[(.)\]\s+(.*\S)\s*$/);
      if (pendency) pendencies.push({ open: pendency[1] !== 'x', text: pendency[2] });
      return;
    }
    if (!inTasks) return;
    const task = line.match(/^(\s*)- \[(.)\](\*?)\s+((\d+(?:\.\d+)*)\.?\s.*?)\s*$/);
    if (task) {
      const [, indent, mark, optional, title, id] = task;
      tasks.push({
        id, mark, title, index, indent,
        optional: optional === '*',
        parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null,
        checkpoint: /^\S+\s+Checkpoint/i.test(title),
        requirements: [],
      });
      return;
    }
    const refs = line.match(/_(?:Requirements|Requisitos):\s*([^_]+)_/);
    if (refs && tasks.length) {
      tasks.at(-1).requirements.push(...refs[1].split(',').map((ref) => ref.trim()).filter(Boolean));
    }
  });
  for (const task of tasks) task.isLeaf = !tasks.some((other) => other.parent === task.id);
  return { eol, lines, tasks, pendencies };
}

function parseWaves(text, errors) {
  for (const [, body] of text.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
    if (!body.includes('"waves"')) continue;
    try {
      return JSON.parse(body).waves;
    } catch {
      errors.push('o JSON do Task Dependency Graph é inválido');
    }
  }
  return null;
}

function parseCriteria(text) {
  const criteria = new Set();
  let requirement = null;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^#{2,4}\s+(?:Requirement|Requisito)\s+(\d+)/i);
    if (header) requirement = header[1];
    const criterion = line.match(/^(\d+)\.\s/);
    if (requirement && criterion) criteria.add(`${requirement}.${criterion[1]}`);
  }
  return criteria;
}

function load(specName) {
  if (!specName) fail('informe o nome da spec');
  const dir = join(findRoot(), '.kiro', 'specs', specName);
  const tasksPath = join(dir, 'tasks.md');
  if (!existsSync(tasksPath)) fail(`não existe ${tasksPath}`);
  const text = readFileSync(tasksPath, 'utf8');
  const metaPath = join(dir, 'tasks.meta.json');
  let meta = null;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      fail(`${metaPath} não é um JSON válido; corrija o arquivo antes de continuar`);
    }
  }
  return { dir, tasksPath, metaPath, text, meta, ...parseTasks(text) };
}

const required = (task) => !task.optional;
const compareIds = (a, b) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if ((left[i] ?? -1) !== (right[i] ?? -1)) return (left[i] ?? -1) - (right[i] ?? -1);
  }
  return 0;
};
const historyOf = (spec, task) => spec.meta?.executionHistory?.[task.title] ?? [];

function diagnose(spec) {
  const errors = [];
  const warnings = [];
  const { tasks, dir } = spec;
  const byId = new Map();
  for (const task of tasks) {
    if (byId.has(task.id)) errors.push(`task ${task.id} duplicada`);
    byId.set(task.id, task);
    if (task.parent && !tasks.some((other) => other.id === task.parent)) {
      errors.push(`task ${task.id} não tem a task pai ${task.parent}`);
    }
  }

  const configPath = join(dir, '.config.kiro');
  let config = null;
  if (!existsSync(configPath)) {
    warnings.push('.config.kiro ausente');
  } else {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      errors.push('.config.kiro não é um JSON válido');
    }
  }
  const sourceFile = config?.specType === 'bugfix' ? 'bugfix.md' : 'requirements.md';
  for (const file of [sourceFile, 'design.md']) {
    if (!existsSync(join(dir, file))) errors.push(`${file} ausente`);
  }

  for (const task of tasks.filter((item) => !item.isLeaf)) {
    const pending = tasks.filter((c) => c.parent === task.id && required(c) && c.mark !== 'x');
    if (task.mark === 'x' && pending.length) {
      errors.push(`task ${task.id} está concluída, mas ${pending.map((c) => c.id).join(', ')} não está`);
    }
    if (task.mark !== 'x' && !pending.length) {
      warnings.push(`task ${task.id} tem todas as subtasks concluídas, mas não está marcada`);
    }
  }

  const waves = parseWaves(spec.text, errors);
  if (waves) {
    const seen = new Set();
    for (const id of waves.flatMap((wave) => wave.tasks)) {
      if (seen.has(id)) errors.push(`task ${id} aparece em mais de uma wave`);
      seen.add(id);
      if (!byId.has(id)) errors.push(`a wave cita a task ${id}, que não existe`);
      else if (!byId.get(id).isLeaf) errors.push(`a wave cita a task pai ${id}; use as subtasks`);
    }
    for (const task of tasks) {
      if (task.isLeaf && required(task) && !task.checkpoint && !seen.has(task.id)) {
        errors.push(`task ${task.id} está fora do Task Dependency Graph`);
      }
    }
  }

  const requirementsPath = join(dir, 'requirements.md');
  if (config?.specType !== 'bugfix' && existsSync(requirementsPath)) {
    const criteria = parseCriteria(readFileSync(requirementsPath, 'utf8'));
    const covered = new Set(tasks.flatMap((task) => task.requirements));
    for (const ref of covered) {
      if (!criteria.has(ref)) errors.push(`referência ao requisito ${ref}, que não existe`);
    }
    const missing = [...criteria].filter((ref) => !covered.has(ref));
    if (missing.length) warnings.push(`critérios sem task: ${missing.join(', ')}`);
    for (const task of tasks) {
      if (task.isLeaf && !task.checkpoint && !task.requirements.length) {
        warnings.push(`task ${task.id} não aponta nenhum requisito`);
      }
    }
  }

  if (spec.meta) {
    // Sem meta (ele é ignorado pelo Git) não há auditoria a comparar: um clone novo é um estado válido.
    // Uma task levada para outra seção do arquivo não é órfã: o título continua registrado.
    for (const key of Object.keys(spec.meta.executionHistory ?? {})) {
      if (!spec.text.includes(key)) warnings.push(`histórico órfão (título alterado?): "${key.slice(0, 60)}"`);
    }
    const remainder = { ' ': 0, '~': 1, '-': 2, x: 0 };
    for (const task of tasks) {
      const count = historyOf(spec, task).length;
      if (task.isLeaf) {
        const consistent = count % 3 === remainder[task.mark] && (task.mark !== 'x' || count >= 3);
        if (!consistent) {
          warnings.push(`task ${task.id}: [${task.mark}] em tasks.md, com ${count} registro(s) no histórico`);
        }
      } else if (task.mark === 'x' && !count) {
        warnings.push(`task ${task.id}: [x] em tasks.md, sem registro no histórico`);
      }
    }
  }
  return { errors, warnings, waves };
}

function nextBatch(spec, waves) {
  const leaves = spec.tasks.filter((task) => task.isLeaf && required(task));
  const open = leaves.filter((task) => task.mark !== 'x');
  // Um checkpoint vale como barreira assim que todas as tasks anteriores a ele terminam.
  const checkpoint = open.find((task) => task.checkpoint
    && open.every((other) => other === task || compareIds(other.id, task.id) > 0));
  if (checkpoint) return { kind: 'checkpoint', ids: [checkpoint.id] };
  if (waves) {
    const openIds = new Set(open.map((task) => task.id));
    for (const wave of waves) {
      const ids = wave.tasks.filter((id) => openIds.has(id));
      if (ids.length) return { kind: `wave ${wave.id}`, ids };
    }
  }
  return open.length ? { kind: 'sequencial', ids: [open[0].id] } : null;
}

function printDiagnostics({ errors, warnings }) {
  if (!errors.length && !warnings.length) console.log('Diagnóstico: sem problemas.');
  for (const message of errors) console.log(`ERRO: ${message}`);
  for (const message of warnings) console.log(`AVISO: ${message}`);
}

function status(specName) {
  const spec = load(specName);
  const diagnostics = diagnose(spec);
  const allLeaves = spec.tasks.filter((task) => task.isLeaf);
  const leaves = allLeaves.filter(required);
  const done = leaves.filter((task) => task.mark === 'x').length;
  console.log(`Spec ${specName}: ${done}/${leaves.length} tasks obrigatórias concluídas`);
  for (const mark of ['-', '~', ' ']) {
    const ids = leaves.filter((task) => task.mark === mark).map((task) => task.id);
    if (ids.length) console.log(`  ${LABEL[mark]}: ${ids.join(', ')}`);
  }
  const optional = allLeaves.filter((task) => task.optional && task.mark !== 'x').map((task) => task.id);
  if (optional.length) console.log(`  opcionais, fora do padrão: ${optional.join(', ')}`);
  printDiagnostics(diagnostics);
  const open = spec.pendencies.filter((item) => item.open);
  if (open.length) {
    console.log(`Pendências abertas (${open.length}), a spec ainda não está pronta:`);
    for (const item of open) console.log(`  - ${item.text}`);
  }
  if (diagnostics.errors.length) {
    console.log('Próximo lote: bloqueado até corrigir os erros.');
    return;
  }
  const next = nextBatch(spec, diagnostics.waves);
  if (!next) {
    console.log('Próximo lote: nenhum.');
    return;
  }
  const running = spec.tasks.some((task) => task.mark === '-' && next.ids.includes(task.id));
  console.log(`${running ? 'Lote atual' : 'Próximo lote'} (${next.kind}): ${next.ids.join(', ')}`);
}

function check(specName) {
  const diagnostics = diagnose(load(specName));
  printDiagnostics(diagnostics);
  if (diagnostics.errors.length) process.exitCode = 1;
}

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  if (!value) fail(`--${name} precisa de um valor`);
  return value;
}

function mark(args) {
  const session = option(args, 'session');
  const execution = option(args, 'execution');
  const [specName, action, ...ids] = args;
  if (!(action in MARK)) fail(`ação inválida: ${action}\n${USAGE}`);
  if (!ids.length) fail('informe ao menos uma task');
  if (action !== 'reopen' && (!session || !execution)) fail('informe --session e --execution');

  const spec = load(specName);
  const byId = new Map(spec.tasks.map((task) => [task.id, task]));
  const target = MARK[action];
  const toChange = [];
  // Valida tudo antes de gravar para um lote inválido não deixar a spec pela metade.
  for (const id of ids) {
    const task = byId.get(id);
    if (!task) fail(`task ${id} não existe`);
    if (!task.isLeaf) fail(`task ${id} é pai; ela é concluída automaticamente com as subtasks`);
    if (task.mark === target && action !== 'reopen') continue;
    // Retomada: reenfileirar o escopo não pode regredir o que já está em andamento.
    if (action === 'queued' && task.mark === '-') continue;
    if (!ALLOWED_FROM[action].includes(task.mark)) {
      fail(`task ${id} está "${LABEL[task.mark]}" e não pode ir para "${action}"`);
    }
    toChange.push(task);
  }

  const meta = spec.meta ?? { pbtResults: {}, executionHistory: {} };
  meta.executionHistory ??= {};
  const setMark = (task, value, record) => {
    task.mark = value;
    spec.lines[task.index] = spec.lines[task.index].replace(/- \[.\]/, `- [${value}]`);
    if (record) {
      (meta.executionHistory[task.title] ??= []).push({
        executionId: execution,
        chatSessionId: session,
        timestamp: Date.now(),
      });
    }
  };

  for (const task of toChange) {
    setMark(task, target, action !== 'reopen');
    for (let id = task.parent; id; id = byId.get(id)?.parent) {
      const parent = byId.get(id);
      if (!parent) break;
      if (action === 'reopen') {
        if (parent.mark === 'x') setMark(parent, ' ', false);
      } else if (action === 'done' && parent.mark !== 'x'
        && spec.tasks.filter((c) => c.parent === id && required(c)).every((c) => c.mark === 'x')) {
        setMark(parent, 'x', true);
      }
    }
  }

  writeFileSync(spec.tasksPath, spec.lines.join(spec.eol));
  if (action !== 'reopen' && toChange.length) {
    writeFileSync(spec.metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }
  const changed = toChange.map((task) => task.id).join(', ') || 'nenhuma (já estavam nesse estado)';
  console.log(`${action}: ${changed}`);
}

function init(args) {
  const type = option(args, 'type') ?? 'feature';
  const workflow = option(args, 'workflow') ?? 'requirements-first';
  const [specName] = args;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(specName ?? '')) fail('use um nome de spec em kebab-case');
  if (!['feature', 'bugfix'].includes(type)) fail(`tipo inválido: ${type}`);
  if (!['requirements-first', 'design-first'].includes(workflow)) fail(`workflow inválido: ${workflow}`);
  const dir = join(findRoot(), '.kiro', 'specs', specName);
  if (existsSync(dir)) fail(`a spec já existe: ${dir}`);
  mkdirSync(dir, { recursive: true });
  const config = { specId: randomUUID(), workflowType: workflow, specType: type };
  writeFileSync(join(dir, '.config.kiro'), JSON.stringify(config).replace(/":/g, '": ').replace(/,"/g, ', "'));
  console.log(`Spec criada em ${dir}`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'init': init(args); break;
  case 'status': status(args[0]); break;
  case 'check': check(args[0]); break;
  case 'new-run': console.log(randomUUID()); break;
  case 'mark': mark(args); break;
  case 'help': case undefined: console.log(USAGE); break;
  default: fail(`comando desconhecido: ${command}\n${USAGE}`);
}
