import { describe, expect, it, vi } from "vitest";
import { loadDashboard, nextWindow, live } from "./dashboard";
import { GeneratePracticeResponse, PracticeQuestionKind as K } from "../api/protocol";
import { Timetable } from "../api/protocol";
import { fixture } from "./test-fixture";
describe("parent dashboard aggregation", () => {
	it("scopes calls to selected profile, keeps latest practices, separates review from graded accuracy", async () => {
		const services = fixture();
		const data = await loadDashboard(services, "profile");
		for (const method of [
			services.homework.list,
			services.childLearning.review,
			services.timetable.get,
			services.robot.dashboard,
		])
			expect(method).toHaveBeenCalledWith("profile");
		expect(services.practice.list).toHaveBeenCalledWith({
			id: "src",
			version: 1,
		});
		expect(data.accuracy).toBe(50);
		expect(data.graded).toBe(2);
		expect(data.help).toHaveLength(1);
		expect(data.uncertain).toHaveLength(1);
		expect(data.review.map((s) => s.practice?.title)).toEqual(["Draft"]);
		expect(data.spelling.map((s) => s.practice?.title)).toEqual(["Words"]);
	});
	it("has explicit empty state, excludes non-spelling and unapproved practice, and propagates denied reads", async () => {
		const services = fixture();
		vi.mocked(services.childLearning.review).mockResolvedValue([]);
		vi.mocked(services.practice.list).mockResolvedValue([
			new GeneratePracticeResponse({
				practice: { practice: { id: "math", version: 1 }, approved: true },
				questions: [{ question: { kind: K.SHORT_ANSWER } }],
			}),
		]);
		const data = await loadDashboard(services, "p");
		expect(data.accuracy).toBeNull();
		expect(data.spelling).toEqual([]);
		vi.mocked(services.robot.dashboard).mockRejectedValue(new Error("denied"));
		await expect(loadDashboard(services, "p")).rejects.toThrow("denied");
	});
	it("identifies only queued, accepted, running commands as stoppable", () => {
		for (const state of ["queued", "accepted", "running"]) expect(live(state)).toBe(true);
		for (const state of ["succeeded", "failed", "cancelled", "expired", "unknown"])
			expect(live(state)).toBe(false);
	});
});
describe("next schedule display", () => {
	it("handles timezone, week rollover, overnight starts, and no windows", () => {
		const t = new Timetable({
			timezone: "America/Chicago",
			windows: [{ day: 6, start: 1380, end: 120, kind: "allowed" }],
		});
		expect(nextWindow(t, Date.parse("2026-10-18T22:00:00Z"))).toEqual({
			at: "2026-10-19T04:00:00.000Z",
			kind: "allowed",
		});
		expect(nextWindow(t, Date.parse("2026-10-19T05:00:00Z"))?.at).toBe("2026-10-26T04:00:00.000Z");
		expect(nextWindow(new Timetable(), Date.now())).toBeNull();
	});
	it("uses real instants across DST transitions", () => {
		const t = new Timetable({
			timezone: "America/Chicago",
			windows: [{ day: 6, start: 150, end: 240, kind: "study" }],
		});
		expect(nextWindow(t, Date.parse("2026-11-01T05:00:00Z"))?.at).toBe("2026-11-01T08:30:00.000Z");
	});
});
