import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import ChildProfile from "./ChildProfile.svelte";
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function setup(picture: string | null = null) {
	vi.stubGlobal("createImageBitmap", undefined);
	const childHome = { setAvatar: vi.fn(async () => {}) };
	const onpicture = vi.fn();
	render(ChildProfile, {
		props: { name: "Ana", picture, onpicture },
		context: new Map([["vulture:runtime", { services: { childHome } } as unknown as Runtime]]),
	});
	return { childHome, onpicture };
}

it("uploads a picture when the child taps their picture", async () => {
	const { childHome, onpicture } = setup();
	expect(screen.getByRole("heading", { name: "Ana" })).toBeVisible();
	expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
	const input = screen.getByLabelText("Choose a profile picture");
	const click = vi.spyOn(input, "click");
	await fireEvent.click(screen.getByRole("button", { name: "Add your picture" }));
	expect(click).toHaveBeenCalled();
	await fireEvent.change(input, {
		target: { files: [new File([new Uint8Array(3)], "me.png", { type: "image/png" })] },
	});
	await waitFor(() =>
		expect(childHome.setAvatar).toHaveBeenCalledWith({
			image: new Uint8Array(3),
			contentType: "image/png",
		}),
	);
	expect(onpicture).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
	expect(await screen.findByText("Picture updated.")).toBeVisible();
});

it("replaces an existing picture and reports invalid files", async () => {
	const { childHome } = setup("blob:old");
	const button = screen.getByRole("button", { name: "Change your picture" });
	expect(button.querySelector("img")).toHaveAttribute("src", "blob:old");
	const input = screen.getByLabelText("Choose a profile picture");
	await fireEvent.change(input, {
		target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] },
	});
	expect(await screen.findByText("Choose a PNG, JPEG or WebP picture.")).toBeVisible();
	await fireEvent.change(input, { target: { files: [] } });
	expect(childHome.setAvatar).not.toHaveBeenCalled();
});
