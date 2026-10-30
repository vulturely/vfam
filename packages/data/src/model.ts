import type { z } from "zod";
import {
	choreSchema,
	familySchema,
	healthRecordSchema,
	messageSchema,
	personSchema,
	roleSchema,
	taskSchema,
} from "./schemas";

export type Role = z.infer<typeof roleSchema>;
export type Family = z.infer<typeof familySchema>;
export type Person = z.infer<typeof personSchema>;
export type Chore = z.infer<typeof choreSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Message = z.infer<typeof messageSchema>;
export type HealthRecord = z.infer<typeof healthRecordSchema>;
