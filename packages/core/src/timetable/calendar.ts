import type { CalendarEntry, TimetableWindow } from "../api/protocol";
export const activityNames: Record<string, string> = {
	study: "Study",
	allowed: "Free time",
	break: "Break",
	homework: "Homework",
	test: "Test",
};
export function localToday(timezone: string, now = new Date()): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	return ["year", "month", "day"].map((k) => parts.find((p) => p.type === k)!.value).join("-");
}
export function shiftDate(date: string, days: number): string {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
export function weekday(date: string): number {
	return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}
export function monthDays(month: string): string[] {
	const first = `${month}-01`;
	const start = shiftDate(first, -weekday(first));
	return Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
}
export function shiftMonth(month: string, delta: number): string {
	const d = new Date(`${month}-01T12:00:00Z`);
	d.setUTCMonth(d.getUTCMonth() + delta);
	return d.toISOString().slice(0, 7);
}
export function clock(minute: number): string {
	return `${Math.floor(minute / 60)
		.toString()
		.padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}
export function parseTime(value: string): number {
	if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00")
		throw new Error("Enter a valid time.");
	const [h, m] = value.split(":").map(Number);
	return h * 60 + m;
}
export interface CalendarBlock {
	id: string;
	title: string;
	kind: string;
	start: number;
	end: number;
	recurring: boolean;
	sourceId: string;
}
export function dayBlocks(
	date: string,
	entries: CalendarEntry[],
	windows: TimetableWindow[],
): CalendarBlock[] {
	const out: CalendarBlock[] = [];
	for (const e of entries) {
		if (e.date === date)
			out.push({
				id: e.id,
				title: e.title,
				kind: e.kind,
				start: e.start,
				end: e.end > e.start ? e.end : 1440,
				recurring: false,
				sourceId: e.id,
			});
		if (e.end < e.start && e.date === shiftDate(date, -1))
			out.push({
				id: `${e.id}-carry`,
				title: e.title,
				kind: e.kind,
				start: 0,
				end: e.end,
				recurring: false,
				sourceId: e.id,
			});
	}
	windows.forEach((w, i) => {
		const day = weekday(date);
		const base = {
			id: `weekly-${i}`,
			title: activityNames[w.kind] ?? w.kind,
			kind: w.kind,
			recurring: true,
			sourceId: String(i),
		};
		if (w.day === day)
			out.push({
				...base,
				start: w.start,
				end: w.end > w.start ? w.end : 1440,
			});
		if (w.end < w.start && (w.day + 1) % 7 === day)
			out.push({ ...base, id: `weekly-${i}-carry`, start: 0, end: w.end });
	});
	return out.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start || a.end - b.end);
}
export function layoutBlocks(blocks: CalendarBlock[]) {
	const result: (CalendarBlock & { lane: number; lanes: number })[] = [];
	let group: typeof result = [];
	let end = -1;
	const finish = () => {
		const count = Math.max(1, ...group.map((b) => b.lane + 1));
		group.forEach((b) => {
			b.lanes = count;
			result.push(b);
		});
		group = [];
	};
	for (const block of blocks) {
		if (block.start >= end) {
			finish();
			end = -1;
		}
		const used = new Set(group.filter((b) => b.end > block.start).map((b) => b.lane));
		let lane = 0;
		while (used.has(lane)) lane++;
		group.push({ ...block, lane, lanes: 1 });
		end = Math.max(end, block.end);
	}
	finish();
	return result;
}
