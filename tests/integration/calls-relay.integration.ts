import { writeFile } from "node:fs/promises";
import { test, expect, seedOidcSession } from "./fixtures";
import type { Page } from "@playwright/test";

// The Rust fixture supplies a real TLS server with test sessions and short-lived
// coturn credentials. No application RPC, peer, ICE candidate or media is mocked.
test("authenticated devices exchange audio/video through forced TURN over TLS", async ({
	browser,
	playwright,
}) => {
	const endpoint = process.env.VULTURE_CALL_TEST_ENDPOINT;
	const token = process.env.VULTURE_CALL_TEST_TOKEN;
	expect(endpoint, "Run through the Rust real_browser_turn_tls test fixture").toBeTruthy();
	expect(token).toBeTruthy();
	const endpoints = [process.env.VULTURE_CALL_TEST_WS_A, process.env.VULTURE_CALL_TEST_WS_B];
	const launchOptions = JSON.stringify({
		headless: true,
		args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
	});
	const remoteBrowsers = endpoints.every(Boolean)
		? await Promise.all(
				endpoints.map((wsEndpoint) => {
					const url = new URL(wsEndpoint!);
					url.searchParams.set("browser", "chromium");
					url.searchParams.set("launch-options", launchOptions);
					return playwright.chromium.connect({ wsEndpoint: url.href });
				}),
			)
		: [];
	const contexts = await Promise.all(
		(remoteBrowsers.length ? remoteBrowsers : [browser, browser]).map((b) =>
			b.newContext({
				ignoreHTTPSErrors: true,
				baseURL: process.env.VULTURE_CALL_TEST_UI_URL ?? "https://localhost:1420",
			}),
		),
	);
	if (process.env.VULTURE_CALL_TEST_NETWORKS)
		await test.info().attach("isolated-docker-networks", {
			body: process.env.VULTURE_CALL_TEST_NETWORKS,
			contentType: "application/json",
		});
	const pages = await Promise.all(
		contexts.map(async (context, index) => {
			const page = await context.newPage();
			await seedOidcSession(page, {
				sub: "parent",
				mockSession: false,
				accessToken: index ? process.env.VULTURE_CALL_TEST_TOKEN_B : token,
			});
			await page.addInitScript(() => {
				const Native = RTCPeerConnection;
				const peers: RTCPeerConnection[] = [];
				(window as unknown as { callPeers: RTCPeerConnection[] }).callPeers = peers;
				window.RTCPeerConnection = class extends Native {
					constructor(config?: RTCConfiguration) {
						super(config);
						peers.push(this);
					}
				};
			});
			await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
				const original = route.request();
				await route.continue({
					url: `${endpoint}${new URL(original.url()).pathname}`,
				});
			});
			await page.goto("/");
			await page.getByRole("link", { name: "Family calls", exact: true }).click();
			await page.getByRole("textbox", { name: "Device name" }).fill(`Device ${index + 1}`);
			await page.getByRole("button", { name: "Enable calls" }).click();
			return page;
		}),
	);
	const [a, b] = pages;
	try {
		await a.getByRole("button", { name: "Video call", exact: true }).click();
		await expect(a.getByRole("alert")).toHaveCount(0);
		await expect(b.getByText("Incoming video call", { exact: true })).toBeVisible();
		await b.getByRole("button", { name: "Accept", exact: true }).click();
		for (const page of pages)
			await expect(page.getByRole("status")).toHaveText("Connected", {
				timeout: 30000,
			});
		async function media(page: Page) {
			return page.evaluate(async () => {
				const peer = (window as unknown as { callPeers: RTCPeerConnection[] }).callPeers.at(-1)!;
				const stats = await peer.getStats();
				const values: Record<string, unknown>[] = [];
				stats.forEach((s) => values.push(s));
				const pair = values.find(
					(s) =>
						s.type === "candidate-pair" && s.state === "succeeded" && (s.nominated || s.selected),
				);
				const local = values.find((s) => s.id === pair?.localCandidateId);
				const remote = values.find((s) => s.id === pair?.remoteCandidateId);
				return {
					local: local?.candidateType,
					remote: remote?.candidateType,
					relayProtocol: local?.relayProtocol,
					received: values
						.filter((s) => s.type === "inbound-rtp")
						.map((s) => ({ kind: s.kind, bytes: s.bytesReceived })),
				};
			});
		}
		for (const page of pages) {
			await expect
				.poll(async () => {
					const stats = await media(page);
					return { local: stats.local, remote: stats.remote };
				})
				.toEqual({ local: "relay", remote: "relay" });
			await expect
				.poll(async () => {
					const stats = await media(page);
					return stats.received
						.filter((s) => Number(s.bytes) > 0)
						.map((s) => s.kind)
						.sort();
				})
				.toEqual(["audio", "video"]);
		}
		const evidence = await Promise.all(pages.map(media));
		if (process.env.VULTURE_CALL_TEST_TRANSPORT)
			for (const peer of evidence)
				expect(peer.relayProtocol).toBe(process.env.VULTURE_CALL_TEST_TRANSPORT);
		await writeFile(
			test.info().outputPath("relay-evidence.json"),
			JSON.stringify(
				{
					transport: process.env.VULTURE_CALL_TEST_TRANSPORT,
					networks: JSON.parse(process.env.VULTURE_CALL_TEST_NETWORKS ?? "[]"),
					peers: evidence,
				},
				null,
				2,
			),
		);
		await test.info().attach("selected-relay-and-media", {
			body: JSON.stringify(evidence, null, 2),
			contentType: "application/json",
		});
		await a.getByRole("button", { name: "Turn camera off", exact: true }).click();
		await expect(a.getByText("Camera off", { exact: true })).toBeVisible();
		await a.getByRole("button", { name: "Mute", exact: true }).click();
		await a.getByRole("button", { name: "Hang up", exact: true }).click();
		for (const page of pages) {
			await expect(page.getByRole("heading", { name: "Available family devices" })).toBeVisible();
			await expect
				.poll(() =>
					page.evaluate(
						() =>
							(window as unknown as { callPeers: RTCPeerConnection[] }).callPeers.at(-1)
								?.connectionState,
					),
				)
				.toBe("closed");
		}
		// Also exercise a genuine audio-only call in the opposite direction.
		await b.getByRole("button", { name: "Audio call", exact: true }).click();
		await a.getByRole("button", { name: "Accept", exact: true }).click();
		for (const page of pages)
			await expect(page.getByRole("status")).toHaveText("Connected", {
				timeout: 30000,
			});
		await b.getByRole("button", { name: "Hang up", exact: true }).click();
	} finally {
		for (const [index, page] of pages.entries()) {
			await test.info().attach(`peer-${index}-screen`, {
				body: await page.locator("body").innerText(),
				contentType: "text/plain",
			});
			const stats = await page.evaluate(async () => {
				const peers = (window as unknown as { callPeers: RTCPeerConnection[] }).callPeers;
				return Promise.all(
					peers.map(async (p) => {
						const report = await p.getStats();
						const values: unknown[] = [];
						report.forEach((v) => values.push(v));
						return {
							state: p.connectionState,
							ice: p.iceConnectionState,
							stats: values,
						};
					}),
				);
			});
			await test.info().attach(`peer-${index}-stats`, {
				body: JSON.stringify(stats, null, 2),
				contentType: "application/json",
			});
		}
		await Promise.all(contexts.map((c) => c.close()));
		await Promise.all(remoteBrowsers.map((b) => b.close()));
	}
});
