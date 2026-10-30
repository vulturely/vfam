import type { Page } from "@playwright/test";

export type ChatCommand = Record<string, unknown>;

export async function mockChatSocket(
	page: Page,
	handler: (command: ChatCommand, token?: string) => Promise<unknown> | unknown,
): Promise<void> {
	await page.exposeFunction("__nativeChatCommand", async (command: ChatCommand, token?: string) => {
		try {
			return await handler(command, token);
		} catch (error) {
			console.error("Native chat command failed", command.action, error);
			throw {
				kind: "unavailable",
				message: error instanceof Error ? error.message : "Chat unavailable.",
			};
		}
	});
}
