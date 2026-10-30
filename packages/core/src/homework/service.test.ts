import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import {
	GetHomeworkResponse,
	HomeworkAnswer,
	HomeworkMediaType,
	SourceVersion,
} from "../api/protocol";
import { DEFAULT_PARSER_YAML } from "./questions";
import { createHomeworkService } from "./service";

const client = vi.hoisted(() => ({
	listHomework: vi.fn(),
	parseWorksheetDraft: vi.fn(),
	suggestWorksheetParser: vi.fn(),
	generateHomeworkDraft: vi.fn(),
	createHomework: vi.fn(),
	updateHomework: vi.fn(),
	downloadHomework: vi.fn(),
	deleteHomework: vi.fn(),
	assignHomework: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const getAccessToken = vi.fn();
const auth = { getAccessToken } as unknown as OidcAuth;
const service = () => createHomeworkService("https://server.invalid", auth);
function file(type = "image/png", size = 3): File {
	return {
		type,
		size,
		name: "worksheet.png",
		arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
	} as unknown as File;
}
beforeEach(() => {
	vi.resetAllMocks();
	getAccessToken.mockResolvedValue("current");
});

describe("homework client", () => {
	it.each([
		["unsupported MIME", "text/plain", 3, "Title", "Maths"],
		["empty file", "image/png", 0, "Title", "Maths"],
		["oversized file", "image/png", 10 * 1024 * 1024 + 1, "Title", "Maths"],
		["missing title", "image/png", 3, " ", "Maths"],
		["missing subject", "image/png", 3, "Title", " "],
	])("rejects %s at the native boundary", async (_, mime, size, title, subject) => {
		client.createHomework.mockRejectedValue(new Error("Invalid homework"));
		await expect(service().upload("profile", title, subject, file(mime, size))).rejects.toThrow();
		expect(client.createHomework).toHaveBeenCalled();
		expect(getAccessToken).toHaveBeenCalled();
	});

	it("uploads trimmed metadata and typed bytes using freshly fetched credentials", async () => {
		const api = service();
		getAccessToken.mockResolvedValueOnce("first").mockResolvedValueOnce("rotated");
		await api.upload("profile", " Title ", " Maths ", file());
		await api.upload("profile", "Title", "Maths", file("application/pdf"));
		expect(client.createHomework).toHaveBeenNthCalledWith(
			1,
			{
				profileId: "profile",
				title: "Title",
				subject: "Maths",
				filename: "worksheet.png",
				declaredMediaType: HomeworkMediaType.PNG,
				content: new Uint8Array([1, 2, 3]),
			},
			{ headers: { authorization: "Bearer first" } },
		);
		expect(client.createHomework).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ declaredMediaType: HomeworkMediaType.PDF }),
			{ headers: { authorization: "Bearer rotated" } },
		);
	});

	it("lists, downloads private bytes and deletes with fresh credentials", async () => {
		const item = new GetHomeworkResponse({ homework: { id: "doc" } });
		client.listHomework.mockResolvedValue({ items: [item] });
		client.downloadHomework.mockResolvedValue({
			content: new Uint8Array([1, 2, 3]),
			contentType: "image/png",
		});
		getAccessToken
			.mockResolvedValueOnce("list")
			.mockResolvedValueOnce("download")
			.mockResolvedValueOnce("delete");
		const api = service();
		expect(await api.list("profile")).toEqual([item]);
		const blob = await api.download("doc");
		expect(blob.type).toBe("image/png");
		expect(blob.size).toBe(3);
		await api.delete("doc");
		expect(client.listHomework).toHaveBeenCalledWith(
			{ profileId: "profile" },
			{ headers: { authorization: "Bearer list" } },
		);
		expect(client.downloadHomework).toHaveBeenCalledWith(
			{ homeworkId: "doc" },
			{ headers: { authorization: "Bearer download" } },
		);
		expect(client.deleteHomework).toHaveBeenCalledWith(
			{ homeworkId: "doc" },
			{ headers: { authorization: "Bearer delete" } },
		);
	});
});

