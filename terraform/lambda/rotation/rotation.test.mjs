import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import { z } from "zod"
import { getAdapter } from "./adapters/index.mjs"
import { handleEvent, rotate } from "./rotation.mjs"
import { FakeSecretsManager } from "./test-support/fake-secrets-manager.mjs"

const SECRET_ID = "arn:aws:secretsmanager:us-east-1:123456789012:secret:nexuskey/fake-AbCdEf"
const STEPS = ["createSecret", "setSecret", "testSecret", "finishSecret"]

/** Serviço externo simulado: registra credenciais ativas e chamadas. */
class FakeService {
  active = new Set(["cred-0"])
  revoked = []
  created = 0
  fail = {}
  calls = []

  adapter(options = {}) {
    const base = {
      secretSchema: z.object({ api_key: z.string().min(5), key_id: z.string().min(1) }),
      create: async ({ current }) => {
        this.calls.push("create")
        if (this.fail.create) throw new Error("create failed")
        if (!this.active.has(current.key_id)) throw new Error("credential revoked")
        this.created += 1
        const id = `cred-${this.created}`
        this.active.add(id)
        return options.invalidCreate ? { key_id: id } : { api_key: `secret-${id}`, key_id: id }
      },
      test: async ({ pending }) => {
        this.calls.push("test")
        if (this.fail.test) throw new Error("test failed")
        if (!this.active.has(pending.key_id)) throw new Error("credential invalid")
      },
      revoke: async ({ previous }) => {
        this.calls.push("revoke")
        if (this.fail.revoke) throw new Error("revoke failed")
        if (!this.active.delete(previous.key_id)) return "already-revoked"
        this.revoked.push(previous.key_id)
        return "revoked"
      },
    }
    if (options.withoutRevoke) delete base.revoke
    if (options.set) base.set = options.set
    return base
  }
}

const silent = { info() {}, warn() {}, error() {} }
const initial = { api_key: "secret-cred-0", key_id: "cred-0" }

