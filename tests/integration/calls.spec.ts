import { test, expect, seedOidcSession } from "./fixtures";
import type { Page } from "@playwright/test";
import { nativeResponse } from "./nativeRpc";
import { mockChatSocket } from "./chatSocket";
import { AccountRole } from "../../packages/core/src/api/protocol";
import type { CallEvent, CallCommand } from "../../packages/core/src/calls/service";

async function setup(page: Page, theme: string) {
	await seedOidcSession(page);
	await page.addInitScript((theme) => {
		localStorage.setItem("vulture.theme", theme);
		(window as unknown as Record<string, unknown>).isTauri = true;
		const pins: Record<string, string> = {};
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			async invoke(command: string, args: { input: Record<string, unknown> }) {
				if (command !== "family_chat_crypto") return window.__nativeFallback(command, args);
				const c = args.input;
				if (c.action === "identity")
					return {
						deviceId: "calls-chat",
						fingerprint: "a".repeat(64),
						keyPackages: ["package"],
					};
				if (c.action === "pins") return { pins };
				if (c.action === "pin") {
					pins[c.deviceId as string] = c.fingerprint as string;
					return {};
				}
				return {};
			},
			transformCallback: (value: unknown) => value,
		};
		let denied = false,
			stopped = 0;
		const metrics = {
			get stopped() {
				return stopped;
			},
			deny() {
				denied = true;
			},
		};
		(window as unknown as { callMetrics: typeof metrics }).callMetrics = metrics;
		Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), "getUserMedia", {
			value: async () => {
				if (denied) throw new Error("Permission denied");
				const stream = new MediaStream();
				const audio = {
					kind: "audio",
					enabled: true,
					stop() {
						stopped++;
					},
				};
				const video = {
					kind: "video",
					enabled: true,
					stop() {
						stopped++;
					},
				};
				stream.getTracks = () => [audio, video] as unknown as MediaStreamTrack[];
				stream.getAudioTracks = () => [audio] as unknown as MediaStreamTrack[];
				stream.getVideoTracks = () => [video] as unknown as MediaStreamTrack[];
				return stream;
			},
		});
		class Peer {
			connectionState = "new";
			remoteDescription: RTCSessionDescriptionInit | null = null;
			onconnectionstatechange?: () => void;
			addTrack() {}
			close() {}
			async createOffer() {
				return { type: "offer", sdp: "offer" };
			}
			async createAnswer() {
				return { type: "answer", sdp: "answer" };
			}
			async setLocalDescription() {}
			async setRemoteDescription(sdp: RTCSessionDescriptionInit) {
				this.remoteDescription = sdp;
				this.connectionState = "connected";
				this.onconnectionstatechange?.();
			}
			async addIceCandidate() {}
		}
		Object.defineProperty(window, "RTCPeerConnection", { value: Peer });
	}, theme);
	const commands: CallCommand[] = [];
	let events: CallEvent[] = [];
	let revoked = false;
	await mockChatSocket(page, () => ({ devices: [], rooms: [] }));
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await nativeResponse(route);
			return;
		}
		switch (route.request().url().split("/").pop()) {
			case "GetAccountSetup":
				await route.fallback();
				return;
			case "GetParentSession":
				await route.fallback();
				return;
			case "GetAccount":
				await nativeResponse(route, {
					account: { id: "parent", displayName: "Alex", role: AccountRole.PARENT },
				});
				return;
			case "GetMyFamily":
				await nativeResponse(route, { family: { id: "family", name: "Family" } });
				return;
			case "FamilyCall": {
				expect(route.request().headers().authorization).toBe(`Bearer vps_${"a".repeat(64)}`);
				const c = JSON.parse(route.request().postDataJSON().commandJson) as CallCommand;
				commands.push(c);
				let reply: Record<string, unknown> = {};
				const iceServer = {
					urls: "turn:localhost:3478",
					username: "600:own",
					credential: "short-lived",
				};
				switch (c.action) {
					case "register":
						reply = { device: "own" };
						break;
					case "poll":
						if (revoked) {
							await nativeResponse(route, undefined, 7);
							return;
						}
						reply = {
							devices: [
								{
									id: "peer",
									name: "Family tablet",
									accountId: "parent",
									busy: false,
								},
							],
							events,
						};
						events = [];
						break;
					case "invite":
						reply = { call: "outgoing", iceServer };
						events.push({ type: "accepted", call: "outgoing" });
						break;
					case "accept":
						reply = { iceServer };
						events.push({
							type: "signal",
							call: c.call,
							kind: "offer",
							payload: { type: "offer", sdp: "offer" },
						});
						break;
					case "signal":
						if (c.kind === "offer")
							events.push({
								type: "signal",
								call: c.call,
								kind: "answer",
								payload: { type: "answer", sdp: "answer" },
							});
						break;
				}
				await nativeResponse(route, { resultJson: JSON.stringify(reply) });
				return;
			}
			default:
				await nativeResponse(route);
		}
	});
	await page.goto("/");
	await page.getByRole("link", { name: "Chat & calls", exact: true }).click();
	await page.getByRole("button", { name: "Call settings", exact: true }).click();
	return {
		commands,
		ring() {
			events.push({
				type: "ringing",
				call: "incoming",
				name: "Grandparent",
				video: true,
			});
		},
		revoke() {
			revoked = true;
		},
	};
}
for (const theme of ["light", "dark"]) {
	test(`family call controls and cleanup match ${theme} theme`, async ({ page }, testInfo) => {
		const f = await setup(page, theme);
		await page.getByRole("checkbox", { name: "Enable calls" }).check();
		await page.getByRole("button", { name: "Video call", exact: true }).click();
		await expect(page.getByRole("status")).toHaveText("Connected");
		await page.getByRole("button", { name: "Minimize call" }).click();
		await expect(page.getByRole("button", { name: "Return to call" })).toBeVisible();
		expect(f.commands.some((command) => command.action === "end")).toBe(false);
		await page.getByRole("button", { name: "Return to call" }).click();
		await expect(page.getByRole("status")).toHaveText("Connected");
		await page.getByRole("button", { name: "Mute", exact: true }).click();
		await expect(page.getByRole("button", { name: "Unmute", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Turn camera off", exact: true }).click();
		await expect(page.getByText("Camera off", { exact: true })).toBeVisible();
		await page.screenshot({
			path: `artifacts/chat-active-call-${theme}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Hang up" }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { callMetrics: { stopped: number } }).callMetrics.stopped,
				),
			)
			.toBe(2);
		await page.getByRole("button", { name: "Close calls" }).click();
		f.ring();
		await expect(page.getByText("Incoming video call", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Reject", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Available family devices" })).toBeVisible();
		f.ring();
		await page.getByRole("button", { name: "Accept", exact: true }).click();
		await expect(page.getByRole("status")).toHaveText("Connected");
		f.revoke();
		await expect(page.getByRole("checkbox", { name: "Enable calls" })).not.toBeChecked();
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { callMetrics: { stopped: number } }).callMetrics.stopped,
				),
			)
			.toBe(4);
		expect(f.commands.some((c) => c.action === "signal" && c.kind === "answer")).toBe(true);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
			.toBe(true);
	});
}
test("permission denial and navigation away release all media", async ({ page }) => {
	const f = await setup(page, "light");
	await page.getByRole("checkbox", { name: "Enable calls" }).check();
	await page.evaluate(() =>
		(window as unknown as { callMetrics: { deny(): void } }).callMetrics.deny(),
	);
	await page.getByRole("button", { name: "Audio call", exact: true }).click();
	await expect(page.getByRole("alert")).toHaveText("Permission denied");
	expect(f.commands.some((c) => c.action === "invite")).toBe(false);
	await page.getByRole("link", { name: "Parent home", exact: true }).click();
	await expect.poll(() => f.commands.some((c) => c.action === "leave")).toBe(true);
});

test("inline call checkbox enables and disables the named device", async ({ page }) => {
	const fixture = await setup(page, "light");
	const enabled = page.getByRole("checkbox", { name: "Enable calls" });
	const deviceName = page.getByRole("textbox", { name: "Device name" });
	await expect(enabled).not.toBeChecked();
	await deviceName.fill("Kitchen tablet");
	await enabled.check();
	await expect(enabled).toBeChecked();
	await expect(deviceName).toBeDisabled();
	await enabled.uncheck();
	await expect(enabled).not.toBeChecked();
	await expect(deviceName).toBeEnabled();
	await expect
		.poll(() => fixture.commands.some((command) => command.action === "leave"))
		.toBe(true);
});
