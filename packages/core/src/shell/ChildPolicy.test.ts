import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { GetChildPolicyResponse } from "../api/protocol";
import type { TimetableService } from "../timetable/service";
import TestChildPolicy from "./TestChildPolicy.svelte";
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function decision(allowed: boolean, ttl = 30000) {
	return new GetChildPolicyResponse({
		allowed,
		currentActivity: allowed ? "Study time" : "Break time",
		timezone: "UTC",
		nextAllowedAt: allowed ? undefined : "2026-10-20T16:00:00Z",
		evaluatedAt: new Date().toISOString(),
		validUntil: new Date(Date.now() + ttl).toISOString(),
	});
}
function setup(policy = vi.fn(async () => decision(true))) {
	render(TestChildPolicy, {
		service: { policy } as unknown as TimetableService,
	});
	return policy;
}
it("shows current activity and next time while blocking content, with Help always reachable", async () => {
	setup(vi.fn(async () => decision(false)));
	await screen.findByText("Right now: Break time");
	expect(screen.queryByText("Restricted learning content")).toBeNull();
	expect(screen.getByText(/Learning opens again/)).toBeTruthy();
	await fireEvent.click(screen.getByRole("button", { name: "Help" }));
	expect(screen.getByText(/Closing Vulture still lets you use other apps/)).toBeTruthy();
});
it("blocks immediately offline and revalidates on reconnect and remount", async () => {
	const policy = setup();
	await screen.findByText("Restricted learning content");
	window.dispatchEvent(new Event("offline"));
	await waitFor(() => expect(screen.queryByText("Restricted learning content")).toBeNull());
	window.dispatchEvent(new Event("online"));
	await screen.findByText("Restricted learning content");
	expect(policy).toHaveBeenCalledTimes(2);
	cleanup();
	policy.mockResolvedValue(decision(false));
	setup(policy);
	expect(screen.queryByText("Restricted learning content")).toBeNull();
	await screen.findByText("Time for a pause");
});
it("expires cached policy even when a renewal hangs, then fails closed on errors", async () => {
	let elapsed = 0;
	vi.spyOn(performance, "now").mockImplementation(() => elapsed);
	const policy = setup();
	await screen.findByText("Restricted learning content");
	elapsed = 31000;
	await waitFor(() => expect(screen.queryByText("Restricted learning content")).toBeNull());
	policy.mockRejectedValue(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await screen.findByRole("alert");
	expect(screen.queryByText("Restricted learning content")).toBeNull();
});
it("ignores a late response from before disconnection", async () => {
	let resolve!: (p: GetChildPolicyResponse) => void;
	setup(
		vi.fn(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		),
	);
	await waitFor(() => expect(resolve).toBeTypeOf("function"));
	window.dispatchEvent(new Event("offline"));
	resolve(decision(true));
	await screen.findByRole("alert");
	expect(screen.queryByText("Restricted learning content")).toBeNull();
});

it("speaks to the child when the timetable is missing or cannot be checked", async () => {
	setup(
		vi.fn(
			async () =>
				new GetChildPolicyResponse({
					allowed: false,
					currentActivity: "Outside allowed time",
					timezone: "UTC",
					evaluatedAt: new Date().toISOString(),
					validUntil: new Date(Date.now() + 30000).toISOString(),
				}),
		),
	);
	await screen.findByText(/hasn't set learning time yet/);
	cleanup();
	setup(vi.fn(async () => Promise.reject(new Error("offline"))));
	await screen.findByText(/can't check your learning time right now/);
	// No timetable status while it cannot be checked.
	expect(screen.queryByText(/Right now/)).toBeNull();
	expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
});
