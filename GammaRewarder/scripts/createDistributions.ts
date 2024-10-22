import { ethers } from "hardhat";
import { getCurrentTimeStamp, getEpochAmount } from "../test/utils";
import { _createDistributions } from "./_createDistributions";

async function createDistributions() {
	// Mock Users and Incentivizors
  	const mockUsers = await ethers.getSigners()
	const incentivizors = [mockUsers[1], mockUsers[2], mockUsers[3]]
	// Mock Vault Contract Address
	const gammaVaultAddr = "0x02203f2351e7ac6ab5051205172d3f772db7d814" // polygon wmatic-weth vault
	// Mock current time stamp
	const currentTimeStamp = await getCurrentTimeStamp()

	const GammaRewarder = await ethers.getContractFactory("GammaRewarder");
	const gammaRewarder = await GammaRewarder.deploy();
	const gammaRewarder_Addr = await gammaRewarder.getAddress();
  	console.log('Gamma Rewarder deployed to:', gammaRewarder_Addr);
	// Initialized distributor address and fee based in 1e9
	await gammaRewarder.initialize(gammaRewarder_Addr, 30000000)
	await gammaRewarder.setDisputePeriod(1)
	  
  	const MockToken = await ethers.getContractFactory("MockERC20Token")
	const mockTokensAddress: string[] = []
	for(let i = 0 ; i < 3 ; i++) {
		const mockToken = await MockToken.deploy(1e8)
		const mockTokenAddr = await mockToken.getAddress()
		console.log(`Mock Token ${i} deployed to:, ${mockTokenAddr}`);
		// whitelist reward tokens
		await gammaRewarder.toggleTokenWhitelist(mockTokenAddr)
		for(let j = 0 ; j < 3 ; j++) {
			// mock token transfer to incentivizors
			await mockToken.transfer(incentivizors[j].address, 1e5)
			// approve reward tokens to gammareward contract
			await mockToken.connect(incentivizors[j]).approve(gammaRewarder_Addr, 1e5)
		}
		
		mockTokensAddress.push(mockTokenAddr)
	}
	// Create distributions
	await _createDistributions(
		gammaRewarder,
		incentivizors,
		gammaVaultAddr,
		mockTokensAddress,
		currentTimeStamp,
		[1000, 2000, 3000],
		[20, 100, 50]
	)
	
	console.log(`Current time stamp is ${currentTimeStamp}`)
	const distributions = await gammaRewarder.getAllDistributions()
	console.log("Created Distributions")
	distributions.map((item) => {
		console.log(`${item.rewardToken} - ${item.incentivizor} - ${item.amount} - ${item.numEpoch} - ${item.amount / item.numEpoch}`)
	})
}

// This pattern can use async/await everywhere and properly handle errors.
createDistributions().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
