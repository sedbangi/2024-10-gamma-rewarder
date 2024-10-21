import mongoose from "mongoose";

const treeSchema = new mongoose.Schema({
    root: String,
    leafHashes: Array,
    leaves: Array,
})

treeSchema.set('timestamps', true)

const Tree = mongoose.model('trees', treeSchema)

export {Tree}