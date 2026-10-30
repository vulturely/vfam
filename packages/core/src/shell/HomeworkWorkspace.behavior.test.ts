import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import Provider from "./TestHomeworkProvider.svelte";
import { GetHomeworkResponse, HomeworkMediaType } from "../api/protocol";

const first = new GetHomeworkResponse({
	homework: {
		id: "fractions",
		title: "Fractions",
		subject: "Math",
		uploadedBy: "parent",
		createdAt: "2026-01-02T03:04:00Z",
	},
	sources: [
		{
			mediaType: HomeworkMediaType.TEXT,
			pageCount: 1,
			source: { id: "source", version: 1 },
		},
	],
});
const second = new GetHomeworkResponse({
	homework: { id: "words", title: "Words", subject: "", createdAt: "not-a-date" },
	sources: [{ mediaType: HomeworkMediaType.PNG, pageCount: 2 }],
});

function setup(deleteImpl = vi.fn(async () => {})) {
	const service = {
		list: vi.fn(async () => [first, second]),
		upload: vi.fn(async () => {}),
		update: vi.fn(async () => first),
		delete: deleteImpl,
		download: vi.fn(async () => new Blob(["Question text"], { type: "text/plain" })),
		previewEmail: vi.fn(),
		importEmail: vi.fn(),
	};
	render(Provider, { service, view: "homework" });
	return service;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("filters by title and subject, resets with Escape, and shows empty results", async () => {
	setup();
	const search = await screen.findByRole("searchbox", { name: "Search homework" });
	expect(await screen.findByRole("button", { name: /^Fractions Math/ })).toBeVisible();
	expect(screen.getByRole("button", { name: /^Words No subject/ })).toBeVisible();
	await fireEvent.input(search, { target: { value: "title:fractions" } });
	expect(screen.queryByRole("button", { name: /^Words No subject/ })).toBeNull();
	await fireEvent.input(search, { target: { value: "subject:math" } });
	expect(screen.getByRole("button", { name: /^Fractions Math/ })).toBeVisible();
	await fireEvent.input(search, { target: { value: "missing" } });
	expect(screen.getByText("No homework matches your search.")).toBeVisible();
	await fireEvent.keyDown(search, { key: "Escape" });
	expect(search).toHaveValue("");
	expect(await screen.findByRole("button", { name: /^Words No subject/ })).toBeVisible();
});

it("opens text previews, edits typed homework, and supports cancel", async () => {
	const service = setup();
	await fireEvent.click(await screen.findByRole("button", { name: /^Fractions Math/ }));
	expect(await screen.findByText("Question text")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Edit homework", exact: true })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Actions for Fractions" }));
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
	await fireEvent.input(await screen.findByLabelText("Homework title"), {
		target: { value: "Updated fractions" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save homework changes" }));
	await waitFor(() =>
		expect(service.update).toHaveBeenCalledWith(
			"fractions",
			expect.objectContaining({ id: "source" }),
			"Updated fractions",
			"Math",
			undefined,
			undefined,
		),
	);
	const actions = await screen.findByRole("button", {
		name: /^Actions for (Updated )?fractions$/i,
	});
	await waitFor(() => expect(actions).toBeEnabled());
	await fireEvent.click(actions);
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
	await fireEvent.click(await screen.findByRole("button", { name: "Cancel editing homework" }));
	await waitFor(() =>
		expect(screen.queryByRole("button", { name: "Save homework changes" })).toBeNull(),
	);
});

it("keeps deletion errors visible and supports cancellation and pointer resizing", async () => {
	const service = setup(vi.fn().mockRejectedValue(new Error("Delete denied")));
	await fireEvent.click(await screen.findByRole("button", { name: "Actions for Words" }));
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
	await fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
	expect(await screen.findByRole("alert")).toHaveTextContent("Delete denied");
	expect(service.delete).toHaveBeenCalledWith("words");
	await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	const splitter = screen.getByRole("separator", { name: "Resize homework list" });
	const panel = document.querySelector(".homework-browser") as HTMLElement;
	vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
		left: 100,
		width: 500,
		top: 0,
		right: 600,
		bottom: 500,
		height: 500,
		x: 100,
		y: 0,
		toJSON: () => ({}),
	});
	Object.defineProperty(splitter, "setPointerCapture", { value: vi.fn() });
	await fireEvent.pointerDown(splitter, { button: 0, pointerId: 1 });
	await fireEvent.pointerMove(splitter, { clientX: 350 });
	expect(splitter).toHaveAttribute("aria-valuenow", "50");
	await fireEvent.pointerMove(splitter, { clientX: 1000 });
	expect(splitter).toHaveAttribute("aria-valuenow", "65");
	await fireEvent.pointerUp(splitter);
	await fireEvent.pointerDown(splitter, { button: 1, pointerId: 2 });
	await fireEvent.pointerCancel(splitter);
});

it("opens questions from the row menu, keeps them out of the preview, and assigns once", async () => {
	const { toastService } = await import("../services/toast.svelte");
	const success = vi.spyOn(toastService, "success");
	const withQuestions = new GetHomeworkResponse({
		...first,
		answerKey: [{ kind: "short_answer", question: "3 + 4", answer: "7" }],
	});
	const service = {
		list: vi.fn(async () => [withQuestions]),
		download: vi.fn(async () => new Blob(["Question text"], { type: "text/plain" })),
		assign: vi.fn(async () => {}),
	};
	let assigned = false;
	const practice = {
		list: vi.fn(async () =>
			assigned
				? [
						{
							practice: {
								origin: "assigned",
								approved: true,
								source: { id: "source", version: 1 },
							},
						},
					]
				: [],
		),
	};
	render(Provider, { service, practice, view: "homework" } as never);
	await fireEvent.click(await screen.findByRole("button", { name: /^Fractions Math/ }));
	expect(await screen.findByText("Question text")).toBeVisible();
	expect(screen.queryByRole("region", { name: "Questions for your child" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Assign to child" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Actions for Fractions" }));
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Questions" }));
	expect(await screen.findByRole("region", { name: "Questions for your child" })).toBeVisible();
	expect(screen.getByText("3 + 4")).toBeVisible();
	expect(screen.getByRole("button", { name: "Edit questions" })).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Assign to child" }));
	await waitFor(() => expect(service.assign).toHaveBeenCalledWith("fractions"));
	expect(success).toHaveBeenLastCalledWith(expect.stringMatching(/^Assigned/));
	assigned = true;
	await fireEvent.click(screen.getByRole("button", { name: "Assign to child" }));
	await waitFor(() =>
		expect(success).toHaveBeenLastCalledWith(expect.stringMatching(/^Already assigned/)),
	);
	expect(service.assign).toHaveBeenCalledOnce();
});

it("never shows question text generated by the server as instructions", async () => {
	const generated = new GetHomeworkResponse({
		...first,
		textFromQuestions: true,
		answerKey: [{ kind: "short_answer", question: "3 + 4", answer: "7" }],
	});
	const service = {
		list: vi.fn(async () => [generated]),
		download: vi.fn(async () => new Blob(["1. 3 + 4"], { type: "text/plain" })),
	};
	render(Provider, { service, view: "homework" });
	await fireEvent.click(await screen.findByRole("button", { name: /^Fractions Math/ }));
	expect(await screen.findByText("No instructions.")).toBeVisible();
	expect(screen.queryByText("1. 3 + 4")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Actions for Fractions" }));
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
	expect(await screen.findByLabelText("Homework instructions")).toHaveValue("");
	expect(screen.getByLabelText("Question")).toHaveValue("3 + 4");
	expect(service.download).toHaveBeenCalledTimes(1);
});
