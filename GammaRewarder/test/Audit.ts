import { expect } from "chai";
import { ethers } from "hardhat";
import { start } from "repl";

const brevisProof = "0xa83852A6a073C43423CC41241f7Fb2ba4C0DDD77"
const hypervisor_address = "0x904135ac233e53fc1c1A5B061D34496b362489c3"
const distribution_amount = 10000000000000000000000n
const start_block_num = 195609600n
const end_block_num = 195782400n
const VK_HASH = "0x2a3e3871a6dd2ffe0012e82243e19567a1cf8df985e0f55e688fc88c3e0f94d1"

describe("Testing Gamma Rewarder Contract", function() {
  let rewardContract:any, rewardToken:any, users:any[];
  
  before("Deploy GammaRewarder", async function() {
    users = await ethers.getSigners();
    const protocolFeeRecipient = users[1]

    const Reward = await ethers.getContractFactory("GammaRewarder");
    rewardContract = await Reward.deploy(brevisProof, protocolFeeRecipient)

    const RewardToken = await ethers.getContractFactory("MockERC20Token")
    rewardToken = await RewardToken.deploy();
  });

  it("Add VK Hash", async function() {
    try {
      // Failed to call `addVKHash()` because it is triggered by non-contract-owner.
      let failHash = "0xd4c6d4607c23b7dbca3b774b9e6d78a46562186867b71d583b5d5fa2b3ac3b33"
      await rewardContract.connect(users[1]).addVkHash(failHash)
    } catch (error) { console.log(`${error}`) }
    
    await rewardContract.addVkHash(VK_HASH)
    let vkHashAdded = await rewardContract.vkHashes(VK_HASH)
    expect(vkHashAdded).to.equal(true)
  })

  it("Remove VK Hash", async function() {
    try {
      // Failed to call `removeVkHash()` because it is triggered by non-contract-owner.
      let failHash = "0xd4c6d4607c23b7dbca3b774b9e6d78a46562186867b71d583b5d5fa2b3ac3b33"
      await rewardContract.connect(users[1]).removeVkHash(failHash)
    } catch (error) { console.log(`${error}`) }
    
    await rewardContract.removeVkHash(VK_HASH)
    let vkHashRemoved = await rewardContract.vkHashes(VK_HASH)
    expect(vkHashRemoved).to.equal(false)
  })

  it("Whitelist reward token", async function() {
    try {
      // Failed to call `toggleTokenWhitelist()` because triggered by non-owner
      await rewardContract.connect(users[1]).toggleTokenWhitelist(rewardToken.getAddress())
    } catch (error) { console.log(`${error}`) }

    // Add `rewardToken` to whitelist for distribution
    await rewardContract.toggleTokenWhitelist(rewardToken.getAddress())
    let tokenStatus = await rewardContract.isWhitelistedRewardToken(rewardToken.getAddress())
    expect(tokenStatus).to.equal(1)

    // Remove `rewardToken` from whitelist for distribution
    await rewardContract.toggleTokenWhitelist(rewardToken.getAddress())
    tokenStatus = await rewardContract.isWhitelistedRewardToken(rewardToken.getAddress())
    expect(tokenStatus).to.equal(0)
  })

  it("Set protocol fee", async function() {
    // Failed because triggered by non-owner
    try {
      await rewardContract.connect(users[5]).setProtocolFee(30000000)
    } catch (error) { console.log(`${error}`) }
    
    // Failed because protocol fee is greater than Fee_base value(10**9)
    try {
      await rewardContract.setProtocolFee(3*10**9)
    } catch (error) { console.log(`${error}`) }

    await rewardContract.setProtocolFee(30000000)
    let protocolFee = await rewardContract.protocolFee()
    expect(protocolFee).to.equal(30000000)
  });

  it("Set protocol fee recipient", async function () {
    // Failed because called by non-owner
    try {
      await rewardContract.connect(users[1]).setProtocolFeeRecipient(users[2])
    } catch (error) { console.log(`${error}`) }

    await rewardContract.setProtocolFeeRecipient(users[5])
    let feeRecipient = await rewardContract.protocolFeeRecipient()
    expect(feeRecipient).to.equal(users[5])
  })

  it("Set blocks per epoch", async function() {
    // Failed because called by non-owner
    try {
      await rewardContract.connect(users[2]).setBlocksPerEpoch(86400)
    } catch (error) { console.log(`${error}`) }

    await rewardContract.setBlocksPerEpoch(86400)
    let blocksPerEpoch = await rewardContract.blocksPerEpoch()
    expect(blocksPerEpoch).to.equal(86400)
  })

  it("Create Distribution", async function() {
    let rewardTokenAddress = await rewardToken.getAddress()
    // Mint `rewardToken` to incentivizor - `users[1]`
    await rewardToken.mint(users[1], 10000000000000000000000n)
    // Approve `rewardToken` to `gammaReward` contract
    await rewardToken.connect(users[1]).approve(rewardContract.getAddress(), 10000000000000000000000n)
    // Add `rewardToken` to whitelist
    await rewardContract.toggleTokenWhitelist(rewardTokenAddress)
    
    await rewardContract.connect(users[1]).createDistribution(
      hypervisor_address,
      rewardTokenAddress,
      distribution_amount,
      start_block_num,
      end_block_num
    )

    // Faile because distribution's start block number is previous than current block number.
    const blockNumBefore = await ethers.provider.getBlockNumber();
    try {
      await rewardContract.connect(users[1]).createDistribution(
        hypervisor_address,
        rewardTokenAddress,
        distribution_amount,
        blockNumBefore - 1, // Failed due to this parameter
        end_block_num
      )
    } catch (error) { console.log(`${error}`) }

    // Failed because duration of distribution is greater than duration limit
    const MAX_DISTRIBUTION_DURATION = await rewardContract.MAX_DISTRIBUTION_BLOCKS()
    try {
      await rewardContract.connect(users[1]).createDistribution(
        hypervisor_address,
        rewardTokenAddress,
        distribution_amount,
        start_block_num,
        start_block_num + BigInt(MAX_DISTRIBUTION_DURATION) + 1n // Failed due to this
      )
    } catch (error) { console.log(`${error}`) }

    // Failed because the distribution amount is zero
    try {
      await rewardContract.connect(users[1]).createDistribution(
        hypervisor_address,
        rewardTokenAddress,
        0, // Failed due to this
        start_block_num,
        end_block_num
      )
    } catch (error) { console.log(`${error}`) }

    // Failed because distribution duration is divided by amount of blocks for each epoch with remainder
    const blocksPerEpoch = await rewardContract.blocksPerEpoch()
    try {
      await rewardContract.connect(users[1]).createDistribution(
        hypervisor_address,
        rewardTokenAddress,
        distribution_amount,
        start_block_num,
        start_block_num + BigInt(blocksPerEpoch) + 1n // Failed due to this
      )
    } catch (error) { console.log(`${error}`) }

    // Failed because reward token is not added to whitelist
    const ERC20Token = await ethers.getContractFactory("MockERC20Token") 
    let nonWhitelistedToken = await ERC20Token.deploy()
    try {
      await rewardContract.connect(users[1]).createDistribution(
        hypervisor_address,
        nonWhitelistedToken.getAddress(), // Failed due to this
        distribution_amount,
        start_block_num,
        end_block_num
      )
    } catch (error) { console.log(`${error}`) }

    // Failed because Incentivizor does not approve the reward token to the `gammaReward` contract
    await rewardContract.toggleTokenWhitelist(nonWhitelistedToken.getAddress())
    let allowance = await nonWhitelistedToken.allowance(users[1], rewardContract.getAddress())
    expect(allowance).to.equal(0) // Allowance is zero
    try {
      await rewardContract.connect(users[1]).createDistribution(
        hypervisor_address,
        nonWhitelistedToken.getAddress(),
        distribution_amount,
        start_block_num,
        end_block_num
      )
    } catch (error) { console.log(`${error}`) }
  });

  it("Get distributions amount", async function() {
    let distributionsSize = await rewardContract.getDistributionsAmount()
    expect(distributionsSize).to.equal(1)
  });

  it("Get distribution ID", async function() {
    let distributionId = await rewardContract.getDistributionId(0)

    // Simulate process to generate ID
    let distributionCreatorAddress = await users[1].getAddress()
    let id = ethers.solidityPackedKeccak256(["address", "uint256"], [distributionCreatorAddress, 0])
    expect(distributionId).to.equal(id)
  });

  it("Claim Test", async function() {
    const testLpAddress = await users[4].getAddress()
    const distributionId = await rewardContract.getDistributionId(0)
    const amountPerEpoch = 4850000000000000000000n
    const rewardTokenAddress = await rewardToken.getAddress()
    let blocksPerEpoch = await rewardContract.blocksPerEpoch()
    let circuitOutput;

    // Failed because `vkHash` is not added
    try {
      circuitOutput = _getCircuitOutput(
        testLpAddress, 
        hypervisor_address, 
        0, 
        start_block_num, 
        end_block_num, 
        distributionId, 
        rewardTokenAddress, 
        amountPerEpoch, 
        1000
      )
      await rewardContract.claimTest(
        ethers.encodeBytes32String("string"),
        VK_HASH,
        circuitOutput
      )  
    } catch (error) {console.log(`${error}`)}

    // Add vkHash
    await rewardContract.addVkHash(VK_HASH)

    // Failed because start block is greater than end block
    try {
      circuitOutput = _getCircuitOutput(
        testLpAddress, 
        hypervisor_address, 
        0, 
        (end_block_num - 10n), // Wrong
        end_block_num, 
        distributionId, 
        rewardTokenAddress, 
        amountPerEpoch, 
        1000
      )
      await rewardContract.claimTest(
        ethers.encodeBytes32String("string"),
        VK_HASH,
        circuitOutput
      )
    } catch (error) { console.log(`${error}`) }

    // Failed because claim duration is divided by amount of blocks per epoch with the remainder
    try {
      circuitOutput = _getCircuitOutput(
        testLpAddress, 
        hypervisor_address, 
        0, 
        start_block_num,
        start_block_num + BigInt(blocksPerEpoch) + 1n, // Wrong 
        distributionId, 
        rewardTokenAddress, 
        amountPerEpoch, 
        1000
      )
      await rewardContract.claimTest(
        ethers.encodeBytes32String("string"),
        VK_HASH,
        circuitOutput
      )
    } catch (error) { console.log(`${error}`) }

    // Failed because claim range does not match to distribution range
    try {
      circuitOutput = _getCircuitOutput(
        testLpAddress, 
        hypervisor_address, 
        0, 
        start_block_num - BigInt(blocksPerEpoch), // wrong
        end_block_num, 
        distributionId, 
        rewardTokenAddress, 
        amountPerEpoch, 
        1000
      )
      await rewardContract.claimTest(
        ethers.encodeBytes32String("string"),
        VK_HASH,
        circuitOutput
      )  
    } catch (error) {console.log(`${error}`)}

    // Failed because hypervisor address dose not match
    try {
      let fakeHypervisor = await users[8].getAddress()
      circuitOutput = _getCircuitOutput(
        testLpAddress, 
        fakeHypervisor, // wrong
        0, 
        start_block_num,
        end_block_num, 
        distributionId, 
        rewardTokenAddress, 
        amountPerEpoch, 
        1000
      )
      await rewardContract.claimTest(
        ethers.encodeBytes32String("string"),
        VK_HASH,
        circuitOutput
      )  
    } catch (error) {console.log(`${error}`)}

    // Failed because reward token address
    try {
      let fakeRewardToken = await users[8].getAddress()
      circuitOutput = _getCircuitOutput(
        testLpAddress, 
        hypervisor_address, 
        0, 
        start_block_num,
        end_block_num, 
        distributionId, 
        fakeRewardToken, // wrong
        amountPerEpoch, 
        1000
      )
      await rewardContract.claimTest(
        ethers.encodeBytes32String("string"),
        VK_HASH,
        circuitOutput
      )  
    } catch (error) {console.log(`${error}`)}

    // Failed because reward amount is zero
    try {
      circuitOutput = _getCircuitOutput(
        testLpAddress, 
        hypervisor_address, 
        0, 
        start_block_num,
        end_block_num, 
        distributionId, 
        rewardTokenAddress, 
        amountPerEpoch, 
        0 // wrong
      )
      await rewardContract.claimTest(
        ethers.encodeBytes32String("string"),
        VK_HASH,
        circuitOutput
      )  
    } catch (error) {console.log(`${error}`)}

    circuitOutput = _getCircuitOutput(
      testLpAddress, 
      hypervisor_address, 
      0, 
      start_block_num,
      end_block_num, 
      distributionId, 
      rewardTokenAddress, 
      amountPerEpoch, 
      1000
    )
    await rewardContract.claimTest(
      ethers.encodeBytes32String("string"),
      VK_HASH,
      circuitOutput
    )  
  });

  it("Get Hypervisor Address", async function () {
    let hypervisorAddr = await rewardContract.getHypervisor(0)
    expect(hypervisorAddr).to.equal(hypervisor_address);
  })

  function _getCircuitOutput(
    _user: string, 
    _hypervisor: string, 
    _data: number, 
    _start: any,
    _end: any,
    _distributionId: string,
    _rewardToken: string,
    _amountPerEpoch: any, 
    _rewardAmount: any) {
      let circuitOutput = ethers.solidityPacked(
        ["address", "address", "uint64", "uint64", "uint64", "bytes32", "address", "uint248", "uint248"],
        [_user, _hypervisor, _data, _start, _end, _distributionId, _rewardToken, _amountPerEpoch, _rewardAmount]
      )
      return circuitOutput;
  }
});