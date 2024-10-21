import { ethers } from "hardhat";
import {time} from '@nomicfoundation/hardhat-network-helpers'
import { expect } from "chai";
import { getRoundedTimestamp, getCurrentTimeStamp, getEpochAmount } from "./utils";
import { generateTree } from "../scripts/merkleTree";
import { _createDistributions } from "../scripts/_createDistributions";

const gammaVaultAddr = "0x02203f2351e7ac6ab5051205172d3f772db7d814" // polygon wmatic-weth vault

describe("Generate Merkle", function() {
    let mockUsers: any;
    let incentivizors: any[], lps: any[];
    let gammaRewarder: any, gammaRewarder_Addr: string;
    let mockToken_A: any, mockToken_B: any, mockToken_C: any;
    let mockToken_A_Addr: string, mockToken_B_Addr: string, mockToken_C_Addr: string;
    let currentTimeStamp: number;
    before('deploy GammaRewarder contract', async function() {
        mockUsers = await ethers.getSigners()
        incentivizors = [mockUsers[1], mockUsers[2], mockUsers[3]]
        lps = [mockUsers[4], mockUsers[5], mockUsers[6], mockUsers[7], mockUsers[8]]

        const GammaRewarder = await ethers.getContractFactory("GammaRewarder");
        gammaRewarder = await GammaRewarder.deploy();
        gammaRewarder_Addr = await gammaRewarder.getAddress();
        await gammaRewarder.initialize(gammaRewarder_Addr, 30000000)

        const MockToken = await ethers.getContractFactory("MockERC20Token")
        mockToken_A = await MockToken.deploy(1e8)
        mockToken_A_Addr = await mockToken_A.getAddress()     
        mockToken_B = await MockToken.deploy(1e8)
        mockToken_B_Addr = await mockToken_B.getAddress()
        mockToken_C = await MockToken.deploy(1e8)
        mockToken_C_Addr = await mockToken_C.getAddress()

        currentTimeStamp = await getCurrentTimeStamp()
    })

    it("create distributions", async function () {
        // create distribution
        let distributionParameter: any;
        // whitelist reward tokens
        await gammaRewarder.toggleTokenWhitelist(mockToken_A_Addr)
        await gammaRewarder.toggleTokenWhitelist(mockToken_B_Addr)
        await gammaRewarder.toggleTokenWhitelist(mockToken_C_Addr)

        // mock token transfer to incentivizors
        await mockToken_A.transfer(incentivizors[0].address, 10000)
        await mockToken_A.transfer(incentivizors[1].address, 10000)
        await mockToken_A.transfer(incentivizors[2].address, 10000)
        await mockToken_B.transfer(incentivizors[0].address, 10000)
        await mockToken_B.transfer(incentivizors[1].address, 10000)
        await mockToken_B.transfer(incentivizors[2].address, 10000)
        await mockToken_C.transfer(incentivizors[0].address, 10000)
        await mockToken_C.transfer(incentivizors[1].address, 10000)
        await mockToken_C.transfer(incentivizors[2].address, 10000)

        // approve reward tokens to gammareward contract
        await mockToken_A.connect(incentivizors[0]).approve(gammaRewarder_Addr, 10000)
        await mockToken_B.connect(incentivizors[0]).approve(gammaRewarder_Addr, 10000)
        await mockToken_C.connect(incentivizors[0]).approve(gammaRewarder_Addr, 10000)
        await mockToken_A.connect(incentivizors[1]).approve(gammaRewarder_Addr, 10000)
        await mockToken_B.connect(incentivizors[1]).approve(gammaRewarder_Addr, 10000)
        await mockToken_C.connect(incentivizors[1]).approve(gammaRewarder_Addr, 10000)
        await mockToken_A.connect(incentivizors[2]).approve(gammaRewarder_Addr, 10000)
        await mockToken_B.connect(incentivizors[2]).approve(gammaRewarder_Addr, 10000)
        await mockToken_C.connect(incentivizors[2]).approve(gammaRewarder_Addr, 10000)

        await _createDistributions(
            gammaRewarder,
            incentivizors,
            gammaVaultAddr,
            [mockToken_A_Addr, mockToken_B_Addr, mockToken_C_Addr],
            currentTimeStamp
        )
    })

    it("get all distributions", async function() {
        let allDistributions = await gammaRewarder.getAllDistributions()
        expect(allDistributions.length).to.equal(9)
        // After 20 hours, get all enable distributions
        await time.increase(39600)
        allDistributions = await gammaRewarder.getActiveDistributions()
        expect(allDistributions.length).to.equal(6)
    })

    it("generate merkle tree", async function() {
        currentTimeStamp = await getCurrentTimeStamp()
        // get all distributions enabled at this timestamp
        let availableDistributions = await gammaRewarder.getDistributionsForEpoch(gammaVaultAddr, currentTimeStamp)
        // list of distributions for the current epoch
        let distributionsForEpoch = []
        // Loop all distributions for the current time
        // Get sum of available rewards per reward token
        // `rewardToken`, `amount`, `epochStart`, `numEpoch`, `incentivizor`
        for(let i = 0 ; i < availableDistributions.length ; i++) {
            let _amount = Number(availableDistributions[i].amount)
            let _epochStart = Number(availableDistributions[i].epochStart)
            let _numEpoch = Number(availableDistributions[i].numEpoch)

            let _rewardsPerEpoch = _amount * getEpochAmount(_epochStart, currentTimeStamp) / _numEpoch

            // Temp data : rewards at the epoch, reward token address, incentivizor address
            let _temp = {
                rewardId: availableDistributions[i].rewardId,
                hypervisor: availableDistributions[i].hypervisor,
                rewardToken: availableDistributions[i].rewardToken,
                amount: _rewardsPerEpoch,
                epochStart: _epochStart,
                numEpoch: _numEpoch,
                incentivizor: availableDistributions[i].incentivizor,
            }
            distributionsForEpoch.push(_temp)
        }

        // API response data
        let apiRes = [
            {lpAddress: lps[0].address, shares: 50},
            {lpAddress: lps[1].address, shares: 10},
            {lpAddress: lps[2].address, shares: 20},
            {lpAddress: lps[3].address, shares: 30},
            {lpAddress: lps[4].address, shares: 40},
        ]
        
        // Generate Merkle Tree
        const tree = generateTree(apiRes, distributionsForEpoch)
        console.log('Merkle Tree:\n', tree.toString())
    })
})