import { gatewayClient } from "../buddy-gateway";
import { parentHeaders, relayClient, relayOrigin, type ParentAuth } from "./client";
import { remoteCrypto, type RemotePair } from "./crypto";
interface Setup {
	gateway: string;
	token: string;
	family: string;
	device: string;
	owner: string;
	server: string;
	auth: ParentAuth;
}
export async function enrollRemote(setup: Setup): Promise<RemotePair> {
	const origin = relayOrigin(setup.server);
	const client = relayClient(origin);
	const headers = await parentHeaders(setup.auth);
	const created = (await client.createChannel({}, { headers, timeoutMs: 10_000 })) as {
		channel: string;
		deviceCredential: string;
	};
	const crypto = remoteCrypto(origin);
	const local = gatewayClient(setup.gateway);
	const localHeaders = { authorization: `Bearer ${setup.token}` };
	try {
		const account = `fambuddy-parent:${setup.owner}:${created.channel}`;
		const own = await crypto.identity(account);
		const enrolled = (await local.enableRemote(
			{
				device: setup.device,
				channel: created.channel,
				origin,
				deviceCredential: created.deviceCredential,
				peer: own,
			},
			{ headers: localHeaders, timeoutMs: 10_000 },
		)) as { devicePeer?: RemotePair["peer"]; welcome: string };
		if (!enrolled.devicePeer) throw new Error("Device did not provide a remote approval key.");
		const pair: RemotePair = {
			origin,
			account,
			own,
			peer: enrolled.devicePeer,
			binding: {
				channel: created.channel,
				family: setup.family,
				device: setup.device,
			},
		};
		await crypto.join(pair, enrolled.welcome);
		return pair;
	} catch (error) {
		await Promise.allSettled([
			local.disableRemote(
				{ channel: created.channel },
				{ headers: localHeaders, timeoutMs: 10_000 },
			),
			client.revokeChannel({ channel: created.channel }, { headers, timeoutMs: 5000 }),
		]);
		throw error;
	} finally {
		crypto.close();
	}
}
export async function revokeRemote(pair: RemotePair, auth: ParentAuth) {
	await relayClient(pair.origin).revokeChannel(
		{ channel: pair.binding.channel },
		{ headers: await parentHeaders(auth), timeoutMs: 5000 },
	);
}
