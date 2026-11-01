import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createKeySchema, listKeysSchema, deleteKeySchema } from "./schema.mjs"
import { rotate } from "./rotation.mjs"

describe("Schema validation", () => {
  describe("createKeySchema", () => {
    test("accepts valid payload", () => {
      const result = createKeySchema.safeParse({
        id: "key_abc123",
        object: "api_key",
        token: "re_AbCdEf1234",
      })
      assert.equal(result.success, true)
    })

    test("rejects missing id", () => {
      const result = createKeySchema.safeParse({ object: "api_key", token: "re_AbCdEf1234" })
      assert.equal(result.success, false)
    })

    test("rejects wrong object literal", () => {
      const result = createKeySchema.safeParse({ id: "k1", object: "wrong", token: "re_AbCdEf1234" })
      assert.equal(result.success, false)
    })

    test("rejects token not matching regex", () => {
      const result = createKeySchema.safeParse({ id: "k1", object: "api_key", token: "invalid_token" })
      assert.equal(result.success, false)
    })

    test("rejects token shorter than 10 chars", () => {
      const result = createKeySchema.safeParse({ id: "k1", object: "api_key", token: "re_short" })
      assert.equal(result.success, false)
    })
  })

  describe("listKeysSchema", () => {
    test("accepts valid payload", () => {
      const result = listKeysSchema.safeParse({
        object: "list",
        has_more: false,
        data: [{ id: "k1", name: "My Key", created_at: "2024-01-01T00:00:00Z" }],
      })
      assert.equal(result.success, true)
    })

    test("accepts empty data array", () => {
      const result = listKeysSchema.safeParse({ object: "list", has_more: false, data: [] })
      assert.equal(result.success, true)
    })

    test("rejects non-boolean has_more", () => {
      const result = listKeysSchema.safeParse({ object: "list", has_more: "false", data: [] })
      assert.equal(result.success, false)
    })

    test("rejects invalid created_at format", () => {
      const result = listKeysSchema.safeParse({
        object: "list",
        has_more: false,
        data: [{ id: "k1", name: "n", created_at: "not-a-date" }],
      })
      assert.equal(result.success, false)
    })

    test("rejects missing data field", () => {
      const result = listKeysSchema.safeParse({ object: "list", has_more: false })
      assert.equal(result.success, false)
    })
  })

  describe("deleteKeySchema", () => {
    test("accepts valid payload", () => {
      const result = deleteKeySchema.safeParse({ object: "api_key", id: "k1", deleted: true })
      assert.equal(result.success, true)
    })

    test("rejects deleted: false", () => {
      const result = deleteKeySchema.safeParse({ object: "api_key", id: "k1", deleted: false })
      assert.equal(result.success, false)
    })

    test("rejects wrong object literal", () => {
      const result = deleteKeySchema.safeParse({ object: "other", id: "k1", deleted: true })
      assert.equal(result.success, false)
    })

    test("rejects missing id", () => {
      const result = deleteKeySchema.safeParse({ object: "api_key", deleted: true })
      assert.equal(result.success, false)
    })
  })
})

