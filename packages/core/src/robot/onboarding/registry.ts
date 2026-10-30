import { createNativeClient } from "../../repositories/nativeClient";
import { parentHeaders, relayOrigin, type ParentAuth } from "../remote/client";
import type { FamilyLicense } from "../../api/protocol";
import { licenseFrom, type FamBuddyLicense } from "../license";
export type { RegisteredFamBuddy } from "../../api/protocol";

export interface ParentConnection {
	server: string;
	auth: ParentAuth;
	signal?: AbortSignal;
}

export function registryClient(server: string) {
	return createNativeClient("fambuddy_registry", relayOrigin(server));
}

async function options(connection: ParentConnection) {
	const headers = await parentHeaders(connection.auth);
	connection.signal?.throwIfAborted();
	return { headers, signal: connection.signal, timeoutMs: 10_000 };
}

export async function list(connection: ParentConnection) {
	const result = await registryClient(connection.server).listFamBuddies(
		{},
		await options(connection),
	);
	return (result as { devices: import("../../api/protocol").RegisteredFamBuddy[] }).devices;
}

export async function register(connection: ParentConnection, name: string) {
	const result = await registryClient(connection.server).registerFamBuddy(
		{ name },
		await options(connection),
	);
	const device = (result as { device?: import("../../api/protocol").RegisteredFamBuddy }).device;
	if (!device) throw new Error("FamBuddy registration was not returned.");
	return device;
}

export async function revoke(connection: ParentConnection, registration: string) {
	await registryClient(connection.server).revokeFamBuddy(
		{ registration },
		await options(connection),
	);
}

/** A guardian saw a waiting approval; the server stops its email reminder. */
export async function acknowledgeApproval(
	connection: ParentConnection,
	registration: string,
	turn: string,
) {
	await registryClient(connection.server).acknowledgeApproval(
		{ registration, turn },
		await options(connection),
	);
}

export async function getMediaRelay(connection: ParentConnection, registration: string) {
	return (await registryClient(connection.server).getMediaRelay(
		{ registration },
		await options(connection),
	)) as { urls: string[]; username: string; credential: string };
}

/**
 * Installs the family's FamBuddy license on the family server; an empty token removes
 * it. The server keeps the token and never returns it.
 */
export async function setFamilyLicense(
	connection: ParentConnection,
	token: string,
): Promise<FamBuddyLicense> {
	const result = await registryClient(connection.server).setFamilyLicense(
		{ token },
		await options(connection),
	);
	return licenseFrom((result as { license?: FamilyLicense }).license);
}

/** The family's FamBuddy license as the family server evaluates it now. */
export async function getFamilyLicense(connection: ParentConnection): Promise<FamBuddyLicense> {
	const result = await registryClient(connection.server).getFamilyLicense(
		{},
		await options(connection),
	);
	return licenseFrom((result as { license?: FamilyLicense }).license);
}
