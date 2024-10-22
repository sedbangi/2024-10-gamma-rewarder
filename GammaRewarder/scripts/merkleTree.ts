import { ethers } from 'ethers'
import { MerkleTree } from 'merkletreejs'

interface IDistribution {
    rewardToken: string;
    amount: number;
}

interface ILPShares {
    lpAddress: string;
    shares: number;
}

interface IMerkleLeaf {
    lpAddress: string;
    rewardToken: string;
    rewardAmount: number;
}

/**
 * @notice Generate new Merkle Tree
 * @param lpShares Array of shares amount which each LPs hold
 * @param distributions Array of distributions for the current time which is represented as Epoch
 * @returns merkleTree new Merkle tree
 */
export function generateTree(lpShares: ILPShares[], distributions: IDistribution[]): Object {
    // Aggregate amounts of distributions by reward token address
    const aggregatedAmounts = new Map<string, number>();
    distributions.forEach(_distribution => {
        const { rewardToken, amount } = _distribution;
        if (aggregatedAmounts.has(rewardToken)) {
            aggregatedAmounts.set(rewardToken, aggregatedAmounts.get(rewardToken)! + amount);
        } else {
            aggregatedAmounts.set(rewardToken, amount);
        }
    });

    // Get total shares of lp
    let totalShares = 0;
    for(let i = 0 ; i < lpShares.length ; i++) {
        totalShares += lpShares[i].shares;
    }

    // Get leaves based on aggregated distributions and lp shares
    let leaves: IMerkleLeaf[] = [];
    for(let i = 0 ; i < lpShares.length ; i++) {
        for (const [address, amount] of aggregatedAmounts) {
            let _reward = amount * lpShares[i].shares / totalShares;
            leaves.push({
                lpAddress: lpShares[i].lpAddress,
                rewardToken: address,
                rewardAmount: _reward
            });
        }
    }

    const leafHashes = leaves.map((item) => {
        console.log(`${item.lpAddress}${item.rewardToken}${item.rewardAmount}`)
        return ethers.keccak256(ethers.toUtf8Bytes(`${item.lpAddress}${item.rewardToken}${item.rewardAmount}`))
    })
    
    const tree = new MerkleTree(leafHashes, ethers.keccak256, {sortPairs: true})
    const root = tree.getHexRoot()
    return tree;
}