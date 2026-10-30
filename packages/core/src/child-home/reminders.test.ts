import { expect, it } from "vitest";
import { Task, TaskStatus } from "../api/protocol";
import { childReminders } from "./reminders";
const now = new Date("2026-10-28T10:00:00Z");
const task = (id: string, status: TaskStatus, fields: Partial<Task> = {}) =>
	new Task({ id, title: id, status, ...fields });

it("orders overdue, due-soon, retry and upcoming reminders", () => {
	const reminders = childReminders({
		now,
		homework: 2,
		learning: { allowed: true },
		tasks: [
			task("later", TaskStatus.TODO, { startAt: "2026-10-28T15:00:00Z" }),
			task("soon", TaskStatus.IN_PROGRESS, { endAt: "2026-10-28T12:00:00Z" }),
			task("late", TaskStatus.TODO, { endAt: "2026-10-27T12:00:00Z" }),
			task("again", TaskStatus.REJECTED),
			task("done", TaskStatus.COMPLETED, { endAt: "2026-10-27T12:00:00Z" }),
			task("review", TaskStatus.IN_REVIEW, { endAt: "2026-10-27T12:00:00Z" }),
			task("far", TaskStatus.TODO, {
				startAt: "2026-11-05T12:00:00Z",
				endAt: "2026-11-06T12:00:00Z",
			}),
		],
	});
	expect(reminders.map((r) => r.id)).toEqual([
		"late:overdue",
		"soon:due",
		"again:again",
		"later:start",
		"homework",
	]);
	expect(reminders[0]!.text).toBe("“late” is overdue");
	expect(reminders[2]!.text).toBe("Try “again” again");
	expect(reminders[4]!.text).toBe("You have 2 homework to finish");
});

it("says when learning opens and counts one homework", () => {
	expect(
		childReminders({ now, tasks: [], homework: 1, learning: { allowed: true } })[0]!.text,
	).toBe("You have 1 homework to finish");
	const closed = childReminders({
		now,
		tasks: [],
		homework: 1,
		learning: { allowed: false, nextAllowedAt: "2026-10-28T16:00:00Z", timezone: "UTC" },
	});
	expect(closed).toHaveLength(1);
	expect(closed[0]!.text).toMatch(/^Learning opens /);
	expect(
		childReminders({
			now,
			tasks: [],
			homework: 0,
			learning: { allowed: false, nextAllowedAt: "not a date" },
		}),
	).toEqual([]);
	expect(childReminders({ now, tasks: [], homework: 3 })).toEqual([]);
});
