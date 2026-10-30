import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ConfirmSourceResponse,
	GetSourceSegmentsResponse,
	SourceSegment,
	SourceVersion,
} from "../api/protocol";
import Provider from "./TestExtractionProvider.svelte";
import { toastService } from "../services/toast.svelte";

afterEach(cleanup);
const source = new SourceVersion({ id: "worksheet", version: 1 });
function region(text = "") {
	return new SourceSegment({
		id: "region-1",
		source,
		pageNumber: 1,
		ordinal: 0,
		text,
		needsReview: true,
		confidence: 0.4,
		region: [10, 20, 300, 80],
	});
}

describe("Parent extraction review", () => {
	it("requires correction of blank uncertain text and approves a new source version", async () => {
		const corrected = region("What is 2 + 2?");
		const nextSource = new SourceVersion({ id: source.id, version: 2 });
		const service = {
			load: vi.fn().mockResolvedValue(new GetSourceSegmentsResponse({ state: "pending" })),
			extract: vi.fn().mockResolvedValue(
				new GetSourceSegmentsResponse({
					state: "extracted",
					segments: [region()],
				}),
			),
			confirm: vi.fn().mockResolvedValue(
				new ConfirmSourceResponse({
					source: nextSource,
					segments: [corrected],
				}),
			),
		};
		const onconfirmed = vi.fn().mockResolvedValue(undefined);
		render(Provider, { service, source, onconfirmed });
		const extract = await screen.findByRole("button", {
			name: "Extract / retry text",
		});
		await waitFor(() => expect(extract).toBeEnabled());
		expect(screen.queryByRole("button", { name: "Approve corrected source text" })).toBeNull();
		await fireEvent.click(extract);
		const text = await screen.findByRole("textbox", {
			name: "Page 1 region 1 text",
		});
		expect(screen.getByText(/40% confidence.*Uncertain/)).toBeInTheDocument();
		expect(screen.getByText("Source area: 10, 20, 300, 80")).toBeInTheDocument();
		const approve = screen.getByRole("button", {
			name: "Approve corrected source text",
		});
		await waitFor(() => expect(extract).toBeEnabled());
		expect(approve).toBeDisabled();
		await fireEvent.input(text, { target: { value: "   " } });
		expect(approve).toBeDisabled();
		await fireEvent.input(text, { target: { value: corrected.text } });
		await waitFor(() => expect(approve).toBeEnabled());
		await fireEvent.click(approve);
		await waitFor(() => expect(onconfirmed).toHaveBeenCalledOnce());
		expect(service.confirm).toHaveBeenCalledWith(source, [
			expect.objectContaining({ text: corrected.text }),
		]);
		expect(text).toBeDisabled();
		expect(screen.getByRole("status")).toHaveTextContent("Source text approved");
		expect(screen.queryByRole("button", { name: "Approve corrected source text" })).toBeNull();
		await fireEvent.click(await screen.findByRole("button", { name: "Extract / retry text" }));
		await waitFor(() => expect(service.extract).toHaveBeenLastCalledWith(nextSource));
	});

	it("explains provider failure and clears the error after successful retry", async () => {
		const service = {
			load: vi.fn().mockResolvedValue(new GetSourceSegmentsResponse({ state: "provider_failed" })),
			extract: vi
				.fn()
				.mockRejectedValueOnce(new Error("Provider unavailable"))
				.mockResolvedValue(
					new GetSourceSegmentsResponse({
						state: "extracted",
						segments: [region("Read this")],
					}),
				),
			confirm: vi.fn(),
		};
		render(Provider, { service, source, onconfirmed: vi.fn() });
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"OCR could not finish",
		);
		await fireEvent.click(await screen.findByRole("button", { name: "Extract / retry text" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Provider unavailable",
		);
		await fireEvent.click(await screen.findByRole("button", { name: "Extract / retry text" }));
		await screen.findByRole("textbox");
		toastService.clear();
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	});

	it("keeps an already confirmed source read only without a new approval", async () => {
		const service = {
			load: vi.fn().mockResolvedValue(
				new GetSourceSegmentsResponse({
					state: "confirmed",
					segments: [region("Approved text")],
				}),
			),
			extract: vi.fn(),
			confirm: vi.fn(),
		};
		const onconfirmed = vi.fn();
		render(Provider, { service, source, onconfirmed });
		expect(await screen.findByRole("textbox")).toBeDisabled();
		expect(screen.getByRole("textbox")).toHaveValue("Approved text");
		expect(screen.queryByRole("button", { name: "Approve corrected source text" })).toBeNull();
		expect(service.confirm).not.toHaveBeenCalled();
		expect(onconfirmed).not.toHaveBeenCalled();
	});
});
