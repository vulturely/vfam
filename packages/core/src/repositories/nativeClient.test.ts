import { beforeEach, expect, it, vi } from "vitest";
import { createNativeClient, decodeNativeValue } from "./nativeClient";
import { NativeServerError, type ServerRepository } from "./server";

const unary = vi.hoisted(() => vi.fn());
const stream = vi.hoisted(() => vi.fn());
const server = { unary, stream } as ServerRepository;

beforeEach(() => {
	vi.clearAllMocks();
	unary.mockResolvedValue({ status: "ok" });
	stream.mockReturnValue(
		(async function* () {
			yield { ready: true };
		})(),
	);
});

it("passes JSON and credentials to unary native calls", async () => {
	const client = createNativeClient("control", "https://server.example", server);
	const response = await client.health(
		{ probe: true },
		{ headers: new Headers({ authorization: "Bearer token" }) },
	);
	expect(response).toEqual({ status: "ok" });
	expect(unary).toHaveBeenCalledWith(
		"control",
		"Health",
		{ probe: true },
		{
			token: "token",
			timeoutMs: undefined,
		},
	);
});

it("encodes bytes and 64-bit integers as protobuf JSON", async () => {
	const client = createNativeClient("control", "https://server.example", server);
	await client.upload({ content: new Uint8Array([0, 1, 2, 255]), size: 4n });
	expect(unary.mock.calls[0][2]).toEqual({ content: "AAEC/w==", size: "4" });
});

it("decodes protobuf JSON enum names without a protobuf runtime", async () => {
	unary.mockResolvedValue({ profiles: [{ ageBand: "LEARNING_AGE_BAND_PRIMARY" }] });
	const response = await createNativeClient(
		"control",
		"https://server.example",
		server,
	).listLearningProfiles({});
	expect(response).toMatchObject({ profiles: [{ ageBand: 2 }] });
});

it("decodes FamBuddy update states and keeps version tags as text", async () => {
	unary.mockResolvedValue({
		output: {
			settings: [
				{
					device: "device",
					installedVersion: "v0.1.56",
					availableVersion: "v0.1.57",
					updateState: "UPDATE_STATE_FAILED",
				},
			],
		},
	});
	const response = await createNativeClient(
		"fambuddy_gateway",
		"https://server.example",
		server,
	).parentCommand({});
	expect(response).toMatchObject({
		output: {
			settings: [{ installedVersion: "v0.1.56", availableVersion: "v0.1.57", updateState: 4 }],
		},
	});
});

it("decodes FamBuddy AI modes and questions waiting for a parent", async () => {
	unary.mockResolvedValue({
		output: {
			settings: [
				{ device: "a", aiMode: "AI_MODE_LOCAL_ONLY", localAi: true },
				{ device: "b", aiMode: "AI_MODE_LOCAL_FIRST" },
				{ device: "c", aiMode: "AI_MODE_CLOUD_ONLY" },
				{ device: "d", aiMode: "AI_MODE_UNSPECIFIED" },
			],
			turns: [{ stage: "TURN_STAGE_NEEDS_PARENT", answeredBy: "ANSWER_SOURCE_CLOUD" }],
		},
	});
	const response = await createNativeClient(
		"fambuddy_gateway",
		"https://server.example",
		server,
	).parentCommand({});
	expect(response).toMatchObject({
		output: {
			settings: [{ aiMode: 1, localAi: true }, { aiMode: 2 }, { aiMode: 3 }, { aiMode: 0 }],
			turns: [{ stage: 8, answeredBy: 4 }],
		},
	});
});

it("supports non-Bearer authorization and aborts before transport", async () => {
	const client = createNativeClient("control", "https://server.example", server);
	await client.health({}, { headers: { authorization: "token" } });
	expect(unary.mock.calls[0][3].token).toBe("token");
	const controller = new AbortController();
	controller.abort();
	await expect(client.health({}, { signal: controller.signal })).rejects.toThrow("aborted");
	expect(unary).toHaveBeenCalledOnce();
});

