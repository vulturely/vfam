import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import ChildAiHelp from "./ChildAiHelp.svelte";
import type { ChildFamilyAiService, ChildHelp } from "../family-ai/child";

afterEach(cleanup);
const props = { practiceId: "practice", version: 1, position: 2 };

async function ask(text: string) {
	await fireEvent.click(screen.getByRole("button", { name: "Ask the AI tutor" }));
	expect(screen.getByText("The tutor gives hints and steps, not the answer.")).toBeTruthy();
	await fireEvent.input(screen.getByLabelText("What are you stuck on?"), {
		target: { value: text },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

it("shows an immediate reply when this device answers", async () => {
	const service = {
		askForHelp: vi.fn(async () => ({ jobId: "job", status: "answered", reply: "Count up." })),
		follow: vi.fn(),
	} as unknown as ChildFamilyAiService;
	render(ChildAiHelp, { service, ...props });
	await ask("I am stuck");
	expect(await screen.findByText("Count up.")).toBeTruthy();
	expect(service.askForHelp).toHaveBeenCalledWith({ ...props, question: "I am stuck" });
	expect(service.follow).not.toHaveBeenCalled();
});

it("waits for a grown-up, then shows the reply or a decline", async () => {
	let finish!: () => void;
	const service = {
		askForHelp: vi.fn(async () => ({ jobId: "job", status: "waiting_for_parent" })),
		follow: vi.fn(async function* (): AsyncIterable<ChildHelp> {
			yield { jobId: "job", status: "waiting_for_parent" };
			await new Promise<void>((resolve) => (finish = resolve));
			yield { jobId: "job", status: "answered", reply: "Two and two more." };
		}),
	} as unknown as ChildFamilyAiService;
	render(ChildAiHelp, { service, ...props });
	await ask("Help");
	expect(await screen.findByText("Waiting for a grown-up to say yes…")).toBeTruthy();
	expect(screen.queryByLabelText("What are you stuck on?")).toBeNull();
	finish();
	expect(await screen.findByText("Two and two more.")).toBeTruthy();
	vi.mocked(service.askForHelp).mockResolvedValueOnce({ jobId: "job2", status: "declined" });
	await fireEvent.input(screen.getByLabelText("What are you stuck on?"), {
		target: { value: "Again" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Ask" }));
	expect(await screen.findByText(/A grown-up said not this time/)).toBeTruthy();
});

it("reports failures without losing the question box", async () => {
	const service = {
		askForHelp: vi.fn(async () => {
			throw new Error("Learning time is over.");
		}),
		follow: vi.fn(),
	} as unknown as ChildFamilyAiService;
	render(ChildAiHelp, { service, ...props });
	await ask("Help");
	await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Learning time"));
	expect(screen.getByLabelText("What are you stuck on?")).toBeTruthy();
});
