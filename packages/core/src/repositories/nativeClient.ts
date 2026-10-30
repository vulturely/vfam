import { reportSessionExpiry } from "../api/auth/sessionEvents";
import {
	AccountRole,
	AiMode,
	AnswerSource,
	AskerRole,
	HomeworkMediaType,
	LearningAgeBand,
	LearningAnswerResult,
	LearningSessionAction,
	LearningSessionState,
	LicenseState,
	PracticeQuestionKind,
	RobotCapabilityValue,
	TaskRepeat,
	TaskStatus,
	TurnStage,
	UpdateState,
} from "../api/protocol";
import { decodeNativeResponse } from "./protocolJson";
import { createServerRepository, type ServerRepository, type ServerService } from "./server";

interface NativeCallOptions {
	headers?: Record<string, string> | Headers;
	timeoutMs?: number;
	signal?: AbortSignal;
}

type NativeMethod = (
	request: object,
	options?: NativeCallOptions,
) => Promise<unknown> | AsyncIterable<unknown>;

const streamingMethods = new Set([
	"WatchEnvelopes",
	"WatchEnrollment",
	"WatchParent",
	"WatchDevice",
	"OpenTalk",
]);
const enumValues: Record<string, number> = {};
for (const [prefix, protocol] of [
	["ACCOUNT_ROLE", AccountRole],
	["AI_MODE", AiMode],
	["ANSWER_SOURCE", AnswerSource],
	["ASKER_ROLE", AskerRole],
	["HOMEWORK_MEDIA_TYPE", HomeworkMediaType],
	["LEARNING_AGE_BAND", LearningAgeBand],
	["LEARNING_ANSWER_RESULT", LearningAnswerResult],
	["LEARNING_SESSION_ACTION", LearningSessionAction],
	["LEARNING_SESSION_STATE", LearningSessionState],
	["LICENSE_STATE", LicenseState],
	["PRACTICE_QUESTION_KIND", PracticeQuestionKind],
	["ROBOT_CAPABILITY_VALUE", RobotCapabilityValue],
	["TASK_REPEAT", TaskRepeat],
	["TASK_STATUS", TaskStatus],
	["TURN_STAGE", TurnStage],
	["UPDATE_STATE", UpdateState],
] as const) {
	// Protobuf JSON names enum values in full (TASK_STATUS_TODO). Only full names are
	// decoded, so free text such as "FAILED" or "CAMERA" stays text.
	for (const [name, value] of Object.entries(protocol)) {
		if (typeof value === "number") enumValues[`${prefix}_${name}`] = value;
	}
}

function decodeJson(value: unknown): unknown {
	if (typeof value === "string") return enumValues[value] ?? value;
	if (Array.isArray(value)) return value.map(decodeJson);
	if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeJson(item)]));
	}
	return value;
}

function encodeJson(value: unknown): unknown {
	if (value instanceof Uint8Array) {
		let binary = "";
		for (const byte of value) binary += String.fromCharCode(byte);
		return btoa(binary);
	}
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return value.map(encodeJson);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, item]) => item !== undefined)
				.map(([key, item]) => [key, encodeJson(item)]),
		);
	}
	return value;
}

/** Decodes a protobuf-JSON value returned outside the native client, e.g. by a Tauri command. */
export function decodeNativeValue(method: string, value: unknown): unknown {
	return decodeNativeResponse(method, decodeJson(value));
}

export function createNativeClient(
	service: ServerService,
	serverUrl: string,
	server: ServerRepository = createServerRepository(serverUrl),
): Record<string, NativeMethod> {
	return new Proxy(
		{},
		{
			get(_target, property) {
				if (typeof property !== "string") return undefined;
				return (request: object, options: NativeCallOptions = {}) => {
					const method = property[0].toUpperCase() + property.slice(1);
					const authorization = readHeader(options.headers, "authorization");
					const token = authorization?.startsWith("Bearer ")
						? authorization.slice(7)
						: authorization;
					const payload = encodeJson(request) as Record<string, unknown>;
					if (streamingMethods.has(method)) {
						return (async function* () {
							try {
								options.signal?.throwIfAborted();
								const values = server.stream<unknown>(service, method, payload, {
									token,
									timeoutMs: options.timeoutMs,
									signal: options.signal,
								});
								for await (const value of values)
									yield decodeNativeResponse(method, decodeJson(value));
							} catch (error) {
								reportSessionExpiry(error, token, method);
								throw error;
							}
						})();
					}
					// server.unary reports an expired session itself.
					return (async () => {
						options.signal?.throwIfAborted();
						const response = await server.unary(service, method, payload, {
							token,
							timeoutMs: options.timeoutMs,
						});
						options.signal?.throwIfAborted();
						return decodeNativeResponse(method, decodeJson(response));
					})();
				};
			},
		},
	);
}

function readHeader(headers: NativeCallOptions["headers"], name: string): string | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) return headers.get(name) ?? undefined;
	const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
	return key ? headers[key] : undefined;
}
