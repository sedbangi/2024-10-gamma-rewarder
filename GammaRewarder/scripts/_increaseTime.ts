import {time} from '@nomicfoundation/hardhat-network-helpers'

export async function _increaseTime(times: number) {
    try {
        await time.increase(times * 3600)
        console.log(`${times} hours are passed.`)
    } catch (error) {
        console.log(`Time passing error: ${error}`)
    }
}
