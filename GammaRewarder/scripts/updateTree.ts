import { ethers } from "hardhat";
import { _increaseTime } from "./_increaseTime";

async function updateTree() {
    const root = "0x4727a556e9a310d0e53dc4694b1a66e64a82938264541fbf32093ecf91e3d4ed"
    const gammaRewarderAddr = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
    const gammareward = await ethers.getContractAt("GammaRewarder", gammaRewarderAddr)
    const mockUsers = await ethers.getSigners()
    // Update tree by owner
    await gammareward.connect(mockUsers[0]).updateTree(root)

    // check if root
    let latestRoot = await gammareward.merkleRoot()
    console.log(`Merkle Root: ${latestRoot}`)
    let activeRoot = await gammareward.getMerkleRoot()
    console.log(`Active Merkle Root: ${activeRoot}`)

    // pass time 2 hours
    await _increaseTime(2)

    latestRoot = await gammareward.merkleRoot()
    console.log(`Merkle Root: ${latestRoot}`)
    activeRoot = await gammareward.getMerkleRoot()
    console.log(`Active Merkle Root: ${activeRoot}`)
}


// This pattern can use async/await everywhere and properly handle errors.
updateTree().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