describe("rotação", () => {
  let sm
  let service

  const step = (Step, token, adapter = service.adapter(), log = silent) =>
    rotate({
      event: { Step, SecretId: SECRET_ID, ClientRequestToken: token },
      adapter,
      deps: sm.deps,
      log,
    })

  const cycle = async (token, adapter) => {
    sm.startRotation(token)
    for (const name of STEPS) await step(name, token, adapter)
  }

  beforeEach(() => {
    sm = new FakeSecretsManager()
    service = new FakeService()
    sm.seed(initial)
  })

  describe("ciclo completo", () => {
    test("promove a nova credencial e revoga a anterior", async () => {
      await cycle("token-1")

      assert.deepEqual(sm.valueAt("AWSCURRENT"), { api_key: "secret-cred-1", key_id: "cred-1" })
      assert.deepEqual(sm.valueAt("AWSPREVIOUS"), initial)
      assert.deepEqual(service.revoked, ["cred-0"])
      assert.deepEqual([...service.active], ["cred-1"])
    })

    test("segue a ordem criar, gravar, testar, promover e revogar em ciclos seguidos", async () => {
      const order = []
      const { putPending, promote } = sm.deps
      sm.deps.putPending = async (...args) => (order.push("put"), putPending(...args))
      sm.deps.promote = async (...args) => (order.push("promote"), promote(...args))
      const adapter = service.adapter()
      for (const name of ["create", "test", "revoke"]) {
        const original = adapter[name]
        adapter[name] = async (args) => (order.push(name), original(args))
      }

      await cycle("token-1", adapter)
      assert.deepEqual(order, ["create", "put", "test", "promote", "revoke"])

      order.length = 0
      await cycle("token-2", adapter)
      assert.deepEqual(order, ["revoke", "create", "put", "test", "promote", "revoke"])
    })

    test("testa a credencial pendente, não a atual", async () => {
      const tested = []
      const adapter = service.adapter()
      adapter.test = async ({ pending }) => tested.push(pending.key_id)
      await cycle("token-1", adapter)
      assert.deepEqual(tested, ["cred-1"])
    })

    test("dois ciclos seguidos revogam a credencial certa em cada um", async () => {
      await cycle("token-1")
      await cycle("token-2")

      assert.deepEqual(sm.valueAt("AWSCURRENT").key_id, "cred-2")
      assert.deepEqual(sm.valueAt("AWSPREVIOUS").key_id, "cred-1")
      assert.deepEqual(service.revoked, ["cred-0", "cred-1"])
      assert.deepEqual([...service.active], ["cred-2"])
      assert.equal(service.created, 2)
    })

    test("a credencial só muda para as aplicações em finishSecret", async () => {
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      await step("setSecret", "token-1")
      await step("testSecret", "token-1")
      assert.deepEqual(sm.valueAt("AWSCURRENT"), initial)
      assert.deepEqual(service.revoked, [])
    })
  })

  describe("reexecução", () => {
    test("createSecret repetido não cria outra credencial", async () => {
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      await step("createSecret", "token-1")
      assert.equal(service.created, 1)
      assert.equal(sm.calls.filter((c) => c === "putPending").length, 1)
    })

    test("etapas repetidas depois da promoção não têm efeito", async () => {
      await cycle("token-1")
      service.calls.length = 0
      sm.calls.length = 0
      await step("createSecret", "token-1")
      await step("setSecret", "token-1")
      await step("testSecret", "token-1")
      assert.deepEqual(service.calls, [])
      assert.deepEqual(sm.calls, [])
    })

    test("finishSecret repetido não promove de novo e conclui com a revogação feita", async () => {
      await cycle("token-1")
      sm.calls.length = 0
      await step("finishSecret", "token-1")
      assert.deepEqual(sm.calls, [])
      assert.deepEqual(service.revoked, ["cred-0"])
    })

    test("o ciclo inteiro repetido com o mesmo token não duplica nada", async () => {
      await cycle("token-1")
      for (const name of STEPS) await step(name, "token-1")
      assert.equal(service.created, 1)
      assert.deepEqual(service.revoked, ["cred-0"])
    })

    test("setSecret repetido executa a operação do adaptador de forma segura", async () => {
      const seen = []
      const adapter = service.adapter({ set: async ({ pending }) => seen.push(pending.key_id) })
      sm.startRotation("token-1")
      await step("createSecret", "token-1", adapter)
      await step("setSecret", "token-1", adapter)
      await step("setSecret", "token-1", adapter)
      assert.deepEqual(seen, ["cred-1", "cred-1"])
    })
  })

  describe("interrupção", () => {
    test("falha ao criar não grava nada", async () => {
      service.fail.create = true
      sm.startRotation("token-1")
      await assert.rejects(() => step("createSecret", "token-1"), /create failed/)
      assert.deepEqual(sm.calls, [])
      assert.deepEqual(sm.valueAt("AWSCURRENT"), initial)
    })

    test("falha na gravação mantém AWSCURRENT e permite recomeçar", async () => {
      sm.fail.putPending = true
      sm.startRotation("token-1")
      await assert.rejects(() => step("createSecret", "token-1"), /PutSecretValue/)
      assert.deepEqual(sm.valueAt("AWSCURRENT"), initial)

      sm.fail.putPending = false
      await step("createSecret", "token-1")
      assert.equal(sm.valueAt("AWSPENDING").key_id, "cred-2", "a primeira credencial fica órfã: risco documentado")
    })

    test("gravação sem VersionId encerra com erro", async () => {
      sm.fail.noVersionId = true
      sm.startRotation("token-1")
      await assert.rejects(() => step("createSecret", "token-1"), /VersionId/)
    })

    test("teste com falha mantém AWSCURRENT e não revoga", async () => {
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      service.fail.test = true
      await assert.rejects(() => step("testSecret", "token-1"), /test failed/)
      assert.deepEqual(sm.valueAt("AWSCURRENT"), initial)
      assert.deepEqual(service.revoked, [])
    })

    test("promoção sem confirmação não revoga", async () => {
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      sm.deps.promote = async () => {}
      await assert.rejects(() => step("finishSecret", "token-1"), /could not be confirmed/)
      assert.deepEqual(service.revoked, [])
      assert.equal(service.calls.includes("revoke"), false)
    })

    test("promoção com falha não revoga, e a repetição conclui", async () => {
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      await step("testSecret", "token-1")
      sm.fail.promote = true
      await assert.rejects(() => step("finishSecret", "token-1"), /UpdateSecretVersionStage/)
      assert.deepEqual(service.revoked, [])

      sm.fail.promote = false
      await step("finishSecret", "token-1")
      assert.equal(sm.valueAt("AWSCURRENT").key_id, "cred-1")
      assert.deepEqual(service.revoked, ["cred-0"])
    })
  })

  describe("revogação", () => {
    test("falha encerra com erro sem reverter a promoção", async () => {
      service.fail.revoke = true
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      await assert.rejects(() => step("finishSecret", "token-1"), /revoke failed/)
      assert.equal(sm.valueAt("AWSCURRENT").key_id, "cred-1")
    })

    test("a repetição de finishSecret tenta revogar de novo", async () => {
      service.fail.revoke = true
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      await assert.rejects(() => step("finishSecret", "token-1"))

      service.fail.revoke = false
      await step("finishSecret", "token-1")
      assert.deepEqual(service.revoked, ["cred-0"])
    })

    test("o ciclo seguinte recupera a revogação perdida antes de criar", async () => {
      service.fail.revoke = true
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      await assert.rejects(() => step("finishSecret", "token-1"))
      service.fail.revoke = false
      service.calls.length = 0

      sm.startRotation("token-2")
      await step("createSecret", "token-2")

      assert.deepEqual(service.revoked, ["cred-0"])
      assert.deepEqual(service.calls, ["revoke", "create"])
    })

    test("falha na revogação pendente impede criar outra credencial", async () => {
      service.fail.revoke = true
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      await assert.rejects(() => step("finishSecret", "token-1"))
      const created = service.created

      sm.startRotation("token-2")
      await assert.rejects(() => step("createSecret", "token-2"), /revoke failed/)
      assert.equal(service.created, created)
      assert.equal(sm.valueAt("AWSPENDING"), null)
    })

    test("credencial já revogada conclui com sucesso", async () => {
      service.active.delete("cred-0")
      service.active.add("cred-0-copy")
      sm.seed({ api_key: "secret-cred-x", key_id: "cred-0-copy" }, "v-other")
      sm.versions.get("v-initial").stages.clear()
      sm.moveStage("AWSPREVIOUS", "v-initial")
      await cycle("token-1")
      assert.equal(sm.valueAt("AWSCURRENT").key_id, "cred-1")
    })

    test("AWSPREVIOUS igual à credencial em uso nunca é revogado", async () => {
      sm.seed(initial, "v-copy")
      sm.versions.get("v-initial").stages.clear()
      sm.moveStage("AWSPREVIOUS", "v-initial")
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      assert.deepEqual(service.revoked, [])
      assert.equal(service.calls.includes("revoke"), false)
    })

    test("adaptador sem revogação conclui sem tentar revogar", async () => {
      const adapter = service.adapter({ withoutRevoke: true })
      await cycle("token-1", adapter)
      await cycle("token-2", adapter)
      assert.equal(sm.valueAt("AWSCURRENT").key_id, "cred-2")
      assert.deepEqual(service.revoked, [])
    })
  })

  describe("operações opcionais", () => {
    test("setSecret não faz nada sem a operação", async () => {
      sm.startRotation("token-1")
      await step("createSecret", "token-1")
      service.calls.length = 0
      await step("setSecret", "token-1")
      assert.deepEqual(service.calls, [])
    })

    test("setSecret usa a operação do adaptador com a credencial pendente e a atual", async () => {
      let received
      const adapter = service.adapter({ set: async (args) => (received = args) })
      sm.startRotation("token-1")
      await step("createSecret", "token-1", adapter)
      await step("setSecret", "token-1", adapter)
      assert.equal(received.pending.key_id, "cred-1")
      assert.equal(received.current.key_id, "cred-0")
    })
  })

  describe("pré-condições", () => {
    test("Step inválido encerra sem efeito colateral", async () => {
      sm.startRotation("token-1")
      await assert.rejects(() => step("deleteSecret", "token-1"), /Unknown rotation step/)
      assert.deepEqual(service.calls, [])
    })

    for (const [form, name] of [
      ["create_secret", "createSecret"],
      ["set_secret", "setSecret"],
      ["test_secret", "testSecret"],
      ["finish_secret", "finishSecret"],
    ]) {
      test(`${form} equivale a ${name}`, async () => {
        sm.startRotation("token-1")
        await step("create_secret", "token-1")
        await step(form, "token-1")
        assert.equal(service.created, 1)
      })
    }

    test("rotação desativada encerra sem efeito colateral", async () => {
      sm.rotationEnabled = false
      sm.startRotation("token-1")
      await assert.rejects(() => step("createSecret", "token-1"), /not enabled/)
      assert.deepEqual(service.calls, [])
    })

    test("token desconhecido encerra sem efeito colateral", async () => {
      await assert.rejects(() => step("createSecret", "token-x"), /Unknown rotation token/)
      assert.deepEqual(service.calls, [])
    })

    test("versão fora de AWSPENDING encerra sem efeito colateral", async () => {
      await cycle("token-1")
      service.calls.length = 0
      assert.deepEqual(sm.stageOf("v-initial"), ["AWSPREVIOUS"])
      await assert.rejects(() => step("createSecret", "v-initial"), /not pending/)
      assert.deepEqual(service.calls, [])
    })
  })

  describe("valor inicial", () => {
    const invalidCases = [
      ["ausente", null],
      ["sem o identificador", JSON.stringify({ api_key: "secret-cred-0" })],
      ["com JSON inválido", "secret-sem-json"],
    ]

    for (const [name, value] of invalidCases) {
      test(`${name} não chama o serviço nem grava`, async () => {
        sm.versions.get("v-initial").value = value
        sm.startRotation("token-1")
        await assert.rejects(() => step("createSecret", "token-1"))
        assert.deepEqual(service.calls, [])
        assert.deepEqual(sm.calls, [])
      })
    }

    test("valor criado fora do schema não é gravado", async () => {
      sm.startRotation("token-1")
      await assert.rejects(
        () => step("createSecret", "token-1", service.adapter({ invalidCreate: true })),
        /schema validation/,
      )
      assert.deepEqual(sm.calls, [])
    })
  })

  describe("logs", () => {
    const capture = () => {
      const lines = []
      const write = (line) => lines.push(line)
      return { lines, log: { info: write, warn: write, error: write } }
    }

    test("um ciclo completo não registra nenhum valor", async () => {
      const { lines, log } = capture()
      sm.startRotation("token-1")
      for (const name of STEPS) await step(name, "token-1", service.adapter(), log)
      assert.ok(lines.length > 0)
      assert.equal(lines.join("\n").includes("secret-cred"), false)
    })

    test("segredo inválido registra só campo e código", async () => {
      const { lines, log } = capture()
      sm.versions.get("v-initial").value = JSON.stringify({ api_key: "secret-curto-demais-x", key_id: "" })
      sm.startRotation("token-1")
      await assert.rejects(() => step("createSecret", "token-1", service.adapter(), log))
      const output = lines.join("\n")
      assert.equal(output.includes("secret-curto"), false)
      assert.match(output, /"field":"key_id"/)
    })

    test("JSON inválido não reproduz o valor no erro nem no log", async () => {
      const { lines, log } = capture()
      sm.versions.get("v-initial").value = "secret-sem-json"
      sm.startRotation("token-1")
      await assert.rejects(
        () => step("createSecret", "token-1", service.adapter(), log),
        (err) => !err.message.includes("secret-sem-json"),
      )
      assert.equal(lines.join("\n").includes("secret-sem-json"), false)
    })
  })

  describe("handler", () => {
    const run = (overrides = {}) =>
      handleEvent({
        event: { Step: "createSecret", SecretId: SECRET_ID, ClientRequestToken: "token-1" },
        serviceName: "fake",
        getAdapter: () => service.adapter(),
        deps: sm.deps,
        log: silent,
        ...overrides,
      })

    test("seleciona o adaptador pelo nome do serviço", async () => {
      let received
      sm.startRotation("token-1")
      await run({
        getAdapter: (name) => {
          received = name
          return service.adapter()
        },
      })
      assert.equal(received, "fake")
      assert.equal(service.created, 1)
    })

    test("erro relançado e log não carregam dados da falha original", async () => {
      const lines = []
      const log = { info() {}, warn() {}, error: (line) => lines.push(line) }
      sm.startRotation("token-1")
      const adapter = service.adapter()
      adapter.create = async () => {
        const err = new TypeError("falha com secret-vazado")
        throw err
      }

      await assert.rejects(
        () => run({ getAdapter: () => adapter, log }),
        (err) => {
          assert.equal(err.name, "RotationError")
          assert.equal(err.message, "Rotation failed at step createSecret")
          assert.equal(err.cause, undefined)
          assert.equal(String(err.stack).includes("secret-vazado"), false)
          return true
        },
      )
      assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ error: "TypeError", step: "createSecret" }])
    })

    test("adaptador inexistente encerra sem efeito colateral", async () => {
      sm.startRotation("token-1")
      await assert.rejects(() => run({ getAdapter }), { name: "RotationError" })
      assert.deepEqual(sm.calls, [])
    })
  })

  describe("registro de adaptadores", () => {
    test("rejeita serviço desconhecido e nomes herdados do Object", () => {
      assert.throws(() => getAdapter("inexistente"), /not found/)
      assert.throws(() => getAdapter("constructor"), /not found/)
    })
  })
})
