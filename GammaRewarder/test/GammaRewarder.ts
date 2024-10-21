import { expect } from "chai";
import { ethers } from "hardhat";
// import mockApiResponse from "./mock/mockApiResponse";
import { generateTree } from "../scripts/merkleTree";

describe("GammaRewarder", function () {
  let gammaRewarderAddr: string;
  let mockUsers:any, mockIncentivizors:any, mockDistributor: any;
  let gammaRewarder:any, gammaRewarderOwnerAddr: string;
  let mockToken_A:any, mockToken_B:any, mockToken_C:any;
  let mockToken_A_Addr: string, mockToken_B_Addr: string, mockToken_C_Addr: string;
  let lpList: any[], mockApiResponse: any[];

  const mockUniswapV3Pool = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const defaultDisputeTokenAmount = 100;

  before('deploy the contract', async function () {
    mockUsers = await ethers.getSigners();
    lpList = [
      mockUsers[10],
      mockUsers[11],
      mockUsers[12],
      mockUsers[13],
      mockUsers[14],
      mockUsers[15],
      mockUsers[16],
      mockUsers[17],
      mockUsers[18]
    ]
    mockApiResponse = [
      { "address": lpList[0].address, "reward": 10},
      { "address": lpList[1].address, "reward": 20},
      { "address": lpList[2].address, "reward": 30},
      { "address": lpList[3].address, "reward": 40},
      { "address": lpList[4].address, "reward": 10},
      { "address": lpList[5].address, "reward": 20},
      { "address": lpList[6].address, "reward": 30},
      { "address": lpList[7].address, "reward": 40},
      { "address": lpList[8].address, "reward": 10}
    ]

    mockDistributor = mockUsers[5];
    mockIncentivizors = [mockUsers[6], mockUsers[7], mockUsers[8]]

    const GammaRewarder = await ethers.getContractFactory("GammaRewarder");
    gammaRewarder = await GammaRewarder.deploy();
    gammaRewarderOwnerAddr = await gammaRewarder.owner();
    gammaRewarderAddr = await gammaRewarder.getAddress();
    
    const MockToken = await ethers.getContractFactory("MockERC20Token")
    mockToken_A = await MockToken.deploy(1e8)
    mockToken_A_Addr = await mockToken_A.getAddress()
    
    mockToken_B = await MockToken.deploy(1e8)
    mockToken_B_Addr = await mockToken_B.getAddress()

    mockToken_C = await MockToken.deploy(1e8)
    mockToken_C_Addr = await mockToken_C.getAddress()
  })
  
  it('owner of gammarewarder contract', async function () {
    expect(gammaRewarderOwnerAddr).to.equal(mockUsers[0].address)
  })

  it('owner of mock token', async function () {
    let balanceOfOwner = await mockToken_A.balanceOf(mockUsers[0].address)
    expect(balanceOfOwner).to.equal(1e8)
  })

  it('set distributor wallet', async function() {
    await gammaRewarder.initialize(mockDistributor.address)
  })

  it('create distribution', async function() {
    const blockNumber = await ethers.provider.getBlockNumber()
    const blockT = await ethers.provider.getBlock(blockNumber)
    const timestamp = blockT?.timestamp
    console.log('time steamp: ', timestamp)

    /**
     * Create 1st distribution with Token A 1000
     * @preprocessing Transfer Token A to Incentivizor-A
     * @preprocessing Approve Token A to GammaRewarder contract
     * @Create distribution
     */
    await mockToken_A.transfer(mockIncentivizors[0], 10000)
    await mockToken_A.connect(mockIncentivizors[0]).approve(gammaRewarderAddr, 1000)
    await gammaRewarder.connect(mockIncentivizors[0]).createDistribution({
      rewardId: "0x1234567890123456789012345678901234567890123456789012345678901234",
      uniV3Pool: mockUniswapV3Pool,
      rewardToken: mockToken_A_Addr,
      amount: 1000,
      epochStart: timestamp,
      numEpoch: 10
    })

    /**
     * Create 1st distribution with Token B 2000
     * @preprocessing Transfer Token B to Incentivizor-B
     * @preprocessing Approve Token B to GammaRewarder contract
     * @Create distribution
     */
    await mockToken_B.transfer(mockIncentivizors[1], 10000)
    await mockToken_B.connect(mockIncentivizors[1]).approve(gammaRewarderAddr, 2000)
    await gammaRewarder.connect(mockIncentivizors[1]).createDistribution({
      rewardId: "0x1234567890123456789012345678901234567890123456789012345678901234",
      uniV3Pool: mockUniswapV3Pool,
      rewardToken: mockToken_B_Addr,
      amount: 2000,
      epochStart: timestamp,
      numEpoch: 10
    })

    /**
     * Create 1st distribution with Token C 3000
     * @preprocessing Transfer Token C to Incentivizor-C
     * @preprocessing Approve Token C to GammaRewarder contract
     * @Create distribution
     */
    await mockToken_C.transfer(mockIncentivizors[2], 10000)
    await mockToken_C.connect(mockIncentivizors[2]).approve(gammaRewarderAddr, 3000)
    await gammaRewarder.connect(mockIncentivizors[2]).createDistribution({
      rewardId: "0x1234567890123456789012345678901234567890123456789012345678901234",
      uniV3Pool: mockUniswapV3Pool,
      rewardToken: mockToken_C_Addr,
      amount: 3000,
      epochStart: timestamp,
      numEpoch: 10
    })
  })

  it('update merkle root', async function() {
    /**
     * Getting all distributions
     * 
     */

    let distributionList = await gammaRewarder.getAllDistributions();
    console.log('list length: ', distributionList.length)

    const merkleTree = await generateTree(mockApiResponse)
    const merkleRoot = merkleTree.getHexRoot()

    await gammaRewarder.updateTree(merkleRoot)

    expect(await gammaRewarder.merkleTree()).to.equal(merkleRoot)
  })
  
  it('set dispute token by owner of GammaRewarder contract', async function() {
    await gammaRewarder.setDisputeToken(mockToken_A_Addr)
    expect(await gammaRewarder.disputeToken()).to.equal(mockToken_A_Addr)
  })

  it('set dispute token amount by owner of gammarewardre contract', async function() {
    await gammaRewarder.setDisputeAmount(defaultDisputeTokenAmount)
    expect(await gammaRewarder.disputeAmount()).to.equal(100)
  })

  it('set dispute period by owner of GammaRewarder contract', async function() {
    await gammaRewarder.setDisputePeriod(3600)
    expect(await gammaRewarder.disputePeriod()).to.equal(3600)
  })
  
  it('dispute', async function() {
    let disputer = mockUsers[1]
    let disputerAddr = disputer.address
    // transfer token to disputer user
    await mockToken_A.transfer(disputerAddr, 10000)
    expect(await mockToken_A.balanceOf(disputerAddr)).to.equal(10000)

    /**
     * Set dispute
     * before set dispute, approve dispute token to gammarewarder contract
     */
    await mockToken_A.connect(disputer).approve(gammaRewarderAddr, defaultDisputeTokenAmount)
    expect(await mockToken_A.allowance(disputer, gammaRewarderAddr)).to.equal(defaultDisputeTokenAmount)
    await gammaRewarder.connect(disputer).dispute("wrong root")
  })

  it('claim rewards', async function() {
    // await gammaRewarder.claim(lpList[0].address, mockToken_A_Addr, )
  })
});
