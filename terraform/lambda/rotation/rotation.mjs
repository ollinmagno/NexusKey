/**
 * Etapas da rotação nativa do Secrets Manager, independentes do serviço externo.
 * O I/O com a AWS é injetado em `deps`, e o específico do serviço fica em `adapter`.
 *
 * deps:
 *   describe(secretId)                         { RotationEnabled, VersionIdsToStages }
 *   getValue(secretId, { versionId?, stage })  string, ou null se a versão não tiver valor
 *   putPending(secretId, token, value)         { VersionId }
 *   promote(secretId, token, currentVersionId) move AWSCURRENT para `token`
 */

const STEPS = {
  createSecret: "createSecret",
  create_secret: "createSecret",
  setSecret: "setSecret",
  set_secret: "setSecret",
  testSecret: "testSecret",
  test_secret: "testSecret",
  finishSecret: "finishSecret",
  finish_secret: "finishSecret",
}

const CURRENT = "AWSCURRENT"
const PENDING = "AWSPENDING"
const PREVIOUS = "AWSPREVIOUS"

function findVersion(versions, stage) {
  return Object.keys(versions).find((id) => versions[id].includes(stage))
}

export async function rotate({ event, adapter, deps, log = console }) {
  const step = STEPS[event?.Step]
  if (!step) throw new Error("Unknown rotation step")

  const { SecretId: secretId, ClientRequestToken: token } = event
  const info = (result) => log.info(JSON.stringify({ step, result }))

  const parse = (value) => {
    const result = adapter.secretSchema.safeParse(value)
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ field: i.path.join("."), code: i.code }))
      log.error(JSON.stringify({ step, result: "invalid-secret", issues }))
      throw new Error("Secret value failed schema validation")
    }
    return result.data
  }

  const readSecret = async (selector) => {
    const raw = await deps.getValue(secretId, selector)
    if (raw === null) throw new Error("Secret version has no value")
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      // A mensagem original do JSON.parse pode reproduzir parte do valor.
      log.error(JSON.stringify({ step, result: "invalid-secret", code: "invalid_json" }))
      throw new Error("Secret value is not valid JSON")
    }
    return parse(value)
  }

  const revokePrevious = async (versions, current) => {
    if (!adapter.revoke || !findVersion(versions, PREVIOUS)) return
    const raw = await deps.getValue(secretId, { stage: PREVIOUS })
    if (raw === null) return
    const previous = await readSecret({ stage: PREVIOUS })
    // Regravar o mesmo valor deixa AWSPREVIOUS igual à credencial em uso, que não pode ser revogada.
    if (JSON.stringify(previous) === JSON.stringify(current)) {
      info("previous-equals-current")
      return
    }
    info(`previous-${await adapter.revoke({ previous, current })}`)
  }

  const { RotationEnabled, VersionIdsToStages: versions = {} } = await deps.describe(secretId)
  if (!RotationEnabled) throw new Error("Rotation is not enabled for this secret")

  const stages = versions[token]
  if (!stages) throw new Error("Unknown rotation token")

  const isCurrent = stages.includes(CURRENT)
  if (!isCurrent && !stages.includes(PENDING)) throw new Error("Version is not pending rotation")

  if (step !== "finishSecret" && isCurrent) {
    info("already-current")
    return
  }

  if (step === "createSecret") {
    if ((await deps.getValue(secretId, { versionId: token, stage: PENDING })) !== null) {
      info("already-created")
      return
    }
    const current = await readSecret({ stage: CURRENT })
    await revokePrevious(versions, current)
    const value = parse(await adapter.create({ current, now: new Date() }))
    const { VersionId } = await deps.putPending(secretId, token, JSON.stringify(value))
    if (!VersionId) throw new Error("PutSecretValue returned no VersionId")
    info("created")
    return
  }

  if (step === "setSecret") {
    if (!adapter.set) {
      info("skipped")
      return
    }
    await adapter.set({
      pending: await readSecret({ versionId: token, stage: PENDING }),
      current: await readSecret({ stage: CURRENT }),
    })
    info("set")
    return
  }

  if (step === "testSecret") {
    await adapter.test({ pending: await readSecret({ versionId: token, stage: PENDING }) })
    info("tested")
    return
  }

  let latest = versions
  if (!isCurrent) {
    await deps.promote(secretId, token, findVersion(versions, CURRENT))
    latest = (await deps.describe(secretId)).VersionIdsToStages ?? {}
    if (!latest[token]?.includes(CURRENT)) throw new Error("Promotion could not be confirmed")
    info("promoted")
  }
  await revokePrevious(latest, await readSecret({ stage: CURRENT }))
  info("finished")
}

/**
 * Ponto de entrada testável. A exceção relançada não carrega a original, porque
 * o runtime da Lambda registra mensagem e stack de todo erro que recebe.
 */
export async function handleEvent({ event, serviceName, getAdapter, deps, log = console }) {
  const step = STEPS[event?.Step] ?? "unknown"
  try {
    await rotate({ event, adapter: getAdapter(serviceName), deps, log })
  } catch (err) {
    log.error(JSON.stringify({ error: err?.name ?? "Error", step }))
    const failure = new Error(`Rotation failed at step ${step}`)
    failure.name = "RotationError"
    throw failure
  }
}
