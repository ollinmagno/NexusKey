import { z } from "zod";

/**
 * createKeySchema — validates POST /api-keys response (Requirement 3.1)
 *
 * Expected shape:
 *   { id: string, object: "api_key", token: "re_..." }
 */
export const createKeySchema = z.object({
  id: z.string().min(1),
  object: z.literal("api_key"),
  token: z.string().regex(/^re_[A-Za-z0-9_]+$/).min(10),
});

/**
 * listKeysSchema — validates GET /api-keys response (Requirement 3.2)
 *
 * Expected shape:
 *   { object: string, has_more: boolean, data: [{ id, name, created_at }] }
 */
export const listKeysSchema = z.object({
  object: z.string(),
  has_more: z.boolean(),
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      created_at: z.string().datetime(),
    })
  ),
});

/**
 * deleteKeySchema — validates DELETE /api-keys/{id} response (Requirement 3.3)
 *
 * Expected shape:
 *   { object: "api_key", id: string, deleted: true }
 */
export const deleteKeySchema = z.object({
  object: z.literal("api_key"),
  id: z.string().min(1),
  deleted: z.literal(true),
});
