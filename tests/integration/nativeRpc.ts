import type { Route } from "@playwright/test";
import { Buffer } from "node:buffer";

function encodeJson(value: unknown): unknown {
	if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
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

export async function nativeResponse(route: Route, message?: unknown, status = 0) {
	const headers = {
		"x-native-error-code": String(status),
		"content-type": "application/json",
	};
	if (route.request().method() === "OPTIONS") {
		await route.fulfill({ status: 204, headers });
		return;
	}
	await route.fulfill({
		status: 200,
		headers,
		body: JSON.stringify(encodeJson(message ?? {})),
	});
}
