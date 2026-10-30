import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { mockChatSocket } from "./chatSocket";
import type { Page } from "@playwright/test";
import { AccountRole } from "../../packages/core/src/api/protocol";

async function fillMessage(page: Page, text: string) {
	const editor = page.getByLabel("Message", { exact: true });
	await editor.click();
	await editor.press("ControlOrMeta+A");
	await editor.pressSequentially(text);
}

const accountId = "00000000-0000-0000-0000-000000000001";
const familyId = "00000000-0000-0000-0000-000000000010";
const own = {
	deviceId: "desktop",
	accountId,
	fingerprint: "a".repeat(64),
	approved: true,
	revoked: false,
	keyPackages: ["package"],
};
const peer = {
	...own,
	deviceId: "peer",
	accountId: "family-peer",
	fingerprint: "b".repeat(64),
};
for (const theme of ["light", "dark"]) {
	test(`private desktop chat retries, verifies keys and deletes using ${theme} theme`, async ({
		page,
	}, testInfo) => {
		await seedOidcSession(page);
		await page.addInitScript(
			({ theme, own }) => {
				(window as unknown as Record<string, unknown>).isTauri = true;
				localStorage.setItem("vulture.theme", theme);
				const pins: Record<string, string> = {};
				let group = false;
				let history: Record<string, unknown>[] = [];
				let outbox: Record<string, unknown>[] = [];
				(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
					transformCallback: (value: unknown) => value,
					async invoke(command: string, args: { input: Record<string, unknown> }) {
						if (command !== "family_chat_crypto") return window.__nativeFallback(command, args);
						const c = args.input;
						switch (c.action) {
							case "identity":
								return { ...own, keyPackages: ["package"] };
							case "pin":
								pins[c.deviceId as string] = c.fingerprint as string;
								return {};
							case "pins":
								return { pins };
							case "exists":
								return { exists: group };
							case "create":
								group = true;
								return {
									welcomes: [{ deviceId: "desktop", ciphertext: "welcome" }],
								};
							case "join":
								group = true;
								return {};
							case "encrypt": {
								const ciphertext = `cipher-${c.clientId}`;
								outbox.push({
									generation: c.generation,
									clientId: c.clientId,
									ciphertext,
									plaintext: c.plaintext,
								});
								return { ciphertext };
							}
							case "outbox":
								return { messages: outbox };
							case "ack":
								outbox = outbox.filter((m) => m.clientId !== c.clientId);
								return {};
							case "cacheAndAck":
							case "cache":
								history = history.filter(
									(m) => m.messageId !== (c.message as Record<string, unknown>).messageId,
								);
								history.push(c.message as Record<string, unknown>);
								if (c.action === "cacheAndAck")
									outbox = outbox.filter((m) => m.clientId !== c.clientId);
								return {};
							case "history":
								return { messages: history };
							case "purge":
								history = history.filter(
									(m) => !(c.ids as string[]).includes(m.messageId as string),
								);
								return {};
							case "notify":
								(window as unknown as { chatNotifications: unknown[] }).chatNotifications ??= [];
								(window as unknown as { chatNotifications: unknown[] }).chatNotifications.push(c);
								return {};
							case "decrypt":
								return {
									plaintext: JSON.stringify({ text: "PRIVATE_INCOMING" }),
								};
							default:
								throw new Error(`Unexpected crypto command ${c.action}`);
						}
					},
				};
			},
			{ theme, own },
		);
		let initialized = false;
		let fail = true;
		let changed = false;
		let messages: Record<string, unknown>[] = [];
		const sent: Record<string, unknown>[] = [];
		await mockChatSocket(page, async (c) => {
			expect(c.familyId).toBe(familyId);
			let result: unknown = {};
			switch (c.action) {
				case "roster":
					result = { devices: changed ? [own, peer] : [own] };
					break;
				case "rooms":
					result = { rooms: [] };
					break;
				case "createChannel":
					result = {
						roomId: "channel",
						name: c.name,
						participants: [own.accountId, ...(c.participantAccountIds as string[])],
					};
					break;
				case "open":
					result = { roomId: c.peerAccountId ? "direct-peer" : "room" };
					break;
				case "sync":
					result = {
						generation: 1,
						revision: 1,
						initialized,
						roster: changed ? [own, peer] : [own],
						welcomes: [{ deviceId: "desktop", ciphertext: "welcome" }],
						generations: [],
						messages: messages.filter((m) => (m.sequence as number) > (c.after as number)),
					};
					break;
				case "initialize":
					initialized = true;
					break;
				case "send": {
					sent.push(c);
					expect(JSON.stringify(c)).not.toMatch(/PRIVATE_BODY|secret-file|PRIVATE_FILE|plaintext/);
					if (fail) {
						fail = false;
						throw new Error("Chat request failed");
					}
					const message = {
						messageId: "sent",
						clientId: c.clientId,
						generation: 1,
						sequence: 1,
						deviceId: "desktop",
						accountId,
						ciphertext: c.ciphertext,
						createdAt: Math.floor(Date.now() / 1000),
						deleted: false,
					};
					messages = [message];
					result = message;
					break;
				}
				case "delete":
					messages = messages.map((m) => ({
						...m,
						deleted: true,
						sequence: 2,
						ciphertext: null,
					}));
					break;
			}
			return result;
		});
		await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
			const method = route.request().url().split("/").at(-1);
			if (route.request().method() === "OPTIONS") {
				await nativeResponse(route);
				return;
			}
			switch (method) {
				case "GetParentSession":
					await nativeResponse(route, {
						accountId,
						displayName: "Alex",
						expiresAt: new Date(Date.now() + 3600000).toISOString(),
					});
					return;
				case "GetAccountSetup":
					await route.fallback();
					return;
				case "GetAccount":
					await nativeResponse(route, {
						account: { id: accountId, displayName: "Alex", role: AccountRole.PARENT },
					});
					return;
				case "GetMyFamily":
					await nativeResponse(route, { family: { id: familyId, name: "Chat family" } });
					return;
				case "ListFamilyMembers":
					await nativeResponse(route, {
						members: [
							{ id: "m1", familyId, accountId },
							{ id: "m2", familyId, accountId: "family-peer" },
						],
					});
					return;
				default:
					await nativeResponse(route);
			}
		});
		let encryptedAttachment = Buffer.alloc(0);
		await page.route("**/chat/attachments/**", async (route) => {
			if (route.request().method() === "PUT") {
				encryptedAttachment = Buffer.from(route.request().postDataBuffer()!);
				expect(encryptedAttachment.includes(Buffer.from("PRIVATE_FILE"))).toBe(false);
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ objectKey: "encrypted-object" }),
				});
				return;
			}
			await route.fulfill({ status: 200, body: encryptedAttachment });
		});
		await page.goto("/");
		// Chat connects as the app loads, before the chat screen is opened.
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { __chatConnections?: unknown[] }).__chatConnections ?? [],
				),
			)
			.toContainEqual(
				expect.objectContaining({ command: "chat_connect", token: `vps_${"a".repeat(64)}` }),
			);
		await page.getByRole("link", { name: "Chat & calls", exact: true }).click();
		await page
			.locator("summary")
			.filter({ hasText: /Device security/ })
			.click();
		await expect(
			page.getByText("Security keys are managed by the app. No codes to compare."),
		).toBeVisible();
		await page.getByRole("button", { name: "Family group", exact: true }).click();
		await fillMessage(page, "PRIVATE_BODY");
		await page.getByLabel("Encrypted attachment (up to 20 MiB)").setInputFiles({
			name: "secret-file.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("PRIVATE_FILE"),
		});
		await page.getByRole("button", { name: "Send encrypted message" }).click();
		await expect(page.getByRole("alert")).toBeVisible();
		await page.getByRole("button", { name: "Refresh messages", exact: true }).click();
		await expect.poll(() => sent.length).toBe(2);
		await expect(
			page
				.getByRole("list", { name: "Messages" })
				.getByText("PRIVATE_BODY", { exact: true })
				.first(),
		).toBeVisible();
		expect(sent).toHaveLength(2);
		expect(sent[0].clientId).toBe(sent[1].clientId);
		await expect(page.getByRole("button", { name: "Download secret-file.txt" })).toBeVisible();
		await page.getByRole("button", { name: "Delete message", exact: true }).first().click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete message", exact: true })
			.click();
		await page.getByRole("button", { name: "Refresh messages", exact: true }).click();
		await expect(
			page.getByRole("list", { name: "Messages" }).getByText("PRIVATE_BODY", { exact: true }),
		).toHaveCount(0);
		changed = true;
		await page.getByRole("button", { name: "Reload devices and conversations" }).click();
		await expect(
			page.getByText("Security key registered automatically", { exact: true }),
		).toHaveCount(2);
		await expect(page.getByLabel("Fingerprint from device peer")).toHaveCount(0);
		await page.getByRole("button", { name: "Refresh messages", exact: true }).click();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await page.getByRole("button", { name: "Message family-peer", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Conversation with Alex" })).toBeVisible();
		await expect(page.getByLabel("Message", { exact: true })).toHaveText("");
		await expect(page.getByText("secret-file.txt", { exact: true })).toHaveCount(0);
		await fillMessage(page, "ALEX_ONLY_DRAFT");
		await page.getByLabel("Encrypted attachment (up to 20 MiB)").setInputFiles({
			name: "alex-only.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("ALEX_ONLY_ATTACHMENT"),
		});
		await page.getByRole("button", { name: "Family group", exact: true }).click();
		await expect(page.getByLabel("Message", { exact: true })).toHaveText("PRIVATE_BODY");
		await expect(page.getByText("alex-only.txt", { exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "Message family-peer", exact: true }).click();
		await expect(page.getByLabel("Message", { exact: true })).toHaveText("ALEX_ONLY_DRAFT");
		await expect
			.poll(() =>
				page
					.getByLabel("Encrypted attachment (up to 20 MiB)")
					.evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
			)
			.toBe("alex-only.txt");
		await page.getByLabel("Notifications without message previews").check();
		messages = [
			{
				messageId: "incoming",
				clientId: "incoming-id",
				sequence: 3,
				generation: 1,
				deviceId: "peer",
				accountId: "family-peer",
				createdAt: Math.floor(Date.now() / 1000),
				deleted: false,
				ciphertext: "incoming-cipher",
			},
		];
		await page.getByRole("button", { name: "Refresh messages", exact: true }).click();
		await expect(page.getByText("PRIVATE_INCOMING", { exact: true })).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { chatNotifications: unknown[] }).chatNotifications,
				),
			)
			.toEqual([{ action: "notify" }]);
		await expect(page.locator("html")).toHaveAttribute("data-v-theme", theme);
		await page.screenshot({
			path: `artifacts/chat-device-security-${theme}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page
			.locator("summary")
			.filter({ hasText: /Device security/ })
			.click();
		await page.screenshot({
			path: `artifacts/chat-calls-${theme}-desktop-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Create channel" }).click();
		await page.getByRole("textbox", { name: "Channel name" }).fill("Weekend plans");
		await page.getByRole("checkbox", { name: "Alex", exact: true }).check();
		await page.getByRole("button", { name: "Save channel", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Weekend plans" })).toBeVisible();
		await expect(page.getByLabel("Message", { exact: true })).toHaveText("");
		await expect(page.getByText("alex-only.txt", { exact: true })).toHaveCount(0);
		await page.screenshot({
			path: `artifacts/chat-channel-${theme}-desktop-${testInfo.project.name}.png`,
			fullPage: true,
		});
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: 844 });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true,
			);
			const composer = await page
				.getByRole("button", { name: "Send encrypted message" })
				.boundingBox();
			expect(composer!.y + composer!.height).toBeLessThanOrEqual(844);
			await page.screenshot({
				path: `artifacts/chat-calls-${theme}-${width}-${testInfo.project.name}.png`,
				fullPage: true,
			});
		}
	});
}

test("chat fails closed without enrolling when the device crypto backend is unavailable", async ({
	page,
}) => {
	await seedOidcSession(page);
	await page.route("**/vulture.server.v1.VultureControl/ListTasks", (route) =>
		nativeResponse(route, {}),
	);
	await page.route("**/vulture.server.v1.VultureControl/ListFamilyMembers", (route) =>
		nativeResponse(route, {}),
	);
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).isTauri = true;
	});
	await page.route("**/vulture.server.v1.VultureControl/GetAccount", (route) =>
		nativeResponse(route, {
			account: { id: accountId, displayName: "Alex", role: AccountRole.PARENT },
		}),
	);
	await page.route("**/vulture.server.v1.VultureControl/GetMyFamily", (route) =>
		nativeResponse(route, { family: { id: familyId, name: "Family" } }),
	);
	let enrolled = false;
	await mockChatSocket(page, () => {
		enrolled = true;
		throw new Error("Remote enrollment must not run");
	});
	await page.goto("/");
	await page.getByRole("link", { name: "Chat & calls", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Encrypted chat could not start");
	expect(enrolled).toBe(false);
});
