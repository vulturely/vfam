import { beforeEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import { Timetable, GetChildPolicyResponse } from "../api/protocol";
import { createTimetableService, policyLease } from "./service";
const client = vi.hoisted(() => ({
	getTimetable: vi.fn(),
	setProfileTimezone: vi.fn(),
	saveCalendar: vi.fn(),
	saveTimetable: vi.fn(),
	overrideTimetable: vi.fn(),
	getChildPolicy: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const getAccessToken = vi.fn(),
	getChildAccessToken = vi.fn();
const auth = { getAccessToken, getChildAccessToken } as unknown as OidcAuth;
beforeEach(() => {
	vi.resetAllMocks();
	getAccessToken.mockResolvedValue("parent");
	getChildAccessToken.mockResolvedValue("child");
});
it("uses parent credentials for settings and overrides, scoped child credentials for each activity", async () => {
	const service = createTimetableService("https://server.invalid", auth),
		t = new Timetable({ timezone: "UTC" });
	client.getTimetable.mockResolvedValue({ timetable: t });
	client.saveTimetable.mockResolvedValue({ timetable: t });
	client.overrideTimetable.mockResolvedValue({ timetable: t });
	expect(await service.get("profile")).toBe(t);
	expect(await service.save("profile", t)).toBe(t);
	expect(await service.override("profile", 15, "finish")).toBe(t);
	const parent = { headers: { authorization: "Bearer parent" } };
	expect(client.getTimetable).toHaveBeenCalledWith({ profileId: "profile" }, parent);
	expect(client.saveTimetable).toHaveBeenCalledWith({ profileId: "profile", timetable: t }, parent);
	expect(client.overrideTimetable).toHaveBeenCalledWith(
		{ profileId: "profile", minutes: 15, reason: "finish" },
		parent,
	);
	for (const activity of ["learning", "chat", "robot"] as const) {
		await service.policy(activity);
		expect(client.getChildPolicy).toHaveBeenLastCalledWith(
			{ activity },
			{ headers: { authorization: "Bearer child" } },
		);
	}
	getChildAccessToken.mockResolvedValueOnce("rotated");
	await service.policy("learning");
	expect(client.getChildPolicy).toHaveBeenLastCalledWith(
		{ activity: "learning" },
		{ headers: { authorization: "Bearer rotated" } },
	);
});
it("fails closed without the correct credential, missing policies, and transport errors", async () => {
	const s = createTimetableService("https://server.invalid", auth);
	getChildAccessToken.mockResolvedValue(null);
	await expect(s.policy("learning")).rejects.toThrow("Child session expired");
	expect(client.getChildPolicy).not.toHaveBeenCalled();
	getAccessToken.mockResolvedValue(null);
	await expect(s.override("p", 5, "reason")).rejects.toThrow("Guardian");
	expect(client.overrideTimetable).not.toHaveBeenCalled();
	getAccessToken.mockResolvedValue("parent");
	client.getTimetable.mockResolvedValue({});
	await expect(s.get("p")).rejects.toThrow("unavailable");
	getChildAccessToken.mockResolvedValue("child");
	client.getChildPolicy.mockRejectedValue(new Error("offline"));
	await expect(s.policy("learning")).rejects.toThrow("offline");
});
it("caps leases, deducts request latency, and rejects expired or malformed policy", () => {
	const p = new GetChildPolicyResponse({
		evaluatedAt: "2026-10-19T10:00:00Z",
		validUntil: "2026-10-19T10:01:00Z",
	});
	expect(policyLease(p, 1000)).toBe(29000);
	p.validUntil = "2026-10-19T10:00:05Z";
	expect(policyLease(p, 1000)).toBe(4000);
	expect(policyLease(p, 6000)).toBe(0);
	p.validUntil = "2026-10-19T09:59:00Z";
	expect(policyLease(p, 0)).toBe(0);
	p.validUntil = "invalid";
	expect(policyLease(p, 0)).toBe(0);
});

it("patches profile timezone and calendar entries separately with guardian credentials", async () => {
	const service = createTimetableService("https://server.invalid", auth),
		timetable = new Timetable({ timezone: "UTC" });
	client.setProfileTimezone.mockResolvedValue({ timetable });
	client.saveCalendar.mockResolvedValue({ timetable });
	expect(await service.setTimezone("child", "Asia/Kathmandu")).toBe(timetable);
	expect(await service.saveCalendar("child", [])).toBe(timetable);
	expect(client.setProfileTimezone).toHaveBeenCalledWith(
		{ profileId: "child", timezone: "Asia/Kathmandu" },
		{ headers: { authorization: "Bearer parent" } },
	);
	expect(client.saveCalendar).toHaveBeenCalledWith(
		{ profileId: "child", entries: [] },
		{ headers: { authorization: "Bearer parent" } },
	);
});