it("uses each JSON native service without protocol descriptors", async () => {
	await createNativeClient("robot", "https://server.example", server).listRobots({});
	await createNativeClient("fambuddy_registry", "https://server.example", server).listFamBuddies(
		{},
	);
	await createNativeClient("fambuddy_relay", "https://server.example", server).createChannel({});
	await createNativeClient("fambuddy_gateway", "https://server.example", server).pairPhone({});
	expect(unary.mock.calls.map((call) => call[0])).toEqual([
		"robot",
		"fambuddy_registry",
		"fambuddy_relay",
		"fambuddy_gateway",
	]);
});

it("returns async JSON events for native streams and forwards errors", async () => {
	const client = createNativeClient("fambuddy_relay", "https://server.example", server);
	const events = [];
	const values = client.watchEnvelopes({ channel: "channel" }) as AsyncIterable<unknown>;
	for await (const event of values) events.push(event);
	expect(events).toEqual([{ ready: true }]);
	stream.mockReturnValue(
		(async function* () {
			yield { ready: false };
			throw new NativeServerError("unauthenticated", "expired");
		})(),
	);
	const dispatch = vi.spyOn(window, "dispatchEvent");
	await expect(async () => {
		const values = client.watchEnvelopes(
			{ channel: "channel" },
			{ headers: { authorization: `vps_${"a".repeat(64)}` } },
		) as AsyncIterable<unknown>;
		for await (const event of values) {
			void event;
		}
	}).rejects.toThrow("expired");
	// The event carries the exact token so only that session is cleared.
	expect(dispatch).toHaveBeenCalledWith(
		expect.objectContaining({ type: "vulture:session-expired", detail: `vps_${"a".repeat(64)}` }),
	);
});

it("decodes full enum names but leaves text that only looks like one", () => {
	expect(
		decodeNativeValue("Unlisted", {
			stage: "TURN_STAGE_QUESTION_PENDING",
			state: "UPDATE_STATE_FAILED",
			text: "FAILED",
			wakeWord: "CAMERA",
		}),
	).toEqual({ stage: 1, state: 4, text: "FAILED", wakeWord: "CAMERA" });
});

it("decodes a FamBuddy's license status from its settings", async () => {
	unary.mockResolvedValue({
		output: {
			settings: [
				{
					device: "device",
					license: {
						state: "LICENSE_STATE_VALID",
						edition: "Family",
						features: ["fambuddy.live_camera"],
						expiresAt: "2027-01-01T00:00:00Z",
					},
				},
				{ device: "other" },
			],
		},
	});
	const response = (await createNativeClient(
		"fambuddy_gateway",
		"https://server.example",
		server,
	).parentCommand({})) as {
		output: { settings: { license?: { state: number; features: string[] } }[] };
	};
	expect(response.output.settings[0].license).toMatchObject({
		state: 2,
		edition: "Family",
		features: ["fambuddy.live_camera"],
		expiresAt: "2027-01-01T00:00:00Z",
	});
	expect(response.output.settings[1].license).toBeUndefined();
});

it("decodes the family license by its nested state names only", async () => {
	const client = createNativeClient("fambuddy_registry", "https://server.example", server);
	unary.mockResolvedValueOnce({
		license: { state: "STATE_EXPIRED", edition: "Family", expiresAt: "2026-01-01T00:00:00Z" },
	});
	expect(await client.getFamilyLicense({})).toMatchObject({
		license: { state: 3, edition: "Family", features: [], expiresAt: "2026-01-01T00:00:00Z" },
	});
	unary.mockResolvedValueOnce({ license: { state: 2, features: ["fambuddy.remote_access"] } });
	expect(await client.setFamilyLicense({ token: "token" })).toMatchObject({
		license: { state: 2, features: ["fambuddy.remote_access"] },
	});
	unary.mockResolvedValueOnce({ license: { state: 9 } });
	expect(await client.getFamilyLicense({})).toMatchObject({ license: { state: 0 } });
	unary.mockResolvedValueOnce({ license: { state: "STATE_PENDING" } });
	expect(await client.getFamilyLicense({})).toMatchObject({ license: { state: 0 } });
	unary.mockResolvedValueOnce({});
	expect(await client.getFamilyLicense({})).toMatchObject({ license: { state: 0, edition: "" } });
	// The channel-status State shares the STATE_ prefix and is left as text.
	expect(decodeNativeValue("GetChannelStatus", { state: "STATE_CONFIRMED" })).toEqual({
		state: "STATE_CONFIRMED",
	});
});
