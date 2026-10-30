import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/svelte";
import { afterEach, describe, it, expect, vi } from "vitest";
import Provider from "./TestHomeworkProvider.svelte";
import { GetHomeworkResponse } from "../api/protocol";
import { toastService } from "../services/toast.svelte";
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
describe("Homework intake", () => {
	it("resizes the split list with keyboard controls and clamps its width", async () => {
		const service = {
			list: vi.fn().mockResolvedValue([]),
			previewEmail: vi.fn(),
			importEmail: vi.fn(),
			upload: vi.fn(),
			delete: vi.fn(),
			download: vi.fn(),
		};
		render(Provider, { service, view: "homework" });
		const splitter = screen.getByRole("separator", {
			name: "Resize homework list",
		});
		expect(splitter).toHaveAttribute("aria-valuenow", "20");
		await fireEvent.keyDown(splitter, { key: "ArrowRight" });
		expect(splitter).toHaveAttribute("aria-valuenow", "22");
		await fireEvent.keyDown(splitter, { key: "Home" });
		await fireEvent.keyDown(splitter, { key: "ArrowLeft" });
		expect(splitter).toHaveAttribute("aria-valuenow", "20");
		await fireEvent.keyDown(splitter, { key: "End" });
		await fireEvent.keyDown(splitter, { key: "ArrowRight" });
		expect(splitter).toHaveAttribute("aria-valuenow", "65");
		await waitFor(() => expect(service.list).toHaveBeenCalled());
	});
	it("previews PDF bytes privately and revokes the URL when closed", async () => {
		const revokeObjectURL = vi.fn();
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn(() => "blob:pdf"),
			revokeObjectURL,
		});
		const service = {
			previewEmail: vi.fn(),
			importEmail: vi.fn(),
			list: vi.fn().mockResolvedValue([
				new GetHomeworkResponse({
					homework: { id: "pdf", title: "Fractions", subject: "Maths" },
					sources: [{ pageCount: 2 }],
				}),
			]),
			upload: vi.fn(),
			delete: vi.fn(),
			download: vi.fn().mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" })),
		};
		render(Provider, { service });
		await fireEvent.click(await screen.findByRole("button", { name: "Preview Fractions" }));
		expect(await screen.findByTitle("PDF page preview")).toHaveAttribute("src", "blob:pdf");
		expect(service.download).toHaveBeenCalledWith("pdf");
		await fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
		expect(screen.queryByTitle("PDF page preview")).toBeNull();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf");
	});
	it("shows download denial without opening a preview and permits retry", async () => {
		const createObjectURL = vi.fn(() => "blob:retry");
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
		const service = {
			previewEmail: vi.fn(),
			importEmail: vi.fn(),
			list: vi.fn().mockResolvedValue([
				new GetHomeworkResponse({
					homework: { id: "doc", title: "Words", subject: "Spelling" },
				}),
			]),
			upload: vi.fn(),
			delete: vi.fn(),
			download: vi
				.fn()
				.mockRejectedValueOnce(new Error("Permission denied"))
				.mockResolvedValue(new Blob(["image"], { type: "image/png" })),
		};
		render(Provider, { service });
		await fireEvent.click(await screen.findByRole("button", { name: "Preview Words" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Permission denied",
		);
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(screen.queryByRole("region", { name: "Homework preview" })).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "Preview Words" }));
		expect(await screen.findByAltText("Worksheet preview: Words")).toHaveAttribute(
			"src",
			"blob:retry",
		);
		toastService.clear();
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	});
	it("shows upload failure and allows retry, preview and deletion", async () => {
		const item = new GetHomeworkResponse({
			homework: { id: "doc", title: "Words", subject: "Spelling" },
			sources: [{ pageCount: 1 }],
		});
		const service = {
			previewEmail: vi.fn(),
			importEmail: vi.fn(),
			list: vi.fn().mockResolvedValue([item]),
			upload: vi
				.fn()
				.mockRejectedValueOnce(new Error("Upload failed. Retry."))
				.mockResolvedValue(undefined),
			download: vi.fn().mockResolvedValue(new Blob(["image"], { type: "image/png" })),
			delete: vi.fn().mockResolvedValue(undefined),
		};
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn().mockReturnValue("blob:private"),
			revokeObjectURL: vi.fn(),
		});
		render(Provider, { service });
		await screen.findByRole("button", { name: "Preview Words" });
		await fireEvent.input(screen.getByLabelText("Homework title"), {
			target: { value: "Words" },
		});
		await fireEvent.input(screen.getByLabelText("Homework subject"), {
			target: { value: "Spelling" },
		});
		await fireEvent.change(screen.getByLabelText("Worksheet file"), {
			target: {
				files: [new File(["png"], "sheet.png", { type: "image/png" })],
			},
		});
		await fireEvent.click(screen.getByRole("button", { name: "Upload homework" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Upload failed",
		);
		await fireEvent.click(screen.getByRole("button", { name: "Upload homework" }));
		await waitFor(() => expect(service.upload).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Preview Words" })).toBeEnabled(),
		);
		await fireEvent.click(screen.getByRole("button", { name: "Preview Words" }));
		expect(await screen.findByAltText("Worksheet preview: Words")).toHaveAttribute(
			"src",
			"blob:private",
		);
		await fireEvent.click(screen.getByRole("button", { name: "Delete Words" }));
		await screen.findByRole("alertdialog");
		await fireEvent.click(screen.getByRole("button", { name: "Delete", exact: true }));
		await waitFor(() => expect(service.delete).toHaveBeenCalledWith("doc"));
	});
});

