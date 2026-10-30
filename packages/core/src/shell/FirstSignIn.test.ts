import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import FirstSignIn from "./FirstSignIn.svelte";
beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: true })));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function setup(resume = false) {
	const update = vi.fn().mockImplementation(async (input) => ({
		role: input.role,
		dobConfirmed: input.role === "parent",
		completed: !!input.complete,
	}));
	const saveAi = vi.fn().mockResolvedValue({});
	const navigate = vi.fn();
	const createFamily = vi.fn().mockResolvedValue({ id: "family" });
	const runtime = {
		state: {
			identity: { id: "account", name: "Alex" },
			accountSetup: {
				role: resume ? "parent" : null,
				dobConfirmed: resume,
				completed: false,
			},
		},
		services: {
			accountSetup: { update },
			family: { getMyFamily: vi.fn().mockResolvedValue(null), createFamily },
			familyAi: { save: saveAi },
		},
		router: { navigate },
		logout: vi.fn(),
	} as unknown as Runtime;
	render(FirstSignIn, { context: new Map([["vulture:runtime", runtime]]) });
	return { runtime, update, saveAi, navigate, createFamily };
}
async function waitReady(name: string) {
	const button = await screen.findByRole("button", { name });
	await waitFor(() => expect(button).toBeEnabled());
	return button;
}
it("shows only the role question initially and directs kids to their parent", async () => {
	const { update } = setup();
	expect(screen.queryByLabelText("Date of birth")).toBeNull();
	expect(screen.queryByLabelText("Provider")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "I'm a kid" }));
	await screen.findByRole("heading", { name: "Ask your parent to add you." });
	expect(update).toHaveBeenCalledWith({ role: "kid" });
	expect(screen.getByText("They can add you as a family member from their account.")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
});
it("confirms DOB before offering optional AI and finishes without enabling a paid provider", async () => {
	const { update, saveAi, navigate, createFamily } = setup();
	await fireEvent.click(screen.getByRole("button", { name: "I'm a parent" }));
	await screen.findByLabelText("Date of birth");
	expect(screen.queryByLabelText("API key")).toBeNull();
	await fireEvent.input(screen.getByLabelText("Date of birth"), {
		target: { value: "1990-01-01" },
	});
	await waitReady("Continue");
	await fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
	await screen.findByRole("heading", { name: "Bring your own AI provider?" });
	expect(update).toHaveBeenCalledWith({
		role: "parent",
		dateOfBirth: "1990-01-01",
	});
	await fireEvent.click(await waitReady("Not now"));
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("profile:choose"));
	expect(createFamily).toHaveBeenCalledWith("Alex's family");
	expect(saveAi).not.toHaveBeenCalled();
	expect(update).toHaveBeenLastCalledWith({ role: "parent", complete: true });
});
it("uses a separate provider and credential stage, saves before finishing and clears a rejected key", async () => {
	const { saveAi, update, navigate } = setup(true);
	saveAi.mockRejectedValueOnce(new Error("Provider unavailable"));
	await fireEvent.click(screen.getByRole("button", { name: "Yes, connect my provider" }));
	await screen.findByLabelText("Provider");
	expect(screen.queryByLabelText("API key")).toBeNull();
	await fireEvent.input(screen.getByLabelText("Model"), {
		target: { value: "model-id" },
	});
	await waitReady("Next");
	await fireEvent.submit(screen.getByRole("button", { name: "Next" }).closest("form")!);
	await screen.findByLabelText("API key");
	await fireEvent.input(screen.getByLabelText("API key"), {
		target: { value: "secret" },
	});
	await waitReady("Connect & continue");
	await fireEvent.submit(
		screen.getByRole("button", { name: "Connect & continue" }).closest("form")!,
	);
	expect(await screen.findByRole("alert")).toHaveTextContent("Provider unavailable");
	expect(screen.getByLabelText("API key")).toHaveValue("");
	expect(navigate).not.toHaveBeenCalled();
	expect(update).not.toHaveBeenCalled();
	await fireEvent.input(screen.getByLabelText("API key"), {
		target: { value: "replacement" },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Connect & continue" }).closest("form")!,
	);
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("profile:choose"));
	// Saved to the device key store; the cost field no longer exists for family AI.
	expect(saveAi).toHaveBeenLastCalledWith({
		provider: "openai",
		model: "model-id",
		apiKey: "replacement",
		endpoint: "",
	});
	expect(screen.queryByLabelText(/Cost limit/)).toBeNull();
});
it("does not advance after a DOB validation failure", async () => {
	const { update } = setup();
	update.mockRejectedValue(new Error("Parents must be 18 or older"));
	await fireEvent.click(screen.getByRole("button", { name: "I'm a parent" }));
	await waitReady("Continue");
	await fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
	expect(await screen.findByRole("alert")).toHaveTextContent("18 or older");
	expect(screen.getByLabelText("Date of birth")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
});

it("reuses a saved family when completion fails and allows a safe retry", async () => {
	const { runtime, update, navigate, createFamily, saveAi } = setup(true);
	vi.mocked(runtime.services.family.getMyFamily).mockResolvedValue({
		id: "existing",
	} as never);
	update.mockRejectedValueOnce(new Error("Connection lost"));
	await fireEvent.click(screen.getByRole("button", { name: "Not now" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
	expect(navigate).not.toHaveBeenCalled();
	expect(runtime.state.accountSetup?.completed).toBe(false);
	await fireEvent.click(screen.getByRole("button", { name: "Not now" }));
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("profile:choose"));
	expect(createFamily).not.toHaveBeenCalled();
	expect(saveAi).not.toHaveBeenCalled();
	expect(update).toHaveBeenCalledTimes(2);
});
it("does not complete or navigate if family creation fails", async () => {
	const { createFamily, update, navigate } = setup(true);
	createFamily.mockRejectedValueOnce(new Error("Family unavailable"));
	await fireEvent.click(screen.getByRole("button", { name: "Not now" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("Family unavailable");
	expect(update).not.toHaveBeenCalled();
	expect(navigate).not.toHaveBeenCalled();
});
it("clears an entered API key when returning to provider selection", async () => {
	setup(true);
	await fireEvent.click(screen.getByRole("button", { name: "Yes, connect my provider" }));
	await waitReady("Next");
	await fireEvent.submit(screen.getByRole("button", { name: "Next" }).closest("form")!);
	await waitReady("Connect & continue");
	await fireEvent.input(screen.getByLabelText("API key"), {
		target: { value: "discard-me" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Back" }));
	await waitReady("Next");
	await fireEvent.submit(screen.getByRole("button", { name: "Next" }).closest("form")!);
	await waitReady("Connect & continue");
	expect(screen.getByLabelText("API key")).toHaveValue("");
});
it("offers a sign-out icon button at the bottom of the setup card", async () => {
	const { runtime } = setup();
	await screen.findByRole("heading", { name: "Who is this account for?" });
	const signOut = await waitReady("Sign out");
	expect(signOut.closest(".card-footer")).not.toBeNull();
	await fireEvent.click(signOut);
	expect(runtime.logout).toHaveBeenCalledOnce();
	await fireEvent.click(screen.getByRole("button", { name: "I'm a kid" }));
	await screen.findByRole("heading", { name: "Ask your parent to add you." });
	await waitFor(() => expect(screen.getAllByRole("button", { name: "Sign out" })).toHaveLength(1));
	expect(document.querySelector(".card-footer")).toBeNull();
});
