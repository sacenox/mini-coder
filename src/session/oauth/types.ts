export interface OAuthCredentials {
	access: string;
	refresh: string;
	expires: number; // epoch ms
}

export interface OAuthProviderConfig {
	readonly id: string;
	readonly name: string;

	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
	refreshToken(refreshToken: string): Promise<OAuthCredentials>;
}

export interface OAuthLoginCallbacks {
	onOpenUrl: (url: string, instructions: string) => void;
	onProgress: (message: string) => void;
}
