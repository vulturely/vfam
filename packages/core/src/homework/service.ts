import { createNativeClient } from "../repositories/nativeClient";
import { parserJson, parserYaml } from "./questions";
import type { OidcAuth } from "../auth/oidc";
import type { FamilyAiService } from "../family-ai/service";
import {
	HomeworkMediaType,
	HomeworkQuestions,
	type SourceSegment,
	ParseWorksheetDraftResponse,
	type HomeworkAnswer,
	type SourceVersion,
	GenerateHomeworkDraftResponse,
	GetHomeworkResponse,
} from "../api/protocol";
export type Homework = GetHomeworkResponse;
export interface HomeworkService {
	parseWorksheet(
		profileId: string,
		yaml: string,
		input: { file?: File; segments?: SourceSegment[] },
	): Promise<ParseWorksheetDraftResponse>;
	suggestParser(
		profileId: string,
		segments: SourceSegment[],
		layout: string,
		aiOptIn: boolean,
	): Promise<string>;

	generateDraft(input: {
		profileId: string;
		topic: string;
		context: string;
		subject: string;
		questionCount: number;
		aiOptIn: boolean;
		reference?: File;
	}): Promise<GenerateHomeworkDraftResponse>;
	createText(
		profileId: string,
		title: string,
		subject: string,
		text: string,
		answers?: HomeworkAnswer[],
	): Promise<void>;
	update(
		homeworkId: string,
		source: SourceVersion,
		title: string,
		subject: string,
		replacement?: string | File,
		answers?: HomeworkAnswer[],
		parserYaml?: string,
	): Promise<Homework>;
	list(profileId: string): Promise<Homework[]>;
	upload(
		profileId: string,
		title: string,
		subject: string,
		file: File,
		answers?: HomeworkAnswer[],
		parserYaml?: string,
	): Promise<void>;
	download(homeworkId: string): Promise<Blob>;
	delete(homeworkId: string): Promise<void>;
	/** Sends the homework's reviewed questions to the child to answer in the app. */
	assign(homeworkId: string): Promise<void>;
}
export function createHomeworkService(
	serverUrl: string,
	auth: OidcAuth,
	familyAi?: FamilyAiService,
): HomeworkService {
	const client = createNativeClient("control", serverUrl);
	async function options(): Promise<{ headers: Record<string, string> }> {
		const token = await auth.getAccessToken();
		return {
			headers: token ? { authorization: `Bearer ${token}` } : {},
		};
	}
	return {
		async parseWorksheet(profileId, yaml, { file, segments = [] }) {
			const types: Record<string, HomeworkMediaType> = {
				"image/png": HomeworkMediaType.PNG,
				"image/jpeg": HomeworkMediaType.JPEG,
				"application/pdf": HomeworkMediaType.PDF,
			};
			return (await client.parseWorksheetDraft(
				{
					profileId,
					parserJson: parserJson(yaml),
					content: file ? new Uint8Array(await file.arrayBuffer()) : undefined,
					declaredMediaType: file ? types[file.type] : undefined,
					segments,
				},
				await options(),
			)) as ParseWorksheetDraftResponse;
		},
		async suggestParser(profileId, segments, layout, aiOptIn) {
			if (familyAi && (await familyAi.enabled())) {
				const result = await familyAi.run({
					worksheetParser: { profileId, segments, layout, aiOptIn },
				});
				if (!result.worksheetParser) throw new Error("AI did not return a reader. Retry.");
				return parserYaml(result.worksheetParser.parserJson);
			}
			const result = (await client.suggestWorksheetParser(
				{ profileId, segments, layout, aiOptIn },
				await options(),
			)) as { parserJson: string };
			return parserYaml(result.parserJson);
		},
		async generateDraft({ reference, ...input }) {
			const types: Record<string, HomeworkMediaType> = {
				"text/plain": HomeworkMediaType.TEXT,
				"application/pdf": HomeworkMediaType.PDF,
				"image/png": HomeworkMediaType.PNG,
				"image/jpeg": HomeworkMediaType.JPEG,
			};
			const request = {
				...input,
				referenceContent: reference ? new Uint8Array(await reference.arrayBuffer()) : undefined,
				referenceMediaType: reference ? types[reference.type] : undefined,
			};
			if (familyAi && (await familyAi.enabled())) {
				const result = await familyAi.run({ homeworkDraft: request });
				if (!result.homeworkDraft) throw new Error("AI did not return a draft. Retry.");
				return result.homeworkDraft;
			}
			return (await client.generateHomeworkDraft(
				request,
				await options(),
			)) as GenerateHomeworkDraftResponse;
		},
		async createText(profileId, title, subject, text, answerKey = []) {
			await client.createHomework(
				{
					profileId,
					title: title.trim(),
					subject: subject.trim(),
					filename: "homework.txt",
					declaredMediaType: HomeworkMediaType.TEXT,
					content: new TextEncoder().encode(text.replaceAll("\r\n", "\n")),
					answerKey,
				},
				await options(),
			);
		},
		async update(homeworkId, expectedSource, title, subject, replacement, answers, parserYaml) {
			let content: Uint8Array | undefined;
			let declaredMediaType = HomeworkMediaType.UNSPECIFIED;
			if (typeof replacement === "string") {
				content = new TextEncoder().encode(replacement.replaceAll("\r\n", "\n"));
				declaredMediaType = HomeworkMediaType.TEXT;
			} else if (replacement) {
				const types: Record<string, HomeworkMediaType> = {
					"image/png": HomeworkMediaType.PNG,
					"image/jpeg": HomeworkMediaType.JPEG,
					"application/pdf": HomeworkMediaType.PDF,
				};
				declaredMediaType = types[replacement.type];
				content = new Uint8Array(await replacement.arrayBuffer());
			}
			return (await client.updateHomework(
				{
					homeworkId,
					parserYaml,
					answerKey: answers ? new HomeworkQuestions({ questions: answers }) : undefined,
					expectedSource,
					title: title.trim(),
					subject: subject.trim(),
					content: content === undefined ? undefined : new Uint8Array(content),
					declaredMediaType,
				},
				await options(),
			)) as GetHomeworkResponse;
		},
		async list(profileId) {
			return (
				(await client.listHomework({ profileId }, await options())) as {
					items: GetHomeworkResponse[];
				}
			).items;
		},
		async upload(profileId, title, subject, file, answerKey = [], parserYaml = "") {
			const types: Record<string, HomeworkMediaType> = {
				"image/jpeg": HomeworkMediaType.JPEG,
				"image/png": HomeworkMediaType.PNG,
				"application/pdf": HomeworkMediaType.PDF,
			};
			await client.createHomework(
				{
					profileId,
					title: title.trim(),
					subject: subject.trim(),
					...(answerKey.length ? { answerKey } : {}),
					...(parserYaml ? { parserYaml } : {}),
					filename: file.name,
					declaredMediaType: types[file.type],
					content: new Uint8Array(await file.arrayBuffer()),
				},
				await options(),
			);
		},
		async download(homeworkId) {
			const result = (await client.downloadHomework({ homeworkId }, await options())) as {
				content: Uint8Array;
				contentType: string;
			};
			return new Blob([new Uint8Array(result.content)], {
				type: result.contentType,
			});
		},
		async delete(homeworkId) {
			await client.deleteHomework({ homeworkId }, await options());
		},
		async assign(homeworkId) {
			await client.assignHomework({ homeworkId }, await options());
		},
	};
}
