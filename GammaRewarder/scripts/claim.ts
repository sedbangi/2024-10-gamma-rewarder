import { ethers } from "hardhat";
import { MerkleTree } from 'merkletreejs'
import { ITreeData, IProof } from "./mongodb/interface";
import { connectDB, findTrees, findLastTree, closeDb } from "./mongodb/services/database.service";
import { _increaseTime } from "./_increaseTime";


async function claim() {
    const claimLpAddresses = [
        "0xbc6fd2917aea56ceaeac3d818a5807d2e11fce30",
        "0x22161250b01f19cd774e22d1d39ba436f9a4d3e2",
        "0xf3a8585cf236889d863e927eccff23e1aaddd3c8"
    ]

    const claimRewardTokens = [
        "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
        "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
        "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82"
    ]
    const gammaRewarderAddr = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
    const gammareward = await ethers.getContractAt("GammaRewarder", gammaRewarderAddr)

    const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder()

    await connectDB()
    const trees: ITreeData[] = await findTrees()
    const lastTree: ITreeData = await findLastTree()

    // Get dispute period: 
    const disputePeriod = await gammareward.disputePeriod()
    // Pass the dispute period
    await _increaseTime(Number(disputePeriod) + 1)
    // get the current active root
    const currentActiveRoot = await gammareward.getMerkleRoot()
    console.log("Current Active Root", currentActiveRoot)
    let proof: IProof[] = [];
    // check if the current active root on chain is equal to latest merkle tree or the previsou tree
    if(currentActiveRoot == lastTree.root) {
        for(let i = 0 ; i < claimLpAddresses.length ; i++) {
            // find the target leaf from the active tree
            const targetLeaf = lastTree.leaves.filter(leaf => 
                leaf.lpAddress === claimLpAddresses[i] && 
                leaf.rewardToken === claimRewardTokens[i]
            )
            console.log(`Target Leaf: ${targetLeaf[0].lpAddress} - ${targetLeaf[0].rewardToken} - ${targetLeaf[0].rewardAmount}`)
            let _tempEncode = defaultAbiCoder.encode(
                ['address', 'address', 'uint256'],
                [targetLeaf[0].lpAddress, targetLeaf[0].rewardToken, targetLeaf[0].rewardAmount]
            )
            const targetLeafHash = ethers.keccak256(_tempEncode)
            console.log(`Hash value: ${targetLeafHash}`)
            const tree = new MerkleTree(lastTree.leafHashes, ethers.keccak256, {sortPairs: true})
            proof = tree.getProof(targetLeafHash)
            let proofValues = proof.map(item => item.data)
            console.log(`Proof: ${proof}`)
            await gammareward.claim(
                targetLeaf[0].lpAddress,
                targetLeaf[0].rewardToken,
                targetLeaf[0].rewardAmount,
                proofValues
            )
        }

    } else {

    }
    closeDb()
}


// This pattern can use async/await everywhere and properly handle errors.
claim().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
