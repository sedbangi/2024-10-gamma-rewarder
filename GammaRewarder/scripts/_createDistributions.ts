async function _createDistributions(
    _gammaRewarder: any,
    _incentivizors: object[], // [A, B, C]
    _gammaVaultAddr: string,
    _mockTockens: string[], // [A, B, C]
    _timeStamp: number,
    _distributionAmounts: number[], // [1000, 2000, 3000],
    _numEpochs: number[] // [20, 100, 50]
) {
    for (let i = 0 ; i < _mockTockens.length ; i++) {
        for(let j = 0 ; j < _incentivizors.length ; j++) {
            await _gammaRewarder.connect(_incentivizors[j]).createDistribution(
                _gammaVaultAddr,
                _mockTockens[i],
                _distributionAmounts[j],
                _timeStamp,
                _numEpochs[j]
            )
        }
    }
}

export {_createDistributions}