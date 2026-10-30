import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "./fixtures";

test("desktop callback relays credentials to the native loopback listener", async ({ page }) => {
	const callbacks: string[] = [];
	const server = createServer((request, response) => {
		callbacks.push(request.url ?? "");
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("Return to VFAM test");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const { port } = server.address() as AddressInfo;
		const state = `vulture-desktop:${port}:123e4567-e89b-12d3-a456-426614174000:csrf-state`;
		const query = new URLSearchParams({ code: "private-code", state });
		await page.goto(`/login/callback?${query}`);
		await expect(page.getByText("Return to VFAM test")).toBeVisible();
		expect(callbacks).toHaveLength(1);
		const callback = new URL(callbacks[0], "http://127.0.0.1");
		expect(callback.pathname).toBe("/login/callback");
		expect(callback.searchParams.get("code")).toBe("private-code");
		expect(callback.searchParams.get("state")).toBe(state);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
