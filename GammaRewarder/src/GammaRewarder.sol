pragma solidity ^0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

struct DistributionParameters {
    // ID of the reward (populated once created). This can be left as a null bytes32 when 
    // creating distributions on Merkl.
    bytes32 rewardId;
    // Address of the Gamma Hypervisor that needs to be incentivized
    address hypervisor;
    // Address of the reward token for the incentives
    address rewardToken;
    // Amount of `rewardToken` to distribute across all the epochs
    // Amount distributed per epoch is `amount/numEpoch`
    uint256 amount;
    // Timestamp at which the incentivization should start. This is in the same units as `block.timestamp`.
    uint32 epochStart;
    // Amount of epochs for which incentivization should last. Epochs are expressed in hours here, so for a
    // campaign of 1 week `numEpoch` should for instance be 168.
    uint32 numEpoch;
    // Wallet address of incentivizor who creates this distribution
    address incentivizor;
}

struct Claim {
    uint208 amount;
    uint48 timestamp;
    bytes32 merkleTree;
}

contract GammaRewarder is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // =========================== CONSTANTS / VARIABLES ===========================
    /// @notice Avoid multiple initialization
    bool private isInitialized = false;
    /// @notice Epoch duration
    uint32 public constant EPOCH_UNIT_IN_SECONDS = 3600;

    /// @notice Base for protocol fee computation
    uint256 public constant BASE_9 = 1e9;

    /// @notice User contract for distributing rewards
    /// All distributions are stored at this address.
    address public distributor;

    /// @notice List of all rewards ever distributed or to be distributed in the contract
    /// @dev An attacker could try to populate this list. It shouldn't be an issue as only view functions
    /// iterate on it
    DistributionParameters[] public distributionList;

    mapping(address => uint256[]) public distributionIdByIncentivisor;
    mapping(uint256 => uint256) public remainingRewardsById;
    mapping(address => uint256[]) distributionListByIncentivisor;

    /// @notice Maps a reward token to whether it is whitelisted or not.
    mapping(address => uint256) public isWhitelistedRewardToken;

    /// @notice Maps an address to its nonce for creating a distribution
    mapping(address => uint256) public nonces;

    /// @notice Value (in base 10**9) of the fees taken when creating a distribution for a pool 
    /// If protocol fee is 1%, `protocolFee` is 10**7.
    uint256 public protocolFee;

    /// @notice Address to which fees are forwarded
    address public protocolFeeRecipient;

    /// @notice Root of Merkle Tree
    bytes32 public merkleTree;

    /// @notice Tree that was in place in the contract before the last `tree` update
    bytes32 public lastMerkleTree;

    /// @notice Token to deposit to freeze the roots update
    IERC20 public disputeToken;

    /// @notice Address which created the dispute
    /// @dev Used to store if there is an ongoing dispute
    address public disputer;

    /// @notice When the current tree will become valid
    uint48 public endOfDisputePeriod;

    /// @notice Time after which a change in a tree becomes effective, in EPOCH_UNIT_IN_SECONDS
    uint48 public disputePeriod;

    /// @notice Amount to deposit to freeze the roots update
    uint256 public disputeAmount;

    /// @notice Mapping user -> token -> amount to track claimed amounts
    mapping(address => mapping(address => Claim)) public claimed;

    /// @notice Incentivizor can reclaim remaining reward tokens after this period
    uint256 public reclaimPeriod;

    // =================================== EVENTS ==================================

    event Claimed(address indexed user, address indexed token, uint256 amount);
    event DisputeAmountUpdated(uint256 _disputeAmount);
    event Disputed(string reason);
    event DisputePeriodUpdated(uint48 _disputePeriod);
    event DisputeResolved(bool valid);
    event DisputeTokenUpdated(address indexed _disputeToken);
    event DistributorUpdated(address indexed _distributor);
    event NewDistribution(DistributionParameters distribution, address indexed sender);
    event ProtocolFeeRecipientUpdated(address indexed _feeRecipient);
    event ProtocolFeeSet(uint256 _protocolFee);
    event ReclaimPeriodUpdated(uint256 _reclaimPeriod);
    event Revoked(); // With this event an indexer could maintain a table (timestamp, merkleRootUpdate)
    event TokenRewardWhitelistToggled(address indexed token, uint256 toggleStatus); 
    event TreeUpdated(bytes32 merkleTree, uint48 endOfDisputePeriod);
    
    // ================================= MODIFIERS =================================


    // ================================ CONSTRUCTOR ================================

    function initialize( address _distributor, uint256 _protocolFee ) external {
        require(_distributor != address(0), "Distributor Address can not be zero.");
        require(!isInitialized, "Contract has been already initialized.");
        isInitialized = true;
        distributor = _distributor;
        protocolFee = _protocolFee;
    }

    constructor() Ownable(msg.sender) {}

    // ================================ MAIN FUNCTION ================================

    function createDistribution(
        address _hypervisor,
        address _rewardToken,
        uint256 _rewardAmount,
        uint32 _epochStart,
        uint32 _numEpoch
    ) external nonReentrant returns (uint256 distributionAmount) {
        // Get the least time stamp rounded by Epoch_duration
        uint32 epochStart = _getRoundedEpoch(_epochStart);

        // Reward are not accepted in the following conditions:
        // if epoch parameters lead to a past distribution
        // if the amount of epochs for which this distribution should last is zero
        require(epochStart + EPOCH_UNIT_IN_SECONDS >= block.timestamp && _numEpoch > 0, "The first distribution time has to be backward and the amount of epoch has to be greater than zero.");

        // Distribution Amount has to be greater than zero
        require(_rewardAmount > 0, "Distribution Amount has to be greater than zero.");

        // Distribution token has to be whitelisted
        require(isWhitelistedRewardToken[_rewardToken] == 1, "Reward token has to be whitelisted.");

        distributionAmount = _rewardAmount;
        uint256 distributionProtocolFee = distributionAmount * (protocolFee / BASE_9);
        uint256 distributionAmountMinusFee = distributionAmount - distributionProtocolFee;
        
        // transfer protocol fee to fee receipient
        address _feeRecipient = protocolFeeRecipient;
        _feeRecipient = _feeRecipient == address(0) ? address(this) : _feeRecipient;
        IERC20(_rewardToken).safeTransferFrom(msg.sender, _feeRecipient, distributionProtocolFee);

        // transfer amount minus fee to distributor
        IERC20(_rewardToken).safeTransferFrom(msg.sender, distributor, distributionAmountMinusFee);

        uint256 senderNonce = nonces[msg.sender];
        nonces[msg.sender] = senderNonce + 1;
        DistributionParameters memory newDistribution = DistributionParameters({
            rewardId: bytes32(keccak256(abi.encodePacked(msg.sender, senderNonce))),
            hypervisor: _hypervisor,
            rewardToken: _rewardToken,
            amount: distributionAmountMinusFee,
            epochStart: epochStart,
            numEpoch: _numEpoch,
            incentivizor: msg.sender
        });
        distributionListByIncentivisor[msg.sender].push(distributionList.length);
        distributionList.push(newDistribution);
        emit NewDistribution(newDistribution, msg.sender);
    }

    function reclaimRemainingDistribution() external {
        // check if the distribution period is finished
        uint256[] storage _distributionId = distributionListByIncentivisor[msg.sender];
        for(uint i = 0 ; i < _distributionId.length ; i++) {
            // reward token address: distributionList[_distributionId[i]].rewardToken
            // remaining token amount: remainingRewardsById[_distributionId[i]]
            IERC20(distributionList[_distributionId[i]].rewardToken).safeTransfer(msg.sender, remainingRewardsById[_distributionId[i]]);
        }
    }

    function claim(
        address user,
        address token,
        uint256 amount,
        bytes32[] calldata proof
    ) external {
        // verifying proof
        bytes32 leaf = keccak256(abi.encode(user, token, amount));
        require(_verifyProof(leaf, proof), "Merkle Tree is not verified.");

        // Closing reentrancy gate here
        uint256 toSend = amount - claimed[user][token].amount;
        claimed[user][token] = Claim(SafeCast.toUint208(amount), uint48(block.timestamp), getMerkleRoot());

        IERC20(token).safeTransfer(user, toSend);
        emit Claimed(user, token, toSend);
    }

    function dispute(string memory reason) external {
        require(disputer == address(0), "The current dispute is not yet resolved");
        require(block.timestamp < endOfDisputePeriod, "The dispute period has already ended.");
        IERC20(disputeToken).safeTransferFrom(msg.sender, address(this), disputeAmount);
        disputer = msg.sender;
        emit Disputed(reason);
    }


    /// @notice Returns the MerkleRoot that is currently live for the contract
    function getMerkleRoot() public view returns (bytes32) {
        if (block.timestamp >= endOfDisputePeriod && disputer == address(0))
            return merkleTree;
        else
            return lastMerkleTree;
    }

    // ============================ GOVERNANCE FUNCTIONS ===========================
    
    /// @notice Updates Merkle Tree
    function updateTree(bytes32 _merkleRoot) external onlyOwner {
        require(disputer == address(0), "Can not update current tree because that is in dispute now.");
        require(block.timestamp >= endOfDisputePeriod, "Can not update current tree because that is in dispute now.");
        lastMerkleTree = merkleTree;
        merkleTree = _merkleRoot;

        uint48 _endOfPeriod = _endOfDisputePeriod(uint48(block.timestamp));
        endOfDisputePeriod = _endOfPeriod;
        emit TreeUpdated(_merkleRoot, _endOfPeriod);
    }

    /// @notice Sets a new `distributor` to which rewards should be distributed
    function setNewDistributor(address _distributor) external onlyOwner {
        require(_distributor != address(0), "New distributor address can not be zero.");
        distributor = _distributor;
        emit DistributorUpdated(_distributor);
    }

    /// @notice Sets the protocol fees on deposit
    function setProtocolFee(uint256 _protocolFee) external onlyOwner {
        // if (_fees >= BASE_9) revert InvalidParam();
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

    /// @notice Sets the dispute period after which a tree update becomes effective
    function setDisputePeriod(uint48 _disputePeriod) external onlyOwner {
        disputePeriod = _disputePeriod;
        emit DisputePeriodUpdated(_disputePeriod);
    }

    /// @notice Sets the token used as a caution during disputes
    function setDisputeToken(IERC20 _disputeToken) external onlyOwner {
        require(disputer == address(0), "Can not set dispute token during the dispute is existing.");
        disputeToken = _disputeToken;
        emit DisputeTokenUpdated(address(_disputeToken));
    }

    /// @notice Sets the amount of `disputeToken` used as a caution during disputes
    function setDisputeAmount(uint256 _disputeAmount) external onlyOwner {
        require(disputer == address(0), "Can not set dispute amount during the dispute is existing.");
        disputeAmount = _disputeAmount;
        emit DisputeAmountUpdated(_disputeAmount);
    }

    /// @notice Sets a new address to receive fees
    function setProtocolFeeRecipient(address _feeRecipient) external onlyOwner {
        protocolFeeRecipient = _feeRecipient;
        emit ProtocolFeeRecipientUpdated(_feeRecipient);
    }

    /// @notice Resolve the ongoing dispute, if any
    /// @param valid Whether the dispute was valid
    function resolveDispute(bool valid) external onlyOwner {
        require(disputer != address(0), "Dispute does not exist.");
        if (valid) {
            IERC20(disputeToken).safeTransfer(disputer, disputeAmount);
            // If a dispute is valid, the contract falls back to the last tree that was updated
            _revokeTree();
        } else {
            IERC20(disputeToken).safeTransfer(msg.sender, disputeAmount);
            endOfDisputePeriod = _endOfDisputePeriod(uint48(block.timestamp));
        }
        disputer = address(0);
        emit DisputeResolved(valid);
    }

    function setReclaimPeriod(uint256 _reclaimPeriod) external onlyOwner {
        reclaimPeriod = _reclaimPeriod;
        emit ReclaimPeriodUpdated(_reclaimPeriod);
    }

    // ================================= UI HELPERS ================================
    // These functions are not to be queried on-chain and hence are not optimized for gas consumption

    /// @notice Returns the list of all distributions ever made or to be done in the future
    function getAllDistributions() external view returns (DistributionParameters[] memory) {
        return distributionList;
    }

    /// @notice Returns the list of all currently active distributions on Hypervisors
    function getActiveDistributions()
        external
        view
        returns (DistributionParameters[] memory searchDistributions)
    {
        uint32 roundedEpoch = _getRoundedEpoch(uint32(block.timestamp));
        (searchDistributions, ) = _getDistributionsBetweenEpochs(
            address(0),
            roundedEpoch,
            roundedEpoch + EPOCH_UNIT_IN_SECONDS,
            0,
            type(uint32).max
        );
    }

    /// @notice Returns the list of all the distributions that were or that are going to be live at a
    /// specific epoch and for a specific pool
    function getDistributionsForEpoch(
        address hypervisor,
        uint32 epoch // timestamp unit
    ) external view returns (DistributionParameters[] memory searchDistributions) {
        uint32 roundedEpoch = _getRoundedEpoch(epoch);
        (searchDistributions, ) = _getDistributionsBetweenEpochs(
            hypervisor,
            roundedEpoch,
            roundedEpoch + EPOCH_UNIT_IN_SECONDS,
            0,
            type(uint32).max
        );
    }

    /// @notice Similar to `getDistributionsForEpoch(address hypervisor,uint32 epoch)` with additional parameters to prevent out of gas error
    /// @param skip Disregard distibutions with a global index lower than `skip`
    /// @param first Limit the length of the returned array to `first`
    /// @return searchDistributions Eligible distributions
    /// @return lastIndexDistribution Index of the last distribution assessed in the list of all distributions
    /// For pagniation purpose, in case of out of gas, you can call back the same function but with `skip` set to `lastIndexDistribution`
    function getDistributionsForEpoch(
        address hypervisor,
        uint32 epoch,
        uint32 skip,
        uint32 first
    ) external view returns (DistributionParameters[] memory, uint256 lastIndexDistribution) {
        uint32 roundedEpoch = _getRoundedEpoch(epoch);
        return _getDistributionsBetweenEpochs(hypervisor, roundedEpoch, roundedEpoch + EPOCH_UNIT_IN_SECONDS, skip, first);
    }

    // ============================== INTERNAL HELPERS =============================

    /// @notice Rounds an `epoch` timestamp to the start of the corresponding period
    function _getRoundedEpoch(uint32 timestamp) internal pure returns (uint32) {
        return (timestamp / EPOCH_UNIT_IN_SECONDS) * EPOCH_UNIT_IN_SECONDS;
    }

    /// @notice Fallback to the last version of the tree
    function _revokeTree() internal {
        endOfDisputePeriod = 0;
        merkleTree = lastMerkleTree;
        emit Revoked();
        emit TreeUpdated(
            merkleTree,
            (uint48(block.timestamp) / EPOCH_UNIT_IN_SECONDS) * (EPOCH_UNIT_IN_SECONDS) // Last hour
        );
    }

    /// @notice Returns the end of the dispute period
    /// @dev `treeUpdatedTimestamp` is rounded up to next hour and then `disputePeriod` hours are added
    function _endOfDisputePeriod(uint48 treeUpdatedTimestamp) internal view returns(uint48) {
        require(disputePeriod > 0, "Dispute period is not defined.");
        return ((treeUpdatedTimestamp - 1) / EPOCH_UNIT_IN_SECONDS + 1 + disputePeriod) * (EPOCH_UNIT_IN_SECONDS);
    }

    /// @notice Checks the validity of a proof
    /// @param leaf Hashed leaf data, the starting point of the proof
    /// @param proof Array of hashes forming a hash chain from leaf to root
    /// @return true If proof is correct, else false
    function _verifyProof(bytes32 leaf, bytes32[] memory proof) internal view returns (bool) {
        bytes32 root = getMerkleRoot();
        require(root != bytes32(0), "Merkle Root is not initialized");
        bytes32 currentHash = leaf;
        uint256 proofLength = proof.length;
        for (uint256 i; i < proofLength; ) {
            if (currentHash < proof[i]) {
                currentHash = keccak256(abi.encode(currentHash, proof[i]));
            } else {
                currentHash = keccak256(abi.encode(proof[i], currentHash));
            }
            unchecked {
                ++i;
            }
        }
        return currentHash == root;
    }


    /// @notice Checks whether `distribution` was live between `roundedEpochStart` and `roundedEpochEnd`
    function _isDistributionLiveBetweenEpochs(
        DistributionParameters memory distribution,
        uint32 roundedEpochStart,
        uint32 roundedEpochEnd
    ) internal pure returns (bool) {
        uint256 distributionEpochStart = distribution.epochStart;
        return (distributionEpochStart + distribution.numEpoch * EPOCH_UNIT_IN_SECONDS > roundedEpochStart &&
            distributionEpochStart < roundedEpochEnd);
    }

    /// @notice Gets the list of all the distributions for `Hypervisor` that have been active between `epochStart` and `epochEnd` (excluded)
    /// @dev If the `Hypervisor` parameter is equal to 0, then this function will return the distributions for all pools
    function _getDistributionsBetweenEpochs(
        address hypervisor,
        uint32 epochStart,
        uint32 epochEnd,
        uint32 skip,
        uint32 first // the length of return distributions 
    ) internal view returns (DistributionParameters[] memory, uint256) {
        uint256 length;
        uint256 distributionListLength = distributionList.length;
        uint256 returnSize = first > distributionListLength ? distributionListLength : first;
        DistributionParameters[] memory activeRewards = new DistributionParameters[](returnSize);
        uint32 i = skip;

        while(i < distributionListLength) {
            DistributionParameters memory distribution = distributionList[i];
            if (
                _isDistributionLiveBetweenEpochs(distribution, epochStart, epochEnd) &&
                (hypervisor == address(0) || distribution.hypervisor == hypervisor)
            ) {
                activeRewards[length] = distribution;
                length += 1;
            }
            unchecked {
                ++i;
            }
            if(length == returnSize) break;
        }

        assembly {
            mstore(activeRewards, length)
        }

        return (activeRewards, i);
    }
}