it("renders imported email text as escaped text with provenance and clears the preview", async () => {
	const createObjectURL = vi.fn();
	vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
	const service = {
		list: vi.fn().mockResolvedValue([
			new GetHomeworkResponse({
				homework: { id: "email", title: "Email words", subject: "Spelling" },
				sources: [
					{
						pageCount: 1,
						emailProvenance: {
							sender: "Teacher",
							sentAt: "Original date",
							partName: "Email body",
						},
					},
				],
			}),
		]),
		upload: vi.fn(),
		delete: vi.fn(),
		previewEmail: vi.fn(),
		importEmail: vi.fn(),
		download: vi.fn().mockResolvedValue({
			type: "text/plain",
			text: async () => "<script>alert(1)</script> apple",
		}),
	};
	render(Provider, { service });
	await fireEvent.click(await screen.findByRole("button", { name: "Preview Email words" }));
	expect(await screen.findByText("<script>alert(1)</script> apple")).toBeVisible();
	expect(screen.getByText("Email: Teacher · Original date · Email body")).toBeVisible();
	expect(document.querySelector("section[aria-label='Homework preview'] script")).toBeNull();
	expect(createObjectURL).not.toHaveBeenCalled();
	await fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
	expect(screen.queryByRole("region", { name: "Homework preview" })).toBeNull();
});

