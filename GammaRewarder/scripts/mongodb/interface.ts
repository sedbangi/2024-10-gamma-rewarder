export interface ILeaf {
    lpAddress: string,
    rewardToken: string,
    rewardAmount: number
}

export interface ITreeData {
    _id?: any,
    root: string,
    leafHashes: string[],
    leaves: ILeaf[],
}

export interface IProof {
    position: "left" | "right";
    data: Buffer;
}