describe("rotate â€” revocation failures are soft", () => {
  const buildSuccessfulDeps = (deleteStatus) => {
    const calls = []
    return {
      calls,
      deps: {
        getCurrentKeyId: async () => "some_other_id",
        callResendApi: async (method, path) => {
          calls.push(`${method}:${path}`)
          if (method === "POST") {
            return { status: 201, data: { id: "new_k", object: "api_key", token: "re_NewToken12345" } }
          }
          return { status: deleteStatus, data: {} }
        },
        putSecret: async () => ({ VersionId: "v1" }),
        putParameter: async () => {},
      },
    }
  }

  test("DELETE returns 404: function exits without error", async () => {
    const { deps } = buildSuccessfulDeps(404)

    // Must NOT throw â€” 404 means key already revoked, that's idempotent success
    await assert.doesNotReject(
      () => rotate({
        currentKeyToken: "re_CurrentToken123",
        oldKeyId: "old_key_404",
        secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:test",
        parameterArn: "arn:aws:ssm:us-east-1:123:parameter/test",
        deps,
      }),
    )
  })

  test("DELETE returns 500: function exits without error (soft failure)", async () => {
    const { deps } = buildSuccessfulDeps(500)

    // Must NOT throw â€” non-2xx DELETE is a warning, not an error
    await assert.doesNotReject(
      () => rotate({
        currentKeyToken: "re_CurrentToken123",
        oldKeyId: "old_key_500",
        secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:test",
        parameterArn: "arn:aws:ssm:us-east-1:123:parameter/test",
        deps,
      }),
    )
  })

  test("DELETE network error: function exits without error (soft failure)", async () => {
    const deps = {
      getCurrentKeyId: async () => "some_other_id",
      callResendApi: async (method) => {
        if (method === "POST") {
          return { status: 201, data: { id: "new_k", object: "api_key", token: "re_NewToken12345" } }
        }
        throw new Error("Network timeout")
      },
      putSecret: async () => ({ VersionId: "v1" }),
      putParameter: async () => {},
    }

    // Must NOT throw â€” network errors on DELETE are soft failures
    await assert.doesNotReject(
      () => rotate({
        currentKeyToken: "re_CurrentToken123",
        oldKeyId: "old_key_net",
        secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:test",
        parameterArn: "arn:aws:ssm:us-east-1:123:parameter/test",
        deps,
      }),
    )
  })
})

describe("rotate â€” failure at breakpoints", () => {
  const baseParams = {
    currentKeyToken: "re_CurrentToken123",
    oldKeyId: "old_key_break",
    secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:test",
    parameterArn: "arn:aws:ssm:us-east-1:123:parameter/test",
  }

  test("Zod validation failure on key creation: DELETE never called", async () => {
    let deleteCalled = false

    const deps = {
      getCurrentKeyId: async () => "some_other_id",
      callResendApi: async (method) => {
        if (method === "DELETE") deleteCalled = true
        // Return an invalid payload that fails createKeySchema
        return { status: 200, data: { id: "k1", object: "wrong_literal", token: "re_ValidToken12345" } }
      },
      putSecret: async () => ({ VersionId: "v1" }),
      putParameter: async () => {},
    }

    // Use a token that does NOT match re_* pattern so partial-idempotency is skipped
    // and POST is actually called, exercising the Zod validation path.
    await assert.rejects(
      () => rotate({ ...baseParams, currentKeyToken: "invalid_token_forces_post", deps }),
      /schema validation/i,
    )

    assert.equal(deleteCalled, false, "DELETE must not be called after Zod failure")
  })

  test("PutSecretValue throws: DELETE never called", async () => {
    let deleteCalled = false

    const deps = {
      getCurrentKeyId: async () => "some_other_id",
      callResendApi: async (method) => {
        if (method === "DELETE") deleteCalled = true
        return { status: 201, data: { id: "new_k", object: "api_key", token: "re_NewToken12345" } }
      },
      putSecret: async () => { throw new Error("AWS PutSecretValue failed") },
      putParameter: async () => {},
    }

    await assert.rejects(
      () => rotate({ ...baseParams, deps }),
      /PutSecretValue|AWS/i,
    )

    assert.equal(deleteCalled, false, "DELETE must not be called after putSecret failure")
  })

  test("PutParameter throws: DELETE never called", async () => {
    let deleteCalled = false

    const deps = {
      getCurrentKeyId: async () => "some_other_id",
      callResendApi: async (method) => {
        if (method === "DELETE") deleteCalled = true
        return { status: 201, data: { id: "new_k", object: "api_key", token: "re_NewToken12345" } }
      },
      putSecret: async () => ({ VersionId: "v1" }),
      putParameter: async () => { throw new Error("AWS PutParameter failed") },
    }

    await assert.rejects(
      () => rotate({ ...baseParams, deps }),
      /AWS PutParameter/i,
    )

    assert.equal(deleteCalled, false, "DELETE must not be called after putParameter failure")
  })
})

