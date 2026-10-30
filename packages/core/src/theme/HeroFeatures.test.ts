import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import Star from "lucide-svelte/icons/star";
import { afterEach, expect, it, vi } from "vitest";
import HeroFeatures from "./HeroFeatures.svelte";

const features = [
	{ icon: Star, title: "First feature", blurb: "First description" },
	{ icon: Star, title: "Second feature", blurb: "Second description" },
];

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it("rotates features and restarts the timer after manual selection", async () => {
	vi.useFakeTimers();
	const view = render(HeroFeatures, { features });
	expect(screen.getByText("First feature")).toBeVisible();
	await vi.advanceTimersByTimeAsync(4000);
	expect(screen.getByText("Second feature")).toBeVisible();
	await fireEvent.click(screen.getByRole("tab", { name: "Feature 1: First feature" }));
	expect(screen.getByText("First feature")).toBeVisible();
	expect(screen.getByRole("tab", { name: "Feature 1: First feature" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	view.unmount();
	await vi.advanceTimersByTimeAsync(8000);
});

it("supports single and empty feature sets", () => {
	const single = render(HeroFeatures, { features: [features[0]] });
	expect(screen.getByText("First feature")).toBeVisible();
	expect(screen.queryByRole("tablist")).toBeNull();
	expect(single.container.querySelector(".v-hero-features")).toHaveAttribute(
		"aria-label",
		"Highlight",
	);
	single.unmount();
	const empty = render(HeroFeatures, { features: [] });
	expect(empty.container.querySelector(".v-feature-card")).toBeNull();
	expect(empty.container.querySelector(".v-hero-features")).toHaveAttribute(
		"aria-label",
		"Highlight",
	);
});
