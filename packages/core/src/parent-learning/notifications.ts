import type { DashboardServices } from "./dashboard";
import { LearningAnswerResult, type GeneratePracticeResponse } from "../api/protocol";

/** Notifications do not depend on device or timetable availability. */
export async function loadNotifications(services: DashboardServices, profileId: string) {
	const [homework, attempts] = await Promise.all([
		services.homework.list(profileId),
		services.childLearning.review(profileId),
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
	const latest = new Map<string, GeneratePracticeResponse>();
	for (const set of sets) {
		const version = set.practice?.practice;
		if (version && version.version > (latest.get(version.id)?.practice?.practice?.version ?? 0))
			latest.set(version.id, set);
	}
	return {
		review: [...latest.values()].filter(
			(set) => !set.practice?.approved && set.practice?.reviewState !== "rejected",
		),
		uncertain: attempts
			.flatMap((attempt) => attempt.answers)
			.filter((answer) => answer.result === LearningAnswerResult.NEEDS_REVIEW),
		help: attempts.filter((attempt) => attempt.helpRequested),
	};
}