describe("rotate â€” full idempotency", () => {
  test("exits early when currentKeyId === oldKeyId, no other deps called", async () => {
    const sameId = "same_key_id"
    const calls = []

    const deps = {
      getCurrentKeyId: async () => { calls.push("getCurrentKeyId"); return sameId },
      callResendApi: async () => { calls.push("callResendApi"); return {} },
      putSecret: async () => { calls.push("putSecret"); return { VersionId: "v1" } },
      putParameter: async () => { calls.push("putParameter") },
    }

    await rotate({
      currentKeyToken: "re_OldToken12345",
      oldKeyId: sameId,
      secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:test",
      parameterArn: "arn:aws:ssm:us-east-1:123:parameter/test",
      deps,
    })

    assert.deepEqual(calls, ["getCurrentKeyId"], "only getCurrentKeyId should be called")
    assert.ok(!calls.includes("callResendApi"), "callResendApi must not be called")
    assert.ok(!calls.includes("putSecret"), "putSecret must not be called")
    assert.ok(!calls.includes("putParameter"), "putParameter must not be called")
  })
})

describe("rotate â€” happy path", () => {
  test("creates key, saves to SM, saves to SSM, revokes old key", async () => {
    const calls = []
    const newKeyId = "new_key_abc"
    const newKeyToken = "re_NewKeyToken12345"
    const oldKeyId = "old_key_xyz"
    const currentKeyToken = "not_a_resend_token_123"

    const deps = {
      getCurrentKeyId: async () => { calls.push("getCurrentKeyId"); return "some_other_id" },
      callResendApi: async (method, path) => {
        calls.push(`callResendApi:${method}:${path}`)
        if (method === "POST") {
          return { status: 201, data: { id: newKeyId, object: "api_key", token: newKeyToken } }
        }
        if (method === "DELETE") {
          return { status: 200, data: { object: "api_key", id: oldKeyId, deleted: true } }
        }
      },
      putSecret: async () => { calls.push("putSecret"); return { VersionId: "v1" } },
      putParameter: async () => { calls.push("putParameter") },
    }

    await rotate({
      currentKeyToken,
      oldKeyId,
      secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:test",
      parameterArn: "arn:aws:ssm:us-east-1:123:parameter/test",
      deps,
    })

    assert.ok(calls.includes("getCurrentKeyId"), "should call getCurrentKeyId")
    assert.ok(calls.includes("callResendApi:POST:/api-keys"), "should POST to create key")
    assert.ok(calls.includes("putSecret"), "should save to Secrets Manager")
    assert.ok(calls.includes("putParameter"), "should save to Parameter Store")
    assert.ok(calls.includes(`callResendApi:DELETE:/api-keys/${oldKeyId}`), "should DELETE old key")

    const postIdx = calls.indexOf("callResendApi:POST:/api-keys")
    const putSecretIdx = calls.indexOf("putSecret")
    const putParamIdx = calls.indexOf("putParameter")
    const deleteIdx = calls.indexOf(`callResendApi:DELETE:/api-keys/${oldKeyId}`)
    assert.ok(postIdx < putSecretIdx, "POST should happen before putSecret")
    assert.ok(putSecretIdx < putParamIdx, "putSecret should happen before putParameter")
    assert.ok(putParamIdx < deleteIdx, "putParameter should happen before DELETE")
  })
})

describe("rotate â€” partial idempotency", () => {
  test("skips key generation when SM already has new key, goes to revocation", async () => {
    const newKeyId = "new_key_partial"
    const newKeyToken = "re_NewKeyPartial123"
    const oldKeyId = "old_key_partial"
    const calls = []

    const deps = {
      getCurrentKeyId: async () => { calls.push("getCurrentKeyId"); return newKeyId },
      callResendApi: async (method) => {
        calls.push(`callResendApi:${method}`)
        if (method === "DELETE") {
          return { status: 200, data: { object: "api_key", id: oldKeyId, deleted: true } }
        }
        return { status: 201, data: {} }
      },
      putSecret: async () => { calls.push("putSecret"); return { VersionId: "v1" } },
      putParameter: async () => { calls.push("putParameter") },
    }

    await rotate({
      currentKeyToken: newKeyToken,
      oldKeyId,
      secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:test",
      parameterArn: "arn:aws:ssm:us-east-1:123:parameter/test",
      deps,
    })

    assert.ok(!calls.includes("callResendApi:POST"), "POST should NOT be called (skip generation)")
    assert.ok(calls.includes("callResendApi:DELETE"), "DELETE should be called (revocation)")
    assert.ok(calls.includes("putSecret"), "putSecret should be called")
    assert.ok(calls.includes("putParameter"), "putParameter should be called")
  })
})

