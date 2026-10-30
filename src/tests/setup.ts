import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach } from "vitest";
import ToastStack from "../../packages/core/src/components/feedback/ToastStack.svelte";
import { toastService } from "../../packages/core/src/services/toast.svelte";

beforeEach(() => {
	render(ToastStack);
});

afterEach(() => {
	cleanup();
	toastService.clear();
});

if (typeof window !== "undefined" && !window.URL.createObjectURL) {
	window.URL.createObjectURL = () => "blob:mock";
}

if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") {
	Element.prototype.animate = function () {
		let onfinish: (() => void) | null = null;
		const animation = {
			playState: "running" as const,
			effect: null,
			cancel: () => {},
			set onfinish(callback: (() => void) | null) {
				onfinish = callback;
				if (onfinish) queueMicrotask(() => onfinish?.());
			},
			get onfinish() {
				return onfinish;
			},
		};
		return animation as unknown as Animation;
	} as typeof Element.prototype.animate;
}
