/**
 * Handler da Lambda e I/O real com o Secrets Manager.
 * O AWS SDK vem do runtime `nodejs24.x`; a lógica fica em `rotation.mjs`.
 */
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
} from "@aws-sdk/client-secrets-manager"
import { getAdapter } from "./adapters/index.mjs"
import { handleEvent } from "./rotation.mjs"

const client = new SecretsManagerClient({})

const deps = {
  describe: (SecretId) => client.send(new DescribeSecretCommand({ SecretId })),

  async getValue(SecretId, { versionId, stage }) {
    try {
      const { SecretString } = await client.send(
        new GetSecretValueCommand({ SecretId, VersionId: versionId, VersionStage: stage }),
      )
      return SecretString ?? null
    } catch (err) {
      if (err.name === "ResourceNotFoundException") return null
      throw err
    }
  },

  putPending: (SecretId, ClientRequestToken, SecretString) =>
    client.send(
      new PutSecretValueCommand({
        SecretId,
        ClientRequestToken,
        SecretString,
        VersionStages: ["AWSPENDING"],
      }),
    ),

  promote: (SecretId, MoveToVersionId, RemoveFromVersionId) =>
    client.send(
      new UpdateSecretVersionStageCommand({
        SecretId,
        VersionStage: "AWSCURRENT",
        MoveToVersionId,
        RemoveFromVersionId,
      }),
    ),
}

export const handler = (event) =>
  handleEvent({ event, serviceName: process.env.SERVICE_NAME, getAdapter, deps })
