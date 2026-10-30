import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import FamilyAiRequests from "./FamilyAiRequests.svelte";
import type { FamilyAiService } from "../family-ai/service";

afterEach(cleanup);
const request = {
	id: "help",
	profileId: "jamie",
	summary: "Homework help · Jamie · question 1",
	question: "I don't get adding",
	createdAt: "now",
};

it("shows the child's exact question and answers it after approval", async () => {
	const service = {
		helpRequests: vi.fn().mockResolvedValueOnce([request]).mockResolvedValue([]),
		approveHelp: vi.fn(async () => "Count two, then two more."),
		declineHelp: vi.fn(),
	};
	render(FamilyAiRequests, { service: service as unknown as FamilyAiService });
	expect(await screen.findByText("I don't get adding")).toBeTruthy();
	await fireEvent.click(screen.getByRole("button", { name: "Approve and answer" }));
	await waitFor(() => expect(service.approveHelp).toHaveBeenCalledWith("help"));
	expect(await screen.findByRole("status")).toHaveTextContent("Count two, then two more.");
	expect(screen.getByText("No help requests waiting.")).toBeTruthy();
});

it("declines requests and reports failures", async () => {
	const service = {
		helpRequests: vi.fn(async () => [request]),
		approveHelp: vi.fn(async () => {
			throw new Error("Set up your family AI provider on this device first.");
		}),
		declineHelp: vi.fn(async () => undefined),
	};
	render(FamilyAiRequests, { service: service as unknown as FamilyAiService });
	await fireEvent.click(await screen.findByRole("button", { name: "Approve and answer" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("Set up your family AI provider");
	await fireEvent.click(screen.getByRole("button", { name: "Decline" }));
	await waitFor(() => expect(service.declineHelp).toHaveBeenCalledWith("help"));
});
