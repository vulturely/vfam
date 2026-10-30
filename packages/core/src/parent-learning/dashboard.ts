import type { Runtime } from "../runtime/registry.svelte";
import {
	LearningAnswerResult as Result,
	PracticeQuestionKind as Kind,
	type GeneratePracticeResponse,
} from "../api/protocol";
import type { Timetable } from "../api/protocol";

export type DashboardServices = Pick<
	Runtime["services"],
	"homework" | "practice" | "childLearning" | "timetable" | "robot"
>;
export async function loadDashboard(services: DashboardServices, profileId: string) {
	const [homework, attempts, timetable, robot] = await Promise.all([
		services.homework.list(profileId),
		services.childLearning.review(profileId),
		services.timetable.get(profileId),
		services.robot.dashboard(profileId),
	]);
	const sets = (
		await Promise.all(
			homework.flatMap((item) =>
				item.sources.flatMap((source) =>
					source.source ? [services.practice.list(source.source)] : [],
				),
			),
		)
	).flat();
	// Practice APIs may return historical versions; only the latest version is actionable.
	const latest = new Map<string, GeneratePracticeResponse>();
	for (const set of sets) {
		const version = set.practice?.practice;
		if (version && version.version > (latest.get(version.id)?.practice?.practice?.version ?? 0))
			latest.set(version.id, set);
	}
	const practices = [...latest.values()];
	const answers = attempts.flatMap((attempt) => attempt.answers);
	const graded = answers.filter((answer) =>
		[Result.CORRECT, Result.INCORRECT].includes(answer.result),
	);
	return {
		homework,
		attempts,
		timetable,
		...robot,
		practices,
		review: practices.filter(
			(set) => !set.practice?.approved && set.practice?.reviewState !== "rejected",
		),
		help: attempts.filter((attempt) => attempt.helpRequested),
		uncertain: answers.filter((answer) => answer.result === Result.NEEDS_REVIEW),
		accuracy: graded.length
			? Math.round(
					(100 * graded.filter((answer) => answer.result === Result.CORRECT).length) /
						graded.length,
				)
			: null,
		graded: graded.length,
		spelling: practices.filter(
			(set) =>
				set.practice?.approved &&
				set.questions.length > 0 &&
				set.questions.every((q) => q.question?.kind === Kind.SPELLING),
		),
	};
}
export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
export function live(state: string) {
	return ["queued", "accepted", "running"].includes(state);
}
/** Display only; the server remains authoritative for every start/poll/answer. */
export function nextWindow(timetable: Timetable, now: number): { at: string; kind: string } | null {
	if (!timetable.windows.length) return null;
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone: timetable.timezone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	for (let t = Math.floor(now / 60000) * 60000 + 60000; t <= now + 8 * 86400000; t += 60000) {
		const parts = Object.fromEntries(formatter.formatToParts(t).map((p) => [p.type, p.value]));
		const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
		const minute = Number(parts.hour) * 60 + Number(parts.minute);
		const window = timetable.windows.find((w) => w.day === day && w.start === minute);
		if (window) return { at: new Date(t).toISOString(), kind: window.kind };
	}
	return null;
}
