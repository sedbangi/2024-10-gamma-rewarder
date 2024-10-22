import mongoose from "mongoose";
import { ITreeData } from "../interface";
import { Tree } from "../models/tree";

export async function connectDB() {
    try {
        await mongoose.connect('mongodb://localhost/gamma')
    } catch (error: any) {
        console.log("Disconnected: ", error)
        if (error.name === 'MongoNetworkError' || error.message.includes('ECONNREFUSED')) {
            // Handle MongoDB service not running or not accessible
            console.error('MongoDB service is not running or not accessible.');
        } else {
            // Handle other errors
            console.error(error);
        }
    }
}

export async function findTrees(): Promise<ITreeData[]> {
    let trees:ITreeData[] = await Tree.find()
    return trees
}

export async function findLastTree(): Promise<any> {
    let lastTree = await Tree.find().sort({_id: -1}).limit(1)
    if(lastTree.length > 0)
        return lastTree[0]
    else
        return undefined
}

export function closeDb() {
    mongoose.connection.close()
}