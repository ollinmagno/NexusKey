import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import { getAdapter } from "./index.mjs"
import {
  createKeySchema,
  createResendAdapter,
  deleteKeySchema,
  listKeysSchema,
  secretSchema,
} from "./resend.mjs"
import { handleEvent } from "../rotation.mjs"
import { FakeSecretsManager } from "../test-support/fake-secrets-manager.mjs"

const TOKEN = "re_c1tpEyD8_NKFusih9vKVQknRAQfmFcWCv"
const NEW_TOKEN = "re_NewTokenDocFormat_123456"
const KEY_ID = "dacf4072-4119-4d88-932f-6202748ac7c8"

// Respostas copiadas da documentação do Resend.
const DOC_CREATE = { id: KEY_ID, object: "api_key", token: TOKEN }
const DOC_LIST = {
  object: "list",
  has_more: false,
  data: [
    {
      id: "91f3200a-df72-4654-b0cd-f202395f5354",
      name: "Production",
      created_at: "2026-04-08 00:11:13.110779+00",
      last_used_at: "2026-11-01 17:09:51.813959+00",
    },
  ],
}
const DOC_DELETE = { object: "api_key", id: "b6d24b8e-af0b-4c3c-be0c-359bbd97381e", deleted: true }

const json = (status, body) => new Response(JSON.stringify(body), { status })

function capture() {
  const lines = []
  return { lines, log: { info() {}, warn() {}, error: (line) => lines.push(line) } }
}

function setup(reply) {
  const calls = []
  const { lines, log } = capture()
  const adapter = createResendAdapter({
    log,
    fetchFn: async (url, init) => {
      calls.push({ url, ...init, headers: init.headers })
      return typeof reply === "function" ? reply(url, init) : reply
    },
  })
  return { adapter, calls, lines }
}

const assertNoSecrets = (text) => {
  for (const secret of [TOKEN, NEW_TOKEN]) assert.equal(text.includes(secret), false)
}

describe("schemas do Resend", () => {
  const validSecret = { api_key: TOKEN, key_id: KEY_ID }

  test("aceitam as respostas da documentação", () => {
    assert.equal(createKeySchema.safeParse(DOC_CREATE).success, true)
    assert.equal(listKeysSchema.safeParse(DOC_LIST).success, true)
    assert.equal(deleteKeySchema.safeParse(DOC_DELETE).success, true)
  })

  test("o segredo mantém só api_key e key_id", () => {
    assert.deepEqual(secretSchema.parse({ ...validSecret, extra: "x" }), validSecret)
  })

  const rejected = [
    ["token sem o prefixo re_", secretSchema, { api_key: "xx_1234567890", key_id: KEY_ID }],
    ["token curto", secretSchema, { api_key: "re_short", key_id: KEY_ID }],
    ["token com caractere inválido", secretSchema, { api_key: "re_abc-defghijk", key_id: KEY_ID }],
    ["segredo sem key_id", secretSchema, { api_key: TOKEN }],
    ["key_id vazio", secretSchema, { api_key: TOKEN, key_id: "" }],
    ["criação sem id", createKeySchema, { object: "api_key", token: TOKEN }],
    ["criação com object errado", createKeySchema, { ...DOC_CREATE, object: "key" }],
    ["criação com token inválido", createKeySchema, { ...DOC_CREATE, token: "invalido" }],
    ["listagem com has_more errado", listKeysSchema, { ...DOC_LIST, has_more: "false" }],
    ["listagem sem data", listKeysSchema, { object: "list", has_more: false }],
    ["item sem created_at", listKeysSchema, { ...DOC_LIST, data: [{ id: "a", name: "n" }] }],
    ["item com created_at vazio", listKeysSchema, { ...DOC_LIST, data: [{ id: "a", name: "n", created_at: "" }] }],
    ["deleção com deleted false", deleteKeySchema, { ...DOC_DELETE, deleted: false }],
    ["deleção com object errado", deleteKeySchema, { ...DOC_DELETE, object: "x" }],
    ["deleção sem id", deleteKeySchema, { object: "api_key", deleted: true }],
  ]

  for (const [name, schema, value] of rejected) {
    test(`rejeitam ${name}`, () => {
      assert.equal(schema.safeParse(value).success, false)
    })
  }
})

