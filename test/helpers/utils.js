const { BN, ether } = require('@openzeppelin/test-helpers');

const addr1PrivateKey = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function price (val) {
    return ether(val).toString();
}

function toBN (num) {
    return new BN(num);
}

function trim0x (bigNumber) {
    const s = bigNumber.toString();
    if (s.startsWith('0x')) {
        return s.substring(2);
    }
    return s;
}

function cutSelector (data) {
    const hexPrefix = '0x';
    return hexPrefix + data.substring(hexPrefix.length + 8);
}

function cutLastArg (data, padding=0) {
    return data.substring(0, data.length - 64 - padding);
}

function joinStaticCalls (targets, datas) {
    const data = datas.map((d, i) => trim0x(targets[i]) + trim0x(d));
    const cumulativeSum = (sum => value => sum += value)(0);
    return {
        offsets: data
            .map(d => d.length / 2)
            .map(cumulativeSum)
            .reduce((acc, val, i) => acc.or(toBN(val).shln(32 * i)), toBN('0')),
        data: '0x' + data.join('')
    }
}

module.exports = {
    addr1PrivateKey,
    joinStaticCalls,
    price,
    toBN,
    cutSelector,
    cutLastArg,
    trim0x,
};
