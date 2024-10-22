# GammaRewarder Technical Documentation

## Description
GammaRewarder is a smart contract system designed to manage and distribute rewards to users of Gamma Hypervisors (LP Vaults). The system leverages zero-knowledge proofs through the Brevis protocol to verify user eligibility and process reward claims. Incentivizers can create reward distributions by depositing tokens, which are then distributed to eligible users over specified time periods. The system features epoch-based distribution, protocol fees, and a token whitelist system to ensure secure and efficient reward management.

## Contract Architecture
The system consists of a single main contract (`GammaRewarder`) that inherits from:
- `BrevisApp`: Handles zero-knowledge proof verification
- `ReentrancyGuard`: Prevents reentrancy attacks
- `Ownable`: Manages administrative access

## Actors and Capabilities

### Owner
Capabilities:
- Set blocks per epoch
- Set protocol fee
- Set protocol fee recipient
- Manage reward token whitelist
- Add/remove verification key hashes

### Incentivizer
Capabilities:
- Create new reward distributions
- Must approve tokens to contract
- Cannot modify existing distributions

### Users
Capabilities:
- Cannot directly interact with contract
- Submit proofs off-chain
- Receive rewards through Brevis system

### Brevis System
Capabilities:
- Verifies user proofs
- Calls handleProofResult to process claims
- Manages proof submission and verification

## Technical Specifications

### Reward Distribution Process
1. Incentivizer creates distribution:
   - Specifies Hypervisor and reward token
   - Sets distribution period
   - Transfers reward tokens

2. Distribution parameters:
   - Start and end block numbers
   - Amount per epoch
   - Total distribution amount
   - Protocol fee taken upfront

### Claiming Process
1. Users generate proofs off-chain
2. Brevis system verifies proofs
3. Contract validates:
   - Distribution parameters
   - Claim period
   - Previous claims
4. Rewards transferred upon successful verification

## Security Features
- Reentrancy protection
- SafeERC20 implementation
- Zero address checks
- Token whitelist system
- Proof verification system

## Key Parameters
- `BASE_9`: 1e9 (base for protocol fee calculation)
- `MAX_DISTRIBUTION_BLOCKS`: 9,676,800 (4 weeks worth of blocks)
- `blocksPerEpoch`: Configurable epoch length
- `protocolFee`: Fee taken from distributions (in BASE_9 units)

## Distribution Requirements
1. Valid Hypervisor address
2. Whitelisted reward token
3. Distribution period > current block
4. Distribution length ≤ MAX_DISTRIBUTION_BLOCKS
5. Distribution length = multiple of blocksPerEpoch
6. Sufficient token approval

## Limitations
- Block-based timing system
- Cannot verify non-participation
- Relies on off-chain proof generation

## Dependencies
- OpenZeppelin Contracts
  - SafeERC20
  - ReentrancyGuard
  - Ownable
- Brevis Proof System
  - BrevisApp
  - IBrevisProof

## Events
- `Claimed`: Emitted when rewards are claimed
- `NewDistribution`: Emitted when distribution is created
- `BlocksPerEpochUpdated`: Emitted when epoch length changes
- `ProtocolFeeSet`: Emitted when fee changes
- `TokenRewardWhitelistToggled`: Emitted when token whitelist status changes

## Error Handling
The contract implements strict validation with clear error messages for:
- Zero address validations
- Block range validations
- Distribution period validations
- Token approval checks
- Claim validations
- Proof verification checks

# Build Instructions

## Environment Setup

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Git

### Installation
```bash
# Clone the repository
git clone https://github.com/GammaStrategies/GammaRewarder.git
cd GammaRewarder

# Install dependencies
npm install
# or 
yarn install
```

## Build and Test

### Compile Contracts
```bash
npx hardhat compile
```

### Run Tests
```bash
npx hardhat test
```

### Test Coverage
```bash
npx hardhat coverage
```

### Deploy Contract
```bash
npx hardhat run scripts/deploy.ts --network <network_name>
```

## Test Environment Details

### Required Components
- Mock ERC20 token implementation
- Test accounts (provided by Hardhat)
- Brevis system mock (0xa83852A6a073C43423CC41241f7Fb2ba4C0DDD77)

### Test Parameters
```
Hypervisor: 0x904135ac233e53fc1c1A5B061D34496b362489c3
Distribution Amount: 10000 tokens
Start Block: 195609600
End Block: 195782400
VK Hash: 0x2a3e3871a6dd2ffe0012e82243e19567a1cf8df985e0f55e688fc88c3e0f94d1
```

### Project Structure
```
.
├── contracts/
│   ├── GammaRewarder.sol
│   ├── brevis/
│   └── mocks/
├── test/
│   └── Audit.ts
├── scripts/
├── hardhat.config.ts
└── package.json
```

### Hardhat Configuration
```typescript
// hardhat.config.ts
export default {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  }
};
```