describe("Homework creation steps", () => {
	function setup() {
		const service = {
			list: vi.fn().mockResolvedValue([]),
			previewEmail: vi.fn(),
			importEmail: vi.fn(),
			upload: vi.fn(),
			delete: vi.fn(),
			download: vi.fn(),
			createText: vi.fn().mockResolvedValue(undefined),
			generateDraft: vi.fn().mockResolvedValue({
				title: "Adding",
				questions: [
					{
						question: "What is 2 + 3?",
						answer: "5",
						explanation: "Add two and three to get five.",
					},
				],
			}),
		};
		render(Provider, { service, view: "homework" });
		return service;
	}
	it("creates instructions-only homework after the content and review steps", async () => {
		const service = setup();
		await waitFor(() => expect(screen.getByRole("button", { name: "Add homework" })).toBeEnabled());
		await fireEvent.click(screen.getByRole("button", { name: "Add homework" }));
		expect(screen.queryByLabelText("Homework title")).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: /Manually/ }));
		await fireEvent.click(screen.getByRole("button", { name: /Type it/ }));
		await fireEvent.input(screen.getByLabelText("Homework title"), {
			target: { value: "Reading" },
		});
		await fireEvent.input(screen.getByLabelText("Homework subject"), {
			target: { value: "English" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next step" }));
		expect(await screen.findByText("Add instructions or at least one question.")).toBeVisible();
		await fireEvent.input(screen.getByLabelText("Homework instructions"), {
			target: { value: "Read chapter 3." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next step" }));
		expect(screen.getByText("Read chapter 3.")).toBeVisible();
		expect(service.createText).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
		await waitFor(() =>
			expect(service.createText).toHaveBeenCalledWith(
				"child",
				"Reading",
				"English",
				"Read chapter 3.",
				[],
			),
		);
	});
	it("saves typed homework with questions the child can answer", async () => {
		const service = setup();
		await waitFor(() => expect(screen.getByRole("button", { name: "Add homework" })).toBeEnabled());
		await fireEvent.click(screen.getByRole("button", { name: "Add homework" }));
		await fireEvent.click(screen.getByRole("button", { name: /Manually/ }));
		await fireEvent.click(screen.getByRole("button", { name: /Type it/ }));
		await fireEvent.input(screen.getByLabelText("Homework title"), {
			target: { value: "Sky" },
		});
		await fireEvent.input(screen.getByLabelText("Homework subject"), {
			target: { value: "Science" },
		});
		await fireEvent.input(screen.getByLabelText("Homework instructions"), {
			target: { value: "Look outside first." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Add question" }));
		const question = screen.getByRole("group", { name: "Question 1" });
		await fireEvent.change(within(question).getByLabelText("Type"), {
			target: { value: "true_false" },
		});
		await fireEvent.input(within(question).getByLabelText("Question"), {
			target: { value: "The sky is blue." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next step" }));
		expect(await screen.findByText("Choose True or False.")).toBeVisible();
		await fireEvent.click(within(question).getByRole("radio", { name: "True" }));
		await fireEvent.click(screen.getByRole("button", { name: "Next step" }));
		expect(screen.getByText("The sky is blue.")).toBeVisible();
		expect(screen.getByText("True or false")).toBeVisible();
		await fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
		await waitFor(() =>
			expect(service.createText).toHaveBeenCalledWith(
				"child",
				"Sky",
				"Science",
				"Look outside first.",
				[expect.objectContaining({ kind: "true_false", answer: "True" })],
			),
		);
	});
	it("generates editable answers and explanations, saving the key separately", async () => {
		const service = setup();
		await waitFor(() => expect(screen.getByRole("button", { name: "Add homework" })).toBeEnabled());
		await fireEvent.click(screen.getByRole("button", { name: "Add homework" }));
		await fireEvent.click(screen.getByRole("button", { name: /Automatically/ }));
		await fireEvent.input(screen.getByLabelText("Topic"), {
			target: { value: "Addition" },
		});
		await fireEvent.input(screen.getByLabelText("Subject", { exact: true }), {
			target: { value: "Math" },
		});
		await fireEvent.click(screen.getByRole("checkbox"));
		await fireEvent.click(screen.getByRole("button", { name: "Generate homework" }));
		await screen.findByRole("heading", { name: "Review homework" });
		expect(service.generateDraft).toHaveBeenCalledWith(
			expect.objectContaining({
				profileId: "child",
				topic: "Addition",
				subject: "Math",
				aiOptIn: true,
			}),
		);
		expect(screen.getByLabelText("Answer")).toHaveValue("5");
		await fireEvent.input(screen.getByLabelText(/^Explanation/), {
			target: { value: "Count three more after two: three, four, five." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
		await waitFor(() =>
			expect(service.createText).toHaveBeenCalledWith("child", "Adding", "Math", "", [
				expect.objectContaining({
					answer: "5",
					explanation: "Count three more after two: three, four, five.",
				}),
			]),
		);
	});
	it("retains context and permits retry after AI failure", async () => {
		const service = setup();
		service.generateDraft.mockRejectedValueOnce(new Error("AI unavailable"));
		await waitFor(() => expect(screen.getByRole("button", { name: "Add homework" })).toBeEnabled());
		await fireEvent.click(screen.getByRole("button", { name: "Add homework" }));
		await fireEvent.click(screen.getByRole("button", { name: /Automatically/ }));
		await fireEvent.input(screen.getByLabelText("Topic"), {
			target: { value: "Addition" },
		});
		await fireEvent.input(screen.getByLabelText("Subject", { exact: true }), {
			target: { value: "Math" },
		});
		await fireEvent.click(screen.getByRole("checkbox"));
		await fireEvent.click(screen.getByRole("button", { name: "Generate homework" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"AI unavailable",
		);
		expect(screen.getByLabelText("Topic")).toHaveValue("Addition");
		await fireEvent.click(screen.getByRole("button", { name: "Generate homework" }));
		await screen.findByRole("heading", { name: "Review homework" });
	});
});

it("requires confirmation and keeps homework when deletion is cancelled", async () => {
	const service = {
		list: vi.fn().mockResolvedValue([
			new GetHomeworkResponse({
				homework: { id: "doc", title: "Fractions", subject: "Math" },
			}),
		]),
		previewEmail: vi.fn(),
		importEmail: vi.fn(),
		upload: vi.fn(),
		download: vi.fn(),
		delete: vi.fn().mockResolvedValue(undefined),
	};
	render(Provider, { service });
	const remove = await screen.findByRole("button", {
		name: "Delete Fractions",
	});
	await waitFor(() => expect(remove).toBeEnabled());
	await fireEvent.click(remove);
	expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete “Fractions”?");
	expect(service.delete).not.toHaveBeenCalled();
	await fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(service.delete).not.toHaveBeenCalled();
	await fireEvent.click(remove);
	await screen.findByRole("alertdialog");
	await fireEvent.click(screen.getByRole("button", { name: "Delete", exact: true }));
	await waitFor(() => expect(service.delete).toHaveBeenCalledExactlyOnceWith("doc"));
});
