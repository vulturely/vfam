import { expect, it } from "vitest";
import { CalendarEntry, TimetableWindow } from "../api/protocol";
import { localToday, monthDays, shiftMonth, dayBlocks, layoutBlocks } from "./calendar";
it("uses profile-local dates and Monday-first month grids across leap years", () => {
	expect(localToday("America/Chicago", new Date("2026-10-19T01:00:00Z"))).toBe("2026-10-18");
	expect(monthDays("2024-02")).toContain("2024-02-29");
	expect(monthDays("2026-10")[0]).toBe("2026-09-28");
	expect(shiftMonth("2026-12", 1)).toBe("2027-01");
});
it("carries overnight weekly and dated activities into the next day without repeating dated entries", () => {
	const entries = [
		new CalendarEntry({
			id: "event",
			date: "2026-10-18",
			start: 1380,
			end: 120,
			kind: "homework",
			title: "Read",
		}),
	];
	const windows = [new TimetableWindow({ day: 6, start: 1380, end: 60, kind: "study" })];
	expect(dayBlocks("2026-10-19", entries, windows)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ sourceId: "event", start: 0, end: 120 }),
			expect.objectContaining({ recurring: true, start: 0, end: 60 }),
		]),
	);
	expect(dayBlocks("2026-10-25", entries, [])).toHaveLength(0);
});
it("gives overlapping events separate lanes and lets touching events use the full width", () => {
	const base = {
		title: "Study",
		kind: "study",
		recurring: false,
		sourceId: "e",
	};
	const rows = layoutBlocks([
		{ ...base, id: "a", start: 60, end: 120 },
		{ ...base, id: "b", start: 90, end: 140 },
		{ ...base, id: "c", start: 140, end: 160 },
	]);
	expect(rows.map((r) => [r.lane, r.lanes])).toEqual([
		[0, 2],
		[1, 2],
		[0, 1],
	]);
});
