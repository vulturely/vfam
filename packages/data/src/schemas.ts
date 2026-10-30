import { z } from "zod";

/**
 * Shared domain schemas — the wire contract between frontend (zod validation)
 * and the Rust backend (serde). Keep these in sync with the Rust structs in
 * `crates/vulture-core` and plugin crates.
 */

export const roleSchema = z.enum(["manager", "kid", "elder"]);

export const familySchema = z.object({
	id: z.string(),
	name: z.string().min(1),
	createdAt: z.string(),
});

export const personSchema = z.object({
	id: z.string(),
	familyId: z.string(),
	name: z.string().min(1),
	role: roleSchema,
	deviceId: z.string(),
	createdAt: z.string(),
	// Optional profile picture URL from the identity provider.
	picture: z.string().optional(),
});

export const choreSchema = z.object({
	id: z.string(),
	familyId: z.string(),
	title: z.string().min(1),
	assigneePersonId: z.string().nullable(),
	dueAt: z.string().nullable(),
	status: z.enum(["todo", "done"]),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const taskSchema = z.object({
	id: z.string(),
	familyId: z.string(),
	title: z.string().min(1),
	done: z.boolean(),
	assigneePersonId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const messageSchema = z.object({
	id: z.string(),
	familyId: z.string(),
	fromPersonId: z.string(),
	text: z.string().min(1),
	createdAt: z.string(),
});

export const healthRecordSchema = z.object({
	id: z.string(),
	familyId: z.string(),
	personId: z.string(),
	kind: z.enum(["medication", "checkin", "note"]),
	note: z.string(),
	createdAt: z.string(),
});
