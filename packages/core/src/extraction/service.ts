import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
import {
	type SourceVersion,
	SourceSegment,
	GetSourceSegmentsResponse,
	ConfirmSourceResponse,
} from "../api/protocol";
export interface ExtractionService {
	load(source: SourceVersion): Promise<GetSourceSegmentsResponse>;
	extract(source: SourceVersion): Promise<GetSourceSegmentsResponse>;
	confirm(source: SourceVersion, corrections: SourceSegment[]): Promise<ConfirmSourceResponse>;
}
export function createExtractionService(serverUrl: string, auth: OidcAuth): ExtractionService {
	const client = createNativeClient("control", serverUrl);
	async function options(): Promise<{ headers: Record<string, string> }> {
		const token = await auth.getAccessToken();
		return { headers: token ? { authorization: `Bearer ${token}` } : {} };
	}
	return {
		load: async (source) =>
			new GetSourceSegmentsResponse(await client.getSourceSegments({ source }, await options())),
		extract: async (source) =>
			new GetSourceSegmentsResponse(await client.extractHomework({ source }, await options())),
		confirm: async (source, corrections) => {
			return new ConfirmSourceResponse(
				await client.confirmSource({ expectedSource: source, corrections }, await options()),
			);
		},
	};
}
