import type { IpcArgs, IpcClient } from "../ipc";

export interface PluginCommandApi {
	call<TResponse>(command: string, args?: IpcArgs): Promise<TResponse>;
}

export function createPluginCommandApi(pluginId: string, ipc: IpcClient): PluginCommandApi {
	return {
		call<TResponse>(command: string, args?: IpcArgs): Promise<TResponse> {
			return ipc.invoke<TResponse>(`plugin:${pluginId}|${command}`, args);
		},
	};
}
