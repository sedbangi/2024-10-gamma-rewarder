import { ethers } from "hardhat";
import {time} from '@nomicfoundation/hardhat-network-helpers'
import { expect } from "chai";
import { 
    getRoundedTimestamp,
    getCurrentTimeStamp,
    getAggregatedDistributionsByToken,
    readMerkleTreeJsonFile,
    writeMerkleTreeJsonFile,
    getLeafFromTreeJsonData,
} from "./utils";
import { MerkleTree } from 'merkletreejs'
import { _createDistributions } from "../scripts/_createDistributions";

const gammaVaultAddr = "0x02203f2351e7ac6ab5051205172d3f772db7d814" // polygon wmatic-weth vault

interface IMerkleLeaf {
    lpAddress: string;
    rewardToken: string;
    rewardAmount: number;
}

interface IMerkleTreeJson {
    root: string;
    leafHashes: string[];
    leaves: IMerkleLeaf[];
    createdAt: number;
}
const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder()

describe("Generate Merkle", function() {
    let mockUsers: any;
    let incentivizors: any[];
    let lps: string[] = [];
    let gammaRewarder: any, gammaRewarder_Addr: string;
    let mockTokens: any[] = []
    let mockTokenAddresses: string[] = []
    let currentTimeStamp: number;
    let merkleRoot: string;
    before('deploy GammaRewarder contract', async function() {
        mockUsers = await ethers.getSigners()
        incentivizors = [mockUsers[1], mockUsers[2], mockUsers[3]]
        for (let i = 4 ; i < 9 ; i++) {
            const _tempLpAddr = await mockUsers[i].getAddress()
            lps.push(_tempLpAddr)
        }

        const GammaRewarder = await ethers.getContractFactory("GammaRewarder");
        gammaRewarder = await GammaRewarder.deploy();
        gammaRewarder_Addr = await gammaRewarder.getAddress();
        await gammaRewarder.initialize(gammaRewarder_Addr, 30000000)

        const MockToken = await ethers.getContractFactory("MockERC20Token")
        for(let i = 0 ; i < 3 ; i++) {
            const _temp = await MockToken.deploy(1e8)
            mockTokens.push(_temp)
            mockTokenAddresses.push(await _temp.getAddress())
        }

        currentTimeStamp = await getCurrentTimeStamp()
    })

    it("create distributions", async function () {
        for(let i = 0 ; i < mockTokens.length ; i++) {
            // whitelist reward tokens
            await gammaRewarder.toggleTokenWhitelist(mockTokenAddresses[i])
            for(let j = 0 ; j < incentivizors.length ; j++) {
                // mock token transfer to incentivizors
                await mockTokens[i].transfer(incentivizors[j].address, 1e5)
                // approve reward tokens to gammareward contract
                await mockTokens[i].connect(incentivizors[j]).approve(gammaRewarder_Addr, 1e5)
            }
        }

        await _createDistributions(
            gammaRewarder,
            incentivizors,
            gammaVaultAddr,
            mockTokenAddresses,
            currentTimeStamp,
            1000
        )
    })

    it("generate merkle tree", async function() {
        const lpShares = [
            {lpAddress: lps[0], shares: 100},
            {lpAddress: lps[1], shares: 200},
            {lpAddress: lps[2], shares: 300},
            {lpAddress: lps[3], shares: 400},
            {lpAddress: lps[4], shares: 500},
        ]

        // check if there is last merkle tree
        let lastTree: IMerkleTreeJson | undefined = readMerkleTreeJsonFile()
        let distributionsForTreeUpdatePeriod: any[] = []
        // Let's imagine the period of tree update is 6 Hours
        if(lastTree) {
            let lastTreeCreated = lastTree.createdAt;
            for(let i = 1 ; i <= 6 ; i++ ) {
                const distributionsForEpoch = await gammaRewarder.getDistributionsForEpoch(gammaVaultAddr, (lastTreeCreated + i * 3600))
                distributionsForTreeUpdatePeriod = [...distributionsForTreeUpdatePeriod, ...distributionsForEpoch]
            }
        } else {
            // Get the rounded epoch for current timestamp
            let roundedTimestamp = getRoundedTimestamp(await getCurrentTimeStamp())
            for(let i = 0 ; i < 6 ; i++) {
                const distributionsForEpoch = await gammaRewarder.getDistributionsForEpoch(gammaVaultAddr, (roundedTimestamp - i * 3600))
                distributionsForTreeUpdatePeriod = [...distributionsForTreeUpdatePeriod, ...distributionsForEpoch]
            }
        }

        let aggregatedDistributionsByTokenForTreeUpdatePeriod = new Map<string, number>()
        aggregatedDistributionsByTokenForTreeUpdatePeriod = getAggregatedDistributionsByToken(distributionsForTreeUpdatePeriod)

        let totalShares: number = 0;
        for(let i = 0 ; i < lpShares.length ; i++) {
            totalShares += lpShares[i].shares
        }

        let leaves: IMerkleLeaf[] = [];
        for(let i = 0 ; i < lpShares.length ; i++) {
            for (const [rewardToken, amount] of aggregatedDistributionsByTokenForTreeUpdatePeriod) {
                let _reward = Math.round(amount * lpShares[i].shares / totalShares);
                leaves.push({
                    lpAddress: lpShares[i].lpAddress,
                    rewardToken: rewardToken,
                    rewardAmount: _reward
                });
            }
        }
        
        const leafHashes: string[] = leaves.map((item) => {
            let _tempEncode = defaultAbiCoder.encode(
                ['address', 'address', 'uint256'],
                [item.lpAddress, item.rewardToken, item.rewardAmount]
            )
            let _hashVal = ethers.keccak256(_tempEncode)
            return _hashVal
        })
        const tree = new MerkleTree(leafHashes, ethers.keccak256, {sortPairs: true})

        merkleRoot = tree.getHexRoot()
        const merklTreeJson = {
            root: merkleRoot,
            leafHashes: leafHashes,
            leaves: leaves,
            createdAt: await getCurrentTimeStamp()
        }
        writeMerkleTreeJsonFile(merklTreeJson)
        console.log(`Root: ${merkleRoot}`)
        // console.log(tree.toString())

        /**
         * @notice Update merkle root on chain
         * 1. Before updating root, the `disputePeriod` has to be defined as more than zero.
         */
        await gammaRewarder.setDisputePeriod(1)
        await gammaRewarder.updateTree(merkleRoot)
    })

    it("claim reward", async function() {
        // Get current active Merkle root
        let root = await gammaRewarder.getMerkleRoot()

        // The return `root` value is zero because the new root is not yet active.
        // The new root becomes active after the dispute period passed.
        expect(root).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000")

        // time is increased 2 hours.
        await time.increase(7200)
        root = await gammaRewarder.getMerkleRoot()
        expect(root).to.equal(merkleRoot)

        // Generate merkle tree from `leafHashes` which is fetched from external JSON file
        const merkleTreeJson: IMerkleTreeJson | undefined = readMerkleTreeJsonFile()
        if(merkleTreeJson) {
            const tree = new MerkleTree(merkleTreeJson.leafHashes, ethers.keccak256, {sortPairs: true})
            const leaf = getLeafFromTreeJsonData(merkleTreeJson, lps[0])

            const leafHash = ethers.keccak256(defaultAbiCoder.encode(
                ['address', 'address', 'uint256'],
                [leaf[0].lpAddress, leaf[0].rewardToken, leaf[0].rewardAmount]
            ))

            let proofData = tree.getProof(leafHash)
            const proof = proofData.map((item) => {
                return ("0x" + item.data.toString("hex")) 
            })

            const claimedRewardToken = await ethers.getContractAt("MockERC20Token", leaf[0].rewardToken)
            let beforeRewardTokenBalance = await claimedRewardToken.balanceOf(leaf[0].lpAddress)

            await gammaRewarder.claim(lps[0], leaf[0].rewardToken, leaf[0].rewardAmount, proof)

            let afterRewardTokenBalance = await claimedRewardToken.balanceOf(leaf[0].lpAddress)
            expect(Number(afterRewardTokenBalance)).to.equal(Number(beforeRewardTokenBalance) + leaf[0].rewardAmount)
        }
    })
})