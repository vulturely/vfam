import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HomeworkSourceReview from "./HomeworkSourceReview.svelte";
import type { Homework } from "../homework/service";
import type { Runtime } from "../runtime/registry.svelte";
import { toastService } from "../services/toast.svelte";

vi.mock("./WorksheetParser.svelte", async () => ({
	default: (await import("./HomeworkSourceReviewTestParser.svelte")).default,
}));

const update = vi.fn();
const download = vi.fn();
const onsaved = vi.fn();

function item(sources = [{ source: { id: "source", version: 1 } }]) {
	return {
		homework: {
			id: "homework",
			profileId: "profile",
			title: "Fractions",
			subject: "Math",
		},
		answerKey: [{ id: "answer" }],
		parserYaml: "initial: true",
		sources,
	} as unknown as Homework;
}

function setup(value = item()) {
	const runtime = {
		services: { homework: { update, download } },
	} as unknown as Runtime;
	const view = render(HomeworkSourceReview, {
		props: {
			item: value,
			rawUrl: "blob:worksheet",
			rawType: "text/plain",
			rawText: "Question",
			onsaved,
		},
		context: new Map([["vulture:runtime", runtime]]),
	});
	return view;
}

beforeEach(() => {
	vi.clearAllMocks();
	update.mockImplementation(async (_id, _source, _title, _subject, _file, answerKey, yaml) => ({
		...item(),
		answerKey,
		parserYaml: yaml,
	}));
});
afterEach(cleanup);

it("applies and saves parser changes, then resets the clean baseline", async () => {
	setup();
	await fireEvent.input(screen.getByLabelText("Parser YAML"), { target: { value: "new: true" } });
	const save = screen.getByRole("button", { name: "Save worksheet parser" });
	expect(save).toBeDisabled();
	expect(screen.getByText("Apply the parser before saving.")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Apply parser" }));
	expect(save).toBeEnabled();
	await fireEvent.click(save);
	await waitFor(() => expect(onsaved).toHaveBeenCalledOnce());
	expect(update).toHaveBeenCalledWith(
		"homework",
		{ id: "source", version: 1 },
		"Fractions",
		"Math",
		undefined,
		[{ id: "answer" }],
		"new: true",
	);
	expect(screen.queryByRole("button", { name: "Save worksheet parser" })).toBeNull();
});

it("cancels unapplied parser edits and reports save failures", async () => {
	update.mockRejectedValueOnce(new Error("Parser denied"));
	setup();
	await fireEvent.input(screen.getByLabelText("Parser YAML"), { target: { value: "bad: true" } });
	await fireEvent.click(screen.getByRole("button", { name: "Apply parser" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save worksheet parser" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Parser denied",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Cancel parser changes" }));
	expect(screen.getByLabelText("Parser YAML")).toHaveValue("initial: true");
	toastService.clear();
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("requires worksheet source metadata and provides the original download", async () => {
	download.mockResolvedValue(new Blob(["worksheet"]));
	setup(item([]));
	await fireEvent.input(screen.getByLabelText("Parser YAML"), { target: { value: "new: true" } });
	await fireEvent.click(screen.getByRole("button", { name: "Apply parser" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save worksheet parser" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Reload the worksheet before saving.",
	);
	expect(update).not.toHaveBeenCalled();
});
