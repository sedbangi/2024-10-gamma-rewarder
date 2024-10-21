import { ethers } from "hardhat";
import fs from 'fs';
import { join } from 'path';

export function getRoundedTimestamp(_timestamp: number): number {
    return Math.round(_timestamp / 3600) * 3600;
}

export async function getCurrentTimeStamp(): Promise<number> {
    const blockNumber = await ethers.provider.getBlockNumber()
    const blockT = await ethers.provider.getBlock(blockNumber)
    let currentTimeStamp = blockT?.timestamp?blockT.timestamp:0
    return currentTimeStamp;
}

export function getEpochAmount(_start: number, _end: number): number {
    let endEpoch = getRoundedTimestamp(_end)
    let startEpoch = getRoundedTimestamp(_start)
    return (endEpoch - startEpoch) / 3600
}

interface IDistribution {
    rewardId: string,
    hypervisor: string,
    rewardToken: string,
    amount: number,
    epochStart: number,
    numEpoch: number,
    incentivizor: string
}
// Aggregate amounts of distributions by reward token address
export function getAggregatedDistributionsByToken(_distributions: IDistribution[]):any {
    const aggregatedDistributions = new Map<string, number>();
    _distributions.forEach(_distribution => {
        const { rewardToken, amount, numEpoch } = _distribution;
        if (aggregatedDistributions.has(rewardToken)) {
            aggregatedDistributions.set(rewardToken, aggregatedDistributions.get(rewardToken)! + Number(amount / numEpoch));
        } else {
            aggregatedDistributions.set(rewardToken, Number(amount));
        }
    });
    return aggregatedDistributions;
}

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
export function writeMerkleTreeJsonFile(treeData: IMerkleTreeJson) {
    let treeDataJson = JSON.stringify(treeData);
    fs.writeFile(
        join(__dirname, 'merkleTree.json'),
        treeDataJson,
        (err) => {
            if (err) {
                console.log('Error writing file:', err);
            } else {
                console.log('Successfully wrote file');
            }
        }
    );
}

export function readMerkleTreeJsonFile(): IMerkleTreeJson | undefined {
    const treeData = fs.readFileSync(join(__dirname, 'merkleTree.json'), "utf-8")
    if(treeData) {
        const jsonData = JSON.parse(treeData)
        return jsonData
    } else {
        return undefined
    }
}

export function getLeafFromTreeJsonData(treeJsonData: IMerkleTreeJson, lpAddress: string): IMerkleLeaf[] {
    return treeJsonData.leaves.filter(leaf => leaf.lpAddress === lpAddress)
}