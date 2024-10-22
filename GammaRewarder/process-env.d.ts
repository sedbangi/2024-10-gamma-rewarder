export {};

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			PRIVATE_KEY_MAIN_NET: HttpNetworkAccountsUserConfig | undefined;
			PRIVATE_KEY_FOR_SEPOLIA: HttpNetworkAccountsUserConfig | undefined;
			AVASCAN_API_KEY: string;
		}
	}
}