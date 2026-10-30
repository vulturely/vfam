import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "./randomId";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("prefers the native UUID implementation", () => {
	vi.stubGlobal("crypto", { randomUUID: () => "native-id" });
	expect(randomUUID()).toBe("native-id");
});

it("uses cryptographic bytes and applies UUID version and variant bits", () => {
	vi.stubGlobal("crypto", {
		getRandomValues: (bytes: Uint8Array) => bytes.fill(255),
	});
	expect(randomUUID()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
});

it("falls back to Math.random when no cryptographic API exists", () => {
	vi.stubGlobal("crypto", undefined);
	vi.spyOn(Math, "random").mockReturnValue(0);
	expect(randomUUID()).toBe("00000000-0000-4000-8000-000000000000");
});
