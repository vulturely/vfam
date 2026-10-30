import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it } from "vitest";
import ContactForm from "./ContactForm.svelte";

afterEach(cleanup);

it("validates each required contact field", async () => {
	render(ContactForm);
	const send = screen.getByRole("button", { name: "Send message" });
	await fireEvent.click(send);
	expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Please enter your name.");
	await fireEvent.input(screen.getByLabelText("Name"), { target: { value: " Parent " } });
	await fireEvent.click(send);
	expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent(
		"Please enter a valid email address.",
	);
	await fireEvent.input(screen.getByLabelText("Email"), {
		target: { value: "parent@example.com" },
	});
	await fireEvent.input(screen.getByLabelText("Message"), { target: { value: "short" } });
	await fireEvent.click(send);
	expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent(
		"Please write a message of at least 10 characters.",
	);
});

it("trims the message and opens the email handoff", async () => {
	render(ContactForm);
	await fireEvent.input(screen.getByLabelText("Name"), { target: { value: " Parent " } });
	await fireEvent.input(screen.getByLabelText("Email"), {
		target: { value: " parent@example.com " },
	});
	await fireEvent.input(screen.getByLabelText("Message"), {
		target: { value: " Please help with our family account. " },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	expect(screen.getByRole("status")).toHaveTextContent(
		"Thanks! Your message has been opened in your email app",
	);
	expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
});
