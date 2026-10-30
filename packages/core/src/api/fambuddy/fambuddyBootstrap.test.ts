import { beforeEach, expect, it, vi } from "vitest";
import { bootstrap, decodeSetup, encodeSetup } from "./fambuddyBootstrap";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../ipc", () => ({ createTauriIpcClient: () => ({ invoke }) }));

beforeEach(() => vi.resetAllMocks());

it("passes setup commands through encrypted native storage", async () => {
	invoke.mockResolvedValue({ session: "ready" });
	await expect(bootstrap({ action: "create" })).resolves.toEqual({ session: "ready" });
	expect(invoke).toHaveBeenCalledWith("fambuddy_storage", {
		scope: "bootstrap-v1",
		account: "setup",
		input: { action: "bootstrap", command: { action: "create" } },
	});
});

it("round-trips binary setup data including zero and high bytes", () => {
	const bytes = Uint8Array.from([0, 1, 127, 128, 255]);
	expect(decodeSetup(encodeSetup(bytes))).toEqual(bytes);
	expect(encodeSetup(new Uint8Array())).toBe("");
});
