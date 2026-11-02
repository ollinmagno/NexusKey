/** Adaptador do Resend: tudo o que é específico da API fica neste arquivo. */
import { z } from "zod"

const API_URL = "https://api.resend.com"
const TIMEOUT_MS = 10_000
const tokenSchema = z.string().regex(/^re_[A-Za-z0-9_]+$/).min(10)

export const secretSchema = z.object({
  api_key: tokenSchema,
  key_id: z.string().min(1),
})

export const createKeySchema = z.object({
  id: z.string().min(1),
  object: z.literal("api_key"),
  token: tokenSchema,
})

// `created_at` não usa o padrão ISO: a documentação traz "2026-04-08 00:11:13.110779+00".
export const listKeysSchema = z.object({
  object: z.string(),
  has_more: z.boolean(),
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      created_at: z.string().min(1),
    }),
  ),
})

export const deleteKeySchema = z.object({
  object: z.literal("api_key"),
  id: z.string().min(1),
  deleted: z.literal(true),
})

const keyName = (now) => `nexuskey-${now.toISOString().replace(/[-:]|\.\d{3}/g, "")}`

export function createResendAdapter({ fetchFn = (...args) => fetch(...args), log = console } = {}) {
  const fail = (operation, detail) => {
    // Só dados estáticos: nunca token, payload ou a mensagem original do erro.
    log.error(JSON.stringify({ service: "resend", operation, ...detail }))
    return new Error(`Resend ${operation} failed`)
  }

  const send = async (operation, { method, path, token, body }) => {
    try {
      return await fetchFn(`${API_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw fail(operation, { error: err?.name ?? "Error" })
    }
  }

  const parse = async (operation, response, schema) => {
    let data
    try {
      data = await response.json()
    } catch {
      throw fail(operation, { result: "invalid-json" })
    }
    const result = schema.safeParse(data)
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ field: i.path.join("."), code: i.code }))
      throw fail(operation, { result: "invalid-response", issues })
    }
    return result.data
  }

  const ensureOk = (operation, response) => {
    if (!response.ok) throw fail(operation, { status: response.status })
  }

  return {
    secretSchema,

    async create({ current, now }) {
      const response = await send("create", {
        method: "POST",
        path: "/api-keys",
        token: current.api_key,
        body: { name: keyName(now), permission: "full_access" },
      })
      ensureOk("create", response)
      const { id, token } = await parse("create", response, createKeySchema)
      return { api_key: token, key_id: id }
    },

    async test({ pending }) {
      const response = await send("test", {
        method: "GET",
        path: "/api-keys",
        token: pending.api_key,
      })
      ensureOk("test", response)
      await parse("test", response, listKeysSchema)
    },

    async revoke({ previous, current }) {
      const response = await send("revoke", {
        method: "DELETE",
        path: `/api-keys/${encodeURIComponent(previous.key_id)}`,
        token: current.api_key,
      })
      if (response.status === 404) return "already-revoked"
      ensureOk("revoke", response)
      await parse("revoke", response, deleteKeySchema)
      return "revoked"
    },
  }
}

export const adapter = createResendAdapter()
