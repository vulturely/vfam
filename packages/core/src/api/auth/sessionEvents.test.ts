import { afterEach, expect, it, vi } from "vitest";
import { NativeServerError } from "../../repositories/server";
import { SESSION_EXPIRED_EVENT, reportSessionExpiry } from "./sessionEvents";

afterEach(() => vi.restoreAllMocks());
const parent = `vps_${"a".repeat(64)}`;
const child = `vcs_${"b".repeat(64)}`;
const expired = new NativeServerError("unauthenticated", "expired");

function reported(run: () => void) {
	const dispatch = vi.spyOn(window, "dispatchEvent");
	run();
	const calls = [...dispatch.mock.calls];
	dispatch.mockRestore();
	return calls
		.map(([event]) => event as CustomEvent<string>)
		.filter((event) => event.type === SESSION_EXPIRED_EVENT)
		.map((event) => event.detail);
}

it("reports rejected parent and child sessions with their exact token", () => {
	expect(reported(() => reportSessionExpiry(expired, parent, "ListHomework"))).toEqual([parent]);
	expect(reported(() => reportSessionExpiry(expired, child, "ListChildTasks"))).toEqual([child]);
	expect(reported(() => reportSessionExpiry(expired, child))).toEqual([child]);
});

it("ignores wrong PINs, other errors and missing or unknown tokens", () => {
	for (const method of ["SignInChild", "UnlockParent", "VerifyParentPin", "GetChildSession"])
		expect(reported(() => reportSessionExpiry(expired, child, method))).toEqual([]);
	expect(
		reported(() =>
			reportSessionExpiry(new NativeServerError("permission_denied", "no"), parent, "ListTasks"),
		),
	).toEqual([]);
	expect(reported(() => reportSessionExpiry(new Error("offline"), parent))).toEqual([]);
	expect(reported(() => reportSessionExpiry(expired, null))).toEqual([]);
	expect(reported(() => reportSessionExpiry(expired, "provider-token"))).toEqual([]);
});
