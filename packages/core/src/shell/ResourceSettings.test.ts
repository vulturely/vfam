import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { afterEach, describe, it, expect, vi } from "vitest";
import ResourceSettings from "./ResourceSettings.svelte";
import type { ResourceService, ResourceSettings as Settings } from "../resources/service";
import type { FamilyAiService } from "../family-ai/service";
afterEach(cleanup);
let familyAi: {
	status: ReturnType<typeof vi.fn>;
	save: ReturnType<typeof vi.fn>;
	clear: ReturnType<typeof vi.fn>;
};
function fixture(paid = false, ownedStorage = false) {
	const value: Settings = {
		platform_paid: paid,
		storage: ownedStorage
			? {
					endpoint: "https://storage.example.com",
					bucket: "family",
					region: "auto",
					access_key_id: "",
					secret_access_key: "",
				}
			: null,
		storage_secret_set: false,
	};
	const service: ResourceService = {
		get: vi.fn().mockResolvedValue(value),
		saveStorage: vi.fn().mockResolvedValue(value),
	};
	familyAi = {
		status: vi.fn().mockResolvedValue({ configured: false }),
		save: vi.fn(async (config) => ({
			configured: true,
			provider: config.provider,
			model: config.model,
			endpoint: config.provider === "openai_compatible" ? config.endpoint : null,
		})),
		clear: vi.fn().mockResolvedValue({ configured: false }),
	};
	const { container } = render(ResourceSettings, {
		service,
		familyAi: familyAi as unknown as FamilyAiService,
	});
	container.querySelectorAll("details").forEach((detail) => detail.setAttribute("open", ""));
	return service;
}
describe("Family resource settings", () => {
	it("shows paid restrictions and supports all five family AI providers", async () => {
		fixture();
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		await screen.findByText("Platform services: Not available for this family");
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.queryByRole("button", { name: "Save AI provider" })).toBeNull();
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "own" },
		});
		for (const name of [
			"OpenAI",
			"Anthropic Claude",
			"OpenAI-compatible",
			"xAI Grok",
			"Google Gemini",
		]) {
			expect(screen.getByRole("option", { name, exact: true })).toBeInTheDocument();
		}
		expect(screen.getByRole("button", { name: "Save AI provider" })).not.toBeDisabled();
	});
	it("saves family provider config on this device, never to the server, then clears the API key", async () => {
		fixture();
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		await screen.findByLabelText("AI service");
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "own" },
		});
		await fireEvent.change(screen.getByLabelText("Provider"), {
			target: { value: "claude" },
		});
		await fireEvent.input(screen.getByLabelText("Model ID"), {
			target: { value: "claude-model" },
		});
		await fireEvent.input(screen.getByLabelText("API key"), {
			target: { value: "private-test-key" },
		});
		expect(screen.queryByLabelText(/cost/i)).toBeNull();
		await fireEvent.submit(
			(
				screen.getByRole("button", {
					name: "Save AI provider",
				}) as HTMLButtonElement
			).form!,
		);
		await waitFor(() =>
			expect(familyAi.save).toHaveBeenCalledWith({
				provider: "claude",
				model: "claude-model",
				endpoint: "",
				apiKey: "private-test-key",
			}),
		);
		await screen.findByText("API key saved. Re-enter it to replace the configuration.");
		expect(screen.getByLabelText("API key")).toHaveValue("");
	});
	it("lets a paid family select platform storage without submitting credentials", async () => {
		const service = fixture(true, true);
		await fireEvent.click(screen.getByRole("button", { name: "Configure Storage" }));
		await screen.findByText("Platform services: Available");
		await fireEvent.change(screen.getByLabelText("Storage service"), {
			target: { value: "platform" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await fireEvent.submit(
			(
				screen.getByRole("button", {
					name: "Save storage",
				}) as HTMLButtonElement
			).form!,
		);
		await waitFor(() => expect(service.saveStorage).toHaveBeenCalledWith(null));
	});
	it("closes on Escape, restores focus and discards unsaved credentials", async () => {
		fixture(true);
		const trigger = screen.getByRole("button", { name: "Configure AI" });
		trigger.focus();
		await fireEvent.click(trigger);
		await screen.findByLabelText("AI service");
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "own" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await fireEvent.input(screen.getByLabelText("API key"), {
			target: { value: "unsaved-secret" },
		});
		await fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(trigger).toHaveFocus();
		await fireEvent.click(trigger);
		expect(screen.getByLabelText("AI service")).toHaveValue("platform");
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "own" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByLabelText("API key")).toHaveValue("");
	});
	it("restores the saved configuration after closing an unsaved edit", async () => {
		fixture(true);
		familyAi.status.mockResolvedValue({
			configured: true,
			provider: "openai",
			model: "saved-model",
			endpoint: null,
		});
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		await screen.findByLabelText("AI service");
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await fireEvent.input(screen.getByLabelText("Model ID"), {
			target: { value: "unsaved-model" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByLabelText("Model ID")).toHaveValue("saved-model");
	});
	it("discards drafts when switching directly between resource editors", async () => {
		fixture(true);
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		await screen.findByLabelText("AI service");
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "own" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await fireEvent.input(screen.getByLabelText("Model ID"), {
			target: { value: "unsaved-model" },
		});
		await fireEvent.input(screen.getByLabelText("API key"), {
			target: { value: "unsaved-secret" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Configure Storage" }));
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		expect(screen.getByRole("dialog", { name: "AI settings" })).toHaveFocus();
		expect(screen.getByLabelText("AI service")).toHaveValue("platform");
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "own" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByLabelText("API key")).toHaveValue("");
		expect(screen.getByLabelText("Model ID")).toHaveValue("");
		expect(screen.getByPlaceholderText("Enter your provider API key")).toBeInTheDocument();
	});
	it("only offers Save for changed configuration and hides it again when reverted", async () => {
		fixture(true, true);
		await fireEvent.click(screen.getByRole("button", { name: "Configure Storage" }));
		await screen.findByLabelText("Storage service");
		expect(screen.queryByRole("button", { name: "Save storage" })).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.queryByRole("button", { name: "Save storage" })).toBeNull();
		await fireEvent.input(screen.getByLabelText("Bucket"), {
			target: { value: "new-family" },
		});
		expect(screen.getByRole("button", { name: "Save storage" })).toBeEnabled();
		await fireEvent.input(screen.getByLabelText("Bucket"), {
			target: { value: "family" },
		});
		expect(screen.queryByRole("button", { name: "Save storage" })).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "Back" }));
		expect(screen.queryByRole("button", { name: "Save storage" })).toBeNull();
	});
	it("switches back to platform AI by clearing this device's family AI settings", async () => {
		fixture(true);
		familyAi.status.mockResolvedValue({
			configured: true,
			provider: "claude",
			model: "claude-model",
			endpoint: null,
		});
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		await screen.findByLabelText("AI service");
		expect(screen.getByLabelText("AI service")).toHaveValue("own");
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "platform" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await fireEvent.submit(
			(screen.getByRole("button", { name: "Save AI provider" }) as HTMLButtonElement).form!,
		);
		await waitFor(() => expect(familyAi.clear).toHaveBeenCalledOnce());
		expect(familyAi.save).not.toHaveBeenCalled();
	});
	it("lets a local model on this device run without an API key", async () => {
		fixture();
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		await screen.findByLabelText("AI service");
		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await fireEvent.change(screen.getByLabelText("AI service"), {
			target: { value: "own" },
		});
		expect(screen.getByLabelText("API key")).toBeRequired();
		await fireEvent.change(screen.getByLabelText("Provider"), {
			target: { value: "openai_compatible" },
		});
		expect(screen.getByLabelText("API key")).not.toBeRequired();
		await fireEvent.input(screen.getByLabelText("Model ID"), { target: { value: "llama3" } });
		await fireEvent.input(screen.getByLabelText(/Provider URL/), {
			target: { value: "http://localhost:11434/v1/chat/completions" },
		});
		await fireEvent.submit(
			(screen.getByRole("button", { name: "Save AI provider" }) as HTMLButtonElement).form!,
		);
		await waitFor(() =>
			expect(familyAi.save).toHaveBeenCalledWith({
				provider: "openai_compatible",
				model: "llama3",
				endpoint: "http://localhost:11434/v1/chat/completions",
				apiKey: "",
			}),
		);
	});
	it("keeps storage usable when this device's AI settings are unavailable", async () => {
		fixture();
		familyAi.status.mockRejectedValue(new Error("Family AI key storage is locked or unavailable."));
		await fireEvent.click(screen.getByRole("button", { name: "Configure Storage" }));
		expect(await screen.findByLabelText("Storage service")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "Configure AI" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("key storage is locked");
	});
	it("does not display forms when manager authorization fails", async () => {
		const service = fixture();
		vi.mocked(service.get).mockRejectedValue(new Error("Permission denied"));
		await fireEvent.click(screen.getByRole("button", { name: "Configure Storage" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
		expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
	});
});
