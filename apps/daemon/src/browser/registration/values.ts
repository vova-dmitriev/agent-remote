export const NativeHostPlatform = { MacOS: 'darwin' } as const;
export type NativeHostPlatform = (typeof NativeHostPlatform)[keyof typeof NativeHostPlatform];
export const NativeHostInterface = { Stdio: 'stdio' } as const;
export type NativeHostInterface = (typeof NativeHostInterface)[keyof typeof NativeHostInterface];
export const NATIVE_HOST_DESCRIPTION = 'Agent Remote companion';
