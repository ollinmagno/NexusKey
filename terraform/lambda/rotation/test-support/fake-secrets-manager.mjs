/** Simula versões e rótulos como o Secrets Manager: cada rótulo fica em uma só versão. */
export class FakeSecretsManager {
  rotationEnabled = true
  versions = new Map()
  fail = {}
  calls = []

  seed(value, id = "v-initial") {
    this.versions.set(id, { value: JSON.stringify(value), stages: new Set(["AWSCURRENT"]) })
  }

  /** Reproduz o que o serviço faz antes de invocar a Lambda: versão vazia em AWSPENDING. */
  startRotation(token) {
    this.moveStage("AWSPENDING", token)
  }

  moveStage(stage, id) {
    for (const version of this.versions.values()) version.stages.delete(stage)
    if (!this.versions.has(id)) this.versions.set(id, { value: null, stages: new Set() })
    this.versions.get(id).stages.add(stage)
  }

  stageOf(id) {
    return [...(this.versions.get(id)?.stages ?? [])]
  }

  valueAt(stage) {
    for (const version of this.versions.values()) {
      if (version.stages.has(stage)) return version.value && JSON.parse(version.value)
    }
    return undefined
  }

  deps = {
    describe: async () => {
      const VersionIdsToStages = {}
      for (const [id, version] of this.versions) {
        if (version.stages.size) VersionIdsToStages[id] = [...version.stages]
      }
      return { RotationEnabled: this.rotationEnabled, VersionIdsToStages }
    },
    getValue: async (_id, { versionId, stage }) => {
      for (const [id, version] of this.versions) {
        if (versionId && id !== versionId) continue
        if (version.stages.has(stage)) return version.value
      }
      return null
    },
    putPending: async (_id, token, value) => {
      this.calls.push("putPending")
      if (this.fail.putPending) throw new Error("AWS PutSecretValue failed")
      if (this.fail.noVersionId) return {}
      this.versions.get(token).value = value
      return { VersionId: token }
    },
    promote: async (_id, token, from) => {
      this.calls.push("promote")
      if (this.fail.promote) throw new Error("AWS UpdateSecretVersionStage failed")
      this.versions.get(from).stages.delete("AWSCURRENT")
      this.moveStage("AWSPREVIOUS", from)
      this.versions.get(token).stages.add("AWSCURRENT")
    },
  }
}
