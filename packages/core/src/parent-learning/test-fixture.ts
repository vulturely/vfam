import { vi } from "vitest";
import { type DashboardServices } from "./dashboard";
import {
	GeneratePracticeResponse,
	LearningAnswerResult as R,
	PracticeQuestionKind as K,
	LearningAttempt,
} from "../api/protocol";
import { Timetable } from "../api/protocol";
export function fixture() {
	const approved = new GeneratePracticeResponse({
		practice: {
			title: "Words",
			practice: { id: "words", version: 2 },
			approved: true,
			reviewState: "approved",
		},
		questions: [{ question: { kind: K.SPELLING } }],
	});
	return {
		homework: {
			list: vi.fn().mockResolvedValue([
				{
					homework: { id: "hw", title: "Worksheet", subject: "Spelling" },
					sources: [{ source: { id: "src", version: 1 } }],
				},
			]),
		},
		practice: {
			list: vi.fn().mockResolvedValue([
				new GeneratePracticeResponse({
					practice: {
						title: "Old words",
						practice: { id: "words", version: 1 },
						reviewState: "draft",
					},
				}),
				approved,
				new GeneratePracticeResponse({
					practice: {
						title: "Draft",
						practice: { id: "draft", version: 1 },
						reviewState: "draft",
					},
				}),
			]),
		},
		childLearning: {
			review: vi.fn().mockResolvedValue([
				new LearningAttempt({
					session: { id: "session", createdAt: "2026-10-15T12:00:00Z" },
					helpRequested: true,
					answers: [
						{ id: "a", result: R.CORRECT },
						{ id: "b", result: R.INCORRECT },
						{
							id: "c",
							prompt: "Spell fruit",
							answer: "aple",
							result: R.NEEDS_REVIEW,
						},
					],
				}),
			]),
		},
		timetable: {
			get: vi.fn().mockResolvedValue(
				new Timetable({
					timezone: "UTC",
					windows: [{ day: 0, start: 960, end: 1020, kind: "allowed" }],
				}),
			),
		},
		robot: {
			dashboard: vi.fn().mockResolvedValue({ devices: [], commands: [] }),
			issue: vi.fn(),
			cancel: vi.fn(),
			revoke: vi.fn(),
		},
	} as unknown as DashboardServices;
}
