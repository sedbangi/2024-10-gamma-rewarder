// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
// import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./brevis/lib/BrevisApp.sol";
import "./brevis/lib/IBrevisProof.sol";

struct DistributionParameters {
    // ID of the distribution (populated once created)
    bytes32 distributionId;
    // Address of the Gamma Hypervisor that needs to be incentivized
    address hypervisor;
    // Address of the token of distribution
    address rewardToken;
    // The distribution amount per epoch
    uint256 distributionAmountPerEpoch;
    // Block number at where the distribution should start
    uint64 startBlockNumber;
    // Block number at where the distribution should end
    uint64 endBlockNumber;
    // Wallet address of incentivizor who creates this distribution
    address incentivizor;
}

struct CumulativeClaim {
    uint256 amount;
    uint64 startBlock;
    uint64 endBlock;
}

contract GammaRewarder is BrevisApp, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // =========================== CONSTANTS / VARIABLES ===========================

    /// @notice Base for protocol fee computation
    uint256 public constant BASE_9 = 1e9;
    uint256 public MAX_DISTRIBUTION_BLOCKS = 9_676_800; // Blocks for 4 weeks

    uint64 public blocksPerEpoch;

    DistributionParameters[] public distributionList;

    mapping(bytes32 => DistributionParameters) distributions;

    mapping(address => uint256) public isWhitelistedRewardToken;

    mapping(address => uint256) public nonces;

    /// @notice Value (in base 10**9) of the fees taken when creating a distribution for a pool
    /// If protocol fee is 1%, `protocolFee` is 10**7.
    uint256 public protocolFee;

    address public protocolFeeRecipient;

    mapping(address => mapping(address => mapping(bytes32 => CumulativeClaim))) public claimed;

    /// @notice Brevis Verify Key Hashes
    mapping(bytes32 => bool) public vkHashes;

    // =================================== EVENTS ==================================

    event Claimed(address indexed user, bytes32 indexed distributionId, address indexed token, uint64 startBlock, uint64 endBlock, uint256 amount);
    event BlocksPerEpochUpdated(uint64 blocksPerEpoch);
    event NewDistribution(DistributionParameters distribution, address indexed sender);
    event ProtocolFeeRecipientUpdated(address indexed _feeRecipient);
    event ProtocolFeeSet(uint256 _protocolFee);
    event ReclaimPeriodUpdated(uint256 _reclaimPeriod);
    event Revoked(); // With this event an indexer could maintain a table (timestamp, merkleRootUpdate)
    event TokenRewardWhitelistToggled(address indexed token, uint256 toggleStatus);
    
    constructor(address brevisProof, address _protocolFeeRecipient) BrevisApp(IBrevisProof(brevisProof)) Ownable(msg.sender) {
        protocolFeeRecipient = _protocolFeeRecipient;
    }
    
    // ================================= Brevis Verify =================================
    function addVkHash(bytes32 _vkHash) external onlyOwner {
        vkHashes[_vkHash] = true;
    }

    function removeVkHash(bytes32 _vkHash) external onlyOwner {
        vkHashes[_vkHash] = false;
    }

    // ================================ MAIN FUNCTION ================================

    function createDistribution(
        address _hypervisor, 
        address _rewardToken, 
        uint256 _amount, 
        uint64 _startBlockNum, 
        uint64 _endBlockNum
    ) external nonReentrant {
        require(_startBlockNum > block.number && (_endBlockNum - _startBlockNum) <= MAX_DISTRIBUTION_BLOCKS, "Distribution start block number is less than current block number or the duration is greater than 4 weeks.");
        require(_amount > 0, "Distribution Amount has to be greater than zero.");
        require((_endBlockNum - _startBlockNum) % blocksPerEpoch == 0, "Distribution length must be multiples of blocks per epoch");
        require(isWhitelistedRewardToken[_rewardToken] == 1, "Reward token has to be whitelisted.");
        require(IERC20(_rewardToken).allowance(msg.sender, address(this)) >= _amount, "Incentivisor did not approve enough amount to Reward contract.");
        require(protocolFeeRecipient != address(0), "The fee recipient has to be defined.");

        uint256 fee = _amount * protocolFee / BASE_9;
        uint256 realAmountToDistribute = _amount - fee;
        uint256 amountPerEpoch = realAmountToDistribute / ((_endBlockNum - _startBlockNum) / blocksPerEpoch);

        IERC20(_rewardToken).safeTransferFrom(msg.sender, protocolFeeRecipient, fee);
        IERC20(_rewardToken).safeTransferFrom(msg.sender, address(this), realAmountToDistribute);

        uint256 senderNonce = nonces[msg.sender];
        bytes32 distributionId = bytes32(keccak256(abi.encodePacked(msg.sender, senderNonce)));
        DistributionParameters memory newDistribution = DistributionParameters({
            distributionId: distributionId,
            hypervisor: _hypervisor,
            rewardToken: _rewardToken,
            distributionAmountPerEpoch: amountPerEpoch,
            startBlockNumber: _startBlockNum,
            endBlockNumber: _endBlockNum,
            incentivizor: msg.sender
        });
        distributionList.push(newDistribution);
        distributions[distributionId] = newDistribution;
        nonces[msg.sender] = senderNonce + 1;
        emit NewDistribution(newDistribution, msg.sender);
    }

    function claimTest(bytes32, bytes32 _vkHash, bytes calldata _appCircuitOutput) external {
        require(vkHashes[_vkHash], "invalid vk");

        (
            address userAddress,
            address lpTokenAddress,
            uint64 startBlock,
            uint64 endBlock,
            bytes32 distributionId,
            address rewardTokenAddress,
            uint248 distributionAmountPerEpoch,
            uint248 totalRewardAmount
        ) = decodeOutput(_appCircuitOutput);

        DistributionParameters memory params = distributions[distributionId];
        require(startBlock < endBlock && (endBlock - startBlock) % blocksPerEpoch == 0, "Claim period must be valid");
        require(startBlock >= params.startBlockNumber && endBlock <= params.endBlockNumber, "Claim range has to include distribution range.");
        require(lpTokenAddress == params.hypervisor && rewardTokenAddress == params.rewardToken && distributionAmountPerEpoch == params.distributionAmountPerEpoch, "Distribution params must match");
        require(totalRewardAmount > 0, "Do not exist reward for you.");
        
        // Closing reentrancy gate here
        CumulativeClaim memory claim = claimed[userAddress][rewardTokenAddress][distributionId];
        require(claim.amount == 0 , "Already claimed reward.");

        claim.startBlock = startBlock;
        claim.endBlock = endBlock;
        claim.amount = totalRewardAmount;
        claimed[userAddress][rewardTokenAddress][distributionId] = claim;

        IERC20(rewardTokenAddress).safeTransfer(userAddress, totalRewardAmount);
        emit Claimed(userAddress, distributionId, rewardTokenAddress, startBlock, endBlock, totalRewardAmount);
    }

    function handleProofResult(bytes32, bytes32 _vkHash, bytes calldata _appCircuitOutput) internal override {
        require(vkHashes[_vkHash], "invalid vk");

        (
            address userAddress,
            address lpTokenAddress,
            uint64 startBlock,
            uint64 endBlock,
            bytes32 distributionId,
            address rewardTokenAddress,
            uint248 distributionAmountPerEpoch,
            uint248 totalRewardAmount
        ) = decodeOutput(_appCircuitOutput);

        DistributionParameters memory params = distributions[distributionId];
        require(startBlock < endBlock && (endBlock - startBlock) % blocksPerEpoch == 0, "Claim period must be valid");
        require(startBlock >= params.startBlockNumber && endBlock <= params.endBlockNumber, "Claim range has to include distribution range.");
        require(lpTokenAddress == params.hypervisor && rewardTokenAddress == params.rewardToken && distributionAmountPerEpoch == params.distributionAmountPerEpoch, "Distribution params must match");
        require(totalRewardAmount > 0, "Do not exist reward for you.");
        
        // Closing reentrancy gate here
        CumulativeClaim memory claim = claimed[userAddress][rewardTokenAddress][distributionId];
        require(claim.amount == 0 , "Already claimed reward.");

        claim.startBlock = startBlock;
        claim.endBlock = endBlock;
        claim.amount = totalRewardAmount;
        claimed[userAddress][rewardTokenAddress][distributionId] = claim;

        IERC20(rewardTokenAddress).safeTransfer(userAddress, totalRewardAmount);
        emit Claimed(userAddress, distributionId, rewardTokenAddress, startBlock, endBlock, totalRewardAmount);
    }

    function decodeOutput(bytes calldata output) internal pure returns (address, address, uint64, uint64, bytes32, address, uint248, uint248) {
        address userAddress = address(bytes20(output[0:20]));
        address lpTokenAddress = address(bytes20(output[20:40]));
        uint64 startBlock = uint64(bytes8(output[48:56]));
        uint64 endBlock = uint64(bytes8(output[56:64]));
        bytes32 distributionId = bytes32(output[64:96]);
        address rewardTokenAddress = address(bytes20(output[96:116]));
        uint248 distributionAmountPerEpoch = uint248(bytes31(output[116:147]));
        uint248 totalRewardAmount = uint248(bytes31(output[147:178]));
        return (userAddress, lpTokenAddress, startBlock, endBlock, distributionId, rewardTokenAddress, distributionAmountPerEpoch, totalRewardAmount);
    }

    // ============================ GOVERNANCE FUNCTIONS ===========================
    function setBlocksPerEpoch(uint64 _blocksPerEpoch) external onlyOwner {
        blocksPerEpoch = _blocksPerEpoch;
        emit BlocksPerEpochUpdated(_blocksPerEpoch);
    }

    /// @notice Sets the protocol fees on deposit
    function setProtocolFee(uint256 _protocolFee) external onlyOwner {
        require(_protocolFee < BASE_9, "Protocol fee is based on 10**9");
        protocolFee = _protocolFee;
        emit ProtocolFeeSet(_protocolFee);
    }

    /// @notice Toggles the whitelist for `token`
    function toggleTokenWhitelist(address token) external onlyOwner {
        uint256 toggleStatus = 1 - isWhitelistedRewardToken[token];
        isWhitelistedRewardToken[token] = toggleStatus;
        emit TokenRewardWhitelistToggled(token, toggleStatus);
    }

    /// @notice Sets a new address to receive fees
    function setProtocolFeeRecipient(address _feeRecipient) external onlyOwner {
        protocolFeeRecipient = _feeRecipient;
        emit ProtocolFeeRecipientUpdated(_feeRecipient);
    }

    receive() external payable {} // The contract can now receive Ether from other

    function getDistributionsAmount() external view returns (uint256) {
        return distributionList.length;
    }

    function getDistributionId(uint256 idx) external view returns(bytes32) {
        return distributionList[idx].distributionId;
    }

    function getHypervisor(uint256 idx) external view returns (address) {
        return distributionList[idx].hypervisor;
    }
}