it("saves structured answer keys separately from worksheet text", async () => {
	await service().createText("profile", " Addition ", " Math ", "", [
		new HomeworkAnswer({
			question: "2 + 3?",
			answer: "5",
			explanation: "Add two and three.",
		}),
	]);
	expect(client.createHomework).toHaveBeenCalledWith(
		expect.objectContaining({
			title: "Addition",
			subject: "Math",
			declaredMediaType: HomeworkMediaType.TEXT,
			answerKey: [
				expect.objectContaining({
					answer: "5",
					explanation: "Add two and three.",
				}),
			],
		}),
		expect.anything(),
	);
});
it("sends optional reference bytes with draft context", async () => {
	await service().generateDraft({
		profileId: "profile",
		topic: "Addition",
		subject: "Math",
		context: "Small sums",
		questionCount: 5,
		aiOptIn: true,
		reference: file("application/pdf"),
	});
	expect(client.generateHomeworkDraft).toHaveBeenCalledWith(
		expect.objectContaining({
			topic: "Addition",
			referenceMediaType: HomeworkMediaType.PDF,
			referenceContent: new Uint8Array([1, 2, 3]),
		}),
		expect.anything(),
	);
});

it("updates metadata without replacing bytes and pins content edits to their source version", async () => {
	const source = new SourceVersion({ id: "source", version: 1 });
	await service().update("doc", source, " Title ", " Math ");
	expect(client.updateHomework).toHaveBeenLastCalledWith(
		expect.objectContaining({
			homeworkId: "doc",
			expectedSource: source,
			title: "Title",
			subject: "Math",
			content: undefined,
		}),
		expect.anything(),
	);
	await service().update("doc", source, "Title", "Math", "**Question**");
	const updated = client.updateHomework.mock.calls.at(-1)![0];
	expect(updated.declaredMediaType).toBe(HomeworkMediaType.TEXT);
	expect(new TextDecoder().decode(updated.content)).toBe("**Question**");
});

it("retains original upload bytes alongside parsed questions and pins YAML updates", async () => {
	const answers = [
		new HomeworkAnswer({
			question: "6 × 7?",
			answer: "42",
			explanation: "Six groups of seven.",
		}),
	];
	const api = service();
	await api.upload("profile", "Worksheet", "Math", file(), answers);
	expect(client.createHomework).toHaveBeenLastCalledWith(
		expect.objectContaining({
			content: new Uint8Array([1, 2, 3]),
			answerKey: answers,
		}),
		expect.anything(),
	);
	const source = new SourceVersion({ id: "source", version: 3 });
	await api.update("doc", source, "Worksheet", "Math", undefined, answers);
	expect(client.updateHomework).toHaveBeenLastCalledWith(
		expect.objectContaining({
			expectedSource: source,
			content: undefined,
			answerKey: expect.objectContaining({ questions: answers }),
		}),
		expect.anything(),
	);

	const recipe =
		"version: 1\nrules:\n  - type: region\n    question: {page: 1, bounds: [0, 0, 500, 200]}";
	await api.parseWorksheet("profile", recipe, { file: file() });
	expect(client.parseWorksheetDraft).toHaveBeenLastCalledWith(
		expect.objectContaining({
			parserJson: expect.any(String),
			content: new Uint8Array([1, 2, 3]),
		}),
		expect.anything(),
	);
	expect(client.generateHomeworkDraft).not.toHaveBeenCalled();
	await api.update("doc", source, "Worksheet", "Math", undefined, answers, recipe);
	expect(client.updateHomework).toHaveBeenLastCalledWith(
		expect.objectContaining({ parserYaml: recipe }),
		expect.anything(),
	);
});

