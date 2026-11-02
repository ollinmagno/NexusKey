/**
 * Registro de adaptadores: um por serviço externo.
 *
 * Contrato de um adaptador:
 *   secretSchema                  Schema Zod do valor do segredo.
 *   create({ current, now })      Cria a credencial e retorna o novo valor do segredo.
 *   test({ pending })             Lança se a credencial pendente não funcionar.
 *   set({ pending, current })     Opcional: aplica a credencial no serviço.
 *   revoke({ previous, current }) Opcional: retorna "revoked" ou "already-revoked".
 *
 * Toda operação valida a resposta do serviço antes de retornar e lança em caso de
 * falha, sem incluir credenciais nem payloads nas mensagens de erro. O adaptador
 * decide qual credencial autoriza cada chamada.
 */
import { adapter as resend } from "./resend.mjs"

const adapters = { resend }

export function getAdapter(serviceName) {
  if (!Object.hasOwn(adapters, serviceName)) {
    throw new Error("Service adapter not found")
  }
  return adapters[serviceName]
}
