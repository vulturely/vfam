import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it } from "vitest";
import RoleHome from "./RoleHome.svelte";

afterEach(cleanup);

it("shows the child role dashboard", () => {
	render(RoleHome, { screen: "home:kid" });
	expect(screen.getByText("Kids screen")).toBeVisible();
	expect(screen.getByRole("heading", { name: "Ready for today's missions?" })).toBeVisible();
	expect(screen.getByText("Check your next chore")).toBeVisible();
	expect(screen.getByText("Ask for help")).toBeVisible();
});

it("shows the grandparent role dashboard", () => {
	render(RoleHome, { screen: "home:grandparent" });
	expect(screen.getByText("Grandparent screen")).toBeVisible();
	expect(
		screen.getByRole("heading", { name: "Everything important, easy to reach." }),
	).toBeVisible();
	expect(screen.getByText("Health notes")).toBeVisible();
});

it("uses parent copy as the fallback for other role screens", () => {
	render(RoleHome, { screen: "home:other" });
	expect(screen.getByText("Parent screen")).toBeVisible();
	expect(
		screen.getByRole("heading", { name: "Your household command center is ready." }),
	).toBeVisible();
	expect(screen.getByText("Invite household members")).toBeVisible();
});