describe("create", () => {
  const current = { api_key: TOKEN, key_id: KEY_ID }
  const now = new Date("2026-11-01T12:30:45.678Z")

  test("envia POST com nome, permissão e a chave atual", async () => {
    const { adapter, calls } = setup(json(201, { id: "new-id", object: "api_key", token: NEW_TOKEN }))
    await adapter.create({ current, now })

    const [call] = calls
    assert.equal(call.url, "https://api.resend.com/api-keys")
    assert.equal(call.method, "POST")
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`)
    assert.deepEqual(JSON.parse(call.body), { name: "nexuskey-20261101T123045Z", permission: "full_access" })
    assert.ok(JSON.parse(call.body).name.length <= 50)
    assert.ok(call.signal instanceof AbortSignal)
  })

  test("retorna só api_key e key_id", async () => {
    const { adapter } = setup(json(201, { id: "new-id", object: "api_key", token: NEW_TOKEN, extra: "x" }))
    assert.deepEqual(await adapter.create({ current, now }), { api_key: NEW_TOKEN, key_id: "new-id" })
  })
})

describe("test", () => {
  test("lista as chaves usando a chave pendente", async () => {
    const { adapter, calls } = setup(json(200, DOC_LIST))
    await adapter.test({ pending: { api_key: NEW_TOKEN, key_id: "new-id" } })
    assert.equal(calls[0].method, "GET")
    assert.equal(calls[0].url, "https://api.resend.com/api-keys")
    assert.equal(calls[0].headers.Authorization, `Bearer ${NEW_TOKEN}`)
    assert.equal(calls[0].body, undefined)
  })
})

describe("revoke", () => {
  const previous = { api_key: TOKEN, key_id: "old/id" }
  const current = { api_key: NEW_TOKEN, key_id: "new-id" }

  test("usa o key_id na URL, nunca o token, e a chave informada como Bearer", async () => {
    const { adapter, calls } = setup(json(200, DOC_DELETE))
    assert.equal(await adapter.revoke({ previous, current }), "revoked")
    assert.equal(calls[0].method, "DELETE")
    assert.equal(calls[0].url, "https://api.resend.com/api-keys/old%2Fid")
    assert.equal(calls[0].url.includes(TOKEN), false)
    assert.equal(calls[0].headers.Authorization, `Bearer ${NEW_TOKEN}`)
  })

  test("404 informa que a chave já estava revogada, mesmo sem corpo JSON", async () => {
    const { adapter } = setup(new Response("not found", { status: 404 }))
    assert.equal(await adapter.revoke({ previous, current }), "already-revoked")
  })
})

describe("falhas", () => {
  const secret = { api_key: TOKEN, key_id: KEY_ID }
  const operations = {
    create: (adapter) => adapter.create({ current: secret, now: new Date() }),
    test: (adapter) => adapter.test({ pending: secret }),
    revoke: (adapter) => adapter.revoke({ previous: secret, current: { api_key: NEW_TOKEN, key_id: "n" } }),
  }

  const failures = {
    "status 500": () => json(500, { message: `erro com ${TOKEN}` }),
    "status 401": () => json(401, { message: "Unauthorized" }),
    "corpo não JSON": () => new Response(`<html>${TOKEN}</html>`, { status: 200 }),
    "schema inválido": () => json(200, { token: TOKEN, unexpected: true }),
    timeout: () => {
      const err = new Error("aborted")
      err.name = "TimeoutError"
      throw err
    },
    "erro de rede": () => {
      throw new TypeError(`fetch failed ${TOKEN}`)
    },
  }

  for (const [operation, run] of Object.entries(operations)) {
    for (const [name, reply] of Object.entries(failures)) {
      test(`${operation} com ${name} lança sem expor chaves`, async () => {
        const { adapter, lines } = setup(reply)
        await assert.rejects(
          () => run(adapter),
          (err) => {
            assert.equal(err.message, `Resend ${operation} failed`)
            assertNoSecrets(`${err.message} ${err.stack}`)
            return true
          },
        )
        assert.equal(lines.length, 1)
        assertNoSecrets(lines.join("\n"))
      })
    }
  }

  const validBodies = { create: DOC_CREATE, test: DOC_LIST, revoke: DOC_DELETE }

  for (const [operation, run] of Object.entries(operations)) {
    test(`${operation} com status de erro e corpo válido lança`, async () => {
      const { adapter, lines } = setup(json(500, validBodies[operation]))
      await assert.rejects(() => run(adapter), new RegExp(`Resend ${operation} failed`))
      assert.match(lines[0], /"status":500/)
    })
  }

  test("schema inválido registra só campo e código", async () => {
    const { adapter, lines } = setup(json(200, { id: "a", object: "api_key", token: "invalido-com-valor" }))
    await assert.rejects(() => adapter.create({ current: secret, now: new Date() }))
    assert.match(lines[0], /"field":"token"/)
    assert.equal(lines[0].includes("invalido-com-valor"), false)
  })
})

describe("registro", () => {
  test("o adaptador resend está disponível e não define set", () => {
    const adapter = getAdapter("resend")
    assert.equal(typeof adapter.create, "function")
    assert.equal(typeof adapter.test, "function")
    assert.equal(typeof adapter.revoke, "function")
    assert.equal(adapter.set, undefined)
  })
})

describe("integração com o núcleo", () => {
  /** Resend simulado: guarda as chaves ativas e exige Bearer válido, como a API real. */
  class FakeResend {
    keys = new Map()
    revoked = []
    counter = 0

    constructor(token, id) {
      this.keys.set(token, id)
    }

    fetch = async (url, init) => {
      const token = init.headers.Authorization.replace("Bearer ", "")
      if (!this.keys.has(token)) return json(401, { message: "Invalid API key" })
      const { pathname } = new URL(url)

      if (init.method === "POST" && pathname === "/api-keys") {
        this.counter += 1
        const id = `key-${this.counter}`
        const created = `re_rotated_token_${this.counter}`
        this.keys.set(created, id)
        return json(201, { id, object: "api_key", token: created })
      }
      if (init.method === "GET" && pathname === "/api-keys") {
        const data = [...this.keys.values()].map((id) => ({
          id,
          name: "k",
          created_at: "2026-04-08 00:11:13.110779+00",
        }))
        return json(200, { object: "list", has_more: false, data })
      }
      if (init.method === "DELETE") {
        const id = pathname.split("/").pop()
        const entry = [...this.keys].find(([, value]) => value === id)
        if (!entry) return json(404, { message: "not found" })
        this.keys.delete(entry[0])
        this.revoked.push(id)
        return json(200, { object: "api_key", id, deleted: true })
      }
      return json(405, {})
    }
  }

  const silent = { info() {}, warn() {}, error() {} }
  const STEPS = ["createSecret", "setSecret", "testSecret", "finishSecret"]
  let sm
  let resend
  let adapter

  const cycle = async (token) => {
    sm.startRotation(token)
    for (const Step of STEPS) {
      await handleEvent({
        event: { Step, SecretId: "s", ClientRequestToken: token },
        serviceName: "resend",
        getAdapter: () => adapter,
        deps: sm.deps,
        log: silent,
      })
    }
  }

  beforeEach(() => {
    sm = new FakeSecretsManager()
    sm.seed({ api_key: TOKEN, key_id: "key-initial" })
    resend = new FakeResend(TOKEN, "key-initial")
    adapter = createResendAdapter({ fetchFn: resend.fetch, log: silent })
  })

  test("dois ciclos revogam a chave certa e deixam só a atual ativa", async () => {
    await cycle("token-1")
    assert.deepEqual(sm.valueAt("AWSCURRENT"), { api_key: "re_rotated_token_1", key_id: "key-1" })
    assert.deepEqual(resend.revoked, ["key-initial"])

    await cycle("token-2")
    assert.deepEqual(sm.valueAt("AWSCURRENT"), { api_key: "re_rotated_token_2", key_id: "key-2" })
    assert.deepEqual(resend.revoked, ["key-initial", "key-1"])
    assert.deepEqual([...resend.keys.keys()], ["re_rotated_token_2"])
  })

  test("a chave ativa ao final funciona, e as anteriores são recusadas", async () => {
    await cycle("token-1")
    const list = (token) =>
      resend.fetch("https://api.resend.com/api-keys", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      })
    assert.equal((await list(sm.valueAt("AWSCURRENT").api_key)).status, 200)
    assert.equal((await list(TOKEN)).status, 401)
  })

  test("chave inicial sem key_id não cria nem revoga nada", async () => {
    sm.versions.get("v-initial").value = JSON.stringify({ api_key: TOKEN })
    sm.startRotation("token-1")
    await assert.rejects(() =>
      handleEvent({
        event: { Step: "createSecret", SecretId: "s", ClientRequestToken: "token-1" },
        serviceName: "resend",
        getAdapter: () => adapter,
        deps: sm.deps,
        log: silent,
      }),
    )
    assert.equal(resend.counter, 0)
    assert.deepEqual(resend.revoked, [])
  })
})