it("AI assistance returns a recipe, and is separate from running the parser", async () => {
	const recipe = JSON.stringify({
		version: 1,
		rules: [{ type: "pattern", question: "Q: (.*)" }],
	});
	client.suggestWorksheetParser.mockResolvedValue({ parserJson: recipe });
	const api = service();
	client.suggestWorksheetParser.mockRejectedValueOnce(new Error("Allow AI"));
	await expect(api.suggestParser("profile", [], "", false)).rejects.toThrow("Allow AI");
	expect(client.suggestWorksheetParser).toHaveBeenCalledOnce();
	const yaml = await api.suggestParser("profile", [], "Questions on the left", true);
	expect(yaml).toContain("type: pattern");
	expect(client.generateHomeworkDraft).not.toHaveBeenCalled();
	await api.parseWorksheet("profile", DEFAULT_PARSER_YAML, { segments: [] });
	expect(client.parseWorksheetDraft).toHaveBeenLastCalledWith(
		expect.objectContaining({ content: undefined, segments: [] }),
		expect.anything(),
	);
});

describe("family AI on this device", () => {
	const familyAi = {
		enabled: vi.fn(async () => true),
		run: vi.fn(),
	};
	const local = () => createHomeworkService("https://server.invalid", auth, familyAi as never);

	beforeEach(() => {
		familyAi.enabled.mockResolvedValue(true);
		familyAi.run.mockReset();
		client.suggestWorksheetParser.mockReset();
		client.generateHomeworkDraft.mockReset();
	});

	it("routes parser assistance and drafts through the device's family AI", async () => {
		familyAi.run.mockResolvedValueOnce({
			worksheetParser: {
				parserJson: JSON.stringify({
					version: 1,
					rules: [{ type: "pattern", question: "Q: (.*)", answer: "A: (.*)" }],
				}),
			},
		});
		const yaml = await local().suggestParser("profile", [], "layout", true);
		expect(yaml).toContain("version: 1");
		expect(familyAi.run).toHaveBeenLastCalledWith({
			worksheetParser: { profileId: "profile", segments: [], layout: "layout", aiOptIn: true },
		});
		familyAi.run.mockResolvedValueOnce({ homeworkDraft: { title: "Draft", questions: [] } });
		const draft = await local().generateDraft({
			profileId: "profile",
			topic: "Addition",
			context: "",
			subject: "Math",
			questionCount: 1,
			aiOptIn: true,
			reference: file("text/plain"),
		});
		expect(draft).toEqual({ title: "Draft", questions: [] });
		const request = familyAi.run.mock.calls[1][0].homeworkDraft;
		expect(request.referenceMediaType).toBe(HomeworkMediaType.TEXT);
		expect(request.referenceContent).toBeInstanceOf(Uint8Array);
		expect(client.suggestWorksheetParser).not.toHaveBeenCalled();
		expect(client.generateHomeworkDraft).not.toHaveBeenCalled();
	});

	it("reports missing results and falls back to the platform when not set up", async () => {
		familyAi.run.mockResolvedValue({});
		await expect(local().suggestParser("profile", [], "", true)).rejects.toThrow(
			"AI did not return a reader",
		);
		await expect(
			local().generateDraft({
				profileId: "profile",
				topic: "Addition",
				context: "",
				subject: "Math",
				questionCount: 1,
				aiOptIn: true,
			}),
		).rejects.toThrow("AI did not return a draft");
		familyAi.enabled.mockResolvedValue(false);
		client.suggestWorksheetParser.mockResolvedValue({
			parserJson: JSON.stringify({
				version: 1,
				rules: [{ type: "pattern", question: "Q: (.*)", answer: "A: (.*)" }],
			}),
		});
		client.generateHomeworkDraft.mockResolvedValue({ title: "Platform" });
		await local().suggestParser("profile", [], "", true);
		await local().generateDraft({
			profileId: "profile",
			topic: "Addition",
			context: "",
			subject: "Math",
			questionCount: 1,
			aiOptIn: true,
		});
		expect(client.suggestWorksheetParser).toHaveBeenCalledOnce();
		expect(client.generateHomeworkDraft).toHaveBeenCalledOnce();
	});
});

it("assigns a homework's questions to the child with the current parent token", async () => {
	await service().assign("doc");
	expect(client.assignHomework).toHaveBeenCalledWith(
		{ homeworkId: "doc" },
		{ headers: { authorization: "Bearer current" } },
	);
});
