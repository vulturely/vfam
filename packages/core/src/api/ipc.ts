export type IpcArgs = Record<string, unknown>;

export interface IpcClient {
	invoke<TResponse>(command: string, args?: IpcArgs): Promise<TResponse>;
}

/**
 * API-layer-only Tauri IPC adapter. UI and service modules must not import
 * `@tauri-apps/api` directly; framework-specific IPC stays behind this client.
 */
export function createTauriIpcClient(): IpcClient {
	return {
		async invoke<TResponse>(command: string, args?: IpcArgs): Promise<TResponse> {
			const { invoke } = await import("@tauri-apps/api/core");
			return invoke(command, args) as Promise<TResponse>;
		},
	};
}
