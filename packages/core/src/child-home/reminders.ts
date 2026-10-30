import { TaskStatus, type Task } from "../api/protocol";

export interface Reminder {
	id: string;
	text: string;
	tone: "overdue" | "soon" | "info";
}
export interface LearningWindow {
	allowed: boolean;
	nextAllowedAt?: string;
	timezone?: string;
}

const DAY = 24 * 60 * 60 * 1000;
const OPEN = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED, TaskStatus.UNSPECIFIED];

function when(value: Date, timeZone?: string) {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		hour: "numeric",
		minute: "2-digit",
		...(timeZone ? { timeZone } : {}),
	}).format(value);
}

/** Reminders for a child's home: overdue and upcoming tasks, homework and learning time. */
export function childReminders(input: {
	now: Date;
	tasks: Task[];
	homework: number;
	learning?: LearningWindow;
}): Reminder[] {
	const now = input.now.getTime();
	const out: Reminder[] = [];
	for (const task of input.tasks) {
		if (!OPEN.includes(task.status)) continue;
		const end = task.endAt ? Date.parse(task.endAt) : NaN;
		const start = task.startAt ? Date.parse(task.startAt) : NaN;
		if (task.status === TaskStatus.REJECTED)
			out.push({ id: `${task.id}:again`, text: `Try “${task.title}” again`, tone: "soon" });
		else if (end < now)
			out.push({ id: `${task.id}:overdue`, text: `“${task.title}” is overdue`, tone: "overdue" });
		else if (end - now <= DAY)
			out.push({
				id: `${task.id}:due`,
				text: `“${task.title}” is due ${when(new Date(end))}`,
				tone: "soon",
			});
		else if (start > now && start - now <= DAY)
			out.push({
				id: `${task.id}:start`,
				text: `“${task.title}” starts ${when(new Date(start))}`,
				tone: "info",
			});
	}
	if (input.learning?.allowed && input.homework > 0)
		out.push({
			id: "homework",
			text:
				input.homework === 1
					? "You have 1 homework to finish"
					: `You have ${input.homework} homework to finish`,
			tone: "info",
		});
	if (input.learning && !input.learning.allowed && input.learning.nextAllowedAt) {
		const next = new Date(input.learning.nextAllowedAt);
		if (!Number.isNaN(next.getTime()))
			out.push({
				id: "learning",
				text: `Learning opens ${when(next, input.learning.timezone || undefined)}`,
				tone: "info",
			});
	}
	const order = { overdue: 0, soon: 1, info: 2 };
	return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
