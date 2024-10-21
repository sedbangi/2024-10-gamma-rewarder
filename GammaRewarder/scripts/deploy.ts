import { ethers } from "hardhat";

async function main() {
    const GammaRewarder = await ethers.getContractFactory("GammaRewarder");
    const gammaRewarder = await GammaRewarder.deploy();

    const gammaRewarder_Addr = await gammaRewarder.getAddress();
  	console.log('Gamma Rewarder deployed to:', gammaRewarder_Addr);    
}


// This pattern can use async/await everywhere and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
